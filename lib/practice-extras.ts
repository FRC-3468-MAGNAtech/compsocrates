"use client";

/**
 * Practice sessions the team's own `teamId ==` query cannot see, read the way old CS read them (docs/FIREBASE_FINDINGS.md):
 *   - sessions saved with an empty `teamId` (a scout with no team at the time), found through the team's members by `scoutId`
 *     or `scoutName`, and kept when their `teamId` is empty or ours;
 *   - the team's exclusions from `scoutingFlagStates` (entity type `practiceSession`).
 * Scope: the team's members and the team's flag states only. Fetched once per team and shared by every hook that needs
 * practice sessions; a failure is reported and surfaced as `error`, never as a silently empty list.
 */

import { collection, getDocs, query, where, type QueryDocumentSnapshot } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { applySessionExclusions, assignSessionOwners, csSessionToPractice, excludedSessionIds, mergeSessionsById, sessionBelongsToTeam, type SessionMember } from "@/data/cs/practice";
import { describeFirestoreError, reportFirestoreError, type FirestoreFailure } from "@/lib/firestore-errors";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import type { PracticeSession } from "@/lib/practice-sessions";
import { useTeamMembers } from "@/lib/team-members";

export type PracticeExtras = {
  /** Sessions found through the members that the team query missed (not yet merged). */
  sessions: PracticeSession[];
  /** Session ids the team excluded from accuracy. */
  excluded: ReadonlySet<string>;
  members: readonly SessionMember[];
};

const EMPTY: PracticeExtras = { sessions: [], excluded: new Set(), members: [] };

const IN_LIMIT = 25; // Firestore allows 30 values in an `in`.
const TTL_MS = 2 * 60 * 1000;

function chunk<T>(values: readonly T[], size = IN_LIMIT): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

type Fetched = { extras: PracticeExtras; error: FirestoreFailure | null };
const cache = new Map<string, { at: number; promise: Promise<Fetched> }>();

/** Test hook. */
export function clearPracticeExtrasCache(): void {
  cache.clear();
}

async function fetchExtras(teamId: string, members: readonly SessionMember[]): Promise<Fetched> {
  let error: FirestoreFailure | null = null;
  const fail = (context: string, err: unknown, path: string) => {
    reportFirestoreError(context, err, path);
    error ??= describeFirestoreError("Couldn't load every practice session", err, path);
  };

  const sessions: PracticeSession[] = [];
  const keep = (snap: QueryDocumentSnapshot) => {
    const data = snap.data();
    if (!sessionBelongsToTeam(data, teamId)) return;
    const s = csSessionToPractice(snap.id, data, teamId);
    if (s) sessions.push(s);
  };

  const uids = [...new Set(members.map((m) => m.uid).filter(Boolean))];
  const names = [...new Set(members.map((m) => m.name.trim()).filter(Boolean))];
  const reads: Promise<void>[] = [
    ...chunk(uids).map(async (ids) => {
      try {
        (await getDocs(query(collection(db, "practiceSessions"), where("scoutId", "in", ids)))).docs.forEach(keep);
      } catch (err) {
        fail("practiceSessions by member uid failed", err, `practiceSessions where scoutId in [${ids.length} member uids]`);
      }
    }),
    ...chunk(names).map(async (list) => {
      try {
        (await getDocs(query(collection(db, "practiceSessions"), where("scoutName", "in", list)))).docs.forEach(keep);
      } catch (err) {
        fail("practiceSessions by member name failed", err, `practiceSessions where scoutName in [${list.length} member names]`);
      }
    }),
  ];

  let excluded: Set<string> = new Set();
  reads.push(
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, "scoutingFlagStates"), where("teamId", "==", teamId)));
        excluded = excludedSessionIds(snap.docs.map((d) => d.data()));
      } catch (err) {
        fail("scoutingFlagStates read failed", err, `scoutingFlagStates where teamId == ${teamId}`);
      }
    })()
  );

  await Promise.all(reads);
  return { extras: { sessions: mergeSessionsById([], sessions), excluded, members }, error };
}

/** One shared fetch per team and member set; a failed fetch is dropped from the cache so the next ask retries. */
export function loadPracticeExtras(teamId: string, members: readonly SessionMember[]): Promise<Fetched> {
  const key = `${teamId}|${members.map((m) => `${m.uid}:${m.name}`).sort().join(",")}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  const promise = fetchExtras(teamId, members);
  cache.set(key, { at: Date.now(), promise });
  void promise.then((r) => {
    if (r.error) cache.delete(key);
  });
  return promise;
}

/** The team query's sessions plus the extras: merged by id, owners assigned by name, exclusions applied. */
export function finalizeSessions(base: readonly PracticeSession[], extras: PracticeExtras): PracticeSession[] {
  return applySessionExclusions(assignSessionOwners(mergeSessionsById(base, extras.sessions), extras.members), extras.excluded);
}

export function usePracticeExtras(teamId: string | null): PracticeExtras & { loaded: boolean; error: FirestoreFailure | null } {
  const { members, loaded: membersLoaded } = useTeamMembers(teamId);
  const sessionMembers = useMemo<SessionMember[]>(() => members.map((m) => ({ uid: m.uid, name: m.name })), [members]);
  const [state, setState] = useState<{ key: string; fetched: Fetched } | null>(null);
  const key = teamId ? `${teamId}|${sessionMembers.map((m) => `${m.uid}:${m.name}`).sort().join(",")}` : "";

  useEffect(() => {
    if (!teamId || !isFirebaseConfigured() || !membersLoaded) return;
    let cancelled = false;
    void loadPracticeExtras(teamId, sessionMembers).then((fetched) => {
      if (!cancelled) setState({ key, fetched });
    });
    return () => {
      cancelled = true;
    };
  }, [teamId, membersLoaded, key, sessionMembers]);

  const current = state && state.key === key ? state.fetched : null;
  const loaded = !teamId || !isFirebaseConfigured() || (membersLoaded && current !== null);
  return { ...(current?.extras ?? { ...EMPTY, members: sessionMembers }), loaded, error: current?.error ?? null };
}
