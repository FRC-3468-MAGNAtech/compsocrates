import "server-only";
import { FieldValue, type DocumentData, type DocumentReference, type Firestore, type Transaction } from "firebase-admin/firestore";
import { MAX_ACTIVE_MEMBERSHIPS } from "@/config/platform";
import { programPath } from "@/lib/firebase/paths";
import {
  MembershipError,
  PROGRAM_IDS,
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
import { teamSnapshotOfDoc, type TeamSnapshot } from "@/lib/memberships/flows";
import { getMembershipsEnabled } from "@/lib/server/team-settings";

export * from "@/lib/memberships/model";

/**
 * Memberships, server side (docs/MEMBERSHIP_PLAN.md, build 1). Admin SDK only: the rules give clients NO write on a membership.
 *
 * THE USER DOCUMENT IS THE SOURCE OF TRUTH FOR THE ACTIVE TEAM'S ROLE. `teamId` on the program's user document stays the active-team pointer that
 * every existing rule and query reads, and live CS edits the role fields there. An INACTIVE team's role lives on its membership. A switch copies the outgoing
 * team's current role fields from the user document into that team's membership, then writes the incoming membership's role fields and the pointer onto the user
 * document, all in ONE transaction. Nothing here changes how any existing writer works.
 *
 * Every membership created in this build has origin "pointer" (derived from a pointer a client could have written). Build session 2 (join, approval, create,
 * transfer: all server-verified flows) creates the "verified" ones.
 */

const memberships = (db: Firestore, program: ProgramId) => db.collection(programPath(program, "memberships"));
const users = (db: Firestore, program: ProgramId) => db.collection(programPath(program, "users"));

/** Does the membership already carry its identity snapshot? (Written once, by server code; older memberships have none.) */
const hasSnapshot = (m: MembershipDoc | null): boolean => !!m && (m.teamNumber !== undefined || m.teamName !== undefined);

/** ONE team-document read, inside the transaction, for the snapshot a membership lacks. Null when the team or its identity cannot be read (nothing is written then). */
async function readTeamSnapshot(db: Firestore, txn: Transaction, program: ProgramId, teamId: string): Promise<TeamSnapshot | null> {
  const snap = await txn.get(db.collection(programPath(program, "teams")).doc(teamId));
  return snap.exists ? teamSnapshotOfDoc(program, snap.data()) : null;
}

/** Is `value` a program id of this app? (`unknown_program` is a 400 for a route.) */
export function parseProgram(value: unknown): { ok: true; program: ProgramId } | { ok: false; status: 400; code: "program_required" | "unknown_program"; error: string } {
  if (value === undefined || value === null || value === "") return { ok: false, status: 400, code: "program_required", error: "Missing program." };
  if (typeof value !== "string" || !(PROGRAM_IDS as readonly string[]).includes(value)) return { ok: false, status: 400, code: "unknown_program", error: "Unknown program." };
  return { ok: true, program: value as ProgramId };
}

/** Counts the account's ACTIVE memberships across every program (the limit is per account), reading at most `MAX` per program. Reads only: call before any write. */
export async function countActive(db: Firestore, txn: Transaction, uid: string): Promise<number> {
  let n = 0;
  for (const program of PROGRAM_IDS) {
    const snap = await txn.get(memberships(db, program).where("uid", "==", uid).where("status", "==", "active").limit(MAX_ACTIVE_MEMBERSHIPS));
    n += snap.size;
  }
  return n;
}

export type EnsureResult = "created" | "exists" | "no-pointer" | "limit" | "invalid";

/**
 * The membership for a user document that already has a pointer. Idempotent and create-only: an existing membership (active or past) is never touched, so
 * calling it twice, or from two servers at once, changes nothing the second time. Refuses ("limit") when the account already holds the maximum of ACTIVE
 * memberships across both programs. Reads: the membership document, plus (only when it has to create) two small count queries.
 */
export async function ensureMembershipForUser(db: Firestore, program: ProgramId, uid: string, userDoc: DocumentData | undefined, nowMs: number = Date.now()): Promise<EnsureResult> {
  const built = buildMembershipFromUser(program, uid, userDoc, nowMs);
  if (!built.ok) return built.error === "no_team" ? "no-pointer" : "invalid";
  const problem = membershipProblem(built.doc);
  if (problem) throw new Error(`membership failed validation: ${problem}`);
  const ref = memberships(db, program).doc(built.id);
  return db.runTransaction(async (txn): Promise<EnsureResult> => {
    const existingSnap = await txn.get(ref);
    if (existingSnap.exists) {
      // An older ACTIVE membership with no identity snapshot gets it now: one team-document read, once, then it has one (a label never needs the id).
      const existing = readMembership(existingSnap.data());
      if (existing && existing.status === "active" && !hasSnapshot(existing)) {
        const snapshot = await readTeamSnapshot(db, txn, program, built.doc.teamId);
        if (snapshot) txn.update(ref, snapshot);
      }
      return "exists";
    }
    const snapshot = await readTeamSnapshot(db, txn, program, built.doc.teamId);
    if ((await countActive(db, txn, uid)) >= MAX_ACTIVE_MEMBERSHIPS) return "limit";
    txn.create(ref, { ...built.doc, ...(snapshot ?? {}) });
    return "created";
  });
}

/** `ensureMembershipForUser` for a uid: reads the user document (one read) and returns "no-pointer" when there is none or it has no team. */
export async function ensureMembership(db: Firestore, program: ProgramId, uid: string, nowMs: number = Date.now()): Promise<EnsureResult> {
  const snap = await users(db, program).doc(uid).get();
  return ensureMembershipForUser(db, program, uid, snap.exists ? snap.data() : undefined, nowMs);
}

export type ActiveState = { program: ProgramId; teamId: string; previousTeamId: string | null; role: string | null; isAdmin: boolean | null; changed: boolean };

/**
 * Makes `teamId` the account's active team for `program`, in ONE Admin SDK transaction (every program's collections live in the same database):
 *  1. the user document must exist (409 `no_profile`: a switch never creates it);
 *  2. the incoming membership must exist (403 `not_a_member`) and be active (403 `membership_ended`);
 *  3. the outgoing team's current role fields are copied from the user document into the outgoing membership (a PAST outgoing membership is left alone); when
 *     the pointer has no membership yet it is created in the same transaction with origin "pointer" (409 `membership_limit` if that would pass the maximum;
 *     409 `invalid_pointer` if the stored pointer cannot make a key, because overwriting it would lose that team's roles);
 *  4. the incoming membership's role fields and `teamId` are written onto the user document (a null field is DELETED, never defaulted).
 * Reads all happen before writes. A failure at any point leaves both documents as they were. Switching to the team that is already active changes nothing.
 */
export async function switchActiveTeam(db: Firestore, program: ProgramId, uid: string, teamId: string, nowMs: number = Date.now()): Promise<ActiveState> {
  const incomingKey = membershipKey(teamId, uid);
  if (!incomingKey.ok) throw new MembershipError(400, "invalid_team", "That team id is not valid.");
  const userRef = users(db, program).doc(uid);
  const incomingRef = memberships(db, program).doc(incomingKey.id);

  return db.runTransaction(async (txn): Promise<ActiveState> => {
    const userSnap = await txn.get(userRef);
    if (!userSnap.exists) throw new MembershipError(409, "no_profile", "This account has no profile in that program yet.");
    const user = userSnap.data() ?? {};
    const incomingSnap = await txn.get(incomingRef);
    if (!incomingSnap.exists) throw new MembershipError(403, "not_a_member", "You are not a member of that team.");
    const incoming = readMembership(incomingSnap.data());
    if (!incoming || incoming.uid !== uid || incoming.teamId !== teamId) throw new MembershipError(403, "not_a_member", "You are not a member of that team.");
    if (incoming.status !== "active") throw new MembershipError(403, "membership_ended", "Your membership in that team has ended.");

    const pointer = pointerOf(user);
    const incomingRoles = roleSnapshotOf(incomingSnap.data());
    if (pointer === teamId) return { program, teamId, previousTeamId: null, role: incomingRoles.role, isAdmin: incomingRoles.isAdmin, changed: false };
    // The incoming team's identity snapshot, when its membership has none yet (one team-document read, once per membership).
    const incomingSnapshot = hasSnapshot(incoming) ? null : await readTeamSnapshot(db, txn, program, teamId);

    // Outgoing team: read first, write later.
    let outgoing: { ref: DocumentReference; exists: boolean; past: boolean; doc?: MembershipDoc; snapshot?: TeamSnapshot | null } | null = null;
    if (pointer !== "") {
      const key = membershipKey(pointer, uid);
      if (!key.ok) throw new MembershipError(409, "invalid_pointer", "Your current team cannot be saved, so the switch was not made.");
      const ref = memberships(db, program).doc(key.id);
      const snap = await txn.get(ref);
      const existing = snap.exists ? readMembership(snap.data()) : null;
      outgoing = { ref, exists: snap.exists, past: existing?.status === "past" };
      if (existing?.status !== "past" && !hasSnapshot(existing)) outgoing.snapshot = await readTeamSnapshot(db, txn, program, pointer);
      if (existing?.status !== "past" && !hasSnapshot(existing)) outgoing.snapshot = await readTeamSnapshot(db, txn, program, pointer);
      if (!snap.exists) {
        const built = buildMembershipFromUser(program, uid, user, nowMs);
        if (!built.ok) throw new MembershipError(409, "invalid_pointer", "Your current team cannot be saved, so the switch was not made.");
        const problem = membershipProblem(built.doc);
        if (problem) throw new Error(`membership failed validation: ${problem}`);
        outgoing.doc = { ...built.doc, ...(outgoing.snapshot ?? {}) };
        if ((await countActive(db, txn, uid)) >= MAX_ACTIVE_MEMBERSHIPS) throw new MembershipError(409, "membership_limit", `An account can hold at most ${MAX_ACTIVE_MEMBERSHIPS} active teams.`);
      }
    }

    // Writes.
    if (outgoing) {
      if (outgoing.doc) txn.create(outgoing.ref, outgoing.doc);
      else if (!outgoing.past) txn.update(outgoing.ref, { ...readRoleSnapshot(program, user), name: nameSnapshot(program, user), updatedAt: nowMs, ...(outgoing.snapshot ?? {}) });
    }
    if (incomingSnapshot) txn.update(incomingRef, incomingSnapshot);
    txn.update(userRef, { teamId, ...restorePatch(program, incomingRoles, FieldValue.delete()) });
    return { program, teamId, previousTeamId: pointer === "" ? null : pointer, role: incomingRoles.role, isAdmin: incomingRoles.isAdmin, changed: true };
  });
}

/**
 * The sign-in hook: for every program, when the kill switch is ON and the account's pointer is set, make sure the membership exists. Quota-careful and
 * failure-proof: OFF costs only the cached switch read; ON asks each program at most once per ~10 minutes per server instance for the same (uid, program;
 * the pointer last seen is kept with the entry), and a program where the pointer is empty costs one read then nothing; every error is logged and swallowed (never thrown), a quota error (gRPC 8) once with its code.
 */
const ENSURED_TTL_MS = 10 * 60 * 1000;
/** (program, uid) -> the pointer last ensured and when to look again. A hit costs no read at all. */
const ensured = new Map<string, { teamId: string; until: number }>();
let quotaLogged = false;

export function resetEnsureCaches(): void {
  ensured.clear();
  quotaLogged = false;
}

export function isQuotaError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 8 || code === "resource-exhausted" || (err instanceof Error && /RESOURCE_EXHAUSTED/.test(err.message));
}

export async function ensureMembershipsOnSignIn(db: Firestore, uid: string, nowMs: number = Date.now()): Promise<Partial<Record<ProgramId, EnsureResult>>> {
  const out: Partial<Record<ProgramId, EnsureResult>> = {};
  try {
    if (!(await getMembershipsEnabled(db, nowMs))) return out;
  } catch (err) {
    logEnsureFailure("kill switch read", err);
    return out;
  }
  for (const program of PROGRAM_IDS) {
    const cacheKey = `${program}|${uid}`;
    const seen = ensured.get(cacheKey);
    if (seen && seen.until > nowMs) continue;
    try {
      const snap = await users(db, program).doc(uid).get();
      const data = snap.exists ? snap.data() : undefined;
      const pointer = pointerOf(data);
      if (pointer === "") {
        ensured.set(cacheKey, { teamId: "", until: nowMs + ENSURED_TTL_MS });
        continue;
      }
      const result = await ensureMembershipForUser(db, program, uid, data, nowMs);
      out[program] = result;
      ensured.set(cacheKey, { teamId: pointer, until: nowMs + ENSURED_TTL_MS });
    } catch (err) {
      logEnsureFailure(`${program} membership`, err);
    }
  }
  return out;
}

function logEnsureFailure(what: string, err: unknown): void {
  if (isQuotaError(err)) {
    if (quotaLogged) return;
    quotaLogged = true;
    console.error(`ensureMembership: ${what}: Firestore quota exhausted (code 8 RESOURCE_EXHAUSTED); skipping until it recovers.`);
    return;
  }
  console.error(`ensureMembership: ${what} failed:`, err instanceof Error ? err.message : err);
}
