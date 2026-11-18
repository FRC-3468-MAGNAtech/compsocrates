import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { MembershipError } from "@/lib/memberships/model";
import { parseProgram } from "@/lib/server/memberships";
import { cancelMyJoinRequest, listMyJoinRequests } from "@/lib/server/join-pointers";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { flowFail, runFlow, type Actor, type FlowResult } from "@/lib/server/membership-flows";

/**
 * The two flows behind the shared Join screen, ONE implementation for every program. They are NOT behind the memberships kill switch (the Join and Apply
 * screens are identical and always on): `my-join-requests` answers the person's pending requests after a reload, `cancel-request` cancels one of their own.
 */

const HOUR_MS = 60 * 60 * 1000;

/** `{ requests: [{ id, teamId, teamLabel, role, status, createdAtMs }] }`: every pending request and the last denied or canceled one. */
export async function myJoinRequests(db: Firestore, caller: Actor, input: { program?: unknown }, nowMs: number = Date.now()): Promise<FlowResult> {
  return runFlow(async () => {
    const parsed = parseProgram(input.program);
    if (!parsed.ok) throw new MembershipError(parsed.status, parsed.code, parsed.error);
    const limit = await consumeRateLimit(db, `my-requests_${caller.uid}`, 120, HOUR_MS, nowMs);
    if (!limit.allowed) throw new MembershipError(429, "rate_limited", "Too many attempts. Try again in a while.");
    return { status: 200, body: { ok: true, requests: await listMyJoinRequests(db, parsed.program, caller.uid) } };
  });
}

/** The person cancels their own pending request. Body: `{ program, teamId }`. */
export async function cancelRequest(db: Firestore, caller: Actor, input: { program?: unknown; teamId?: unknown }, nowMs: number = Date.now()): Promise<FlowResult> {
  return runFlow(async () => {
    const parsed = parseProgram(input.program);
    if (!parsed.ok) throw new MembershipError(parsed.status, parsed.code, parsed.error);
    const limit = await consumeRateLimit(db, `cancel-request_${caller.uid}`, 60, HOUR_MS, nowMs);
    if (!limit.allowed) return flowFail(429, "rate_limited", "Too many attempts. Try again in a while.");
    const res = await cancelMyJoinRequest(db, { uid: caller.uid, email: caller.email ?? null, name: caller.name }, parsed.program, input.teamId);
    return { status: res.status, body: res.body };
  });
}
