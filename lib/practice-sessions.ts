"use client";

import {
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { useEffect, useState } from "react";
import { csSessionToPractice, practicePatchToCsFields, type SessionWriteContext } from "@/data/cs/practice";
import { tryClaimDoc } from "@/lib/claim-doc";
import { describeFirestoreError, reportFirestoreError, type FirestoreFailure } from "@/lib/firestore-errors";
import { completedAttemptQuery, ownPausedSessionQuery, scoutSessionsQuery, teamLiveSessionsQuery, teamSessionsQuery } from "@/lib/practice-queries";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import type { Difficulty } from "@/lib/difficulty";
import type { MatchType } from "@/lib/events/types";

export type SessionKind = "solo" | "live" | "lobby";
export type SessionStatus = "in-progress" | "paused" | "completed";
export type SessionMode = "trial" | "competitive" | null;
export type AllianceColor = "red" | "blue";
export type Platform = "pc" | "mobile";

export type SessionFlag = {
  type: string;
  title: string;
  detail: string;
  dismissed: boolean;
};

export type PracticeSession = {
  /** The doc id IS the Session ID (see generateSessionId/claimSessionId below). */
  id: string;
  teamId: string;
  uid: string;
  scoutName: string;
  kind: SessionKind;
  seasonId: string;
  mode: SessionMode;
  difficulty: Difficulty | null;
  libraryMatchId: string | null;
  eventCode: string | null;
  alliance: AllianceColor | null;
  robots: number[];
  status: SessionStatus;
  completedRobots: number[];
  entryIds: string[];
  accuracy: number | null;
  scoutedTotal: number | null;
  penaltyPoints: number | null;
  officialScore: number | null;
  platform: Platform;
  flags: SessionFlag[];
  excluded: boolean;
  lobbyId: string | null;
  pairId: string | null;
  startedAt: string;
  finishedAt: string | null;
  /**
   * P7, `kind: "live"` only. Solo identifies its match via `libraryMatchId`
   * alone; a live match may never be in the library at all (`libraryMatchId`
   * stays null then), so live sessions record the real match type/number
   * directly. Also doubles as the `liveMatches/{eventCode_matchKey}`
   * presence doc's own key (`lib/match-library.ts`'s `libraryMatchId()`
   * helper, reused purely for its id-formatting).
   */
  matchType: MatchType | null;
  matchNumber: number | null;
  /** P7, `kind: "live"` only — every team on `alliance` (3 for FRC), so "the other robot" (pending/presence/join logic) never needs a fresh FIRST API roster lookup. `robots` itself stays this session's own single scouted team. */
  allianceTeams: number[] | null;
  /** P7, `kind: "live"` only — null for solo/lobby. The pasted livestream link. */
  streamUrl: string | null;
  /** P7: stream position (seconds) when scouting started/ended, when the embed could report it — used to re-watch the match later. Null if not captured (e.g. "Open in a new tab" fallback) or not finished yet. */
  streamStartSec: number | null;
  streamEndSec: number | null;
};

// D1: sessions live in CS's `practiceSessions` (data/cs/practice.ts). A CE-written session carries CE's fields (uid, kind, status, ...)
// AND the CS ones (scoutId, eventKey, matchId/Key/Number/Type, scores, epoch-ms timestamps), so CS reads it too; a CS-written snapshot
// reads here as a completed solo session. CS's live-lobby docs share the collection and are not sessions: they are skipped on read.
const COLLECTION = "practiceSessions";

const SESSION_ID_PREFIXES: Record<SessionKind, string> = { solo: "PS-", live: "LV-", lobby: "LB-" };
// No 0/O/1/I — unambiguous when read off a screen or written down.
const SESSION_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const SESSION_ID_SUFFIX_LENGTH = 6;

function randomSuffix(): string {
  let out = "";
  for (let i = 0; i < SESSION_ID_SUFFIX_LENGTH; i++) {
    out += SESSION_ID_ALPHABET[Math.floor(Math.random() * SESSION_ID_ALPHABET.length)];
  }
  return out;
}

/** A readable, random candidate Session ID — PS-/LV-/LB- plus 6 unambiguous characters. Pure; does not check or reserve uniqueness (see claimSessionId). */
export function generateSessionId(kind: SessionKind): string {
  return `${SESSION_ID_PREFIXES[kind]}${randomSuffix()}`;
}

/**
 * Generates a `${prefix}XXXXXX` candidate id and atomically reserves it as
 * a doc in `collectionName`, retrying with a fresh candidate on the rare
 * collision — a bare random-string pick alone can't stop two concurrent
 * callers from both choosing the same free id before either writes
 * anything. Shared by `claimSessionId` (practiceSessions) and `lib/lobby.ts`'s
 * `claimLobbyId` (lobbies, P8) — same scheme, two collections.
 */
export async function claimUniqueDocId(
  collectionName: string,
  prefix: string,
  initialData: Record<string, unknown>,
  maxAttempts = 5
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = `${prefix}${randomSuffix()}`;
    if (await tryClaimDoc(db, collectionName, candidate, initialData)) return candidate;
  }
  throw new Error(`Couldn't generate a unique id in ${collectionName} — try again.`);
}

/**
 * Generates a Session ID and atomically reserves it as a (minimal, valid)
 * `practiceSessions/{id}` doc (see `claimUniqueDocId` above). The caller
 * (P4) follows up with further writes to fill in the rest of the session
 * once more context is known (library match, alliance, robots, ...).
 */
export async function claimSessionId(teamId: string, uid: string, kind: SessionKind, maxAttempts = 5): Promise<string> {
  return claimUniqueDocId(
    COLLECTION,
    SESSION_ID_PREFIXES[kind],
    {
      teamId,
      uid,
      kind,
      status: "in-progress" satisfies SessionStatus,
      // CS fields (epoch ms, as CS writes them): the scout's uid, the live flag, and the time CS sorts on.
      scoutId: uid,
      isLivePracticeScouting: kind === "live",
      startedAt: Date.now(),
      timestamp: Date.now(),
      createdAt: serverTimestamp(),
    },
    maxAttempts
  );
}

/** A `practiceSessions` doc as a session; null for a doc that is not one (CS's live-lobby docs). */
function toSession(id: string, data: Record<string, unknown>): PracticeSession | null {
  return csSessionToPractice(id, data);
}

const isSession = (s: PracticeSession | null): s is PracticeSession => s !== null;

/**
 * Merge-updates a session. The patch is written together with its CS-named counterparts (`practicePatchToCsFields`), so the doc stays
 * readable by CS: pass `context` (the library match, the session kind) when the patch sets the match, since the CS match fields come
 * from the match and the patch alone does not carry them.
 */
export async function updatePracticeSession(sessionId: string, patch: Partial<PracticeSession>, context?: SessionWriteContext): Promise<void> {
  await updateDoc(doc(db, COLLECTION, sessionId), { ...patch, ...practicePatchToCsFields(patch, context) });
}

export async function getPracticeSession(sessionId: string): Promise<PracticeSession | null> {
  const snap = await getDoc(doc(db, COLLECTION, sessionId));
  return snap.exists() ? toSession(snap.id, snap.data()) : null;
}

/** Realtime subscription to one session — for the in-progress scouting screen (P4) or a shared lobby view. */
export function usePracticeSession(sessionId: string | null) {
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());

  useEffect(() => {
    if (!sessionId || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSession(null);
      setLoaded(true);
      return;
    }
    const unsubscribe = onSnapshot(
      doc(db, COLLECTION, sessionId),
      (snap) => {
        setSession(snap.exists() ? toSession(snap.id, snap.data()) : null);
        setLoaded(true);
      },
      (err) => {
        console.error("practiceSessions/{sessionId} subscription failed:", err);
        setSession(null);
        setLoaded(true);
      }
    );
    return unsubscribe;
  }, [sessionId]);

  return { session, loaded };
}

/**
 * Realtime subscription to every `solo` session for the team — what
 * Practice Scouting's Match Select (P4) uses to compute each (match,
 * alliance) row's Fresh/Opened/Scouted status team-wide. Simpler and more
 * robust than querying per `libraryMatchId` (which would hit Firestore's
 * 30-value `in`-query cap for a large library): one subscription, status
 * computed client-side.
 */
export function useTeamPracticeSessions(teamId: string | null) {
  const [sessions, setSessions] = useState<PracticeSession[]>([]);
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());
  const [error, setError] = useState<FirestoreFailure | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!teamId || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSessions([]);
      setLoaded(true);
      return;
    }
    setError(null);
    const unsubscribe = onSnapshot(
      // CS's own snapshots carry no `kind`, so the team's sessions are read and filtered here instead of querying `kind == "solo"`.
      teamSessionsQuery(db, teamId),
      (snap) => {
        setSessions(snap.docs.map((d) => toSession(d.id, d.data())).filter(isSession).filter((s) => s.kind === "solo"));
        setLoaded(true);
      },
      (err) => {
        const path = `practiceSessions where teamId == ${teamId}, kind == "solo"`;
        reportFirestoreError("team practiceSessions subscription failed", err, path);
        setError(describeFirestoreError("Couldn't load practice sessions", err, path));
        setSessions([]);
        setLoaded(true);
      }
    );
    return unsubscribe;
  }, [teamId, attempt]);

  return { sessions, loaded, error, retry: () => setAttempt((n) => n + 1) };
}

/**
 * Realtime subscription to every `live` session for the team (P7) — what
 * the Pending Robots list and the Presence panel's "is this alliance fully
 * covered" checks read, team-wide (not just the caller's own), same
 * reasoning as `useTeamPracticeSessions`.
 */
export function useTeamLiveSessions(teamId: string | null) {
  const [sessions, setSessions] = useState<PracticeSession[]>([]);
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());

  useEffect(() => {
    if (!teamId || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSessions([]);
      setLoaded(true);
      return;
    }
    const unsubscribe = onSnapshot(
      teamLiveSessionsQuery(db, teamId),
      (snap) => {
        setSessions(snap.docs.map((d) => toSession(d.id, d.data())).filter(isSession));
        setLoaded(true);
      },
      (err) => {
        reportFirestoreError("team live practiceSessions subscription failed", err, `practiceSessions where teamId == ${teamId}, kind == "live"`);
        setSessions([]);
        setLoaded(true);
      }
    );
    return unsubscribe;
  }, [teamId]);

  return { sessions, loaded };
}

/**
 * Realtime, every `practiceSessions` doc for the team regardless of `kind`
 * or `status` (P9) — what the Admin Panel's Sessions/Rescore tabs and Match
 * Analytics' practice view need, since those tools work across solo/live/
 * lobby sessions at once rather than one kind at a time like
 * `useTeamPracticeSessions`/`useTeamLiveSessions` do.
 */
export function useAllTeamPracticeSessions(teamId: string | null) {
  const [sessions, setSessions] = useState<PracticeSession[]>([]);
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());

  useEffect(() => {
    if (!teamId || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSessions([]);
      setLoaded(true);
      return;
    }
    const unsubscribe = onSnapshot(
      teamSessionsQuery(db, teamId),
      (snap) => {
        setSessions(snap.docs.map((d) => toSession(d.id, d.data())).filter(isSession));
        setLoaded(true);
      },
      (err) => {
        reportFirestoreError("all team practiceSessions subscription failed", err, `practiceSessions where teamId == ${teamId}`);
        setSessions([]);
        setLoaded(true);
      }
    );
    return unsubscribe;
  }, [teamId]);

  return { sessions, loaded };
}

/** At most one paused session per user (spec) — realtime, so the Resume banner updates if it's resolved from another tab. */
export function useOwnPausedSession(teamId: string | null, uid: string | null) {
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());

  useEffect(() => {
    if (!teamId || !uid || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSession(null);
      setLoaded(true);
      return;
    }
    const unsubscribe = onSnapshot(
      ownPausedSessionQuery(db, teamId, uid),
      (snap) => {
        const first = snap.docs[0];
        setSession(first ? toSession(first.id, first.data()) : null);
        setLoaded(true);
      },
      (err) => {
        reportFirestoreError("own paused practiceSessions subscription failed", err, `practiceSessions where teamId == ${teamId}, uid == ${uid}, status == "paused"`);
        setSession(null);
        setLoaded(true);
      }
    );
    return unsubscribe;
  }, [teamId, uid]);

  return { session, loaded };
}

/** One-shot check for the "Repeat Attempt" flag — has this uid already completed this exact alliance+match before? */
export async function hasCompletedAttemptBefore(
  teamId: string,
  uid: string,
  libraryMatchId: string,
  alliance: AllianceColor
): Promise<boolean> {
  const snap = await getDocs(completedAttemptQuery(db, teamId, uid, libraryMatchId, alliance));
  if (!snap.empty) return true;
  // A CS-written snapshot has no `status` / `uid`: look through the scout's sessions by `scoutId` for the same match and alliance.
  try {
    const own = await getDocs(scoutSessionsQuery(db, teamId, uid));
    return own.docs.some((d) => {
      const s = toSession(d.id, d.data());
      return s !== null && s.status === "completed" && s.libraryMatchId === libraryMatchId && s.alliance === alliance;
    });
  } catch (err) {
    console.warn("scout practiceSessions lookup failed:", err);
    return false;
  }
}

/**
 * Deletes a session the caller owns while it's still in-progress or
 * paused — backs "Change Match," "Cancel"/"End Session" (discard without
 * saving), and the Resume banner's "Discard" button. Never allowed once
 * completed (see firestore.rules) — P4 extends P3's `allow delete: if
 * false` for exactly this, see docs/ASSUMPTIONS.md.
 */
export async function deletePracticeSession(sessionId: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, sessionId));
}

export type ScoutingCategory = "trial" | "competitive" | "real-event";

type CategoryInput =
  | { source: "event" | "practice" | "live"; mode: SessionMode }
  | { kind: SessionKind; mode: SessionMode };

/** Shared by scoutEntries (source-based) and practiceSessions (kind-based) — a "live" kind/source is always "real-event", matching an in-person or synchronized real competition, never a recorded library match. */
export function getCategory(input: CategoryInput): ScoutingCategory {
  const isRealEvent = "source" in input ? input.source === "event" || input.source === "live" : input.kind === "live";
  if (isRealEvent) return "real-event";
  return input.mode ?? "trial";
}
