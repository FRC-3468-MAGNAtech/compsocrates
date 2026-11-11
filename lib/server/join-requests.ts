import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import type { CsRecord, CsUserDoc } from "@/data/cs/types";
import {
  buildApprovalUserPatch,
  buildBaseUserDoc,
  buildJoinRequestDoc,
  buildRequestOutcomePatch,
  canRequestToJoin,
  decideJoinRequest,
  deriveJoinRequestName,
  formatTeamLabel,
  isPlaceholderName,
  isValidTeamCode,
  normalizeTeamCode,
  ownerUidOfTeam,
  readJoinRequest,
  type CsJoinRequestDoc,
  type JoinRequestAction,
  type JoinRequestFailure,
} from "@/data/cs/join-requests";
import { str } from "@/data/cs/util";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { releaseOwnerUids } from "@/lib/server/env";

/**
 * The server side of CS's join-request flow (docs/ROUTES.md D1/D6/D10), over the Admin SDK. CS did this through the Firestore
 * REST API with a shared "migration user" login; here the caller's ID token is verified by the route (verifyBearerToken)
 * and every write is the Admin SDK's, authorised by `decideJoinRequest` (team admin of that team, or a platform owner).
 *
 * Handlers return `{ status, body }` so the routes stay one-liners and the logic is testable with a fake Firestore
 * (lib/server/test-support/fake-firestore.ts). Times are epoch-ms numbers, like every CS document.
 */
export type RouteResult = { status: number; body: Record<string, unknown> };
export type Caller = { uid: string; email?: string | null; name?: string | null };

const HOUR_MS = 60 * 60 * 1000;
const fail = (status: number, code: string, error: string, extra: Record<string, unknown> = {}): RouteResult => ({ status, body: { ok: false, code, error, ...extra } });

const FAILURE_STATUS: Record<JoinRequestFailure, number> = { "not-pending": 409, "not-allowed": 403, "wrong-team": 403, "not-requester": 403, "bad-request": 400 };

/** Team label (`formatTeamLabel`) for a team code, or "does not exist". Reads the team doc by id (the uppercase code). */
export async function resolveTeamLabel(db: Firestore, teamCodeInput: unknown): Promise<{ exists: boolean; code: string; label: string }> {
  const code = normalizeTeamCode(teamCodeInput);
  if (!isValidTeamCode(code)) return { exists: false, code, label: code ? `Team ${code}` : "Team" };
  const snap = await db.collection("teams").doc(code).get();
  if (!snap.exists) return { exists: false, code, label: `Team ${code}` };
  const data = (snap.data() ?? {}) as CsRecord;
  return { exists: true, code, label: formatTeamLabel(code, data.teamName, data.teamNumber) };
}

/** CS /api/team-label equivalent: authenticated, and rate limited per user so it can't be used to enumerate join codes. */
export async function teamLabelFor(db: Firestore, caller: Caller, teamCodeInput: unknown): Promise<RouteResult> {
  const limit = await consumeRateLimit(db, `teamlabel_${caller.uid}`, 120, HOUR_MS);
  if (!limit.allowed) return fail(429, "rate-limited", "Too many lookups. Try again in a while.");
  const code = normalizeTeamCode(teamCodeInput);
  if (!code) return fail(400, "bad-code", "Missing teamCode.");
  const found = await resolveTeamLabel(db, code);
  return { status: 200, body: { ok: true, exists: found.exists, verified: true, label: found.label } };
}

/** The join requests a user has made (any status), newest first. */
async function requestsOfUser(db: Firestore, uid: string) {
  const snap = await db.collection("teamJoinRequests").where("userId", "==", uid).get();
  return snap.docs.map((d) => readJoinRequest(d.id, d.data() as CsJoinRequestDoc)).sort((a, b) => b.createdAtMs - a.createdAtMs);
}

/**
 * "I want to join team CODE as ROLE": makes sure the caller has a CS-shaped user doc (`teamId: ""`, like CS's signup), then files
 * ONE pending `teamJoinRequests` row. Replaces the app's instant join-code join and CS's client-side `addDoc` with its permission-
 * error fallback ladder. A repeat request for the same team is answered with the existing one (200, `alreadyPending`).
 */
export async function requestToJoinTeam(db: Firestore, caller: Caller, input: { teamCode: unknown; role?: unknown; name?: unknown }, nowMs: number = Date.now()): Promise<RouteResult> {
  const code = normalizeTeamCode(input.teamCode);
  if (!isValidTeamCode(code)) return fail(400, "bad-code", "Enter a join code.");

  // Join codes are guessable; every try counts, hit or miss.
  const limit = await consumeRateLimit(db, `join_${caller.uid}`, 30, HOUR_MS, nowMs);
  if (!limit.allowed) return fail(429, "rate-limited", "Too many attempts. Try again in a while.");

  const team = await resolveTeamLabel(db, code);
  if (!team.exists) return fail(404, "team-not-found", "That join code doesn't match any team.");

  const userRef = db.collection("users").doc(caller.uid);
  const userSnap = await userRef.get();
  const user = userSnap.exists ? ((userSnap.data() ?? {}) as CsUserDoc) : null;
  const existing = await requestsOfUser(db, caller.uid);
  const allowed = canRequestToJoin({ user, teamId: code, existing });
  if (!allowed.ok) {
    if (allowed.code === "duplicate") {
      const dup = existing.find((r) => r.status === "pending" && r.teamId === code);
      return { status: 200, body: { ok: true, alreadyPending: true, requestId: dup?.id ?? null, status: "pending", teamId: code, teamLabel: team.label } };
    }
    return fail(409, allowed.code, allowed.message);
  }

  const email = caller.email ?? "";
  const displayName = str(input.name).trim() || str(caller.name).trim() || email.split("@")[0] || "";
  if (!user) {
    await userRef.set(buildBaseUserDoc({ uid: caller.uid, email, displayName, role: input.role }, nowMs));
  }

  const request = buildJoinRequestDoc(
    {
      userId: caller.uid,
      userEmail: email,
      userName: str(user?.displayName).trim() || displayName,
      requestedRole: input.role ?? user?.role,
      teamId: code,
      teamDisplayLabel: team.label,
    },
    nowMs
  );
  const ref = db.collection("teamJoinRequests").doc();
  await ref.set(request);
  return { status: 200, body: { ok: true, alreadyPending: false, requestId: ref.id, status: "pending", teamId: code, teamLabel: team.label } };
}

/**
 * approve / deny / cancel one request. The caller is the verified token's uid; the actor's own user doc decides what they may do
 * (`decideJoinRequest`). Approval is ONE transaction: it re-reads the request and the target, then merges
 * `teamId/role/roles/...` into the target's user doc (unknown fields kept, D10) and marks the request approved, so a double
 * click or a race with a deny cannot half-apply.
 */
export async function processJoinRequest(db: Firestore, caller: Caller, action: JoinRequestAction, requestIdInput: unknown, nowMs: number = Date.now()): Promise<RouteResult> {
  const requestId = str(requestIdInput).trim();
  if (!requestId || requestId.includes("/")) return fail(400, "bad-request", "Missing requestId.");

  const requestRef = db.collection("teamJoinRequests").doc(requestId);
  const callerRef = db.collection("users").doc(caller.uid);

  return db.runTransaction(async (txn): Promise<RouteResult> => {
    const [requestSnap, callerSnap] = await Promise.all([txn.get(requestRef), txn.get(callerRef)]);
    if (!requestSnap.exists) return fail(404, "not-found", "Request not found.");
    const request = readJoinRequest(requestId, (requestSnap.data() ?? {}) as CsJoinRequestDoc);
    const actorUser = callerSnap.exists ? ((callerSnap.data() ?? {}) as CsUserDoc) : null;
    const decision = decideJoinRequest(request, action, { uid: caller.uid, user: actorUser, ownerUids: releaseOwnerUids() });
    if (!decision.ok) return fail(FAILURE_STATUS[decision.code], decision.code, decision.message);

    if (action !== "approve") {
      txn.update(requestRef, buildRequestOutcomePatch(decision.next, caller.uid, nowMs));
      return { status: 200, body: { ok: true, status: decision.next } };
    }

    const targetRef = db.collection("users").doc(request.userId);
    const teamRef = db.collection("teams").doc(request.teamId);
    const [targetSnap, teamSnap] = await Promise.all([txn.get(targetRef), txn.get(teamRef)]);
    if (!teamSnap.exists) return fail(404, "team-not-found", "That team no longer exists.");
    const target = targetSnap.exists ? ((targetSnap.data() ?? {}) as CsUserDoc) : null;
    const targetTeam = normalizeTeamCode(target?.teamId);
    if (targetTeam && targetTeam !== request.teamId) return fail(409, "already-on-team", "This person has already joined a different team.");

    const hydratedEmail = request.userEmail || str(target?.email).trim();
    const hydratedName = (!isPlaceholderName(request.userName) && request.userName) || str(target?.displayName).trim() || deriveJoinRequestName({ userName: request.userName, userEmail: hydratedEmail, userId: request.userId });
    const patch = buildApprovalUserPatch(request);
    if (targetSnap.exists) {
      txn.set(targetRef, patch, { merge: true });
    } else {
      // The requester's own doc is gone (CS tolerated this): recreate the CS base shape with the approved team on it.
      txn.set(targetRef, { ...buildBaseUserDoc({ uid: request.userId, email: hydratedEmail, displayName: hydratedName, role: request.requestedRole }, nowMs), ...patch });
    }
    txn.update(requestRef, buildRequestOutcomePatch("approved", caller.uid, nowMs, { userName: hydratedName, userEmail: hydratedEmail }));
    return { status: 200, body: { ok: true, status: "approved", approvedUserId: request.userId, userName: hydratedName, userEmail: hydratedEmail, profileSyncPending: false } };
  });
}

/**
 * CS `syncApprovedJoinRequest`, server side: a signed-in user with no team whose latest approved request is still marked
 * `profileSyncPending: true` (an approval that could not write their profile, which only legacy CS approvals did) gets the
 * approval applied now. Requests already synced are ignored on purpose, so a member an admin later removed is never put back
 * by an old approval. Returns true when it changed the user doc.
 */
export async function applyPendingApprovalForUser(db: Firestore, uid: string, nowMs: number = Date.now()): Promise<boolean> {
  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) return false;
  if (normalizeTeamCode((userSnap.data() as CsUserDoc | undefined)?.teamId)) return false;
  const rows = await db.collection("teamJoinRequests").where("userId", "==", uid).get();
  const waiting = rows.docs
    .map((d) => ({ id: d.id, request: readJoinRequest(d.id, d.data() as CsJoinRequestDoc) }))
    .filter((r) => r.request.status === "approved" && r.request.teamId && r.request.profileSyncPending)
    .sort((a, b) => (b.request.processedAtMs || b.request.createdAtMs) - (a.request.processedAtMs || a.request.createdAtMs))[0];
  if (!waiting) return false;
  await userRef.set(buildApprovalUserPatch(waiting.request), { merge: true });
  await db.collection("teamJoinRequests").doc(waiting.id).update({ profileSyncPending: false, profileSyncedAt: nowMs });
  return true;
}

/**
 * Account-data deletion (CS `/api/user/delete`): the user's join requests and their `users/{uid}` doc. Clients cannot delete
 * a user doc (`allow delete: if false`), so this is the only way. Refuses the sole path that would orphan a team: the team's
 * owner deleting themselves while other members remain (transfer ownership first).
 */
export async function deleteAccountData(db: Firestore, caller: Caller): Promise<RouteResult> {
  const userRef = db.collection("users").doc(caller.uid);
  const userSnap = await userRef.get();
  const teamId = normalizeTeamCode((userSnap.data() as CsUserDoc | undefined)?.teamId);
  if (userSnap.exists && teamId) {
    const teamSnap = await db.collection("teams").doc(teamId).get();
    if (teamSnap.exists && ownerUidOfTeam(teamSnap.data() as CsRecord) === caller.uid) {
      const members = await db.collection("users").where("teamId", "==", teamId).get();
      if (members.docs.some((m) => m.id !== caller.uid)) {
        return fail(409, "owns-team", "You own this team and it still has members. Transfer ownership in Team Settings first.");
      }
    }
  }
  const requests = await db.collection("teamJoinRequests").where("userId", "==", caller.uid).get();
  const batch = db.batch();
  for (const r of requests.docs) batch.delete(r.ref);
  batch.delete(userRef);
  await batch.commit();
  return { status: 200, body: { ok: true } };
}
