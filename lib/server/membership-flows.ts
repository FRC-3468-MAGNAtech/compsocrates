import "server-only";
import { FieldValue, Timestamp, type DocumentData, type Firestore, type Transaction } from "firebase-admin/firestore";
import { MAX_ACTIVE_MEMBERSHIPS } from "@/config/platform";
import { PROGRAMS } from "@/config/programs";
import { programPath } from "@/lib/firebase/paths";
import {
  ALLOW_ROLE_CHOICE_FIELD,
  teamLabelOfDoc,
  accessMembershipPatch,
  accessUserPatch,
  buildVerifiedMembership,
  clearedUserPatch,
  endedMembershipPatch,
  guardEnding,
  guardSelfDemotion,
  isRequestableRole,
  mergeRosterRows,
  parseAccessChanges,
  pickNextActive,
  resolveApprovedRole,
  restoredMembershipPatch,
  rosterRowFromMembership,
  rosterRowFromUser,
  teamOwnerUid,
  userIsAdmin,
  userIsOwner,
  type RosterRow,
} from "@/lib/memberships/flows";
import {
  MembershipError,
  buildMembershipFromUser,
  membershipKey,
  membershipProblem,
  nameSnapshot,
  pointerOf,
  readMembership,
  readRoleSnapshot,
  restorePatch,
  roleSnapshotOf,
  type MembershipDoc,
  type ProgramId,
} from "@/lib/memberships/model";
import { canEditMember } from "@/lib/member-access";
import { teamAuditDoc } from "@/lib/server/audit";
import { countActive, isQuotaError, parseProgram } from "@/lib/server/memberships";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { getMembershipsEnabled } from "@/lib/server/team-settings";

/**
 * Memberships build 2, server side: join lookup, join request, approve and deny, leave, remove, role edit. ONE implementation for every program: the program
 * supplies field names and paths through `ProgramConfig.membership` (and the program path helper), never through a branch here.
 *
 * Rules every flow follows:
 *  - the kill switch first (404 `memberships_disabled` while `appSettings/global.membershipsEnabled` is not true), then the REQUIRED `program`;
 *  - the caller is the verified token's uid, passed in by the route; nothing identity-like is read from the body;
 *  - every write of a flow is in ONE Admin SDK transaction (membership, user document, join request, audit entry), reads before writes, so a failure at any
 *    point changes nothing; a typed refusal thrown inside rolls the transaction back;
 *  - `users/{uid}.teamId` stays the ACTIVE team pointer. It moves only where this file says so, `isPlatformOwner` is never read or written, and no client
 *    field is trusted for a role.
 */

export type FlowResult = { status: number; body: Record<string, unknown> };
export type Actor = { uid: string; name: string; email?: string | null; isPlatformOwner: boolean };

const HOUR_MS = 60 * 60 * 1000;
const ok = (body: Record<string, unknown> = {}): FlowResult => ({ status: 200, body: { ok: true, ...body } });
export const flowFail = (status: number, code: string, error: string, extra: Record<string, unknown> = {}): FlowResult => ({ status, body: { ok: false, code, error, ...extra } });

/** Turns a typed refusal into its answer and a Firestore quota error (gRPC 8) into 503 `quota_exceeded`. Anything else is the route's 500. */
export async function runFlow(work: () => Promise<FlowResult>): Promise<FlowResult> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof MembershipError) return flowFail(err.status, err.code, err.message);
    if (isQuotaError(err)) return flowFail(503, "quota_exceeded", "The database is busy right now. Try again in a little while.");
    throw err;
  }
}

type Ctx = { db: Firestore; program: ProgramId };
const flowsOf = (program: ProgramId) => PROGRAMS[program].membership.flows;
const col = (c: Ctx, name: string) => c.db.collection(programPath(c.program, name));
const userRef = (c: Ctx, uid: string) => col(c, "users").doc(uid);
const teamRef = (c: Ctx, teamId: string) => col(c, "teams").doc(teamId);
const requestKey = (c: Ctx) => PROGRAMS[c.program].membership.flows.requests;
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function membershipRef(c: Ctx, teamId: string, uid: string) {
  const key = membershipKey(teamId, uid);
  if (!key.ok) throw new MembershipError(400, "invalid_team", "That team id is not valid.");
  return col(c, "memberships").doc(key.id);
}

function requestRef(c: Ctx, teamId: string, requestId: string) {
  const r = requestKey(c);
  return r.layout === "flat" ? col(c, r.collection).doc(requestId) : c.db.doc(`${programPath(c.program, "teams")}/${teamId}/${r.collection}/${requestId}`);
}

const timeValue = (c: Ctx, nowMs: number): number | Timestamp => (requestKey(c).timeKind === "timestamp" ? Timestamp.fromMillis(nowMs) : nowMs);

/** The shared start of every flow: switch, program, and (optionally) a per-account rate limit. */
async function begin(db: Firestore, nowMs: number, program: unknown, limit?: { key: string; max: number }): Promise<Ctx> {
  if (!(await getMembershipsEnabled(db, nowMs))) throw new MembershipError(404, "memberships_disabled", "Not found.");
  const parsed = parseProgram(program);
  if (!parsed.ok) throw new MembershipError(parsed.status, parsed.code, parsed.error);
  if (limit) {
    const l = await consumeRateLimit(db, limit.key, limit.max, HOUR_MS, nowMs);
    if (!l.allowed) throw new MembershipError(429, "rate_limited", "Too many attempts. Try again in a while.");
  }
  return { db, program: parsed.program };
}

function cleanId(value: unknown, code = "invalid_team", message = "That team id is not valid."): string {
  const v = typeof value === "string" ? value.trim() : "";
  if (!v || v.includes("/") || v.length > 128) throw new MembershipError(400, code, message);
  return v;
}

/** A typed join code: uppercase letters and digits, 3 to 24. Anything else cannot be a code. */
export function normalizeJoinCode(value: unknown): string | null {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return /^[A-Z0-9]{3,24}$/.test(code) ? code : null;
}

/** The team a code belongs to: by document id, and (where the program says so) then by its `joinCode` field. */
async function findTeam(c: Ctx, code: string): Promise<{ id: string; data: DocumentData } | null> {
  const teams = col(c, "teams");
  const byId = await teams.doc(code).get();
  if (byId.exists) return { id: byId.id, data: byId.data() ?? {} };
  if (flowsOf(c.program).teamLookup === "idOrJoinCode") {
    const byCode = await teams.where("joinCode", "==", code).limit(1).get();
    if (!byCode.empty) return { id: byCode.docs[0].id, data: byCode.docs[0].data() ?? {} };
  }
  return null;
}

/** The account's active memberships across both programs, plus ONE for a pointer that has no membership document yet (the backfill has not reached it). */
async function activeLimitCount(c: Ctx, txn: Transaction, uid: string, user: DocumentData | undefined): Promise<number> {
  let n = await countActive(c.db, txn, uid);
  const pointer = pointerOf(user);
  if (pointer) {
    const key = membershipKey(pointer, uid);
    if (!key.ok) n += 1;
    else if (!(await txn.get(col(c, "memberships").doc(key.id))).exists) n += 1;
  }
  return n;
}

/** May this actor manage the team (admin of it) by what the SERVER holds: the user document pointing at it, or the actor's active membership of it. */
function managesTeam(c: Ctx, input: { actor: Actor; teamId: string; actorUser: DocumentData | undefined; actorMembership: DocumentData | undefined }): boolean {
  if (input.actor.isPlatformOwner) return true;
  if (pointerOf(input.actorUser) === input.teamId && userIsAdmin(c.program, input.actorUser)) return true;
  const m = readMembership(input.actorMembership);
  return !!m && m.status === "active" && m.teamId === input.teamId && m.uid === input.actor.uid && m.isAdmin === true;
}

/** The user document a person with no profile gets when a request is approved (data from the program's config). */
function newUserDoc(c: Ctx, input: { uid: string; email: string; name: string; teamId: string; role: string; fieldTeamIds: string[] | null; nowMs: number }): Record<string, unknown> {
  const m = PROGRAMS[c.program].membership;
  const f = m.flows;
  const out: Record<string, unknown> = { [m.nameFields[0]]: input.name, ...f.newUser.extras };
  if (f.newUser.storeUid) out.uid = input.uid;
  if (f.newUser.emailField) out[f.newUser.emailField] = input.email;
  out.teamId = input.teamId;
  const snapshot = buildVerifiedMembership({ program: c.program, uid: input.uid, teamId: input.teamId, name: input.name, role: input.role, fieldTeamIds: input.fieldTeamIds, nowMs: input.nowMs });
  Object.assign(out, restorePatch(c.program, snapshot, null));
  // `null` for a field the program stores as absent would be written as null: leave those out of a brand-new document.
  for (const k of Object.keys(out)) if (out[k] === null) delete out[k];
  for (const [k, v] of Object.entries(f.leaveExtras)) out[k] = Array.isArray(v) ? [] : v;
  out.createdAt = timeValue(c, input.nowMs);
  return out;
}

function teamAssignable(c: Ctx, team: DocumentData | undefined): string[] | null {
  const field = flowsOf(c.program).assignableListField;
  if (!field) return null;
  const v = team?.[field];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function strictRequestedRole(value: unknown): string | null {
  return isRequestableRole(value) ? value : null;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// join lookup: what the Join screen needs before it shows a role choice
// ---------------------------------------------------------------------------------------------------------------------------------------------

export type JoinLookupInput = { program?: unknown; code?: unknown };

/**
 * `POST /api/team/join-lookup`: for a typed code, ONLY `{ exists, allowsRoleChoice, alreadyMember, atLimit }`. An unknown or malformed code gets the same 200 answer
 * as any other miss (no 404, no hint which); the team's name and every other field never leave the server. Rate limited per account (30 an hour) because codes are guessable.
 */
export async function joinLookup(db: Firestore, caller: Actor, input: JoinLookupInput, nowMs: number = Date.now()): Promise<FlowResult> {
  return runFlow(async () => {
    const c = await begin(db, nowMs, input.program, { key: `membership-lookup_${caller.uid}`, max: 30 });
    const code = normalizeJoinCode(input.code);
    const team = code ? await findTeam(c, code) : null;
    const user = (await userRef(c, caller.uid).get()).data();
    const atLimit = await db.runTransaction((txn) => activeLimitCount(c, txn, caller.uid, user)).then((n) => n >= MAX_ACTIVE_MEMBERSHIPS);
    if (!team) return ok({ exists: false, allowsRoleChoice: false, alreadyMember: false, atLimit });
    const mem = readMembership((await membershipRef(c, team.id, caller.uid).get()).data());
    const alreadyMember = pointerOf(user) === team.id || mem?.status === "active";
    return ok({ exists: true, allowsRoleChoice: team.data[ALLOW_ROLE_CHOICE_FIELD] === true, alreadyMember, atLimit });
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// request to join: an account that already has a team may ask for another
// ---------------------------------------------------------------------------------------------------------------------------------------------

export type RequestJoinInput = { program?: unknown; code?: unknown; name?: unknown; requestedRole?: unknown };

export async function requestJoin(db: Firestore, caller: Actor, input: RequestJoinInput, nowMs: number = Date.now()): Promise<FlowResult> {
  return runFlow(async () => {
    const c = await begin(db, nowMs, input.program, { key: `membership-join_${caller.uid}`, max: 30 });
    const code = normalizeJoinCode(input.code);
    if (!code) throw new MembershipError(400, "bad_code", "Enter the join code your team admin gave you.");
    const team = await findTeam(c, code);
    if (!team) throw new MembershipError(404, "team_not_found", "That join code doesn't match any team.");
    const f = flowsOf(c.program);
    const r = f.requests;
    const email = caller.email ?? "";
    const name = (str(input.name) || str(caller.name) || email.split("@")[0] || "").slice(0, 80);
    if (!name) throw new MembershipError(400, "bad_name", "Enter your name (80 characters at most).");

    // The role a person asks for is a REQUEST FIELD only, and only when the team lets joiners choose; the server decides again at approval.
    const allowChoice = team.data[ALLOW_ROLE_CHOICE_FIELD] === true;
    const asked = strictRequestedRole(input.requestedRole);
    const requestedRole = allowChoice && asked ? asked : PROGRAMS[c.program].membership.defaultJoinRole;

    return db.runTransaction(async (txn): Promise<FlowResult> => {
      const uRef = userRef(c, caller.uid);
      const reqRef = r.layout === "perTeam" ? requestRef(c, team.id, caller.uid) : null;
      const [userSnap, memSnap, existingFlat, existingPerTeam] = await Promise.all([
        txn.get(uRef),
        txn.get(membershipRef(c, team.id, caller.uid)),
        r.layout === "flat" && r.teamId ? txn.get(col(c, r.collection).where(r.userId, "==", caller.uid).where(r.teamId, "==", team.id).where("status", "==", "pending")) : Promise.resolve(null),
        reqRef ? txn.get(reqRef) : Promise.resolve(null),
      ]);
      const user = userSnap.exists ? (userSnap.data() ?? {}) : undefined;
      const mem = readMembership(memSnap.data());
      if (pointerOf(user) === team.id || mem?.status === "active") throw new MembershipError(409, "already_member", "You are already on that team.");

      const pending = existingFlat ? existingFlat.docs[0] : existingPerTeam && existingPerTeam.exists && existingPerTeam.data()?.status === "pending" ? existingPerTeam : null;
      if (pending) return ok({ alreadyPending: true, requestId: pending.id, status: "pending", teamId: team.id });

      if ((await activeLimitCount(c, txn, caller.uid, user)) >= MAX_ACTIVE_MEMBERSHIPS) {
        throw new MembershipError(409, "membership_limit", `An account can hold at most ${MAX_ACTIVE_MEMBERSHIPS} active teams.`);
      }

      if (!userSnap.exists && f.newUser.createOnRequest) {
        const base = newUserDoc(c, { uid: caller.uid, email, name, teamId: "", role: PROGRAMS[c.program].membership.defaultJoinRole, fieldTeamIds: null, nowMs });
        txn.set(uRef, base);
      }
      const doc: Record<string, unknown> = { [r.userId]: caller.uid, [r.name]: name, status: "pending", createdAt: timeValue(c, nowMs), [r.role]: requestedRole };
      if (r.alsoRole) doc[r.alsoRole] = requestedRole;
      if (r.email) {
        doc[r.email] = email;
        doc[`${r.email}Lower`] = email.trim().toLowerCase();
      }
      if (r.teamId) doc[r.teamId] = team.id;
      const ref = reqRef ?? col(c, r.collection).doc();
      txn.set(ref, doc);
      return ok({ alreadyPending: false, requestId: ref.id, status: "pending", teamId: team.id });
    });
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// approve or deny: the approver is checked against the server's own record of the team
// ---------------------------------------------------------------------------------------------------------------------------------------------

export type DecideInput = { program?: unknown; teamId?: unknown; requestId?: unknown; action?: unknown; role?: unknown };

export async function decideJoin(db: Firestore, actor: Actor, input: DecideInput, nowMs: number = Date.now()): Promise<FlowResult> {
  return runFlow(async () => {
    const c = await begin(db, nowMs, input.program, { key: `membership-decide_${actor.uid}`, max: 240 });
    const teamId = cleanId(input.teamId);
    const requestId = cleanId(input.requestId, "bad_request", "Missing request.");
    if (input.action !== "approve" && input.action !== "deny") throw new MembershipError(400, "invalid_action", "Unknown action.");
    const approve = input.action === "approve";
    const r = requestKey(c);
    const f = flowsOf(c.program);

    return db.runTransaction(async (txn): Promise<FlowResult> => {
      const reqRef = requestRef(c, teamId, requestId);
      const [reqSnap, teamSnap, actorSnap, actorMemSnap] = await Promise.all([txn.get(reqRef), txn.get(teamRef(c, teamId)), txn.get(userRef(c, actor.uid)), txn.get(membershipRef(c, teamId, actor.uid))]);
      if (!reqSnap.exists) throw new MembershipError(404, "not_found", "Request not found.");
      if (!teamSnap.exists) throw new MembershipError(404, "team_not_found", "That team no longer exists.");
      const req = reqSnap.data() ?? {};
      if (r.layout === "flat" && r.teamId && str(req[r.teamId]) !== teamId) throw new MembershipError(403, "wrong_team", "That request is for a different team.");
      if (!managesTeam(c, { actor, teamId, actorUser: actorSnap.data(), actorMembership: actorMemSnap.data() })) {
        throw new MembershipError(403, "not_admin", "Only a team admin can handle join requests.");
      }
      if (req.status !== "pending") throw new MembershipError(409, "not_pending", `This request is already ${String(req.status)}.`);
      const targetUid = r.layout === "perTeam" ? requestId : str(req[r.userId]);
      if (!targetUid || targetUid.includes("/")) throw new MembershipError(400, "bad_request", "This request has no person on it. Ask for a new one.");
      const team = teamSnap.data() ?? {};

      const decision = (status: "approved" | "denied", extra: Record<string, unknown>): Record<string, unknown> => {
        const out: Record<string, unknown> = { status, decidedBy: actor.uid, decidedAt: timeValue(c, nowMs), ...extra };
        if (r.outcomeFields) {
          out[r.outcomeFields.by] = actor.uid;
          out[r.outcomeFields.at] = nowMs;
        }
        if (status === "approved") for (const [k, v] of Object.entries(r.approvedExtras)) out[k] = v === "@now" ? nowMs : v;
        return out;
      };
      const requestedName = str(req[r.name]);
      const audit = (action: "approve-join-request" | "deny-join-request", target: Record<string, unknown>, after: unknown) =>
        txn.set(col(c, "auditLog").doc(), teamAuditDoc(teamId, actor.uid, actor.name, action, { targetUid, targetName: requestedName, ...target }, { status: "pending" }, after));

      if (!approve) {
        txn.update(reqRef, decision("denied", {}));
        audit("deny-join-request", {}, { status: "denied" });
        return ok({ status: "denied" });
      }

      const [targetSnap, targetMemSnap] = await Promise.all([txn.get(userRef(c, targetUid)), txn.get(membershipRef(c, teamId, targetUid))]);
      const target = targetSnap.exists ? (targetSnap.data() ?? {}) : undefined;
      const targetMem = readMembership(targetMemSnap.data());
      if (pointerOf(target) === teamId || targetMem?.status === "active") throw new MembershipError(409, "already_member", "This person is already on the team.");
      if ((await activeLimitCount(c, txn, targetUid, target)) >= MAX_ACTIVE_MEMBERSHIPS) {
        throw new MembershipError(409, "membership_limit", `This person already belongs to ${MAX_ACTIVE_MEMBERSHIPS} teams.`);
      }

      // The server decides the role: the one asked for (or the approver's change of it) only when the team lets joiners choose, and never an admin role.
      const { role, honored } = resolveApprovedRole({ program: c.program, allowChoice: team[ALLOW_ROLE_CHOICE_FIELD], requested: input.role !== undefined ? input.role : req[r.role] });
      const name = requestedName || nameSnapshot(c.program, target) || "Member";
      const fieldTeamIds = teamAssignable(c, team);
      const label = teamLabelOfDoc(team);
      const mRef = membershipRef(c, teamId, targetUid);
      const restored = !!targetMem && targetMem.status === "past";
      let snapshotDoc: MembershipDoc;
      if (restored) {
        const patch = restoredMembershipPatch({ program: c.program, name, teamLabel: label, role, fieldTeamIds, nowMs });
        txn.update(mRef, patch);
        snapshotDoc = { ...(targetMem as MembershipDoc), ...(patch as Partial<MembershipDoc>) } as MembershipDoc;
      } else {
        snapshotDoc = buildVerifiedMembership({ program: c.program, uid: targetUid, teamId, name, teamLabel: label, role, fieldTeamIds, nowMs });
        const problem = membershipProblem(snapshotDoc as unknown as Record<string, unknown>);
        if (problem) throw new Error(`membership failed validation: ${problem}`);
        txn.create(mRef, snapshotDoc);
      }

      // The pointer moves only when the account has no active team in this program; otherwise the person switches later.
      const pointerSet = pointerOf(target) === "";
      if (pointerSet) {
        if (targetSnap.exists) {
          const extras: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(f.leaveExtras)) extras[k] = Array.isArray(v) ? [] : v;
          txn.update(userRef(c, targetUid), { teamId, ...restorePatch(c.program, roleSnapshotOf(snapshotDoc as unknown as Record<string, unknown>), FieldValue.delete()), ...extras });
        } else {
          txn.set(userRef(c, targetUid), newUserDoc(c, { uid: targetUid, email: str(req[r.email ?? ""]), name, teamId, role, fieldTeamIds, nowMs }));
        }
      }
      txn.update(reqRef, decision("approved", { decidedRole: role }));
      audit("approve-join-request", { role, roleChoiceHonored: honored, restored, pointerSet }, { role, status: "approved" });
      return ok({ status: "approved", approvedUserId: targetUid, userName: name, role, restored, pointerSet });
    });
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// leave and remove
// ---------------------------------------------------------------------------------------------------------------------------------------------

export type EndInput = { program?: unknown; teamId?: unknown; uid?: unknown; force?: unknown };

/** The team's roster as the guards see it, read INSIDE the transaction: pointer rows from the user documents, membership rows for the rest (a user row wins). */
async function readRoster(c: Ctx, txn: Transaction, teamId: string): Promise<RosterRow[]> {
  const [users, mems] = await Promise.all([
    txn.get(col(c, "users").where("teamId", "==", teamId)),
    txn.get(col(c, "memberships").where("teamId", "==", teamId).where("status", "==", "active")),
  ]);
  const userRows = users.docs.map((d) => rosterRowFromUser(c.program, d.id, d.data()));
  const memRows = mems.docs.map((d) => readMembership(d.data())).filter((m): m is MembershipDoc => m !== null).map(rosterRowFromMembership);
  return mergeRosterRows(userRows, memRows);
}

/** Ends `targetUid`'s membership of `teamId` in ONE transaction, moving or clearing the active pointer. `endedBy` is "self" for leave and "admin" for removal. */
async function endMembership(c: Ctx, actor: Actor, input: { teamId: string; targetUid: string; endedBy: "self" | "admin"; force: boolean; nowMs: number }): Promise<FlowResult> {
  const { teamId, targetUid, endedBy, force, nowMs } = input;
  return c.db.runTransaction(async (txn): Promise<FlowResult> => {
    const mRef = membershipRef(c, teamId, targetUid);
    const uRef = userRef(c, targetUid);
    const [teamSnap, targetSnap, memSnap, actorSnap, actorMemSnap] = await Promise.all([
      txn.get(teamRef(c, teamId)),
      txn.get(uRef),
      txn.get(mRef),
      actor.uid === targetUid ? Promise.resolve(null) : txn.get(userRef(c, actor.uid)),
      actor.uid === targetUid ? Promise.resolve(null) : txn.get(membershipRef(c, teamId, actor.uid)),
    ]);
    if (endedBy === "admin" && !managesTeam(c, { actor, teamId, actorUser: actorSnap?.data(), actorMembership: actorMemSnap?.data() })) {
      throw new MembershipError(403, "not_admin", "Only a team admin can remove a member.");
    }
    const user = targetSnap.exists ? (targetSnap.data() ?? {}) : undefined;
    const mem = readMembership(memSnap.data());
    const pointer = pointerOf(user);
    const isActive = pointer === teamId || mem?.status === "active";
    if (!isActive) throw new MembershipError(403, "not_a_member", endedBy === "self" ? "You are not a member of that team." : "That person is not a member of that team.");

    // Admin and owner status come from the document that is the truth for it: the user document for the active team, the membership for any other.
    const onPointer = pointer === teamId;
    const targetRow: RosterRow = onPointer
      ? rosterRowFromUser(c.program, targetUid, user)
      : { uid: targetUid, name: mem?.name ?? "", isAdmin: mem?.isAdmin === true, isOwner: mem?.isOwner === true, pointer: false };
    const ownerUid = teamOwnerUid(c.program, teamSnap.data());
    const needsRoster = !force && (targetRow.isAdmin || targetRow.isOwner || ownerUid === targetUid);
    const roster = needsRoster ? await readRoster(c, txn, teamId) : [];
    const others = roster.filter((r) => r.uid !== targetUid);
    const refusal = guardEnding({ target: targetRow, others, teamOwnerUid: ownerUid, force });
    if (refusal) throw new MembershipError(refusal.status, refusal.code, refusal.message);

    // The next home of the pointer: this person's most recently active OTHER membership in the program.
    let next: MembershipDoc | null = null;
    if (onPointer) {
      const mine = await txn.get(col(c, "memberships").where("uid", "==", targetUid).where("status", "==", "active"));
      next = pickNextActive(mine.docs.map((d) => readMembership(d.data())).filter((m): m is MembershipDoc => m !== null), teamId);
    }

    // Writes. The membership becomes past with fresh snapshots; a pointer-only person (no membership yet) gets one made past.
    const snapshot = onPointer ? readRoleSnapshot(c.program, user) : roleSnapshotOf(memSnap.data());
    const name = (onPointer ? nameSnapshot(c.program, user) : "") || mem?.name || "";
    const ended = endedMembershipPatch({ endedBy, snapshot, name, nowMs });
    if (memSnap.exists) {
      txn.update(mRef, ended);
    } else {
      const created = typeof user?.createdAt === "number" ? user.createdAt : nowMs;
      const built = buildMembershipFromUser(c.program, targetUid, { ...user, teamId }, created);
      if (!built.ok) throw new MembershipError(409, "invalid_pointer", "That membership cannot be saved.");
      txn.create(mRef, { ...built.doc, ...ended });
    }
    if (onPointer) {
      if (next) txn.update(uRef, { teamId: next.teamId, ...restorePatch(c.program, roleSnapshotOf(next as unknown as Record<string, unknown>), FieldValue.delete()) });
      else txn.update(uRef, clearedUserPatch(c.program, FieldValue.delete()));
    }
    txn.set(
      col(c, "auditLog").doc(),
      teamAuditDoc(teamId, actor.uid, actor.name, endedBy === "self" ? "leave-team" : "remove-member", { targetUid, targetName: name, endedBy, force }, { status: "active" }, { status: "past", activeTeamId: onPointer ? (next?.teamId ?? "") : null })
    );
    return ok({ status: "past", teamId, activeTeamId: onPointer ? (next?.teamId ?? "") : null });
  });
}

/** `POST /api/team/leave { program, teamId }`: the caller leaves a team of their own. */
export async function leaveTeam(db: Firestore, caller: Actor, input: EndInput, nowMs: number = Date.now()): Promise<FlowResult> {
  return runFlow(async () => {
    const c = await begin(db, nowMs, input.program, { key: `membership-leave_${caller.uid}`, max: 30 });
    return endMembership(c, caller, { teamId: cleanId(input.teamId), targetUid: caller.uid, endedBy: "self", force: false, nowMs });
  });
}

/** `POST /api/team/member/remove { program, teamId, uid, force? }`: an admin removes a member; a platform owner may force it (skips the owner and last-admin guards). */
export async function removeMember(db: Firestore, actor: Actor, input: EndInput, nowMs: number = Date.now()): Promise<FlowResult> {
  return runFlow(async () => {
    const c = await begin(db, nowMs, input.program, { key: `membership-remove_${actor.uid}`, max: 60 });
    const targetUid = cleanId(input.uid, "bad_request", "Missing member.");
    if (targetUid === actor.uid) throw new MembershipError(400, "use_leave", "To leave your own team, use Leave team.");
    const force = input.force === true && actor.isPlatformOwner;
    return endMembership(c, actor, { teamId: cleanId(input.teamId), targetUid, endedBy: "admin", force, nowMs });
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// role and admin edits
// ---------------------------------------------------------------------------------------------------------------------------------------------

export type AccessInput = { program?: unknown; teamId?: unknown; uid?: unknown; changes?: unknown };

/**
 * `POST /api/team/member/access { program, teamId, uid, changes }`. Writes the USER document only when this team is the person's active team and the MEMBERSHIP
 * only when it is not. Never touches `isOwner` or `isPlatformOwner`; an owner's row is editable only by that owner and stays admin; an admin cannot take their own
 * admin flag away while nobody else is an admin.
 */
export async function editMemberAccess(db: Firestore, actor: Actor, input: AccessInput, nowMs: number = Date.now()): Promise<FlowResult> {
  return runFlow(async () => {
    const c = await begin(db, nowMs, input.program, { key: `membership-access_${actor.uid}`, max: 120 });
    const teamId = cleanId(input.teamId);
    const targetUid = cleanId(input.uid, "bad_request", "Missing member.");
    const parsed = parseAccessChanges(input.changes);
    if (!parsed.ok) throw new MembershipError(400, "invalid_changes", parsed.message);
    const changes = parsed.changes;

    return db.runTransaction(async (txn): Promise<FlowResult> => {
      const mRef = membershipRef(c, teamId, targetUid);
      const [teamSnap, targetSnap, memSnap, actorSnap, actorMemSnap] = await Promise.all([
        txn.get(teamRef(c, teamId)),
        txn.get(userRef(c, targetUid)),
        txn.get(mRef),
        actor.uid === targetUid ? Promise.resolve(null) : txn.get(userRef(c, actor.uid)),
        actor.uid === targetUid ? Promise.resolve(null) : txn.get(membershipRef(c, teamId, actor.uid)),
      ]);
      const user = targetSnap.exists ? (targetSnap.data() ?? {}) : undefined;
      const actorUser = actor.uid === targetUid ? user : actorSnap?.data();
      const actorMem = actor.uid === targetUid ? memSnap.data() : actorMemSnap?.data();
      // Platform owners are NOT team admins here: only a real admin of the team edits roles.
      const asAdmin = managesTeam(c, { actor: { ...actor, isPlatformOwner: false }, teamId, actorUser, actorMembership: actorMem });
      if (!asAdmin) throw new MembershipError(403, "not_admin", "Only a team admin can change roles.");

      const mem = readMembership(memSnap.data());
      const pointer = pointerOf(user);
      const onPointer = pointer === teamId;
      if (!onPointer && mem?.status !== "active") throw new MembershipError(404, "not_a_member", "That person is not a member of that team.");

      const ownerUid = teamOwnerUid(c.program, teamSnap.data());
      const targetRow: RosterRow = onPointer ? rosterRowFromUser(c.program, targetUid, user) : { uid: targetUid, name: mem?.name ?? "", isAdmin: mem?.isAdmin === true, isOwner: mem?.isOwner === true, pointer: false };
      const targetIsOwner = targetRow.isOwner || ownerUid === targetUid;
      const actorRow = actor.uid === targetUid ? targetRow : rosterRowFromUser(c.program, actor.uid, actorUser);
      const actorIsOwner = actorRow.isOwner || ownerUid === actor.uid;
      const edit = canEditMember({ uid: actor.uid, isAdmin: true, isOwner: actorIsOwner }, { uid: targetUid, isOwner: targetIsOwner });
      if (!edit.allowed) throw new MembershipError(403, "not_allowed", edit.reason ?? "You cannot edit this member.");
      if (targetIsOwner && changes.isAdmin === false) throw new MembershipError(409, "owner_admin_locked", "Owner access can't be removed.");

      if (changes.isAdmin === false && targetRow.isAdmin && actor.uid === targetUid) {
        const others = (await readRoster(c, txn, teamId)).filter((r) => r.uid !== targetUid);
        const refusal = guardSelfDemotion({ actorUid: actor.uid, targetUid, makesAdmin: changes.isAdmin, currentlyAdmin: targetRow.isAdmin, others });
        if (refusal) throw new MembershipError(refusal.status, refusal.code, refusal.message);
      }

      const before = { primaryRole: onPointer ? rosterRoleOf(c, user) : mem?.role ?? null, isAdmin: targetRow.isAdmin };
      if (onPointer) {
        txn.update(userRef(c, targetUid), accessUserPatch(c.program, user, changes));
      } else {
        txn.update(mRef, { ...accessMembershipPatch(c.program, roleSnapshotOf(memSnap.data()), changes), updatedAt: nowMs });
      }
      txn.set(
        col(c, "auditLog").doc(),
        teamAuditDoc(teamId, actor.uid, actor.name, "edit-member-roles", { targetUid, targetName: targetRow.name, via: onPointer ? "user" : "membership" }, before, { ...changes })
      );
      return ok({ teamId, uid: targetUid, wrote: onPointer ? "user" : "membership" });
    });
  });
}

function rosterRoleOf(c: Ctx, user: DocumentData | undefined): string | null {
  return readRoleSnapshot(c.program, user).role;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// verified memberships for the flows that already create teams and owners (team creation, application approval, ownership transfer)
// ---------------------------------------------------------------------------------------------------------------------------------------------

export type VerifiedState = { ref: ReturnType<typeof membershipRef>; existing: MembershipDoc | null };

/** READ half (call with the flow's other reads, before any write): the person's membership document for the team, if any. */
export async function readVerifiedState(db: Firestore, txn: Transaction, program: ProgramId, teamId: string, uid: string): Promise<VerifiedState> {
  const c: Ctx = { db, program };
  const ref = membershipRef(c, teamId, uid);
  const snap = await txn.get(ref);
  return { ref, existing: snap.exists ? readMembership(snap.data()) : null };
}

/**
 * WRITE half: makes the person's membership of the team VERIFIED with the given role flags. Creates it, or upgrades the existing one in place (keeps `joinedAt`,
 * an ended one is restored with `rejoinedAt`). The server flow calling this has itself checked who the person is on the team.
 */
export function writeVerifiedMembership(txn: Transaction, program: ProgramId, state: VerifiedState, input: { uid: string; teamId: string; name: string; teamLabel?: string; role: string; isAdmin: boolean; isOwner: boolean; fieldTeamIds: string[] | null; nowMs: number }): void {
  if (!state.existing) {
    const doc = buildVerifiedMembership({ program, uid: input.uid, teamId: input.teamId, name: input.name, teamLabel: input.teamLabel, role: input.role, isAdmin: input.isAdmin, isOwner: input.isOwner, fieldTeamIds: input.fieldTeamIds, nowMs: input.nowMs });
    txn.create(state.ref, doc);
    return;
  }
  const patch: Record<string, unknown> = { origin: "verified", isAdmin: input.isAdmin, isOwner: input.isOwner, name: input.name.slice(0, 120), updatedAt: input.nowMs, status: "active", leftAt: null, endedBy: null, ...(input.teamLabel ? { teamLabel: input.teamLabel.slice(0, 120) } : {}) };
  if (state.existing.status === "past") patch.rejoinedAt = input.nowMs;
  txn.update(state.ref, patch);
}

export { userIsAdmin, userIsOwner };

// ---------------------------------------------------------------------------------------------------------------------------------------------
// ownership transfer: the new owner's membership is verified (and the old owner's loses the owner flag)
// ---------------------------------------------------------------------------------------------------------------------------------------------

export type OwnerTransferState = { newOwner: VerifiedState; oldOwner: VerifiedState | null };

/** READ half, with the transfer's other reads: both people's membership documents for the team. */
export async function readOwnerTransferState(db: Firestore, txn: Transaction, program: ProgramId, teamId: string, newUid: string, oldUid: string | null): Promise<OwnerTransferState> {
  const [newOwner, oldOwner] = await Promise.all([
    readVerifiedState(db, txn, program, teamId, newUid),
    oldUid && oldUid !== newUid ? readVerifiedState(db, txn, program, teamId, oldUid) : Promise.resolve(null),
  ]);
  return { newOwner, oldOwner };
}

/**
 * WRITE half: the new owner's membership becomes VERIFIED, admin and owner (made from their user document when they have none yet), and the previous owner's
 * membership, when there is one, loses only the owner flag (they stay an admin). The transfer route has itself checked who may transfer to whom.
 */
export function writeOwnerTransfer(txn: Transaction, program: ProgramId, state: OwnerTransferState, input: { teamId: string; newUid: string; newUser: DocumentData | undefined; teamLabel?: string; nowMs: number }): void {
  const { newOwner, oldOwner } = state;
  if (newOwner.existing) {
    txn.update(newOwner.ref, { origin: "verified", isAdmin: true, isOwner: true, status: "active", leftAt: null, endedBy: null, updatedAt: input.nowMs, ...(input.teamLabel ? { teamLabel: input.teamLabel } : {}), ...(newOwner.existing.status === "past" ? { rejoinedAt: input.nowMs } : {}) });
  } else {
    const built = buildMembershipFromUser(program, input.newUid, { ...input.newUser, teamId: input.teamId }, input.nowMs);
    if (built.ok) txn.create(newOwner.ref, { ...built.doc, origin: "verified", isAdmin: true, isOwner: true, ...(input.teamLabel ? { teamLabel: input.teamLabel } : {}) });
  }
  if (oldOwner?.existing && oldOwner.existing.status === "active") txn.update(oldOwner.ref, { isOwner: false, updatedAt: input.nowMs });
}

/** Reads for team creation or application approval: the account's active count (for the limit) and the new membership's (absent) document. Call before any write. */
export async function readCreationState(db: Firestore, txn: Transaction, program: ProgramId, teamId: string, uid: string): Promise<{ state: VerifiedState; active: number }> {
  const [state, active] = await Promise.all([readVerifiedState(db, txn, program, teamId, uid), countActive(db, txn, uid)]);
  return { state, active };
}

/** WRITE half for a team's creator: a verified, admin, owner membership. Refuses (409 `membership_limit`) at five active teams. */
export function writeCreatorMembership(txn: Transaction, program: ProgramId, created: { state: VerifiedState; active: number }, input: { uid: string; teamId: string; name: string; teamLabel?: string; role: string; nowMs: number }): void {
  if (created.active >= MAX_ACTIVE_MEMBERSHIPS) throw new MembershipError(409, "membership_limit", `An account can hold at most ${MAX_ACTIVE_MEMBERSHIPS} active teams.`);
  writeVerifiedMembership(txn, program, created.state, { uid: input.uid, teamId: input.teamId, name: input.name, teamLabel: input.teamLabel, role: input.role, isAdmin: true, isOwner: true, fieldTeamIds: null, nowMs: input.nowMs });
}
