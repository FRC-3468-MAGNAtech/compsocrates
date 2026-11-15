/**
 * Live practice presence under `programs/ftc/liveMatches/{matchKey}/scouts/{uid}` (Batch 6). Same conventions as `practice.ts`: paths come from
 * `lib/firebase/paths.ts` with an explicit program, a failed read is reported and handed to `onError` (never an empty list), a failed write is reported and
 * rethrown. Pure rules are in `lib/ftc/live.ts`.
 *
 * NO collection-group query (docs/SECURITY-NOTES.md 3a): "who is scouting live on my team" derives the match keys from the team's own open live sessions
 * (`teamId ==`, `kind == "live"`) and reads each match's `scouts` by path with `teamId ==` (what the rules need to allow the list). Equality-only, no orderBy.
 */
import { collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, setDoc, where, type Unsubscribe } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { programPath } from "@/lib/firebase/paths";
import { reportFirestoreError, type FirestoreFailure } from "@/lib/firestore-errors";
import { clearReadFailure, recordReadFailure } from "@/lib/read-failures";
import { diffKeys, openLiveMatchKeys, readPresence } from "@/lib/ftc/live";
import { subscribeTeamLiveSessions } from "@/data/ftc/practice";
import type { LiveMatchScoutPresence } from "@/lib/live-presence";

const PROGRAM = "ftc" as const;
const LIVE_MATCHES = "liveMatches";

type Failure = (failure: FirestoreFailure) => void;
export type TeamLiveScout = LiveMatchScoutPresence & { matchKey: string };

const scoutsPath = (matchKey: string) => `${programPath(PROGRAM, LIVE_MATCHES)}/${matchKey}/scouts`;

function scoutsQuery(matchKey: string, teamId: string) {
  return query(collection(db, programPath(PROGRAM, LIVE_MATCHES), matchKey, "scouts"), where("teamId", "==", teamId));
}

function watchMatch(matchKey: string, teamId: string, onData: (scouts: LiveMatchScoutPresence[]) => void, onError: Failure): Unsubscribe {
  const path = `${scoutsPath(matchKey)} where teamId == ${JSON.stringify(teamId)}`;
  return onSnapshot(
    scoutsQuery(matchKey, teamId),
    (snap) => {
      clearReadFailure("Couldn't load who is scouting this match", path);
      onData(snap.docs.flatMap((d) => readPresence(d.data()) ?? []));
    },
    (err) => {
      const failure = reportFirestoreError("Couldn't load who is scouting this match", err, path);
      recordReadFailure(failure);
      onError(failure);
    }
  );
}

/** Realtime, this team's scouts on ONE match. */
export function subscribeMatchScouts(matchKey: string, teamId: string, onData: (scouts: LiveMatchScoutPresence[]) => void, onError: Failure): Unsubscribe {
  return watchMatch(matchKey, teamId, onData, onError);
}

/**
 * Realtime, this team's scouts on every match one of its open live sessions is on. The set of matches follows the sessions: a session that starts adds its
 * match's reader, a match nobody's session is on any more drops its reader. The first emission waits until every current match has answered once.
 */
export function subscribeTeamLiveScouts(teamId: string, onData: (scouts: TeamLiveScout[]) => void, onError: Failure): Unsubscribe {
  const readers = new Map<string, Unsubscribe>();
  const latest = new Map<string, LiveMatchScoutPresence[]>();
  let keys: string[] | null = null;
  let closed = false;

  const emit = () => {
    if (closed || keys === null) return;
    if (keys.some((k) => !latest.has(k))) return; // a match has not answered yet
    onData(keys.flatMap((k) => (latest.get(k) ?? []).map((s) => ({ ...s, matchKey: k }))));
  };

  const stopSessions = subscribeTeamLiveSessions(
    teamId,
    (sessions) => {
      if (closed) return;
      keys = openLiveMatchKeys(sessions);
      const { add, remove } = diffKeys(new Set(readers.keys()), keys);
      for (const k of remove) {
        readers.get(k)?.();
        readers.delete(k);
        latest.delete(k);
      }
      for (const k of add) {
        readers.set(
          k,
          watchMatch(
            k,
            teamId,
            (scouts) => {
              latest.set(k, scouts);
              emit();
            },
            (failure) => {
              latest.set(k, []); // the failure is reported; the others keep working
              onError(failure);
              emit();
            }
          )
        );
      }
      emit();
    },
    onError
  );

  return () => {
    closed = true;
    stopSessions();
    for (const stop of readers.values()) stop();
    readers.clear();
  };
}

/** Marks the caller present on a match (their own doc: `uid` is the doc id, `teamId` is what the rules scope reads by). */
export async function upsertPresence(matchKey: string, presence: Omit<LiveMatchScoutPresence, "lastSeen">): Promise<void> {
  const path = `${scoutsPath(matchKey)}/${presence.uid}`;
  try {
    await setDoc(doc(db, programPath(PROGRAM, LIVE_MATCHES), matchKey, "scouts", presence.uid), { ...presence, lastSeen: serverTimestamp() });
  } catch (err) {
    reportFirestoreError("Couldn't mark you present on this match", err, path);
    throw err;
  }
}

export async function removePresence(matchKey: string, uid: string): Promise<void> {
  const path = `${scoutsPath(matchKey)}/${uid}`;
  try {
    await deleteDoc(doc(db, programPath(PROGRAM, LIVE_MATCHES), matchKey, "scouts", uid));
  } catch (err) {
    reportFirestoreError("Couldn't remove your presence from this match", err, path);
    throw err;
  }
}
