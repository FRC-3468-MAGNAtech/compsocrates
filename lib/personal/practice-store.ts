"use client";

import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, query, serverTimestamp, updateDoc, where } from "@/lib/firebase/metered";
import { db } from "@/lib/firebase/client";
import { programPath } from "@/lib/firebase/paths";
import type { ProgramId } from "@/config/programs/types";
import { tryClaimDoc } from "@/lib/claim-doc";
import { generateSessionId, type AllianceColor, type PracticeSession, type SessionFlag } from "@/lib/practice-sessions";
import type { SaveEntryInput, ScoutEntry } from "@/lib/scout-entries";

/**
 * A person's PRIVATE practice: sessions and their entries under the person's own path, `<program>/personalPractice/{uid}/sessions|entries`. Nothing here carries a
 * `teamId` (an empty `teamId` was the old data bug, and the rules refuse the key), so a team can never see it unless the person shares it on joining
 * (`/api/team/share-practice`). Every read is a one-time `getDocs`/`getDoc` (no listener); the in-memory copy below lets the screens that watch one session
 * follow its updates without one. The official matches come from the shared library (`lib/personal/library.ts`), never from a team's own documents.
 *
 * The documents use the app's own field names (the shape `PracticeSession` and `ScoutEntry` already have), minus `id` and `teamId`.
 */
const sessionsPath = (program: ProgramId, uid: string) => `${programPath(program, "personalPractice")}/${uid}/sessions`;
const entriesPath = (program: ProgramId, uid: string) => `${programPath(program, "personalPractice")}/${uid}/entries`;

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** A stored personal session as the app's `PracticeSession` (`teamId` is "" in memory only: the document has no such key). Never throws. */
export function toPersonalSession(id: string, data: Record<string, unknown>): PracticeSession {
  const status = data.status === "paused" || data.status === "completed" ? data.status : "in-progress";
  return {
    id,
    teamId: "",
    uid: str(data.uid),
    scoutName: str(data.scoutName),
    kind: "solo",
    seasonId: str(data.seasonId),
    mode: data.mode === "trial" || data.mode === "competitive" ? data.mode : null,
    difficulty: (data.difficulty as PracticeSession["difficulty"]) ?? null,
    libraryMatchId: typeof data.libraryMatchId === "string" ? data.libraryMatchId : null,
    eventCode: typeof data.eventCode === "string" ? data.eventCode : null,
    alliance: data.alliance === "red" || data.alliance === "blue" ? (data.alliance as AllianceColor) : null,
    robots: arr<number>(data.robots),
    status,
    completedRobots: arr<number>(data.completedRobots),
    entryIds: arr<string>(data.entryIds),
    accuracy: num(data.accuracy),
    scoutedTotal: num(data.scoutedTotal),
    penaltyPoints: num(data.penaltyPoints),
    officialScore: num(data.officialScore),
    platform: data.platform === "mobile" ? "mobile" : "pc",
    flags: arr<SessionFlag>(data.flags),
    excluded: data.excluded === true,
    lobbyId: null,
    pairId: null,
    startedAt: str(data.startedAt),
    finishedAt: typeof data.finishedAt === "string" ? data.finishedAt : null,
    matchType: null,
    matchNumber: null,
    allianceTeams: null,
    streamUrl: null,
    streamStartSec: null,
    streamEndSec: null,
  };
}

// --- the in-memory copy (so no listener is needed) ------------------------------------------------------

const cache = new Map<string, PracticeSession>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const keyOf = (program: ProgramId, uid: string, id: string) => `${program}|${uid}|${id}`;

export function subscribePersonalSessions(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function cachedPersonalSession(program: ProgramId, uid: string, id: string): PracticeSession | null {
  return cache.get(keyOf(program, uid, id)) ?? null;
}

export function resetPersonalPracticeForTests(): void {
  cache.clear();
  listeners.clear();
}

// --- sessions -------------------------------------------------------------------------------------------

/** Reserves a fresh `PS-XXXXXX` id as a minimal session document (no `teamId`) and returns it. */
export async function claimPersonalSession(program: ProgramId, uid: string, maxAttempts = 5): Promise<string> {
  const startedAt = new Date().toISOString();
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const id = generateSessionId("solo");
    if (await tryClaimDoc(db, sessionsPath(program, uid), id, { uid, kind: "solo", status: "in-progress", startedAt, createdAt: serverTimestamp() })) {
      cache.set(keyOf(program, uid, id), toPersonalSession(id, { uid, status: "in-progress", startedAt }));
      notify();
      return id;
    }
  }
  throw new Error("Couldn't generate a unique id for your practice session. Try again.");
}

/** Merge-updates a session; the patch never carries a team id (a stray one is dropped, the rules refuse it anyway). */
export async function updatePersonalSession(program: ProgramId, uid: string, sessionId: string, patch: Partial<PracticeSession>): Promise<void> {
  const { id: _id, teamId: _teamId, ...rest } = patch;
  void _id;
  void _teamId;
  await updateDoc(doc(db, sessionsPath(program, uid), sessionId), rest);
  const key = keyOf(program, uid, sessionId);
  const current = cache.get(key);
  if (current) cache.set(key, { ...current, ...rest });
  notify();
}

export async function deletePersonalSession(program: ProgramId, uid: string, sessionId: string): Promise<void> {
  await deleteDoc(doc(db, sessionsPath(program, uid), sessionId));
  cache.delete(keyOf(program, uid, sessionId));
  notify();
}

export async function getPersonalSession(program: ProgramId, uid: string, sessionId: string): Promise<PracticeSession | null> {
  const snap = await getDoc(doc(db, sessionsPath(program, uid), sessionId));
  if (!snap.exists()) return null;
  const session = toPersonalSession(snap.id, snap.data());
  cache.set(keyOf(program, uid, sessionId), session);
  return session;
}

/** All of the person's sessions (one `getDocs`): what Match Select needs for Fresh / Opened / Scouted, and what sharing copies. */
export async function listPersonalSessions(program: ProgramId, uid: string): Promise<PracticeSession[]> {
  const snap = await getDocs(collection(db, sessionsPath(program, uid)));
  const sessions = snap.docs.map((d) => toPersonalSession(d.id, d.data()));
  for (const s of sessions) cache.set(keyOf(program, uid, s.id), s);
  return sessions;
}

/** At most one paused session (one query). */
export async function findPersonalPausedSession(program: ProgramId, uid: string): Promise<PracticeSession | null> {
  const snap = await getDocs(query(collection(db, sessionsPath(program, uid)), where("status", "==", "paused"), limit(1)));
  const first = snap.docs[0];
  return first ? toPersonalSession(first.id, first.data()) : null;
}

/** Has the person already completed this exact alliance and match? (the Repeat Attempt flag; one query) */
export async function hasCompletedPersonalAttempt(program: ProgramId, uid: string, libraryMatchId: string, alliance: AllianceColor): Promise<boolean> {
  const snap = await getDocs(query(collection(db, sessionsPath(program, uid)), where("libraryMatchId", "==", libraryMatchId), where("alliance", "==", alliance), where("status", "==", "completed"), limit(1)));
  return !snap.empty;
}

// --- entries --------------------------------------------------------------------------------------------

/** The stored entry document for a robot scouted in a personal session: the app's own entry fields, no team id, no gate. */
export function personalEntryDoc(uid: string, input: SaveEntryInput, nowIso: string = new Date().toISOString()): Record<string, unknown> {
  const { gate: _gate, ...rest } = input;
  void _gate;
  const doc: Record<string, unknown> = {
    ...rest,
    uid,
    source: "practice",
    mode: input.mode ?? null,
    sessionId: input.sessionId ?? null,
    libraryMatchId: input.libraryMatchId ?? null,
    submittedAt: nowIso,
    excluded: false,
    autoFlags: [],
    manualFlags: [],
    accuracy: null,
  };
  for (const key of Object.keys(doc)) if (doc[key] === undefined) delete doc[key];
  delete doc.teamId;
  return doc;
}

export async function savePersonalEntry(program: ProgramId, uid: string, input: SaveEntryInput): Promise<void> {
  await addDoc(collection(db, entriesPath(program, uid)), personalEntryDoc(uid, input));
}

/** A stored personal entry as the app's `ScoutEntry` (`teamId` "" in memory only). */
export function toPersonalEntry(id: string, data: Record<string, unknown>): ScoutEntry {
  return { teamId: "", autoFlags: [], manualFlags: [], accuracy: null, excluded: false, sessionId: null, libraryMatchId: null, mode: null, ...data, id } as unknown as ScoutEntry;
}

/** The robots' entries of one session, in the order they were saved. */
export async function personalEntriesForSession(program: ProgramId, uid: string, sessionId: string): Promise<ScoutEntry[]> {
  const snap = await getDocs(query(collection(db, entriesPath(program, uid)), where("sessionId", "==", sessionId)));
  return snap.docs.map((d) => toPersonalEntry(d.id, d.data())).sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
}

/** Every entry of the person's practice (one `getDocs`): what sharing copies. */
export async function listPersonalEntries(program: ProgramId, uid: string): Promise<ScoutEntry[]> {
  const snap = await getDocs(collection(db, entriesPath(program, uid)));
  return snap.docs.map((d) => toPersonalEntry(d.id, d.data()));
}
