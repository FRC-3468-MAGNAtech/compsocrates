import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { revalidateTag, unstable_cache } from "next/cache";
import { CACHE_ENTRY_CAP_BYTES, chunkBySize, isFresh, refreshWaitMs, toJsonSafe, type CacheStatus, type SnapshotDataset } from "@/lib/snapshot/model";

/**
 * THE SHARED CACHE of the snapshot routes (read reduction 2a). One part of a dataset (a team's roster, a program's library) is built from Firestore once per TTL and
 * served from Next's persisted data cache (`unstable_cache`) to every authorized member, whichever server instance answers. Nothing here reads the request, so it
 * is safe inside a cache scope; the caller has already authorized the team, and the key is made from that team only.
 *
 * FRESHNESS IS MANUAL. A part is stored as a manifest `{ builtAt, buildId, chunkCount, ... }` under a very long cache lifetime, with each chunk of rows in its own
 * cache entry (a cache entry may not exceed 2 MB, so a chunk is cut at about 1.2 MB of JSON). Every request compares `builtAt` with the TTL it was given (the owner can
 * change a TTL in `appSettings/global.snapshotTtl` without a deploy); a stale part is expired with `revalidateTag(tag, { expire: 0 })` and rebuilt in the same request.
 * A Refresh does the same, but only when the copy is older than the refresh throttle.
 *
 * HONEST LIMITS: whether the persisted cache is shared between instances depends on the host (checked on a preview with the `x-snapshot-cache` header). When a rebuild
 * fails the route serves the last copy THIS instance built or served (marked stale), because the expiry has already removed the shared one. A chunk over the cache cap
 * is never cached silently: it is reported (`oversize`) and held in this instance's memory for the TTL instead.
 */

const LONG_LIFETIME_SECONDS = 60 * 60 * 24 * 30;
const FAILURE_BACKOFF_MS = 30_000;
/** A copy kept in memory for stale serving is worth at most this much (datasets of a later phase can be large). */
const MEMORY_COPY_MAX_BYTES = 6 * 1024 * 1024;

export type PartSpec = {
  program: string;
  dataset: SnapshotDataset;
  /** `roster`, `library`, `library-own`: what part of the dataset this is. */
  name: string;
  /** The team for a team's part, `*` for a program-wide part. Derived by the server from the caller's user document, never taken from a request. */
  scope: string;
  ttlSeconds: number;
  refresh: boolean;
  /** Rebuild whatever the TTL and the throttle say (the route sets it once when a chunk it needs has left the shared cache). */
  force?: boolean;
  build: () => Promise<unknown[]>;
  now?: number;
};

export type Manifest = { v: 1; buildId: string; builtAt: number; chunkCount: number; bytes: number[]; rows: number; oversize: boolean };

export type PartResult = {
  manifest: Manifest;
  status: CacheStatus;
  stale: boolean;
  refreshWaitMs: number | null;
  oversize: boolean;
  /** The rows of one chunk. */
  chunk: (index: number) => Promise<unknown[]>;
};

/** A chunk the manifest names is no longer in the shared cache and this instance does not hold it: the caller rebuilds once (`force`). */
export class ChunkMissing extends Error {}

/** Chunks built by THIS instance and not yet (or never) readable from the shared cache: the bridge that puts a chunk into the cache, and the stale/oversize fallback. */
const memory = new Map<string, { manifest: Manifest; chunks: unknown[][]; at: number }>();
const inflight = new Map<string, Promise<Manifest>>();
const failures = new Map<string, { at: number; error: unknown }>();

export function resetSnapshotCacheForTests(): void {
  memory.clear();
  inflight.clear();
  failures.clear();
}

const keyOf = (spec: Pick<PartSpec, "program" | "dataset" | "name" | "scope">) => `${spec.program}:${spec.dataset}:${spec.name}:${spec.scope}`;
/** A tag is at most 256 characters; a long key is hashed. Tags never leave the server. */
const tagOf = (key: string) => `snap:${key.length <= 200 ? key : createHash("sha256").update(key).digest("hex")}`;

async function buildAndStore(spec: PartSpec, key: string, tag: string, now: number): Promise<Manifest> {
  const rows = ((await spec.build()) ?? []).map((row) => toJsonSafe(row));
  const { chunks, bytes } = chunkBySize(rows);
  const buildId = `${now.toString(36)}-${randomBytes(4).toString("hex")}`;
  const oversize = bytes.some((b) => b > CACHE_ENTRY_CAP_BYTES - 64 * 1024);
  const manifest: Manifest = { v: 1, buildId, builtAt: now, chunkCount: chunks.length, bytes, rows: rows.length, oversize };
  const total = bytes.reduce((a, b) => a + b, 0);
  if (total <= MEMORY_COPY_MAX_BYTES || oversize) memory.set(key, { manifest, chunks, at: now });
  if (!oversize) {
    // Put each chunk into the shared cache under its own key (the build id and the index).
    await Promise.all(
      chunks.map((_, i) =>
        unstable_cache(
          // Runs only on a cache miss, which for a chunk of the build just made is always: the closure holds the rows (no per-instance memory needed for big datasets).
          async () => chunks[i],
          ["snapshot", "v1", key, "chunk", buildId, String(i)],
          { tags: [tag], revalidate: LONG_LIFETIME_SECONDS }
        )()
      )
    );
  }
  return manifest;
}

/**
 * One part of a dataset, from the cache when fresh and rebuilt when not. `status`: HIT (served from the cache, fresh), MISS (nothing cached: built now), REBUILD (cached
 * but stale, refreshed or forced: expired and built now), THROTTLED (a Refresh arrived inside the throttle and the copy is still within its TTL: served as it is, with the wait).
 */
export async function getPart(spec: PartSpec): Promise<PartResult> {
  const now = spec.now ?? Date.now();
  const key = keyOf(spec);
  const tag = tagOf(key);

  let built = false;
  const manifestCache = unstable_cache(
    async (): Promise<Manifest> => {
      built = true;
      const pending = inflight.get(key);
      if (pending) return pending;
      const task = buildAndStore(spec, key, tag, now).finally(() => inflight.delete(key));
      inflight.set(key, task);
      return task;
    },
    ["snapshot", "v1", key, "manifest"],
    { tags: [tag], revalidate: LONG_LIFETIME_SECONDS }
  );

  const serveStale = (error: unknown): PartResult => {
    const held = memory.get(key);
    if (!held) throw error;
    return resultFrom(held.manifest, held.chunks, "HIT", true, null, key, tag);
  };

  // A rebuild failed a moment ago: do not hit Firestore again for every request; serve the last copy (or the same failure).
  const recent = failures.get(key);
  if (recent && now - recent.at < FAILURE_BACKOFF_MS) return serveStale(recent.error);

  let manifest: Manifest;
  try {
    manifest = await manifestCache();
  } catch (error) {
    failures.set(key, { at: now, error });
    return serveStale(error);
  }
  let status: CacheStatus = built ? "MISS" : "HIT";
  let wait: number | null = null;

  if (!built) {
    const stale = !isFresh(manifest.builtAt, spec.ttlSeconds, now);
    const remaining = spec.refresh ? refreshWaitMs(manifest.builtAt, now) : 0;
    if (spec.force || stale || (spec.refresh && remaining === 0)) {
      revalidateTag(tag, { expire: 0 });
      try {
        manifest = await manifestCache();
      } catch (error) {
        failures.set(key, { at: now, error });
        return serveStale(error);
      }
      status = built ? "REBUILD" : "HIT";
    } else if (spec.refresh) {
      status = "THROTTLED";
      wait = remaining;
    }
  }
  if (built) failures.delete(key);
  return resultFrom(manifest, null, status, false, wait, key, tag);
}

function resultFrom(manifest: Manifest, held: unknown[][] | null, status: CacheStatus, stale: boolean, wait: number | null, key: string, tag: string): PartResult {
  const chunk = async (index: number): Promise<unknown[]> => {
    if (index < 0 || index >= manifest.chunkCount) return [];
    if (held) return held[index] ?? [];
    // This instance built it (or the cap forbade caching): serve from memory without asking the cache.
    const mine = memory.get(key);
    if (mine && mine.manifest.buildId === manifest.buildId && (manifest.oversize || mine.chunks[index])) return mine.chunks[index] ?? [];
    return unstable_cache(
      async () => {
        const again = memory.get(key);
        const rowsOfChunk = again && again.manifest.buildId === manifest.buildId ? again.chunks[index] : undefined;
        if (!rowsOfChunk) throw new ChunkMissing(`chunk ${index} of ${manifest.buildId} is gone`);
        return rowsOfChunk;
      },
      ["snapshot", "v1", key, "chunk", manifest.buildId, String(index)],
      { tags: [tag], revalidate: LONG_LIFETIME_SECONDS }
    )();
  };
  return { manifest, status, stale, refreshWaitMs: wait, oversize: manifest.oversize, chunk };
}
