"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { getDocs, query, where } from "@/lib/firebase/metered";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import { programCollection } from "@/lib/firebase/paths";
import { isFirestoreDenied } from "@/lib/team-roster-errors";
import { membershipsEnabled, useMembershipsEnabled } from "@/lib/memberships/client";
import { readMembership, type MembershipDoc, type ProgramId } from "@/lib/memberships/model";
import type { TeamMember } from "@/lib/team-members";
import { useProgram } from "@/lib/program/context";
import { membershipToMember } from "@/lib/memberships/roster-member";

// The pure mapper lives in lib/memberships/roster-member.ts so the server (snapshot roster) can use it too; re-exported here for the existing importers.
export { membershipToMember };

/**
 * THE roster seam (browser side): who is on a team, for every reader that used to ask `users where teamId ==` alone.
 *
 * Each reader keeps its own user query exactly as it was (the realtime listener of Team Management and People, the one-shot name lookups). This module adds the
 * second half only while the kill switch is ON: the team's ACTIVE memberships (`teamId ==`, `status ==`), read ONCE per page load per (program, team) and
 * shared by every reader on the page, then merged with the user rows (a user row wins: it is the truth for the active team's role). It adds NO listener.
 *
 *  - Kill switch OFF (or not known yet): `loadRosterExtras` returns nothing and runs no query at all. The readers' reads are byte for byte what they were.
 *  - Memberships read denied (the rules are not deployed, or any failure): the extras are empty, `denied` is remembered for the page load (no retry storm), and
 *    the roster is the user rows alone, as before. Nothing is shown to the person.
 *  - Cost per roster view with the switch ON: one extra read per active member, once per page load (20 members: 20 extra; 60: 60 extra), then none.
 */
export type RosterExtras = { members: TeamMember[]; denied: boolean };

/** What the seam needs from the outside: the kill switch and the membership query. Injected so the query count can be tested without Firebase. */
export type RosterDeps = {
  enabled: () => Promise<boolean>;
  readActiveMemberships: (program: ProgramId, teamId: string) => Promise<MembershipDoc[]>;
};

const readActiveMemberships: RosterDeps["readActiveMemberships"] = async (program, teamId) => {
  const snap = await getDocs(query(programCollection(db, program, "memberships"), where("teamId", "==", teamId), where("status", "==", "active")));
  return snap.docs.map((d) => readMembership(d.data())).filter((m): m is MembershipDoc => m !== null);
};

export const defaultRosterDeps: RosterDeps = { enabled: membershipsEnabled, readActiveMemberships };

/** The union: every user row, then each membership row for a uid the user rows do not have. */
export function mergeMembers(users: readonly TeamMember[], extras: readonly TeamMember[]): TeamMember[] {
  if (extras.length === 0) return users as TeamMember[];
  const seen = new Set(users.map((u) => u.uid));
  return [...users, ...extras.filter((e) => !seen.has(e.uid))];
}

const cache = new Map<string, Promise<RosterExtras>>();
const keyOf = (program: ProgramId, teamId: string) => `${program}|${teamId}`;

/** Forget every cached roster (after a team switch or a membership change). */
export function clearRosterCache(): void {
  cache.clear();
}

// A mounted roster re-reads its membership half after `invalidateRoster()` (a member left, was removed or had a role edited).
let version = 0;
const versionListeners = new Set<() => void>();
const subscribeVersion = (l: () => void) => {
  versionListeners.add(l);
  return () => void versionListeners.delete(l);
};

/** Clears the cache AND tells every mounted roster to read its membership half again (once). */
export function invalidateRoster(): void {
  cache.clear();
  version += 1;
  versionListeners.forEach((l) => l());
}

/** The membership half of a team's roster. OFF: empty, no query. ON: one query per (program, team) per page load, cached (a denial too). */
export async function loadRosterExtras(program: ProgramId, teamId: string, deps: RosterDeps = defaultRosterDeps): Promise<RosterExtras> {
  if (!(await deps.enabled())) return { members: [], denied: false };
  const key = keyOf(program, teamId);
  const held = cache.get(key);
  if (held) return held;
  const task = deps
    .readActiveMemberships(program, teamId)
    .then((rows): RosterExtras => ({ members: rows.map(membershipToMember), denied: false }))
    .catch((err): RosterExtras => {
      if (!isFirestoreDenied(err)) console.warn("roster memberships read failed:", err instanceof Error ? err.message : err);
      return { members: [], denied: true };
    });
  cache.set(key, task);
  return task;
}

/** One-shot readers (names for old rows, legacy entry lookups): their user rows plus the membership rows, as `TeamMember`s. */
export async function withRosterExtras(program: ProgramId, teamId: string, users: readonly TeamMember[], deps: RosterDeps = defaultRosterDeps): Promise<TeamMember[]> {
  const extras = await loadRosterExtras(program, teamId, deps);
  return mergeMembers(users, extras.members);
}

/** For the realtime roster hook: the membership rows to merge in. Always `[]` while the kill switch is OFF; loads once, never subscribes. */
export function useRosterExtras(teamId: string | null): TeamMember[] {
  const program = useProgram();
  const enabled = useMembershipsEnabled();
  const [held, setHeld] = useState<{ key: string; members: TeamMember[] } | null>(null);
  const stamp = useSyncExternalStore(subscribeVersion, () => version, () => 0);
  const key = teamId ? `${keyOf(program, teamId)}|${stamp}` : null;
  useEffect(() => {
    if (!enabled || !teamId || !key || !isFirebaseConfigured()) return;
    let alive = true;
    void loadRosterExtras(program, teamId).then((r) => {
      if (alive) setHeld({ key, members: r.members });
    });
    return () => {
      alive = false;
    };
  }, [enabled, program, teamId, key]);
  return useMemo(() => (enabled && held && held.key === key ? held.members : []), [enabled, held, key]);
}
