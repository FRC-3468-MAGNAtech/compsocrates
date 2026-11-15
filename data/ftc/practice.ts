/**
 * Practice sessions under `programs/ftc/practiceSessions` (docs/FTC_COMPLETION_PLAN.md, batch 3). Same conventions as `read.ts` / `write.ts` / `library.ts`: every
 * path is built by `lib/firebase/paths.ts` with an explicit program, a failed read is reported and handed to `onError` (never an empty list), a failed write is
 * reported and rethrown. Pure rules (the stored shape, the stub, malformed docs) are in `lib/ftc/practice.ts`.
 *
 * Every query is equality-only (no orderBy, no new index) and never collection-group; every LIST carries `teamId ==` (what the rules need to allow it):
 *   - the team's sessions, team-wide, NEVER narrowed by event (docs/FIREBASE_FINDINGS.md: scoping practice reads to the selected event hid sessions);
 *   - a scout's own sessions (`teamId ==`, `uid ==`) and their paused one (`teamId ==`, `uid ==`, `status == "paused"`);
 *   - one session by document id;
 *   - the completed-attempt check (five equalities, limit 1, as CE writes it).
 * Practice flags (`excluded`, `flags[].dismissed`) live ON the session document: there is no flag-state collection.
 * The published library matches a practice flow lists are read through the library port (`data/ftc/library.ts`), not here.
 */
import { deleteDoc, getDoc, getDocs, limit, onSnapshot, query, serverTimestamp, updateDoc, where, type DocumentReference, type Query, type QuerySnapshot, type Unsubscribe } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { programCollection, programDoc, programPath } from "@/lib/firebase/paths";
import { tryClaimDoc } from "@/lib/claim-doc";
import { reportFirestoreError, type FirestoreFailure } from "@/lib/firestore-errors";
import { clearReadFailure, recordReadFailure } from "@/lib/read-failures";
import { ftcDocToPracticeSession, ftcDocsToPracticeSessions, ftcSessionPatch, ftcSessionStub, newSessionId } from "@/lib/ftc/practice";
import { isRecord } from "@/data/ftc/util";
import type { AllianceColor, PracticeSession, SessionKind } from "@/lib/practice-sessions";

const PROGRAM = "ftc" as const;
const SESSIONS = "practiceSessions";

type Failure = (failure: FirestoreFailure) => void;
type Equality = [field: string, value: string];
type Target = { q: Query; path: string };

const sessionsRef = () => programCollection(db, PROGRAM, SESSIONS);

function sessionsQuery(filters: Equality[], max?: number): Target {
  const wheres = filters.map(([field, value]) => where(field, "==", value));
  return {
    q: max ? query(sessionsRef(), ...wheres, limit(max)) : query(sessionsRef(), ...wheres),
    path: `${programPath(PROGRAM, SESSIONS)} where ${filters.map(([f, v]) => `${f} == ${JSON.stringify(v)}`).join(", ")}${max ? `, limit ${max}` : ""}`,
  };
}

function watch(context: string, target: Target, onData: (sessions: PracticeSession[]) => void, onError: Failure): Unsubscribe {
  return onSnapshot(
    target.q,
    (snap: QuerySnapshot) => {
      clearReadFailure(context, target.path);
      onData(ftcDocsToPracticeSessions(snap.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }))));
    },
    (err) => {
      const failure = reportFirestoreError(context, err, target.path);
      recordReadFailure(failure); // the shell shows it, so an empty list is not mistaken for "no sessions"
      onError(failure);
    }
  );
}

// --- reads -------------------------------------------------------------------------------------------------------

/** Realtime, every session of the team, any kind and status, all events (Match Select, history, the admin's unreadable-session notice). */
export function subscribeTeamSessions(teamId: string, onData: (sessions: PracticeSession[]) => void, onError: Failure): Unsubscribe {
  return watch("Couldn't load practice sessions", sessionsQuery([["teamId", teamId]]), onData, onError);
}

/** Realtime, the team's LIVE sessions (`teamId ==`, `kind ==`; live practice: Pending Robots, the score watcher, and the match keys the presence reads derive from). */
export function subscribeTeamLiveSessions(teamId: string, onData: (sessions: PracticeSession[]) => void, onError: Failure): Unsubscribe {
  return watch("Couldn't load live practice sessions", sessionsQuery([["teamId", teamId], ["kind", "live"]]), onData, onError);
}

/** Realtime, the sessions of one lobby (`teamId ==`, `lobbyId ==`): the waiting room and the results screen. */
export function subscribeLobbySessions(teamId: string, lobbyId: string, onData: (sessions: PracticeSession[]) => void, onError: Failure): Unsubscribe {
  return watch("Couldn't load the lobby's sessions", sessionsQuery([["teamId", teamId], ["lobbyId", lobbyId]]), onData, onError);
}

/** Realtime, one scout's own sessions. */
export function subscribeOwnSessions(teamId: string, uid: string, onData: (sessions: PracticeSession[]) => void, onError: Failure): Unsubscribe {
  return watch("Couldn't load your practice sessions", sessionsQuery([["teamId", teamId], ["uid", uid]]), onData, onError);
}

/** Realtime, the scout's paused session (at most one is expected; the first is offered). */
export function subscribeOwnPausedSession(teamId: string, uid: string, onData: (session: PracticeSession | null) => void, onError: Failure): Unsubscribe {
  return watch("Couldn't load your paused practice session", sessionsQuery([["teamId", teamId], ["uid", uid], ["status", "paused"]]), (sessions) => onData(sessions[0] ?? null), onError);
}

/** Realtime, one session by document id (null while it does not exist). */
export function subscribeSession(sessionId: string, onData: (session: PracticeSession | null) => void, onError: Failure): Unsubscribe {
  const ref = programDoc(db, PROGRAM, SESSIONS, sessionId);
  return onSnapshot(
    ref,
    (snap) => {
      clearReadFailure("Couldn't load the practice session", ref.path);
      const data = snap.data();
      onData(snap.exists() && isRecord(data) ? ftcDocToPracticeSession(snap.id, data) : null);
    },
    (err) => {
      const failure = reportFirestoreError("Couldn't load the practice session", err, ref.path);
      recordReadFailure(failure);
      onError(failure);
    }
  );
}

/** One session by document id (null when there is none). A failed read is reported and rethrown. */
export async function getSession(sessionId: string): Promise<PracticeSession | null> {
  const ref: DocumentReference = programDoc(db, PROGRAM, SESSIONS, sessionId);
  try {
    const snap = await getDoc(ref);
    const data = snap.data();
    return snap.exists() && isRecord(data) ? ftcDocToPracticeSession(snap.id, data) : null;
  } catch (err) {
    reportFirestoreError("Couldn't load the practice session", err, ref.path);
    throw err;
  }
}

/** The "Repeat Attempt" check: did this scout already complete this exact alliance on this match? Five equalities, limit 1, as CE writes it. */
export async function hasCompletedAttempt(teamId: string, uid: string, libraryMatchId: string, alliance: AllianceColor): Promise<boolean> {
  const target = sessionsQuery([["teamId", teamId], ["uid", uid], ["libraryMatchId", libraryMatchId], ["alliance", alliance], ["status", "completed"]], 1);
  try {
    return !(await getDocs(target.q)).empty;
  } catch (err) {
    reportFirestoreError("Couldn't check for an earlier attempt", err, target.path);
    throw err;
  }
}

// --- writes --------------------------------------------------------------------------------------------------------

/**
 * Reserves a fresh session id as a stub doc, atomically (a transaction that creates it only if nobody holds it; a clash retries with a new candidate).
 * The caller follows up with `updateSession` once the match, alliance and robots are known.
 */
export async function claimSession(teamId: string, uid: string, kind: SessionKind, maxAttempts = 5): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const id = newSessionId(kind);
    try {
      if (await tryClaimDoc(db, programPath(PROGRAM, SESSIONS), id, ftcSessionStub(teamId, uid, kind, serverTimestamp))) return id;
    } catch (err) {
      reportFirestoreError("Couldn't start the practice session", err, `${programPath(PROGRAM, SESSIONS)}/${id}`);
      throw err;
    }
  }
  throw new Error("Couldn't generate a unique session id. Try again.");
}

/** Merge-updates a session with the app-shaped patch (identity fields are never written). */
export async function updateSession(sessionId: string, patch: Partial<PracticeSession>): Promise<void> {
  const fields = ftcSessionPatch(patch);
  if (Object.keys(fields).length === 0) return;
  try {
    await updateDoc(programDoc(db, PROGRAM, SESSIONS, sessionId), fields);
  } catch (err) {
    reportFirestoreError("Couldn't save the practice session", err, `${programPath(PROGRAM, SESSIONS)}/${sessionId}`);
    throw err;
  }
}

/** Deletes a session the caller owns while it is still in progress or paused (an admin may delete a completed one), by the rules. */
export async function deleteSession(sessionId: string): Promise<void> {
  try {
    await deleteDoc(programDoc(db, PROGRAM, SESSIONS, sessionId));
  } catch (err) {
    reportFirestoreError("Couldn't delete the practice session", err, `${programPath(PROGRAM, SESSIONS)}/${sessionId}`);
    throw err;
  }
}
