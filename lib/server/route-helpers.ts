import "server-only";
import { NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { serverSignInProblem, verifyBearerToken } from "@/lib/server/require-user";
import type { Caller, RouteResult } from "@/lib/server/join-requests";

/**
 * The boilerplate every Bearer-token route repeats: verify the ID token (401), get the Admin Firestore (503), run the handler,
 * turn a throw into a generic 500 (the message is logged, never sent). `handler` returns `{ status, body }`.
 */
export async function withCaller(request: Request, handler: (db: Firestore, caller: Caller) => Promise<RouteResult>): Promise<NextResponse> {
  const decoded = await verifyBearerToken(request);
  if (!decoded) {
    const problem = serverSignInProblem();
    return problem ? NextResponse.json({ ok: false, error: problem }, { status: 503 }) : NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ ok: false, error: "Server isn't configured." }, { status: 503 });
  try {
    const result = await handler(db, { uid: decoded.uid, email: decoded.email ?? null, name: typeof decoded.name === "string" ? decoded.name : null });
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error("route failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}

/** The JSON object of a request body, or `{}` when it is missing/not an object. */
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const parsed: unknown = await request.json().catch(() => null);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}
