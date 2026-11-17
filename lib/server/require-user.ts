import "server-only";
import { cookies } from "next/headers";
import type { DecodedIdToken } from "firebase-admin/auth";
import { firebaseAdminProblem, getAdminAuth } from "@/lib/firebase/admin";
import { SESSION_COOKIE_NAME } from "@/lib/server/session-cookie";
import type { ActionError } from "@/lib/events/types";

/**
 * The outcome of a session check, with the reason a check failed. `not-configured` means the server's Admin SDK
 * (FIREBASE_ADMIN_*) is not set up, so nobody can be verified; the message names the variables. `not-signed-in` means
 * the visitor has no valid session.
 */
export type SessionCheck =
  | { ok: true; uid: string }
  | { ok: false; reason: "not-configured" | "not-signed-in"; message: string };

/** Why server sign-in cannot work (the Admin SDK is unconfigured or broken), or null when it can. Names only, never values. */
export function serverSignInProblem(): string | null {
  return getAdminAuth() ? null : (firebaseAdminProblem() ?? "Server sign-in is not configured: set FIREBASE_ADMIN_CLIENT_EMAIL and FIREBASE_ADMIN_PRIVATE_KEY.");
}

/**
 * Verifies the session cookie set by app/api/auth/session. Never throws, and says why when it fails, so a caller can tell
 * "the server is not set up" (fix: the FIREBASE_ADMIN_* variables) from "you are not signed in".
 */
export async function checkSession(): Promise<SessionCheck> {
  const adminAuth = getAdminAuth();
  if (!adminAuth) return { ok: false, reason: "not-configured", message: serverSignInProblem() ?? "Server sign-in is not configured." };

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) return { ok: false, reason: "not-signed-in", message: "Sign in to view event data." };

  try {
    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
    return { ok: true, uid: decoded.uid };
  } catch {
    return { ok: false, reason: "not-signed-in", message: "Your session has expired. Sign in again." };
  }
}

/** The signed-in user, or null for any failure (use `checkSession` when the reason matters). Never throws. */
export async function requireUser(): Promise<{ uid: string } | null> {
  const check = await checkSession();
  return check.ok ? { uid: check.uid } : null;
}

/** For Server Actions: the signed-in user, or an `ActionResult`-shaped error that says why (a distinct code when the server is unconfigured). */
export async function requireUserResult(): Promise<{ ok: true; uid: string } | { ok: false; error: ActionError }> {
  const check = await checkSession();
  if (check.ok) return check;
  return { ok: false, error: { code: check.reason === "not-configured" ? "server_not_configured" : "unauthorized", message: check.message } };
}

/**
 * Verifies an `Authorization: Bearer <idToken>` header — used by the API routes (/api/team/create, /api/team/join,
 * /api/auth/sync-roles, ...) that the client calls directly with a fresh ID token, rather than relying on the session
 * cookie (those calls happen *before* a user doc — and sometimes before the session cookie sync — exists). Returns the
 * full decoded token (uid, email, email_verified, custom claims) since callers need more than just the uid; null on any
 * missing/invalid/expired token. Routes that want to explain an unconfigured server call `serverSignInProblem()` first.
 */
export async function verifyBearerToken(request: Request): Promise<DecodedIdToken | null> {
  const adminAuth = getAdminAuth();
  if (!adminAuth) return null;

  const header = request.headers.get("authorization");
  const match = header?.match(/^Bearer (.+)$/);
  if (!match) return null;

  try {
    return await adminAuth.verifyIdToken(match[1]);
  } catch {
    return null;
  }
}
