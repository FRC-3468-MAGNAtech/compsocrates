import "server-only";
import { NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { isPlatformOwnerToken } from "@/lib/server/owner-admin";
import { serverSignInProblem, verifyBearerToken } from "@/lib/server/require-user";
import { readJsonBody } from "@/lib/server/route-helpers";
import { withDeadline, DeadlineError, ROUTE_DEADLINE_MS } from "@/lib/server/deadline";
import { flowFail, type Actor, type FlowResult } from "@/lib/server/membership-flows";

/**
 * The wiring every membership route shares: verify the ID token (401), the Admin SDK (503 `server_not_configured`), read the JSON body, run the flow with a
 * REQUEST DEADLINE (504 `timeout` instead of a hung request), and turn a throw into a generic 500 (the message is logged, never sent).
 * It uses the gRPC Admin client (`getAdminFirestore`), like every other transactional route: a transaction needs it.
 */
const respond = (r: FlowResult) => NextResponse.json(r.body, { status: r.status });

export async function membershipRoute(request: Request, handler: (db: Firestore, actor: Actor, body: Record<string, unknown>) => Promise<FlowResult>, deadlineMs: number = ROUTE_DEADLINE_MS): Promise<NextResponse> {
  const decoded = await verifyBearerToken(request);
  if (!decoded) {
    const problem = serverSignInProblem();
    return respond(problem ? flowFail(503, "server_not_configured", problem) : flowFail(401, "not_signed_in", "Not signed in."));
  }
  const db = getAdminFirestore();
  if (!db) return respond(flowFail(503, "server_not_configured", "Server isn't configured."));
  const body = await readJsonBody(request);
  // The name on an audit entry is the token's display name, never the email address.
  const name = typeof decoded.name === "string" && decoded.name.trim() !== "" ? decoded.name.trim().slice(0, 80) : "A member";
  const actor: Actor = { uid: decoded.uid, name, email: decoded.email ?? null, isPlatformOwner: isPlatformOwnerToken(decoded) };
  try {
    return respond(await withDeadline(handler(db, actor, body), deadlineMs));
  } catch (err) {
    if (err instanceof DeadlineError) {
      console.error("membership route: deadline exceeded");
      return respond(flowFail(504, "timeout", "The server took too long to answer. Nothing may have changed: reload and check before you try again."));
    }
    console.error("membership route failed:", err instanceof Error ? err.message : "unknown error");
    return respond(flowFail(500, "server_error", "Something went wrong."));
  }
}
