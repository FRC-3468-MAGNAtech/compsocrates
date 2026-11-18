import "server-only";
import { NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { isPlatformOwnerToken } from "@/lib/server/owner-admin";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { isQuotaError } from "@/lib/server/memberships";
import { serverSignInProblem, verifyBearerToken } from "@/lib/server/require-user";

// The route wiring shared by the platform changelog and credits routes (Session 7). Every route here uses the Admin SDK only: the
// `platformChangelog` and `platformCredits` collections are closed to clients by the rules catch-all.

export type RouteResult = { status: number; body: Record<string, unknown>; headers?: Record<string, string> };

export const fail = (status: number, code: string, error: string, extra: Record<string, unknown> = {}): RouteResult => ({ status, body: { ok: false, code, error, ...extra } });

const respond = (r: RouteResult) => NextResponse.json(r.body, { status: r.status, headers: r.headers });

export type Viewer = { uid: string; name: string; isOwner: boolean };

const notConfigured = (): NextResponse => respond(fail(503, "server_not_configured", serverSignInProblem() ?? "Server isn't configured."));

/** The display name for an audit entry: the token's name, never the email address. */
const nameOf = (decoded: Record<string, unknown>): string => (typeof decoded.name === "string" && decoded.name.trim() !== "" ? decoded.name.trim().slice(0, 80) : "Platform owner");

/**
 * A signed-in caller (any account): 401 without a valid token, 503 `server_not_configured` when the Admin SDK is not set up. The handler is told
 * whether the caller is the platform owner (the live check, like the other owner routes). A thrown error is logged by message only and answered 500.
 */
export async function withViewer(request: Request, handler: (db: Firestore, viewer: Viewer) => Promise<RouteResult>): Promise<NextResponse> {
  const decoded = await verifyBearerToken(request);
  if (!decoded) {
    const problem = serverSignInProblem();
    return problem ? notConfigured() : respond(fail(401, "not_signed_in", "Not signed in."));
  }
  const db = getAdminFirestore();
  if (!db) return notConfigured();
  try {
    return respond(await handler(db, { uid: decoded.uid, name: nameOf(decoded), isOwner: isPlatformOwnerToken(decoded) }));
  } catch (err) {
    console.error("platform route failed:", err instanceof Error ? err.message : "unknown error");
    if (isQuotaError(err)) return respond(fail(503, "quota_exceeded", "The database is over its daily usage limit right now. Try again later."));
    return respond(fail(500, "server_error", "Something went wrong."));
  }
}

/** The platform owner only: 401, 403 for anyone else, 503 when unconfigured. A write (`limit` set) is also rate limited per owner. */
export async function withOwner(request: Request, opts: { rateLimit?: { key: string; limit: number } }, handler: (db: Firestore, owner: Viewer) => Promise<RouteResult>): Promise<NextResponse> {
  return withViewer(request, async (db, viewer) => {
    if (!viewer.isOwner) return fail(403, "forbidden", "Only the platform owner can do this.");
    if (opts.rateLimit) {
      const { allowed } = await consumeRateLimit(db, `${opts.rateLimit.key}:${viewer.uid}`, opts.rateLimit.limit, 60 * 60 * 1000);
      if (!allowed) return fail(429, "rate_limited", "Too many saves. Try again in a while.");
    }
    return handler(db, viewer);
  });
}

/** A public route (no token): 503 `server_not_configured` when the Admin SDK is not set up. */
export async function withPublicDb(handler: (db: Firestore) => Promise<RouteResult>): Promise<NextResponse> {
  const db = getAdminFirestore();
  if (!db) return notConfigured();
  try {
    return respond(await handler(db));
  } catch (err) {
    console.error("public route failed:", err instanceof Error ? err.message : "unknown error");
    return respond(fail(500, "server_error", "Something went wrong."));
  }
}
