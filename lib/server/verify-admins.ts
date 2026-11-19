import "server-only";
import type { DocumentData, Firestore } from "firebase-admin/firestore";
import { PROGRAMS } from "@/config/programs";
import { programPath } from "@/lib/firebase/paths";
import { rosterRowFromUser, teamLabelOfDoc, teamSnapshotOfDoc, teamOwnerUid, userIsAdmin, userIsOwner } from "@/lib/memberships/flows";
import { MembershipError, buildMembershipFromUser, membershipKey, pointerOf, readMembership, readRoleSnapshot, type MembershipDoc, type ProgramId } from "@/lib/memberships/model";
import { platformAuditDoc } from "@/lib/server/audit";
import { flowFail, runFlow, type Actor, type FlowResult } from "@/lib/server/membership-flows";
import { parseProgram } from "@/lib/server/memberships";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { getMembershipsEnabled } from "@/lib/server/team-settings";
import { readTeamIdentity } from "@/lib/team-number";

/**
 * Platform owner only: upgrade the memberships of a team's EXISTING admins from "pointer" to "verified" origin, so they can read the past roster.
 *
 * Why this needs a human: an existing admin's admin flag is not provable from data. On the root program the person can write the flag (and the team pointer)
 * on their own user document, so nothing stored proves they were ever made an admin; on a program whose rules lock the flag, it is only as good as the deployed
 * rules. So step one LISTS the team's active admins and owners with an evidence note, the owner reviews them and ticks the ones they know, and step two verifies
 * ONLY the ticked uids: it re-reads each user document in the same transaction and refuses anyone who is no longer an admin of that team.
 */

const HOUR_MS = 60 * 60 * 1000;
const ok = (body: Record<string, unknown>): FlowResult => ({ status: 200, body: { ok: true, ...body } });

export type AdminToVerify = {
  uid: string;
  name: string;
  role: string | null;
  isAdmin: boolean;
  isOwner: boolean;
  /** "pointer": the membership came from the user document's pointer; "verified": already done; "none": no membership document yet (verifying creates one). */
  membership: "pointer" | "verified" | "none";
  evidence: string;
};

export type VerifyInput = { program?: unknown; teamId?: unknown; uids?: unknown; confirmName?: unknown };

/** What the owner types to confirm: the team's name, else "Team <number>", else its id. Compared without case or edge spaces. */
export function confirmNameOf(team: DocumentData | undefined, teamId: string): string {
  const { number, name } = readTeamIdentity(team);
  return name ?? (number !== null ? `Team ${number}` : teamId);
}

const sameName = (a: unknown, b: string) => typeof a === "string" && a.trim().toLowerCase() === b.trim().toLowerCase();

export function evidenceNote(program: ProgramId): string {
  return PROGRAMS[program].membership.flows.adminFlagLocked
    ? "Admin flag is locked by the rules, so the person cannot set it on themself. This holds only if the current rules are deployed."
    : "Admin flag can be edited by the user themself: cannot be verified from data.";
}

async function start(db: Firestore, owner: Actor, input: VerifyInput, nowMs: number, rateKey: string, max: number) {
  if (!(await getMembershipsEnabled(db, nowMs))) throw new MembershipError(404, "memberships_disabled", "Not found.");
  if (!owner.isPlatformOwner) throw new MembershipError(403, "forbidden", "Only the platform owner can do this.");
  const parsed = parseProgram(input.program);
  if (!parsed.ok) throw new MembershipError(parsed.status, parsed.code, parsed.error);
  const teamId = typeof input.teamId === "string" ? input.teamId.trim() : "";
  if (!teamId || teamId.includes("/")) throw new MembershipError(400, "invalid_team", "That team id is not valid.");
  const limit = await consumeRateLimit(db, `${rateKey}_${owner.uid}`, max, HOUR_MS, nowMs);
  if (!limit.allowed) throw new MembershipError(429, "rate_limited", "Too many attempts. Try again in a while.");
  return { program: parsed.program, teamId };
}

/** Step one, READ ONLY: the team's active admins and owners, with what the server knows about each. Writes nothing. */
export async function listAdminsToVerify(db: Firestore, owner: Actor, input: VerifyInput, nowMs: number = Date.now()): Promise<FlowResult> {
  return runFlow(async () => {
    const { program, teamId } = await start(db, owner, input, nowMs, "verify-admins-list", 120);
    const teamSnap = await db.collection(programPath(program, "teams")).doc(teamId).get();
    if (!teamSnap.exists) throw new MembershipError(404, "team_not_found", "That team does not exist.");
    const [users, mems] = await Promise.all([
      db.collection(programPath(program, "users")).where("teamId", "==", teamId).get(),
      db.collection(programPath(program, "memberships")).where("teamId", "==", teamId).where("status", "==", "active").get(),
    ]);
    const memberships = new Map<string, MembershipDoc>();
    for (const d of mems.docs) {
      const m = readMembership(d.data());
      if (m) memberships.set(m.uid, m);
    }
    const ownerUid = teamOwnerUid(program, teamSnap.data());
    const evidence = evidenceNote(program);
    const rows: AdminToVerify[] = [];
    const seen = new Set<string>();
    for (const d of users.docs) {
      const data = d.data();
      const row = rosterRowFromUser(program, d.id, data);
      seen.add(d.id);
      if (!row.isAdmin && !row.isOwner && d.id !== ownerUid) continue;
      const m = memberships.get(d.id);
      rows.push({ uid: d.id, name: row.name, role: readRoleSnapshot(program, data).role, isAdmin: row.isAdmin, isOwner: row.isOwner, membership: m ? m.origin : "none", evidence });
    }
    for (const m of memberships.values()) {
      if (seen.has(m.uid) || m.isAdmin !== true) continue;
      rows.push({ uid: m.uid, name: m.name, role: m.role, isAdmin: true, isOwner: m.isOwner === true, membership: m.origin, evidence });
    }
    rows.sort((a, b) => Number(b.isOwner) - Number(a.isOwner) || a.name.localeCompare(b.name));
    return ok({ teamId, confirmName: confirmNameOf(teamSnap.data(), teamId), admins: rows });
  });
}

type Skip = { uid: string; reason: "not_found" | "not_admin_anymore" | "wrong_team" | "not_active" };

/**
 * Step two: verifies ONLY the uids the owner sent (nobody is pre-selected anywhere), after the owner typed the team name. Everything is decided inside ONE
 * transaction from freshly read documents: a person whose admin flag is gone, or who is not on that team any more, is skipped and reported; a membership already
 * verified is left alone (so running it twice changes nothing the second time). One platform audit entry.
 */
export async function verifyAdmins(db: Firestore, owner: Actor, input: VerifyInput, nowMs: number = Date.now()): Promise<FlowResult> {
  return runFlow(async () => {
    const { program, teamId } = await start(db, owner, input, nowMs, "verify-admins-write", 30);
    const uids = Array.isArray(input.uids) ? [...new Set(input.uids.filter((u): u is string => typeof u === "string" && u.trim() !== "").map((u) => u.trim()))] : [];
    if (uids.length === 0 || uids.length > 100 || uids.some((u) => u.includes("/"))) throw new MembershipError(400, "invalid_uids", "Tick the admins to verify (up to 100).");
    const usersCol = db.collection(programPath(program, "users"));
    const memCol = db.collection(programPath(program, "memberships"));

    return db.runTransaction(async (txn): Promise<FlowResult> => {
      const teamSnap = await txn.get(db.collection(programPath(program, "teams")).doc(teamId));
      if (!teamSnap.exists) throw new MembershipError(404, "team_not_found", "That team does not exist.");
      // Nothing is read for the people, and nothing is written, until the name matches.
      if (!sameName(input.confirmName, confirmNameOf(teamSnap.data(), teamId))) {
        return flowFail(400, "confirmation_mismatch", "Type the team name exactly to confirm.");
      }
      const ownerUid = teamOwnerUid(program, teamSnap.data());
      const label = teamLabelOfDoc(teamSnap.data());
      const snapshot = teamSnapshotOfDoc(program, teamSnap.data());
      const reads = await Promise.all(
        uids.map(async (uid) => {
          const key = membershipKey(teamId, uid);
          const [u, m] = await Promise.all([txn.get(usersCol.doc(uid)), key.ok ? txn.get(memCol.doc(key.id)) : Promise.resolve(null)]);
          return { uid, key, user: u.exists ? (u.data() ?? {}) : undefined, mem: m && m.exists ? readMembership(m.data()) : null, memExists: !!m && m.exists };
        })
      );

      const verified: string[] = [];
      const already: string[] = [];
      const skipped: Skip[] = [];
      const writes: (() => void)[] = [];
      for (const r of reads) {
        if (!r.key.ok) {
          skipped.push({ uid: r.uid, reason: "not_found" });
          continue;
        }
        const ref = memCol.doc(r.key.id);
        const onTeam = r.user !== undefined && pointerOf(r.user) === teamId;
        if (onTeam) {
          // The user document is re-read here: the admin flag must still be set (or the person be the team's recorded owner).
          if (!userIsAdmin(program, r.user) && r.uid !== ownerUid) {
            skipped.push({ uid: r.uid, reason: "not_admin_anymore" });
            continue;
          }
          if (r.mem?.origin === "verified" && r.mem.status === "active") {
            already.push(r.uid);
            continue;
          }
          if (r.mem && r.mem.status !== "active") {
            skipped.push({ uid: r.uid, reason: "not_active" });
            continue;
          }
          const isOwner = userIsOwner(program, r.user) || r.uid === ownerUid;
          if (r.mem) {
            writes.push(() => txn.update(ref, { origin: "verified", verifiedBy: owner.uid, verifiedAt: nowMs, isAdmin: true, isOwner, updatedAt: nowMs, ...(label ? { teamLabel: label } : {}), ...(snapshot ?? {}) }));
          } else {
            const built = buildMembershipFromUser(program, r.uid, r.user, typeof r.user?.createdAt === "number" ? r.user.createdAt : nowMs);
            if (!built.ok) {
              skipped.push({ uid: r.uid, reason: "not_found" });
              continue;
            }
            writes.push(() => txn.create(ref, { ...built.doc, origin: "verified", verifiedBy: owner.uid, verifiedAt: nowMs, isAdmin: true, isOwner, ...(label ? { teamLabel: label } : {}), ...(snapshot ?? {}) }));
          }
          verified.push(r.uid);
          continue;
        }
        // Not their active team: only an active membership of this team that records them as an admin counts.
        if (r.mem && r.mem.status === "active" && r.mem.isAdmin === true) {
          if (r.mem.origin === "verified") {
            already.push(r.uid);
            continue;
          }
          writes.push(() => txn.update(ref, { origin: "verified", verifiedBy: owner.uid, verifiedAt: nowMs, updatedAt: nowMs, ...(label ? { teamLabel: label } : {}), ...(snapshot ?? {}) }));
          verified.push(r.uid);
          continue;
        }
        skipped.push({ uid: r.uid, reason: r.user === undefined && !r.memExists ? "not_found" : r.mem && r.mem.status === "active" ? "not_admin_anymore" : "wrong_team" });
      }
      for (const w of writes) w();
      if (verified.length > 0) {
        txn.set(db.collection("platformAuditLog").doc(), platformAuditDoc("verify-team-admins", owner, { program, teamId, verified, alreadyVerified: already, skipped: skipped.map((s) => `${s.uid}:${s.reason}`) }));
      }
      return ok({ verified, alreadyVerified: already, skipped });
    });
  });
}
