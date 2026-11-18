import "server-only";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { firebaseAdminProblem, getAdminAuth, getAdminFirestore } from "@/lib/firebase/admin";
import { DeadlineError, ROUTE_DEADLINE_MS, withDeadline } from "@/lib/server/deadline";
import { cronSecret } from "@/lib/server/env";
import { isQuotaError } from "@/lib/server/memberships";
import { isPlatformOwnerToken } from "@/lib/server/owner-admin";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { serverSignInProblem, verifyBearerToken } from "@/lib/server/require-user";
import { readJsonBody } from "@/lib/server/route-helpers";
import { getAccountDeletionSettings } from "@/lib/server/team-settings";
import { adminDeps } from "./admin-adapters";
import { DISABLED, handleCron, handleOwnerAction, handleSelfDelete, type Caller, type HandlerEnv } from "./handlers";
import { fail, type Result } from "./job";

/**
 * The Admin SDK half of the account deletion routes: the kill switch first (404 while OFF, before anything is read about the caller), then the token, a 20 second
 * request deadline (504: the job keeps its saved progress and the next run continues), a quota error (gRPC 8) as 503 `quota_exceeded`, and any other failure as a
 * generic 500 (the message is logged by class only, never sent: it can hold data). It uses the gRPC Admin client like the other transactional routes.
 */
const HOUR_MS = 60 * 60 * 1000;
const respond = (r: Result) => NextResponse.json(r.body, { status: r.status });

async function run(request: Request, kind: "self" | "owner"): Promise<NextResponse> {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) return respond(fail(503, "server_not_configured", firebaseAdminProblem() ?? "Server isn't configured."));
  try {
    const settings = await getAccountDeletionSettings(db);
    if (!settings.enabled) return respond(DISABLED);
    const decoded = await verifyBearerToken(request);
    if (!decoded) {
      const problem = serverSignInProblem();
      return respond(problem ? fail(503, "server_not_configured", problem) : fail(401, "not_signed_in", "Not signed in."));
    }
    const body = await readJsonBody(request);
    const caller: Caller = {
      uid: decoded.uid,
      name: typeof decoded.name === "string" && decoded.name.trim() !== "" ? decoded.name.trim().slice(0, 80) : "Platform owner",
      authTimeSeconds: decoded.auth_time,
      isPlatformOwner: isPlatformOwnerToken(decoded),
    };
    const env: HandlerEnv = { deps: adminDeps(db, auth), settings, nowMs: Date.now(), rateLimit: async (key, limit) => (await consumeRateLimit(db, key, limit, HOUR_MS)).allowed };
    return respond(await withDeadline(kind === "self" ? handleSelfDelete(env, caller, body) : handleOwnerAction(env, caller, body), ROUTE_DEADLINE_MS));
  } catch (err) {
    return failure(err);
  }
}

function failure(err: unknown): NextResponse {
  if (err instanceof DeadlineError) return respond(fail(504, "timeout", "The server took too long to answer. The deletion keeps its progress and continues on the next run."));
  if (isQuotaError(err)) return respond(fail(503, "quota_exceeded", "The database is busy right now. Try again in a little while."));
  console.error("account deletion route failed:", err instanceof Error ? err.name : "unknown error");
  return respond(fail(500, "server_error", "Something went wrong."));
}

export const selfDeleteRoute = (request: Request) => run(request, "self");
export const ownerRoute = (request: Request) => run(request, "owner");

function bearerMatches(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function cronRoute(request: Request): Promise<NextResponse> {
  const secret = cronSecret();
  if (!secret) return NextResponse.json({ ok: false, error: "The sweeper is off: CRON_SECRET is not configured." }, { status: 503 });
  if (!bearerMatches(request.headers.get("authorization"), secret)) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) return respond(fail(503, "server_not_configured", firebaseAdminProblem() ?? "Server isn't configured."));
  try {
    const settings = await getAccountDeletionSettings(db);
    const env: HandlerEnv = { deps: adminDeps(db, auth), settings, nowMs: Date.now(), rateLimit: async () => true };
    return respond(await withDeadline(handleCron(env), ROUTE_DEADLINE_MS));
  } catch (err) {
    return failure(err);
  }
}
