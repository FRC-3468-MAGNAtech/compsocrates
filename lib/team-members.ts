"use client";

import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, query, where, writeBatch } from "firebase/firestore";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import { buildAuditEntry, newAuditLogRef } from "@/lib/audit-log";
import type { MemberAccess } from "@/lib/member-access";
import type { RoleId } from "@/lib/roles";
import type { AvatarChoice } from "@/lib/profile/config";
import type { CsUserDoc } from "@/data/cs/types";
import { csUserToMember, profilePatchToCsUser } from "@/data/cs/users";
import { DEFAULT_PROGRAM, type ProgramId } from "@/config/programs/types";
import { programData, useProgramData } from "@/lib/program/data";

export type TeamMember = {
  uid: string;
  name: string;
  email: string;
  primaryRole: RoleId;
  secondaryRoles: RoleId[];
  isAdmin: boolean;
  /** Set only by app/api/auth/sync-roles. Owner rows can't be edited by anyone through the UI (also enforced in firestore.rules). */
  isOwner: boolean;
  /** P25: the member's avatar choice (mirrored on the user doc); initials when absent. */
  avatar?: AvatarChoice;
  /** P25: when the account joined the team (ms), from the user doc's createdAt; absent on old docs. */
  joinedAtMs?: number;
  /** D1: the raw CS `role` string (may be a legacy value such as "coach"), so a role edit keeps CS's own admin rule consistent. */
  legacyRole?: string;
};

/** Realtime roster for a team — backs both Team Management (editable, admin-only) and People (read-only). */
export function useTeamMembers(teamId: string | null) {
  // A namespaced program reads its roster through its data port; the root program's read below is untouched.
  const data = useProgramData();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!teamId || !isFirebaseConfigured()) {
      // Deliberate: resets the roster when teamId becomes unavailable (e.g.
      // the profile doc hasn't loaded yet), so a previous team's members
      // never linger on screen for a different (or no) team.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMembers([]);
      setLoaded(true);
      return;
    }
    if (data) {
      return data.members.subscribe(
        teamId,
        (next) => {
          setMembers(next);
          setLoaded(true);
        },
        () => {
          // already reported by the port
          setMembers([]);
          setLoaded(true);
        }
      );
    }
    const q = query(collection(db, "users"), where("teamId", "==", teamId));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setMembers(
          snap.docs.map((d) => csUserToMember(d.id, d.data() as CsUserDoc))
        );
        setLoaded(true);
      },
      (err) => {
        console.error("team members subscription failed:", err);
        setMembers([]);
        setLoaded(true);
      }
    );
    return unsubscribe;
  }, [teamId, data]);

  return { members, loaded };
}

/**
 * FIX1-3: saves whatever the Team Management editor changed (primary role,
 * secondary roles, admin flag) *and* its `edit-member-roles` audit entry
 * (who, whom, before, after) in one atomic batch — so a role change can never
 * land without its audit record, and teammates get a single realtime change.
 * Admin-gated at the call site (lib/member-access.ts's getMemberEditState) and
 * enforced in firestore.rules — owners are untouchable and an admin can't
 * demote themself. No-op when `changes` is empty.
 */
export async function updateMemberAccess(
  actor: { teamId: string; uid: string; name: string },
  member: Pick<TeamMember, "uid" | "name" | "legacyRole"> & MemberAccess,
  changes: Partial<MemberAccess>,
  program: ProgramId = DEFAULT_PROGRAM
) {
  if (Object.keys(changes).length === 0) return;
  // A namespaced program's member docs already use the app's field names; its port writes them and the audit entry in one batch.
  const data = programData(program);
  if (data) return data.members.updateAccess(actor, member, changes);

  const before: MemberAccess = {
    primaryRole: member.primaryRole,
    secondaryRoles: member.secondaryRoles,
    isAdmin: member.isAdmin,
  };
  const after: MemberAccess = { ...before, ...changes };

  const batch = writeBatch(db);
  // D1/D10: CS field names (role, roles, secondaryRoles, isTeamAdmin), merge write, nothing else on the doc is touched.
  batch.set(doc(db, "users", member.uid), profilePatchToCsUser(changes, { role: member.legacyRole }), { merge: true });
  batch.set(
    newAuditLogRef(),
    buildAuditEntry(actor.teamId, actor.uid, actor.name, "edit-member-roles", { targetUid: member.uid, targetName: member.name }, before, after)
  );
  await batch.commit();
}
