/**
 * Practice lobbies under `programs/ftc/lobbies/{LB-code}` and `.../players/{uid}` (Batch 6). Conventions as `practice.ts`: explicit-program paths, a failed
 * read is reported and handed to `onError`, a failed write is reported and rethrown. Pure rules are in `lib/ftc/lobby.ts`.
 *
 * NO collection-group query (docs/SECURITY-NOTES.md 3a). "The lobby I am in" lists the team's lobbies (`teamId ==`, allowed by the rules) and, for each OPEN
 * one, reads the caller's own player doc by path (`teamId ==`, `uid ==`: a query, not a get, because a get of a player doc that does not exist is denied).
 * A roster read carries `teamId ==` too, as the rules require. Equality-only, no orderBy, no new index.
 */
import { collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where, type Unsubscribe } from "@/lib/firebase/metered";
import { db } from "@/lib/firebase/client";
import { programCollection, programDoc, programPath } from "@/lib/firebase/paths";
import { tryClaimDoc } from "@/lib/claim-doc";
import { reportFirestoreError, type FirestoreFailure } from "@/lib/firestore-errors";
import { clearReadFailure, recordReadFailure } from "@/lib/read-failures";
import { isRecord } from "@/data/ftc/util";
import { isClosedLobby, joinedAtMs, lobbyStub, pickMyLobby, readLobby, type MyLobbyEntry } from "@/lib/ftc/lobby";
import { newSessionId } from "@/lib/ftc/practice";
import type { LobbyDoc, LobbyPlayer } from "@/lib/lobby";
import type { SessionMode } from "@/lib/practice-sessions";

const PROGRAM = "ftc" as const;
const LOBBIES = "lobbies";
const PLAYERS = "players";

type Failure = (failure: FirestoreFailure) => void;

const lobbyDoc = (lobbyId: string) => programDoc(db, PROGRAM, LOBBIES, lobbyId);
const playerDoc = (lobbyId: string, uid: string) => doc(db, programPath(PROGRAM, LOBBIES), lobbyId, PLAYERS, uid);
const playersPath = (lobbyId: string) => `${programPath(PROGRAM, LOBBIES)}/${lobbyId}/${PLAYERS}`;

async function write<T>(context: string, path: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    reportFirestoreError(context, err, path);
    throw err;
  }
}

// --- the lobby ------------------------------------------------------------------------------------------------------

/** Reserves a fresh lobby code (`LB-XXXXXX`, also the join code) as a waiting lobby, atomically; a clash retries with a new candidate. */
export async function claimLobby(teamId: string, hostUid: string, hostName: string, seasonId: string, mode: Exclude<SessionMode, null>, maxAttempts = 5): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const id = newSessionId("lobby");
    const claimed = await write("Couldn't create the lobby", `${programPath(PROGRAM, LOBBIES)}/${id}`, () =>
      tryClaimDoc(db, programPath(PROGRAM, LOBBIES), id, lobbyStub({ teamId, hostUid, hostName, seasonId, mode }, serverTimestamp))
    );
    if (claimed) return id;
  }
  throw new Error("Couldn't generate a unique lobby code. Try again.");
}

/** Host-only (by the rules): settings, match, pairing, status. */
export function updateLobby(lobbyId: string, patch: Partial<LobbyDoc>): Promise<void> {
  return write("Couldn't update the lobby", `${programPath(PROGRAM, LOBBIES)}/${lobbyId}`, () => updateDoc(lobbyDoc(lobbyId), patch as Record<string, unknown>));
}

export function heartbeatHost(lobbyId: string): Promise<void> {
  return updateLobby(lobbyId, { hostLastSeen: serverTimestamp() });
}

/** Realtime, one lobby by code (null while it does not exist). */
export function subscribeLobby(lobbyId: string, onData: (lobby: LobbyDoc | null) => void, onError: Failure): Unsubscribe {
  const ref = lobbyDoc(lobbyId);
  return onSnapshot(
    ref,
    (snap) => {
      clearReadFailure("Couldn't load the lobby", ref.path);
      const data = snap.data();
      onData(snap.exists() && isRecord(data) ? readLobby(snap.id, data) : null);
    },
    (err) => {
      const failure = reportFirestoreError("Couldn't load the lobby", err, ref.path);
      recordReadFailure(failure);
      onError(failure);
    }
  );
}

// --- the roster ---------------------------------------------------------------------------------------------------------

/** Create-or-merge the caller's own player doc: joining with a code and a reconnecting refresh are the same call. */
export function joinLobby(lobbyId: string, teamId: string, uid: string, name: string): Promise<void> {
  return write("Couldn't join the lobby", `${playersPath(lobbyId)}/${uid}`, () =>
    setDoc(playerDoc(lobbyId, uid), { uid, teamId, name, lastSeen: serverTimestamp(), submitted: false, joinedAt: serverTimestamp() }, { merge: true })
  );
}

const patchPlayer = (context: string, lobbyId: string, uid: string, patch: Record<string, unknown>) =>
  write(context, `${playersPath(lobbyId)}/${uid}`, () => updateDoc(playerDoc(lobbyId, uid), patch));

export const heartbeatPlayer = (lobbyId: string, uid: string) => patchPlayer("Couldn't update your presence in the lobby", lobbyId, uid, { lastSeen: serverTimestamp() });
export const markPlayerSubmitted = (lobbyId: string, uid: string) => patchPlayer("Couldn't record your submission", lobbyId, uid, { submitted: true });
export const resetPlayerSubmitted = (lobbyId: string, uid: string) => patchPlayer("Couldn't reset your submission", lobbyId, uid, { submitted: false });

export function leaveLobbyPlayer(lobbyId: string, uid: string): Promise<void> {
  return write("Couldn't leave the lobby", `${playersPath(lobbyId)}/${uid}`, () => deleteDoc(playerDoc(lobbyId, uid)));
}

/** Realtime, the lobby's roster for this team (`teamId ==`: the rules do not filter, the query must). */
export function subscribePlayers(lobbyId: string, teamId: string, onData: (players: LobbyPlayer[]) => void, onError: Failure): Unsubscribe {
  const path = `${playersPath(lobbyId)} where teamId == ${JSON.stringify(teamId)}`;
  return onSnapshot(
    query(collection(db, programPath(PROGRAM, LOBBIES), lobbyId, PLAYERS), where("teamId", "==", teamId)),
    (snap) => {
      clearReadFailure("Couldn't load the lobby's players", path);
      onData(snap.docs.map((d) => d.data() as LobbyPlayer));
    },
    (err) => {
      const failure = reportFirestoreError("Couldn't load the lobby's players", err, path);
      recordReadFailure(failure);
      onError(failure);
    }
  );
}

// --- "the lobby I am in" (replaces the collection-group query on `players`) -------------------------------------------

/**
 * Realtime, the open lobby the caller joined most recently (null when none). Lists the team's lobbies, then watches the caller's own player doc in each OPEN
 * one. The first answer waits until every open lobby has been asked once, so a banner never appears and then vanishes.
 */
export function subscribeMyLobby(teamId: string, uid: string, onData: (lobbyId: string | null) => void, onError: Failure): Unsubscribe {
  const watching = new Map<string, Unsubscribe>();
  const answers = new Map<string, MyLobbyEntry | null>(); // lobby id -> my player doc there (null: asked, none)
  let open: string[] | null = null;
  let closed = false;

  const emit = () => {
    if (closed || open === null) return;
    if (open.some((id) => !answers.has(id))) return;
    onData(pickMyLobby(open.flatMap((id) => answers.get(id) ?? [])));
  };

  const lobbiesPath = `${programPath(PROGRAM, LOBBIES)} where teamId == ${JSON.stringify(teamId)}`;
  const stopLobbies = onSnapshot(
    query(programCollection(db, PROGRAM, LOBBIES), where("teamId", "==", teamId)),
    (snap) => {
      if (closed) return;
      clearReadFailure("Couldn't look for your lobby", lobbiesPath);
      open = snap.docs.filter((d) => !isClosedLobby(d.data().status)).map((d) => d.id);
      const wanted = new Set(open);
      for (const [id, stop] of [...watching]) {
        if (wanted.has(id)) continue;
        stop();
        watching.delete(id);
        answers.delete(id);
      }
      for (const id of open) {
        if (watching.has(id)) continue;
        const path = `${playersPath(id)} where teamId == ${JSON.stringify(teamId)}, uid == ${JSON.stringify(uid)}`;
        watching.set(
          id,
          onSnapshot(
            query(collection(db, programPath(PROGRAM, LOBBIES), id, PLAYERS), where("teamId", "==", teamId), where("uid", "==", uid)),
            (players) => {
              const mine = players.docs[0];
              answers.set(id, mine ? { lobbyId: id, joinedAtMs: joinedAtMs(mine.data().joinedAt) } : null);
              emit();
            },
            (err) => {
              const failure = reportFirestoreError("Couldn't look for your lobby", err, path);
              recordReadFailure(failure);
              answers.set(id, null); // reported; the other lobbies still answer
              onError(failure);
              emit();
            }
          )
        );
      }
      emit();
    },
    (err) => {
      const failure = reportFirestoreError("Couldn't look for your lobby", err, lobbiesPath);
      recordReadFailure(failure);
      onError(failure);
    }
  );

  return () => {
    closed = true;
    stopLobbies();
    for (const stop of watching.values()) stop();
    watching.clear();
  };
}
