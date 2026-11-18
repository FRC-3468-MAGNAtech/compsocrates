import "server-only";
import { FieldValue, type DocumentData, type Firestore } from "firebase-admin/firestore";
import { MAX_PENDING_JOIN_REQUESTS } from "@/config/platform";
import { PROGRAMS } from "@/config/programs";
import { programPath } from "@/lib/firebase/paths";
import { readJoinRequestStatus } from "@/data/cs/join-requests";
import { toEpochMs } from "@/data/cs/util";
import { teamLabelOfDoc } from "@/lib/memberships/flows";
import { normalizeLegacyRole } from "@/lib/roles";
import { MembershipError, type ProgramId } from "@/lib/memberships/model";
import { processJoinRequest, type Caller } from "@/lib/server/join-requests";

/**
 * Pending join requests an account can see after a reload, for EVERY program, from one function (`listMyJoinRequests`) that answers the same shape.
 *
 *  - A program that keeps its requests in one collection (`requests.layout === "flat"`) is read with one query by the person's uid.
 *  - A program that keeps them under each team (`"perTeam"`) cannot be searched without a collection-group query, so the SERVER keeps a user-private pointer
 *    document `<program>/joinRequestPointers/{uid}` = `{ entries: [{ teamId, requestId, status }] }` (nothing else: no name, email or code). It is written only by
 *    these functions (Admin SDK; no client rule matches the collection, so the catch-all denies every client read and write). The pointer is a LEAD, never the
 *    truth: each entry is checked against the request document itself, so an approve or deny made by the older client batches (kill switch OFF) is noticed
 *    here, and a stale entry is cleaned on the next listing.
 *
 * Closed requests: an approved request disappears (the profile moves the screen on); a denied or canceled one stays as a single "last closed" line so the
 * shared notice reads the same in every program. A new request to the same team replaces it.
 */

export type MyJoinRequest = { id: string; teamId: string; teamLabel: string; role: string; status: "pending" | "denied" | "canceled"; createdAtMs: number };
type Entry = { teamId: string; requestId: string; status: "pending" | "denied" | "canceled" };

const requestsOf = (program: ProgramId) => PROGRAMS[program].membership.flows.requests;
const pointerRef = (db: Firestore, program: ProgramId, uid: string) => db.collection(programPath(program, "joinRequestPointers")).doc(uid);
const teamsPath = (program: ProgramId) => programPath(program, "teams");

function parseEntries(data: DocumentData | undefined): Entry[] {
  const raw = Array.isArray(data?.entries) ? (data?.entries as unknown[]) : [];
  const out: Entry[] = [];
  for (const e of raw) {
    const o = (e ?? {}) as Record<string, unknown>;
    if (typeof o.teamId === "string" && typeof o.requestId === "string" && (o.status === "pending" || o.status === "denied" || o.status === "canceled")) out.push({ teamId: o.teamId, requestId: o.requestId, status: o.status });
  }
  return out;
}

async function labelOfTeam(db: Firestore, program: ProgramId, teamId: string): Promise<string> {
  const snap = await db.collection(teamsPath(program)).doc(teamId).get();
  return snap.exists ? teamLabelOfDoc((snap.data() ?? {}) as Record<string, unknown>) || `Team ${teamId}` : `Team ${teamId}`;
}

/** Pending requests (all) and the most recent denied or canceled one. */
function shape(rows: MyJoinRequest[]): MyJoinRequest[] {
  const pending = rows.filter((r) => r.status === "pending").sort((a, b) => b.createdAtMs - a.createdAtMs);
  const closed = rows.filter((r) => r.status !== "pending").sort((a, b) => b.createdAtMs - a.createdAtMs)[0];
  return closed ? [...pending, closed] : pending;
}

async function listFlat(db: Firestore, program: ProgramId, uid: string): Promise<MyJoinRequest[]> {
  const r = requestsOf(program);
  const snap = await db.collection(programPath(program, r.collection)).where(r.userId, "==", uid).get();
  const rows: MyJoinRequest[] = [];
  for (const d of snap.docs) {
    const data = d.data();
    const status = readJoinRequestStatus({ status: data.status, canceledByUser: data.canceledByUser });
    if (status === "approved") continue;
    const roleRaw = String(data[r.role] ?? "").trim();
    rows.push({
      id: d.id,
      teamId: r.teamId ? String(data[r.teamId] ?? "").trim() : "",
      teamLabel: String(data.teamDisplayLabel ?? "").trim(),
      role: roleRaw ? normalizeLegacyRole(roleRaw) : PROGRAMS[program].membership.defaultJoinRole,
      status,
      createdAtMs: toEpochMs(data.createdAt),
    });
  }
  const shaped = shape(rows);
  // A label the request did not carry is looked up once per team (never a name from the person's own data).
  for (const row of shaped) if (!row.teamLabel) row.teamLabel = await labelOfTeam(db, program, row.teamId);
  return shaped;
}

async function listPerTeam(db: Firestore, program: ProgramId, uid: string): Promise<MyJoinRequest[]> {
  const ref = pointerRef(db, program, uid);
  const entries = parseEntries((await ref.get()).data());
  if (entries.length === 0) return [];
  const r = requestsOf(program);
  const kept: Entry[] = [];
  const rows: MyJoinRequest[] = [];
  for (const e of entries) {
    const reqSnap = await db.doc(`${teamsPath(program)}/${e.teamId}/${r.collection}/${e.requestId}`).get();
    let status: Entry["status"] | "gone" | "approved" = e.status;
    if (reqSnap.exists) status = readJoinRequestStatus({ status: reqSnap.data()?.status, canceledByUser: reqSnap.data()?.canceledByUser });
    else if (e.status !== "canceled") status = "gone";
    if (status === "approved" || status === "gone") continue;
    kept.push({ ...e, status });
    const data = reqSnap.data() ?? {};
    const roleRaw = String(data[r.role] ?? "").trim();
    rows.push({ id: e.requestId, teamId: e.teamId, teamLabel: "", role: roleRaw ? normalizeLegacyRole(roleRaw) : PROGRAMS[program].membership.defaultJoinRole, status, createdAtMs: toEpochMs(data.createdAt) });
  }
  const shaped = shape(rows);
  const keepKeys = new Set(shaped.map((s) => `${s.teamId}|${s.id}`));
  const finalEntries = kept.filter((e) => keepKeys.has(`${e.teamId}|${e.requestId}`));
  if (JSON.stringify(finalEntries) !== JSON.stringify(entries)) {
    if (finalEntries.length === 0) await ref.delete();
    else await ref.set({ entries: finalEntries, updatedAt: FieldValue.serverTimestamp() });
  }
  for (const row of shaped) row.teamLabel = await labelOfTeam(db, program, row.teamId);
  return shaped;
}

/** The person's pending requests in `program`, plus the last denied or canceled one. Same shape for every program. */
export async function listMyJoinRequests(db: Firestore, program: ProgramId, uid: string): Promise<MyJoinRequest[]> {
  return requestsOf(program).layout === "flat" ? listFlat(db, program, uid) : listPerTeam(db, program, uid);
}

/** Throws 409 `already_pending` (a pending request to this team exists) or 409 `too_many_pending` (five pending already). Call before filing a request. */
export async function assertCanFileRequest(db: Firestore, program: ProgramId, uid: string, teamId: string): Promise<void> {
  const pending = (await listMyJoinRequests(db, program, uid)).filter((r) => r.status === "pending");
  if (pending.some((r) => r.teamId === teamId)) throw new MembershipError(409, "already_pending", "You already asked to join that team and your request is still pending.");
  if (pending.length >= MAX_PENDING_JOIN_REQUESTS) throw new MembershipError(409, "too_many_pending", `You can have at most ${MAX_PENDING_JOIN_REQUESTS} requests waiting at once. Cancel one to ask another team.`);
}

/** Remembers a request just filed (a program that keeps requests per team). Best effort: the request exists whether or not this lands. A flat program needs nothing. */
export async function recordJoinRequest(db: Firestore, program: ProgramId, uid: string, teamId: string, requestId: string): Promise<void> {
  if (requestsOf(program).layout === "flat") return;
  try {
    const ref = pointerRef(db, program, uid);
    await db.runTransaction(async (txn) => {
      const entries = parseEntries((await txn.get(ref)).data()).filter((e) => e.status === "pending" && e.teamId !== teamId);
      txn.set(ref, { entries: [...entries, { teamId, requestId, status: "pending" }], updatedAt: FieldValue.serverTimestamp() });
    });
  } catch (err) {
    console.error("join request pointer not written:", err instanceof Error ? err.message : err);
  }
}

/** The person cancels their own pending request to `teamId`. Same answer for every program. */
export async function cancelMyJoinRequest(db: Firestore, caller: Caller, program: ProgramId, teamIdInput: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const teamId = typeof teamIdInput === "string" ? teamIdInput.trim() : "";
  if (!teamId || teamId.includes("/") || teamId.length > 128) return { status: 400, body: { ok: false, code: "invalid_team", error: "That team id is not valid." } };
  const r = requestsOf(program);
  if (r.layout === "flat") {
    const snap = await db.collection(programPath(program, r.collection)).where(r.userId, "==", caller.uid).get();
    const found = snap.docs.find((d) => String(d.data()[r.teamId ?? "teamId"] ?? "").trim() === teamId && readJoinRequestStatus({ status: d.data().status, canceledByUser: d.data().canceledByUser }) === "pending");
    if (!found) return { status: 404, body: { ok: false, code: "not_found", error: "That request is no longer waiting." } };
    return processJoinRequest(db, caller, "cancel", found.id);
  }
  const reqRef = db.doc(`${teamsPath(program)}/${teamId}/${r.collection}/${caller.uid}`);
  const snap = await reqRef.get();
  if (!snap.exists || snap.data()?.status !== "pending") return { status: 404, body: { ok: false, code: "not_found", error: "That request is no longer waiting." } };
  await reqRef.delete();
  const ref = pointerRef(db, program, caller.uid);
  await db.runTransaction(async (txn) => {
    const entries = parseEntries((await txn.get(ref)).data()).filter((e) => e.teamId !== teamId && e.status === "pending");
    txn.set(ref, { entries: [...entries, { teamId, requestId: caller.uid, status: "canceled" }], updatedAt: FieldValue.serverTimestamp() });
  });
  return { status: 200, body: { ok: true, status: "canceled" } };
}
