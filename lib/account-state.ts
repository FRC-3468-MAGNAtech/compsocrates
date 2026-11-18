"use client";

import { useEffect, useSyncExternalStore } from "react";
import { getDocs, query, where } from "@/lib/firebase/metered";
import { db } from "@/lib/firebase/client";
import { programCollection } from "@/lib/firebase/paths";
import { useAuth, type UserDoc } from "@/lib/auth";
import { reportFirestoreError } from "@/lib/firestore-errors";
import { useProgram } from "@/lib/program/context";
import { EMPTY_ROLES, readMembership, type MembershipDoc, type ProgramId } from "@/lib/memberships/model";

/**
 * `useAccountState()`: the account's team state for the CURRENT program, one seam beside `useAuth().profile` (it changes nothing about it). Nothing consumes it
 * yet (docs/MEMBERSHIP_BUILD1_RESULTS.md); later sessions route the no-team screens, the switcher and the roster through it.
 *
 *  - `status`: "loading" until the auth/profile has loaded and the membership read has answered; "team" when the profile's `teamId` pointer (the ACTIVE team,
 *    still the source of truth) is set; "no-team" otherwise.
 *  - `memberships`: the account's membership documents in this program (any status), read ONCE with a `uid ==` query (`getDocs`, no listener) and cached for
 *    the session per (program, uid). It is refetched only after `refreshAccountState()` (call it after a team switch), never on a page load or remount, and two
 *    components mounting the hook share one read.
 *  - FALLBACK: when the read is refused (permission-denied: the rules are not deployed yet, or any failure) or returns nothing for an account whose profile has a
 *    pointer, the list holds ONE implicit membership built from the profile, so nothing breaks before the backfill or the rules deploy. An implicit entry has
 *    `implicit: true` and origin "pointer".
 */

export type AccountMembership = MembershipDoc & { implicit: boolean };
export type AccountState = { status: "loading" | "no-team" | "team"; activeTeamId: string | null; memberships: AccountMembership[]; program: ProgramId };

type Entry = { state: "pending" } | { state: "done"; memberships: MembershipDoc[]; error: string | null };

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const keyOf = (program: ProgramId, uid: string) => `${program}|${uid}`;
const notify = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export type MembershipFetcher = (program: ProgramId, uid: string) => Promise<MembershipDoc[]>;

/** The one-time read: this account's memberships in `program`, by `uid ==` (the query the rules allow). */
export const fetchMyMemberships: MembershipFetcher = async (program, uid) => {
  const snap = await getDocs(query(programCollection(db, program, "memberships"), where("uid", "==", uid)));
  return snap.docs.map((d) => readMembership(d.data())).filter((m): m is MembershipDoc => m !== null);
};

const codeOf = (err: unknown): string => (typeof (err as { code?: unknown } | null)?.code === "string" ? (err as { code: string }).code : "error");

/** Starts the read unless this (program, uid) already has one pending or done. The pending mark is set synchronously, so two mounts read once. */
export function loadAccountMemberships(program: ProgramId, uid: string, fetcher: MembershipFetcher = fetchMyMemberships): Promise<void> {
  const key = keyOf(program, uid);
  if (entries.has(key)) return Promise.resolve();
  entries.set(key, { state: "pending" });
  notify();
  return fetcher(program, uid).then(
    (memberships) => {
      entries.set(key, { state: "done", memberships, error: null });
      notify();
    },
    (err: unknown) => {
      const code = codeOf(err);
      // permission-denied is the expected answer before the rules are deployed; anything else is reported (CLAUDE.md: a failed read says so).
      if (code !== "permission-denied") reportFirestoreError("Couldn't load your team memberships", err, `${program}/memberships`);
      entries.set(key, { state: "done", memberships: [], error: code });
      notify();
    }
  );
}

/** Forget the cached read (all programs of `uid`, or everything): the next mount of the hook reads again. Call it after a successful team switch. */
export function refreshAccountState(uid?: string): void {
  for (const key of [...entries.keys()]) if (!uid || key.endsWith(`|${uid}`)) entries.delete(key);
  notify();
}

/** Pure: the state from what is known. `profile` is the program's own profile (null: no profile document). */
export function deriveAccountState(input: { program: ProgramId; uid: string | null; authLoading: boolean; profile: UserDoc | null; entry: Entry | undefined }): AccountState {
  const { program, profile, entry } = input;
  const pointer = profile?.teamId?.trim() ? profile.teamId : null;
  if (input.authLoading || (input.uid !== null && (!entry || entry.state === "pending"))) return { status: "loading", activeTeamId: null, memberships: [], program };
  const fetched = entry?.state === "done" ? entry.memberships : [];
  const memberships: AccountMembership[] = fetched.map((m) => ({ ...m, implicit: false }));
  if (pointer && profile && !memberships.some((m) => m.teamId === pointer)) memberships.push(implicitMembership(input.uid ?? "", pointer, profile));
  return { status: pointer ? "team" : "no-team", activeTeamId: pointer, memberships, program };
}

/** The one implicit membership of a pointer-only account, from its profile. Not a stored document. */
function implicitMembership(uid: string, teamId: string, profile: UserDoc): AccountMembership {
  return {
    uid,
    teamId,
    ...EMPTY_ROLES,
    role: profile.primaryRole,
    secondaryRoles: profile.secondaryRoles ?? null,
    isAdmin: profile.isAdmin,
    isOwner: profile.isOwner,
    name: profile.name,
    status: "active",
    origin: "pointer",
    joinedAt: 0,
    leftAt: null,
    endedBy: null,
    updatedAt: 0,
    implicit: true,
  };
}

const LOADING_SNAPSHOT = undefined;

export function useAccountState(): AccountState {
  const program = useProgram();
  const { user, profile, loading } = useAuth();
  const uid = user?.uid ?? null;
  const entry = useSyncExternalStore(
    subscribe,
    () => (uid ? entries.get(keyOf(program, uid)) : undefined),
    () => LOADING_SNAPSHOT
  );
  useEffect(() => {
    if (uid && !loading && entry === undefined) void loadAccountMemberships(program, uid);
  }, [program, uid, loading, entry]);
  return deriveAccountState({ program, uid, authLoading: loading, profile, entry });
}

/** Test hook: forget everything and every listener. */
export function resetAccountStateForTests(): void {
  entries.clear();
  listeners.clear();
}
