import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import type { CsRecord, CsUserDoc } from "@/data/cs/types";
import { buildBaseUserDoc, ownerUidOfTeam } from "@/data/cs/join-requests";
import { toEpochMs } from "@/data/cs/util";
import { isAdminFromCsUser } from "@/data/cs/users";
import { isCsOwnerUid } from "@/config/cs";
import { defaultMemberFieldTeamIds } from "@/lib/field-teams";
import { chooseBootstrapOwner } from "@/lib/team-owner";
import { applyPendingApprovalForUser } from "@/lib/server/join-requests";

export type SyncRolesInput = {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  /** Whether the email is in OWNER_EMAILS / ADMIN_EMAILS (server env). */
  isOwnerEmail: boolean;
  isAdminEmail: boolean;
  /** The caller's current custom claims (`platformOwner`, `admin`, and the pre-P20 `owner`). */
  claims: { platformOwner?: unknown; admin?: unknown; owner?: unknown };
  setClaims: (claims: { platformOwner: boolean; admin: boolean }) => Promise<void>;
  /** Platform owner uids (defaults to `CS_OWNER_UIDS`). */
  ownerUids?: readonly string[];
};

export type SyncRolesResult = { changed: boolean; ownerPendingVerification?: boolean; attached?: boolean };

/**
 * The team-owner bootstrap (P20), on CS fields: an account whose team has no `verifiedOwnerId` (or CE's `ownerUid`) yet gets one:
 * a member already carrying the CE `isOwner` mirror (the earliest created), else a signing-in platform owner who is a member.
 * Runs only while the owner is absent, inside a transaction that re-checks, so it can never take ownership back after a transfer.
 */
async function bootstrapTeamOwner(db: Firestore, teamId: string, caller: { uid: string; isPlatformOwner: boolean }): Promise<boolean> {
  const teamRef = db.collection("teams").doc(teamId);
  const firstLook = await teamRef.get();
  if (!firstLook.exists || ownerUidOfTeam(firstLook.data() as CsRecord)) return false;
  const membersSnap = await db.collection("users").where("teamId", "==", teamId).get();
  return db.runTransaction(async (txn) => {
    const teamSnap = await txn.get(teamRef);
    if (!teamSnap.exists || ownerUidOfTeam(teamSnap.data() as CsRecord)) return false;
    const users = membersSnap.docs.map((d) => {
      const data = d.data() as CsUserDoc;
      return { uid: d.id, isOwner: data.isOwner === true, createdAtMs: toEpochMs(data.createdAt) };
    });
    const choice = chooseBootstrapOwner({ users, caller });
    if (!choice.ownerUid) return false;
    txn.update(teamRef, { verifiedOwnerId: choice.ownerUid });
    const chosen = users.find((u) => u.uid === choice.ownerUid);
    if (chosen && !chosen.isOwner) txn.update(db.collection("users").doc(choice.ownerUid), { isOwner: true, isTeamAdmin: true });
    for (const uid of choice.demoteUids) txn.update(db.collection("users").doc(uid), { isOwner: false });
    return true;
  });
}

/**
 * Called after every sign-in (lib/auth.tsx). CS-shaped (users have `isTeamAdmin`, `teamId`; teams have `verifiedOwnerId`):
 *  - applies an approved join request whose profile write never landed (`profileSyncPending`), CS's `syncApprovedJoinRequest`;
 *  - grants the platform-owner mirror (`isPlatformOwner`, additive) and the `platformOwner`/`admin` claims: a platform owner is
 *    a uid in `CS_OWNER_UIDS`, or a VERIFIED email in OWNER_EMAILS. Admin (`isTeamAdmin`), once granted, is never auto-revoked;
 *  - attaches a platform owner who has no profile to the only team that exists;
 *  - bootstraps `verifiedOwnerId` for an ownerless team.
 * It never writes `role`, `roles`, `teamId` (except the owner attach) or any field it does not own, so `encryptedUserData` and
 * the rest survive (D10).
 */
export async function syncRolesForCaller(db: Firestore, input: SyncRolesInput): Promise<SyncRolesResult> {
  const { uid } = input;
  const csOwner = input.ownerUids ? isCsOwnerUid(uid, input.ownerUids) : isCsOwnerUid(uid);
  // A uid cannot be spoofed; an email can, until it is verified.
  const platformOwner = csOwner || (input.emailVerified && input.isOwnerEmail);
  const wantsAdmin = platformOwner || (input.emailVerified && input.isAdminEmail);

  const approvalApplied = await applyPendingApprovalForUser(db, uid);

  if (!input.emailVerified && !csOwner) {
    // Nothing is granted, but say so (FIX2): the owner would otherwise just see controls silently missing.
    return { changed: approvalApplied, ownerPendingVerification: input.isOwnerEmail };
  }

  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();

  if (!userSnap.exists) {
    // Owner convenience: a platform owner landing with no profile yet and exactly one team in existence is attached to it
    // (as an admin), no join code needed. Anyone else goes through Finish Setup (request to join, or apply).
    if (!platformOwner) return { changed: approvalApplied, attached: false };
    const teamsSnap = await db.collection("teams").limit(2).get();
    if (teamsSnap.size !== 1) return { changed: approvalApplied, attached: false };
    const team = teamsSnap.docs[0];
    await userRef.set({
      ...buildBaseUserDoc({ uid, email: input.email ?? "", displayName: input.name ?? "" }, Date.now()),
      teamId: team.id,
      isTeamAdmin: true,
      isPlatformOwner: true,
      fieldTeamIds: defaultMemberFieldTeamIds(team.data() as CsRecord),
    });
    await input.setClaims({ platformOwner: true, admin: true });
    await bootstrapTeamOwner(db, team.id, { uid, isPlatformOwner: true });
    return { changed: true, attached: true };
  }

  const data = (userSnap.data() ?? {}) as CsUserDoc;
  const currentIsPlatformOwner = data.isPlatformOwner === true;
  const currentIsAdmin = isAdminFromCsUser(data);
  const nextIsAdmin = currentIsAdmin || wantsAdmin;

  const patch: Record<string, unknown> = {};
  if (platformOwner !== currentIsPlatformOwner) patch.isPlatformOwner = platformOwner;
  if (nextIsAdmin !== currentIsAdmin) patch.isTeamAdmin = true;

  // Team owner: CS's `verifiedOwnerId` is authoritative. Keep the additive `isOwner` mirror on the caller's own doc in step with it
  // (legacy CS teams have the field but no mirror, and a stale mirror must not keep owner protections after a transfer).
  const teamId = typeof data.teamId === "string" ? data.teamId.trim().toUpperCase() : "";
  const teamSnap = teamId ? await db.collection("teams").doc(teamId).get() : null;
  const teamOwner = teamSnap?.exists ? ownerUidOfTeam(teamSnap.data() as CsRecord) : "";
  if (teamOwner) {
    const isOwnerNow = teamOwner === uid;
    if (isOwnerNow !== (data.isOwner === true)) patch.isOwner = isOwnerNow;
    if (isOwnerNow && !currentIsAdmin) patch.isTeamAdmin = true;
  }
  const firestoreChanged = Object.keys(patch).length > 0;
  if (firestoreChanged) await userRef.set(patch, { merge: true });

  // `owner` is the pre-P20 claim: it must go, so a stale token can't keep acting as an owner anywhere.
  const claimsChanged = Boolean(input.claims.platformOwner) !== platformOwner || Boolean(input.claims.admin) !== nextIsAdmin || input.claims.owner !== undefined;
  if (claimsChanged) await input.setClaims({ platformOwner, admin: nextIsAdmin });

  const bootstrapped = teamId && teamSnap?.exists && !teamOwner && !approvalApplied ? await bootstrapTeamOwner(db, teamId, { uid, isPlatformOwner: platformOwner }) : false;

  return { changed: approvalApplied || firestoreChanged || claimsChanged || bootstrapped };
}
