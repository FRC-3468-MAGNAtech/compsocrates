"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, query, where, writeBatch } from "@/lib/firebase/metered";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import { buildAuditEntry, newAuditLogRef } from "@/lib/audit-log";
import type { MemberAccess } from "@/lib/member-access";
import type { RoleId } from "@/lib/roles";
import type { AvatarChoice } from "@/lib/profile/config";
import type { CsUserDoc } from "@/data/cs/types";
import { csUserToMember, profilePatchToCsUser } from "@/data/cs/users";
import { DEFAULT_PROGRAM, type ProgramId } from "@/config/programs/types";
import { programData, useProgramData } from "@/lib/program/data";
import { useProgram } from "@/lib/program/context";
import { describeFirestoreError, type FirestoreFailure } from "@/lib/firestore-errors";
import { mergeMembers, useRosterExtras } from "@/lib/team-roster";
import { membershipApi, membershipsEnabled } from "@/lib/memberships/client";

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
  /** Multi-team programs: the account teams the member is assigned to; absent or empty = all of them. */
  assignedTeamIds?: string[];
};

// ---------------------------------------------------------------------------------------------------------------------
// ONE roster listener per (program, team) however many components call `useTeamMembers` (read reduction 2a). Before this every call site opened its own
// `users where teamId ==` listener and was billed for the whole roster again (the Team Coach dashboard mounts three).
// ---------------------------------------------------------------------------------------------------------------------

type RosterState = { members: TeamMember[]; loaded: boolean; error: FirestoreFailure | null };
type RosterFeed = { listeners: Set<(s: RosterState) => void>; state: RosterState; stop: () => void; lingerTimer: ReturnType<typeof setTimeout> | null };
const rosterFeeds = new Map<string, RosterFeed>();

/** How long a feed with no component left keeps listening, so moving between pages does not start it again. */
const ROSTER_LINGER_MS = 20_000;
const rosterKey = (program: string, teamId: string) => `${program}|${teamId}`;

/** Test hook: forget every shared roster feed (a reload does this). */
export function resetRosterFeedsForTests(): void {
  for (const feed of rosterFeeds.values()) {
    if (feed.lingerTimer) clearTimeout(feed.lingerTimer);
    feed.stop();
  }
  rosterFeeds.clear();
}

/**
 * `start` opens the one source (a data port's subscription, or the root `users where teamId ==` listener) and reports to `emit`. The feed is shared by key; the
 * last subscriber leaving stops it after the linger. A failed source ends the feed (the next mount starts a fresh one, so a retry is just a remount).
 */
function subscribeRosterFeed(key: string, start: (emit: (s: RosterState) => void) => () => void, listener: (s: RosterState) => void): () => void {
  let feed = rosterFeeds.get(key);
  if (!feed) {
    const created: RosterFeed = { listeners: new Set(), state: { members: [], loaded: false, error: null }, stop: () => {}, lingerTimer: null };
    rosterFeeds.set(key, created);
    feed = created;
    created.stop = start((s) => {
      created.state = s;
      created.listeners.forEach((l) => l(s));
      if (s.error && rosterFeeds.get(key) === created) rosterFeeds.delete(key);
    });
  }
  const active = feed;
  if (active.lingerTimer) {
    clearTimeout(active.lingerTimer);
    active.lingerTimer = null;
  }
  active.listeners.add(listener);
  if (active.state.loaded) listener(active.state);
  return () => {
    active.listeners.delete(listener);
    if (active.listeners.size > 0 || active.lingerTimer) return;
    const stopNow = () => {
      active.lingerTimer = null;
      if (active.listeners.size > 0) return;
      active.stop();
      if (rosterFeeds.get(key) === active) rosterFeeds.delete(key);
    };
    active.lingerTimer = setTimeout(stopNow, ROSTER_LINGER_MS);
    (active.lingerTimer as { unref?: () => void }).unref?.();
  };
}

/** Realtime roster for a team — backs both Team Management (editable, admin-only) and People (read-only). */
export function useTeamMembers(teamId: string | null) {
  // A namespaced program reads its roster through its data port; the root program's read below is untouched.
  const data = useProgramData();
  const program = useProgram();
  const [state, setState] = useState<RosterState>({ members: [], loaded: false, error: null });
  // The roster seam (lib/team-roster.ts): the team's active memberships, merged in. Always empty (and no read) while the memberships kill switch is OFF.
  const extras = useRosterExtras(teamId);
  const merged = useMemo(() => mergeMembers(state.members, extras), [state.members, extras]);

  useEffect(() => {
    if (!teamId || !isFirebaseConfigured()) {
      // Deliberate: resets the roster when teamId becomes unavailable (e.g.
      // the profile doc hasn't loaded yet), so a previous team's members
      // never linger on screen for a different (or no) team.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ members: [], loaded: true, error: null });
      return;
    }
    const start = (emit: (s: RosterState) => void): (() => void) => {
      if (data) {
        return data.members.subscribe(
          teamId,
          (next) => emit({ members: next, loaded: true, error: null }),
          // already reported by the port
          (failure) => emit({ members: [], loaded: true, error: failure })
        );
      }
      const q = query(collection(db, "users"), where("teamId", "==", teamId));
      return onSnapshot(
        q,
        (snap) => emit({ members: snap.docs.map((d) => csUserToMember(d.id, d.data() as CsUserDoc)), loaded: true, error: null }),
        (err) => {
          console.error("team members subscription failed:", err);
          // A source that fails says so (the page names it); `loaded` still flips so nothing hangs on "loading".
          emit({ members: [], loaded: true, error: describeFirestoreError("Couldn't load team members", err, "users where teamId == ours") });
        }
      );
    };
    return subscribeRosterFeed(rosterKey(program, teamId), start, setState);
  }, [teamId, data, program]);

  return { members: merged, loaded: state.loaded, error: state.error };
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
  // Memberships ON: a server route makes the edit (the user document when this is the person's active team, their membership otherwise) and logs it.
  if (await membershipsEnabled()) {
    await membershipApi.access(program, { teamId: actor.teamId, uid: member.uid, changes });
    return;
  }
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
