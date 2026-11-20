import "server-only";
import { NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { isProgramId, type ProgramId } from "@/config/programs/types";
import { programPath } from "@/lib/firebase/paths";
import { countSnapshot, meterDb } from "@/lib/server/read-meter";
import { isQuotaError } from "@/lib/server/memberships";
import { serverSignInProblem, verifyBearerToken } from "@/lib/server/require-user";
import { getSnapshotSettings } from "@/lib/server/team-settings";
import { ChunkMissing, getPart, type PartResult } from "@/lib/server/snapshot-cache";
import { datasetParts } from "@/lib/server/snapshot-datasets";
import { HEADER_BUILT_AT, HEADER_CACHE, HEADER_CHUNKS, HEADER_OVERSIZE, HEADER_STALE, IMPLEMENTED_DATASETS, byteLength, datasetEnabled, isSnapshotDataset, type CacheStatus, type SnapshotMeta } from "@/lib/snapshot/model";

/**
 * GET /api/snapshot/<dataset>?program=<id>&chunk=<n>&refresh=1 (read reduction 2a).
 *
 * AUTHORIZATION, in this order, with the cheapest checks first:
 *   1. the Bearer ID token is verified locally (no Firestore read);
 *   2. the dataset is on: the master switch AND its own switch (one shared appSettings snapshot, about 30 s per instance), else 404 `snapshot_disabled`;
 *   3. ONE fresh read of the caller's user document in that program gives the ACTIVE team (the pointer). It is read on EVERY request and never cached: a cached
 *      pointer could keep serving the old team's data after a switch. The browser never sends a team id, and nothing in the cache key comes from the request.
 * Under today's rules the pointer is client-writable, so this route is EQUAL to the current exposure (any signed-in user can already read these collections
 * straight from Firestore), not stricter; closing that is the post-release rules hardening.
 *
 * The answer is `private, no-store` at the HTTP layer: the shared cache lives on the server only (lib/server/snapshot-cache.ts).
 */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 90;
const calls = new Map<string, { windowStart: number; n: number }>();

/** A cheap per-instance guard against a signed-in script hammering the route (each call costs one user-document read). */
function limited(uid: string, now: number): boolean {
  const entry = calls.get(uid);
  if (!entry || now - entry.windowStart >= RATE_WINDOW_MS) {
    calls.set(uid, { windowStart: now, n: 1 });
    if (calls.size > 2_000) calls.clear();
    return false;
  }
  entry.n += 1;
  return entry.n > RATE_MAX;
}

export function resetSnapshotRateForTests(): void {
  calls.clear();
}

const json = (status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", ...headers } });
const fail = (status: number, code: string, error: string, extra: Record<string, unknown> = {}) => json(status, { ok: false, code, error, ...extra });

const ORDER: CacheStatus[] = ["REBUILD", "MISS", "THROTTLED", "HIT"];
const worst = (statuses: CacheStatus[]): CacheStatus => ORDER.find((s) => statuses.includes(s)) ?? "HIT";

export async function handleSnapshot(request: Request, datasetParam: string, nowMs: number = Date.now()): Promise<NextResponse> {
  if (!isSnapshotDataset(datasetParam)) return fail(404, "unknown_dataset", "Unknown snapshot dataset.");
  const dataset = datasetParam;
  if (!IMPLEMENTED_DATASETS.includes(dataset)) return fail(404, "snapshot_not_available", "This snapshot is not available yet.");

  const decoded = await verifyBearerToken(request);
  if (!decoded) {
    const problem = serverSignInProblem();
    return problem ? fail(503, "server_not_configured", problem) : fail(401, "not_signed_in", "Not signed in.");
  }
  const rawDb = getAdminFirestore();
  if (!rawDb) return fail(503, "server_not_configured", "Server isn't configured.");

  const url = new URL(request.url);
  const programParam = url.searchParams.get("program");
  if (!programParam) return fail(400, "program_required", "Missing program.");
  if (!isProgramId(programParam)) return fail(400, "unknown_program", "Unknown program.");
  const program: ProgramId = programParam;
  const chunkParam = url.searchParams.get("chunk");
  const chunkIndex = chunkParam === null ? 0 : Number(chunkParam);
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex > 10_000) return fail(400, "bad_chunk", "Bad chunk.");
  const refresh = url.searchParams.get("refresh") === "1";

  if (limited(decoded.uid, nowMs)) return fail(429, "rate_limited", "Too many requests. Wait a moment.");

  const db = meterDb(rawDb, `api/snapshot/${dataset}`);
  try {
    const settings = await getSnapshotSettings(db, nowMs);
    if (!datasetEnabled(settings, dataset)) return fail(404, "snapshot_disabled", "This snapshot is not turned on.");

    // The ACTIVE team: one fresh read, never cached (see above). A person with no team has none.
    const userSnap = await db.doc(`${programPath(program, "users")}/${decoded.uid}`).get();
    const teamField = userSnap.exists ? userSnap.data()?.teamId : null;
    const teamId = typeof teamField === "string" && teamField.trim() !== "" ? teamField.trim() : null;

    const all = datasetParts(db, dataset, program, teamId ?? "");
    if (!all) return fail(404, "snapshot_not_available", "This snapshot is not available yet.");
    // A part keyed by team needs a team. The roster has no team-free part (403); the library's shared part needs none.
    const parts = all.filter((p) => p.scope === "program" || teamId !== null);
    if (parts.length === 0 || (dataset === "roster" && teamId === null)) return fail(403, "no_team", "This account has no team in this program.");

    const open = (force: boolean) =>
      Promise.all(
        parts.map((p) =>
          getPart({ program, dataset, name: p.name, scope: p.scope === "team" ? (teamId as string) : "*", ttlSeconds: settings.ttlSeconds[dataset], refresh, force, build: p.build, now: nowMs })
        )
      );
    let results: PartResult[] = await open(false);

    const locate = (rs: PartResult[]) => {
      let remaining = chunkIndex;
      for (const r of rs) {
        if (remaining < r.manifest.chunkCount) return { result: r, local: remaining };
        remaining -= r.manifest.chunkCount;
      }
      return null;
    };
    let at = locate(results);
    if (!at) return fail(400, "bad_chunk", "No such chunk.");
    let rows: unknown[];
    try {
      rows = await at.result.chunk(at.local);
    } catch (err) {
      if (!(err instanceof ChunkMissing)) throw err;
      // The chunk left the shared cache and this instance does not hold it: rebuild once.
      results = await open(true);
      at = locate(results);
      if (!at) return fail(400, "bad_chunk", "No such chunk.");
      rows = await at.result.chunk(at.local);
    }

    const status = worst(results.map((r) => r.status));
    const stale = results.some((r) => r.stale);
    const oversize = results.some((r) => r.oversize);
    const builtAt = Math.min(...results.map((r) => r.manifest.builtAt));
    const waits = results.map((r) => r.refreshWaitMs).filter((w): w is number => w !== null);
    const meta: SnapshotMeta = {
      ok: true,
      dataset,
      program,
      teamId: dataset === "library" && !parts.some((p) => p.scope === "team") ? null : teamId,
      builtAt,
      buildId: results.map((r) => r.manifest.buildId).join("+"),
      chunk: chunkIndex,
      chunks: results.reduce((n, r) => n + r.manifest.chunkCount, 0),
      stale,
      refreshWaitMs: refresh && waits.length > 0 ? Math.max(...waits) : null,
      rows,
    };
    const body = JSON.stringify(meta);
    countSnapshot(rawDb, dataset, "requests");
    countSnapshot(rawDb, dataset, status === "HIT" ? "hits" : status === "MISS" ? "misses" : status === "REBUILD" ? "rebuilds" : "throttled");
    if (stale) countSnapshot(rawDb, dataset, "stale");
    if (oversize) countSnapshot(rawDb, dataset, "oversize");
    countSnapshot(rawDb, dataset, "bytes", byteLength(body));
    countSnapshot(rawDb, dataset, "rows", rows.length);
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, no-store",
        [HEADER_CACHE]: status,
        [HEADER_BUILT_AT]: String(builtAt),
        [HEADER_CHUNKS]: String(meta.chunks),
        ...(oversize ? { [HEADER_OVERSIZE]: "1" } : {}),
        ...(stale ? { [HEADER_STALE]: "1" } : {}),
      },
    });
  } catch (err) {
    console.error("snapshot route failed:", err instanceof Error ? err.message : "unknown error");
    if (isQuotaError(err)) return fail(503, "quota_exceeded", "The database is over its daily usage limit right now. Try again later.");
    return fail(500, "server_error", "Something went wrong.");
  }
}
