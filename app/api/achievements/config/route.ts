import { NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { readAchievementConfig, saveAchievementConfig, type AchievementCaller, type RouteResult, type SaveInput } from "@/lib/server/achievement-config";
import { isPlatformOwnerToken } from "@/lib/server/owner-admin";
import { serverSignInProblem, verifyBearerToken } from "@/lib/server/require-user";

const MAX_BODY_BYTES = 64 * 1024;

const reply = (r: RouteResult) => NextResponse.json(r.body, { status: r.status });
const fail = (status: number, code: string, error: string) => NextResponse.json({ ok: false, code, error }, { status });

async function caller(request: Request): Promise<{ ok: true; who: AchievementCaller } | { ok: false; response: NextResponse }> {
  const decoded = await verifyBearerToken(request);
  if (!decoded) {
    const problem = serverSignInProblem();
    return { ok: false, response: problem ? fail(503, "server_not_configured", problem) : fail(401, "not-signed-in", "Not signed in.") };
  }
  return { ok: true, who: { uid: decoded.uid, name: typeof decoded.name === "string" ? decoded.name : null, isPlatformOwner: isPlatformOwnerToken(decoded) } };
}

/** The effective achievement settings of the caller's own team (`?program=<id>`). A caller with no team gets the built-ins only. */
export async function GET(request: Request) {
  const who = await caller(request);
  if (!who.ok) return who.response;
  const db = getAdminFirestore();
  if (!db) return fail(503, "server_not_configured", "Server isn't configured.");
  try {
    return reply(await readAchievementConfig(db, who.who, new URL(request.url).searchParams.get("program")));
  } catch (err) {
    console.error("achievements read failed:", err instanceof Error ? err.message : err);
    return fail(500, "server_error", "Something went wrong.");
  }
}

/** Save the team's achievement settings. Team admin of the caller's team, or the platform owner. Body: `{ program, expectedVersion, overrides, custom, order? }`. */
export async function PUT(request: Request) {
  const who = await caller(request);
  if (!who.ok) return who.response;
  const db = getAdminFirestore();
  if (!db) return fail(503, "server_not_configured", "Server isn't configured.");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return fail(413, "too-large", "That's too large.");
  const raw = await request.text().catch(() => "");
  if (raw.length > MAX_BODY_BYTES) return fail(413, "too-large", "That's too large.");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, "bad-request", "That request couldn't be read.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail(400, "bad-request", "That request couldn't be read.");
  try {
    return reply(await saveAchievementConfig(db, who.who, body as SaveInput));
  } catch (err) {
    console.error("achievements save failed:", err instanceof Error ? err.message : err);
    return fail(500, "server_error", "Something went wrong.");
  }
}
