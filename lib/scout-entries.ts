"use client";

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  where,
  type Query,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { useEffect, useState } from "react";
import { expandEventKeyAliases, normalizeEventKey } from "@/config/event";
import { csDocsToScoutEntries, csDocToScoutEntry, entryFlagStatePatch, flagStateDocId, indexFlagStates, scoutEntryToCsDoc, scoutEntryToCsPatch } from "@/data/cs/scouting";
import type { CsFlagState, CsRecord } from "@/data/cs/types";
import { str, stripUndefined } from "@/data/cs/util";
import { auth, db, isFirebaseConfigured } from "@/lib/firebase/client";
import type { MatchType } from "@/lib/events/types";
import type { Form, FormValues, StickyNote } from "@/lib/forms/types";
import { storableScore, type ScoreResult } from "@/lib/forms/scoring";
import { commentsFrom, joinNotes } from "@/lib/forms/values";
import type { GameId } from "@/lib/games/types";

/** The three standard phase subtotals and the total; `byPhase` is only present when some other (custom) phase also scored (P21), so ordinary entries are unchanged. */
export type ScoreBreakdown = { auto: number; teleop: number; endgame: number; total: number; byPhase?: Record<string, number> };

export type AccuracyStatus = "complete" | "needs-robots" | "awaiting-results" | "not-applicable";

export type AccuracyResult = {
  status: AccuracyStatus;
  value: number | null;
  scoutedTotal: number | null;
  penaltyPoints: number | null;
  officialScore: number | null;
};

export const notApplicableAccuracy: AccuracyResult = {
  status: "not-applicable",
  value: null,
  scoutedTotal: null,
  penaltyPoints: null,
  officialScore: null,
};

export type ManualFlagReason =
  | "No teleop score"
  | "No auto score"
  | "Unrealistic scoring"
  | "Wrong team scouted"
  | "Scout started late"
  | "Scout left early"
  | "Duplicate entry"
  | "Other";

export type AutoFlag = { ruleId: string; dismissed: boolean };
export type ManualFlag = { id: string; reason: ManualFlagReason; note?: string; addedAt: string };

/** P3: 'event' (today's Match Scout Form), 'practice' (a solo/lobby session against a library match), 'live' (scouting a real event in real time as a practice session). */
export type ScoutEntrySource = "event" | "practice" | "live";
/** Only meaningful for `source: "practice"` — null for 'event'/'live'. See lib/practice-sessions.ts's getCategory(). */
export type ScoutEntryMode = "trial" | "competitive" | null;

export type ScoutEntry = {
  id: string;
  teamId: string;
  uid: string;
  source: ScoutEntrySource;
  mode: ScoutEntryMode;
  /** P21: the form (and the immutable version of it) this entry was scouted with, so it can always be read, displayed and rescored against that form. */
  formId: string;
  formVersion: number;
  scoutName: string;
  eventCode: string;
  matchType: MatchType;
  matchNumber: number;
  teamNumber: number;
  /**
   * P21: the entry's values keyed by the form's field `key`: what every reader should use, through `entryValues()` (lib/forms/entry-values.ts), which
   * applies the form's key aliases.
   */
  values?: FormValues;
  score: ScoreBreakdown;
  /** P21: present (as `false`) only on entries from a form with scoring off: they have no score, so accuracy and everything that depends on it is "n/a" for them. */
  scored?: false;
  comments: string;
  /** P27: the sticky notes written while filling the form (the panel itself is P28). `comments` is derived from them too, for the old Comments column. */
  stickyNotes?: StickyNote[];
  /** P27: the alliance a form about an alliance (Lead Scout, Match Strategy, Drive Reflection) was filled for; absent on match-scout entries. */
  alliance?: "red" | "blue" | null;
  /** P27: for a plan-versus-actual form: the entry it was prefilled from, and how many answers differed from it when it was submitted. */
  linkedEntryId?: string | null;
  planDifferences?: number;
  /** Client-set ISO timestamp, usable immediately (including offline, before createdAt syncs). */
  submittedAt: string;
  excluded: boolean;
  autoFlags: AutoFlag[];
  manualFlags: ManualFlag[];
  accuracy: AccuracyResult | null;
  /** P3: set for 'practice'/'live' entries — the practiceSessions doc this entry belongs to. */
  sessionId: string | null;
  /** P3: set for 'practice' entries scored against an imported libraryMatches doc. */
  libraryMatchId: string | null;
  /** D1 (additive): the game the entry was scouted for ("REBUILT" | "REEFSCAPE" | "CHARGED_UP"), from the CS doc's `game`. */
  game?: GameId;
  /** D1 (additive): CS keeps "exclude from accuracy" on `scoutingFlagStates` (separate from `excluded`, CS's `excludeFromStats`). */
  excludeFromAccuracy?: boolean;
  /** D1/D10 (additive): the CS-side strings this entry was read from, kept so rewriting an unchanged entry never alters them. See data/cs/scouting.ts. */
  legacy?: ScoutEntryLegacy;
};

/** The original CS strings of an entry read through `data/cs/scouting.ts` (`matchId` `qf2`, `matchType` `finals`, `matchNumber` "2", `teamNumber` "254", `eventKey` as stored). */
export type ScoutEntryLegacy = {
  /** Which kind of `scouting` row this was (always "official" or "practice" for an entry). */
  kind: "official" | "practice";
  matchId?: string;
  matchType?: string;
  matchNumber?: string;
  teamNumber?: string;
  eventKey?: string;
};

/**
 * P21: everything about an entry that comes from its form: which form and version, the keyed values, the score as it is stored, and the summary
 * comment. Build it with `entryPayloadFor` so every writer stores the same shape.
 */
export type EntryPayload = {
  formId: string;
  formVersion: number;
  values: FormValues;
  score: ScoreBreakdown;
  scored?: false;
  comments: string;
  stickyNotes?: StickyNote[];
};

/**
 * The summary comment: the form's `comments` field text (if it has one) and the sticky notes' text, joined with " | " (P27). With no notes it is exactly what it
 * always was, so the Comments column and every old entry read the same.
 */
export function derivedComments(form: Pick<Form, "sections">, values: FormValues, stickyNotes?: readonly StickyNote[]): string {
  const base = commentsFrom(form, values);
  const notes = joinNotes(stickyNotes);
  return [base, notes].filter((x) => x.trim() !== "").join(" | ");
}

export function entryPayloadFor(form: Pick<Form, "id" | "version" | "sections" | "scoringEnabled">, values: FormValues, score: ScoreResult, extras: { stickyNotes?: StickyNote[] } = {}): EntryPayload {
  return {
    formId: form.id,
    formVersion: form.version,
    values,
    score: storableScore(score),
    ...(form.scoringEnabled ? {} : { scored: false as const }),
    comments: derivedComments(form, values, extras.stickyNotes),
    ...(extras.stickyNotes && extras.stickyNotes.length > 0 ? { stickyNotes: extras.stickyNotes } : {}),
  };
}

/** Does this entry have a score at all? (False for entries from a form with scoring off: their accuracy is "n/a".) */
export const isScored = (entry: Pick<ScoutEntry, "scored">): boolean => entry.scored !== false;

export type SaveEntryInput = Pick<ScoutEntry, "scoutName" | "eventCode" | "matchType" | "matchNumber" | "teamNumber"> &
  EntryPayload &
  Partial<Pick<ScoutEntry, "source" | "mode" | "sessionId" | "libraryMatchId">>;

/**
 * D1: entries are stored in CS's `scouting` collection (and their manual flags in `scoutingFlagStates`), through the pure
 * converters in data/cs/scouting.ts. Everything below keeps the exported names the app's pages call.
 *
 *  - READ  `scouting where teamId == team`, plus one `scoutingFlagStates where teamId == team` listener shared per team. Rows that
 *          are not entries (sub-in, lead, unknown game) are dropped client-side (`classifyCsRow`). Older rows without a `teamId`
 *          are reached through a one-shot fallback by the team members' `scoutId` / `scoutName` (team-wide reads only).
 *  - WRITE `addDoc` in the CS shape; edits are `setDoc(..., { merge: true })` of only the changed top-level fields, so fields
 *          this app does not know survive (D10). Flag / dismissal / exclude-from-accuracy changes go to `scoutingFlagStates`.
 *  - DELETE removes the scouting doc (and, best effort, its flag state).
 */
const COLLECTION = "scouting";
const FLAG_COLLECTION = "scoutingFlagStates";

/** Firestore's `in` operator takes at most 30 values. */
const IN_LIMIT = 30;

type RawRow = { id: string; data: CsRecord; pending: boolean };

// ---------------------------------------------------------------------------------------------------------------------
// Flag states: ONE listener per team, shared by every entry subscription
// ---------------------------------------------------------------------------------------------------------------------

type FlagStore = { listeners: Set<() => void>; states: ReadonlyMap<string, CsFlagState>; unsubscribe: Unsubscribe };
const flagStores = new Map<string, FlagStore>();

function subscribeFlagStates(teamId: string, onChange: () => void): Unsubscribe {
  let store = flagStores.get(teamId);
  if (!store) {
    const created: FlagStore = { listeners: new Set(), states: new Map(), unsubscribe: () => {} };
    created.unsubscribe = onSnapshot(
      query(collection(db, FLAG_COLLECTION), where("teamId", "==", teamId)),
      (snap) => {
        created.states = indexFlagStates(snap.docs.map((d) => d.data() as CsFlagState));
        created.listeners.forEach((listener) => listener());
      },
      (err) => {
        // CS does the same: carry on without flag states.
        console.warn("scoutingFlagStates subscription failed:", err);
        created.states = new Map();
        created.listeners.forEach((listener) => listener());
      }
    );
    flagStores.set(teamId, created);
    store = created;
  }
  const active = store;
  active.listeners.add(onChange);
  return () => {
    active.listeners.delete(onChange);
    if (active.listeners.size === 0) {
      active.unsubscribe();
      if (flagStores.get(teamId) === active) flagStores.delete(teamId);
    }
  };
}

function currentFlagStates(teamId: string): ReadonlyMap<string, CsFlagState> {
  return flagStores.get(teamId)?.states ?? new Map();
}

async function loadFlagStates(teamId: string): Promise<ReadonlyMap<string, CsFlagState>> {
  try {
    const snap = await getDocs(query(collection(db, FLAG_COLLECTION), where("teamId", "==", teamId)));
    return indexFlagStates(snap.docs.map((d) => d.data() as CsFlagState));
  } catch (err) {
    console.warn("scoutingFlagStates read failed, continuing without flag states:", err);
    return new Map();
  }
}

const toRaw = (d: QueryDocumentSnapshot): RawRow => ({ id: d.id, data: d.data() as CsRecord, pending: d.metadata.hasPendingWrites });

function toEntries(rows: readonly RawRow[], teamId: string, flags: ReadonlyMap<string, CsFlagState>): ScoutEntry[] {
  return csDocsToScoutEntries(rows, flags, { fallbackTeamId: teamId });
}

/** Subscribes to one scouting query (already scoped to the team) and keeps its entries merged with the team's flag states. */
function subscribeEntryQuery(teamId: string, q: Query, callback: (entries: ScoutEntry[], pendingWrites: number) => void, label: string): Unsubscribe {
  let rows: RawRow[] = [];
  const emit = () => callback(toEntries(rows, teamId, currentFlagStates(teamId)), rows.filter((r) => r.pending).length);
  const unsubscribeRows = onSnapshot(
    q,
    { includeMetadataChanges: true },
    (snap) => {
      rows = snap.docs.map(toRaw);
      emit();
    },
    (err) => console.error(`${label} subscription failed:`, err)
  );
  const unsubscribeFlags = subscribeFlagStates(teamId, emit);
  return () => {
    unsubscribeRows();
    unsubscribeFlags();
  };
}

const teamQuery = (teamId: string, ...extra: QueryConstraint[]) => query(collection(db, COLLECTION), where("teamId", "==", teamId), ...extra);

/** `eventKey in [canonical key + every alias spelling]`: stored data may use either (config/event.ts). */
const eventConstraint = (eventCode: string) => where("eventKey", "in", expandEventKeyAliases(eventCode).slice(0, IN_LIMIT));

// ---------------------------------------------------------------------------------------------------------------------
// Legacy rows without a teamId (CS `getTeamEntries` joined them through the scouts' names)
// ---------------------------------------------------------------------------------------------------------------------

const fallbackCache = new Map<string, Promise<RawRow[]>>();

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Rows written before CS stamped `teamId` (or by users with no team at the time) are invisible to `where teamId ==`. They are
 * found through the team's members: `scoutId in [uids]` and `scoutName in [names]`, 30 per query, keeping only rows whose
 * `teamId` is empty or missing (a row stamped with another team belongs to that team). One-shot per team per session, since
 * such rows are historical and every new write carries a `teamId`.
 */
function loadLegacyRows(teamId: string): Promise<RawRow[]> {
  const cached = fallbackCache.get(teamId);
  if (cached) return cached;
  const task = (async () => {
    const members = await getDocs(query(collection(db, "users"), where("teamId", "==", teamId)));
    const uids = members.docs.map((d) => d.id);
    const names = [...new Set(members.docs.map((d) => str(d.data().displayName).trim()).filter(Boolean))];
    const snaps = await Promise.all([
      ...chunk(uids, IN_LIMIT).map((ids) => getDocs(query(collection(db, COLLECTION), where("scoutId", "in", ids)))),
      ...chunk(names, IN_LIMIT).map((list) => getDocs(query(collection(db, COLLECTION), where("scoutName", "in", list)))),
    ]);
    const byId = new Map<string, RawRow>();
    for (const snap of snaps) {
      for (const d of snap.docs) {
        if (str(d.data().teamId).trim() === "" && !byId.has(d.id)) byId.set(d.id, toRaw(d));
      }
    }
    return [...byId.values()];
  })().catch((err) => {
    console.warn("legacy scouting rows fallback failed:", err);
    fallbackCache.delete(teamId);
    return [] as RawRow[];
  });
  fallbackCache.set(teamId, task);
  return task;
}

function mergeRows(primary: readonly RawRow[], extra: readonly RawRow[]): RawRow[] {
  const seen = new Set(primary.map((r) => r.id));
  return [...primary, ...extra.filter((r) => !seen.has(r.id))];
}

// ---------------------------------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The CS `scouting` document `saveEntry` writes for a new entry: pure (no Firestore), so each game's submission can be checked against the raw shape
 * CS reads. Throws for a form CS cannot store (a game that is not submittable, or a form no game plugin owns): nothing should be written then.
 */
export function entryDocForSave(teamId: string, uid: string, input: SaveEntryInput, options: { now?: number } = {}): CsRecord {
  const { source = "event", mode = null, sessionId = null, libraryMatchId = null } = input;
  const draft: ScoutEntry = {
    id: "",
    teamId,
    uid,
    source,
    mode,
    formId: input.formId,
    formVersion: input.formVersion,
    scoutName: input.scoutName,
    eventCode: normalizeEventKey(input.eventCode),
    matchType: input.matchType,
    matchNumber: input.matchNumber,
    teamNumber: input.teamNumber,
    values: input.values,
    score: input.score,
    comments: input.comments,
    ...(input.stickyNotes && input.stickyNotes.length > 0 ? { stickyNotes: input.stickyNotes } : {}),
    alliance: null,
    submittedAt: new Date(options.now ?? Date.now()).toISOString(),
    excluded: false,
    autoFlags: [],
    manualFlags: [],
    accuracy: null,
    sessionId,
    libraryMatchId,
  };
  return stripUndefined(scoutEntryToCsDoc(draft, undefined, { actorUid: uid, now: options.now }));
}

export async function saveEntry(teamId: string, uid: string, input: SaveEntryInput): Promise<void> {
  // Throws for a form CS cannot store: nothing is written.
  await addDoc(collection(db, COLLECTION), entryDocForSave(teamId, uid, input));
}

// ---------------------------------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------------------------------

/** Every entry of the team (all sources), plus legacy rows without a `teamId`. */
export async function getEntries(teamId: string): Promise<ScoutEntry[]> {
  const [snap, legacy, flags] = await Promise.all([getDocs(teamQuery(teamId)), loadLegacyRows(teamId), loadFlagStates(teamId)]);
  return toEntries(mergeRows(snap.docs.map(toRaw), legacy), teamId, flags);
}

/**
 * "event"-sourced entries for one real event only (`source === "event"`: practice-session rows can carry the same event key and
 * must not mix into Match Analytics). Matches every spelling of the event key (aliases, config/event.ts).
 */
export async function getEntriesForEvent(teamId: string, eventCode: string): Promise<ScoutEntry[]> {
  const [snap, flags] = await Promise.all([getDocs(teamQuery(teamId, eventConstraint(eventCode))), loadFlagStates(teamId)]);
  return toEntries(snap.docs.map(toRaw), teamId, flags).filter((e) => e.source === "event");
}

/** P9: the documented, canonical name for "an analytics page's real-event data": a plain alias for `getEntriesForEvent`. */
export const getEventEntries = getEntriesForEvent;

/**
 * Realtime subscription for one event's "event"-sourced entries only. `pendingWrites` counts the returned docs that are local
 * writes not yet acknowledged by the server (Firestore tracks this per document), which drives the "N pending sync" indicator.
 */
export function subscribeEntries(teamId: string, eventCode: string, callback: (entries: ScoutEntry[], pendingWrites: number) => void): Unsubscribe {
  return subscribeEntryQuery(
    teamId,
    teamQuery(teamId, eventConstraint(eventCode)),
    (entries, pending) =>
      callback(
        entries.filter((e) => e.source === "event"),
        pending
      ),
    "scouting"
  );
}

/** P4: every entry saved so far for one practice session (`practiceSessionId`), so Results can assemble both robots' entries. */
export async function getEntriesForSession(teamId: string, sessionId: string): Promise<ScoutEntry[]> {
  const [snap, flags] = await Promise.all([getDocs(teamQuery(teamId, where("practiceSessionId", "==", sessionId))), loadFlagStates(teamId)]);
  return toEntries(snap.docs.map(toRaw), teamId, flags);
}

/** P7: both alliance robots' entries for a match, realtime, found by the match itself rather than by one session. */
export function useEntriesForMatch(teamId: string | null, eventCode: string | null, matchType: ScoutEntry["matchType"] | null, matchNumber: number | null) {
  const [entries, setEntries] = useState<ScoutEntry[]>([]);
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());

  useEffect(() => {
    if (!teamId || !eventCode || !matchType || matchNumber === null || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEntries([]);
      setLoaded(true);
      return;
    }
    // CS has no query by (type, number): its match ids vary (`q12`, `qf2m1`, labels). Query the event, match on the parsed identity.
    return subscribeEntryQuery(
      teamId,
      teamQuery(teamId, eventConstraint(eventCode)),
      (all) => {
        setEntries(all.filter((e) => e.matchType === matchType && e.matchNumber === matchNumber));
        setLoaded(true);
      },
      "entries-for-match"
    );
  }, [teamId, eventCode, matchType, matchNumber]);

  return { entries, loaded };
}

type TeamSnapshot = { entries: ScoutEntry[]; loaded: boolean };
type TeamFeed = { listeners: Set<(s: TeamSnapshot) => void>; snapshot: TeamSnapshot; stop: () => void };
const teamFeeds = new Map<string, TeamFeed>();

/** One shared subscription per team (rows + legacy fallback + flag states) however many components use `useTeamScoutEntries`. */
function subscribeTeamFeed(teamId: string, listener: (s: TeamSnapshot) => void): Unsubscribe {
  let feed = teamFeeds.get(teamId);
  if (!feed) {
    const created: TeamFeed = { listeners: new Set(), snapshot: { entries: [], loaded: false }, stop: () => {} };
    let primary: RawRow[] = [];
    let legacy: RawRow[] = [];
    let primaryLoaded = false;
    const emit = () => {
      created.snapshot = { entries: toEntries(mergeRows(primary, legacy), teamId, currentFlagStates(teamId)), loaded: primaryLoaded };
      created.listeners.forEach((l) => l(created.snapshot));
    };
    let alive = true;
    const unsubscribeRows = onSnapshot(
      teamQuery(teamId),
      (snap) => {
        primary = snap.docs.map(toRaw);
        primaryLoaded = true;
        emit();
      },
      (err) => {
        console.error("team scouting subscription failed:", err);
        primary = [];
        primaryLoaded = true;
        emit();
      }
    );
    const unsubscribeFlags = subscribeFlagStates(teamId, emit);
    void loadLegacyRows(teamId).then((rows) => {
      if (!alive || rows.length === 0) return;
      legacy = rows;
      emit();
    });
    created.stop = () => {
      alive = false;
      unsubscribeRows();
      unsubscribeFlags();
    };
    teamFeeds.set(teamId, created);
    feed = created;
  }
  const active = feed;
  active.listeners.add(listener);
  if (active.snapshot.loaded) listener(active.snapshot);
  return () => {
    active.listeners.delete(listener);
    if (active.listeners.size === 0) {
      active.stop();
      if (teamFeeds.get(teamId) === active) teamFeeds.delete(teamId);
    }
  };
}

/**
 * P5: every entry for the whole team, every source/mode: what Scout Accuracy / My Scouting's stats engine needs. One shared
 * listener per team (the rows, the flag states and a one-shot legacy fallback) however many components call this.
 */
export function useTeamScoutEntries(teamId: string | null) {
  const [state, setState] = useState<TeamSnapshot>({ entries: [], loaded: !isFirebaseConfigured() });

  useEffect(() => {
    if (!teamId || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ entries: [], loaded: true });
      return;
    }
    return subscribeTeamFeed(teamId, setState);
  }, [teamId]);

  return { entries: state.entries, loaded: state.loaded };
}

// ---------------------------------------------------------------------------------------------------------------------
// Edits and deletes
// ---------------------------------------------------------------------------------------------------------------------

export type UpdateEntryOptions = {
  /** The team the entry belongs to, for the `scoutingFlagStates` write of a doc that has no `teamId` of its own. */
  teamId?: string;
};

/**
 * Applies an app-shaped patch to a stored entry. The stored doc is read, converted, patched, converted back, and only the
 * top-level fields that changed are merge-written (unknown CS fields are untouched). Flag, dismissal and exclude-from-accuracy
 * changes are written to `scoutingFlagStates/scoutingEntry:<id>`; `excluded` is CS's `excludeFromStats` on the doc itself.
 */
export async function updateEntry(id: string, patch: Partial<ScoutEntry>, options: UpdateEntryOptions = {}): Promise<void> {
  const ref = doc(db, COLLECTION, id);
  const flagRef = doc(db, FLAG_COLLECTION, flagStateDocId(id));
  const [snap, flagSnap] = await Promise.all([getDoc(ref), getDoc(flagRef).catch(() => null)]);
  if (!snap.exists()) throw new Error(`Scouting entry ${id} no longer exists.`);
  const existing = snap.data() as CsRecord;
  const flagState = flagSnap && flagSnap.exists() ? (flagSnap.data() as CsFlagState) : null;

  const current = csDocToScoutEntry(id, existing, flagState, { fallbackTeamId: options.teamId });
  if (!current) throw new Error(`Scouting entry ${id} is not a match-scout entry.`);
  const next: ScoutEntry = { ...current, ...patch, id };
  const actorUid = auth.currentUser?.uid;

  const docPatch = scoutEntryToCsPatch(next, existing, { actorUid });
  if (Object.keys(docPatch).length > 0) await setDoc(ref, stripUndefined(docPatch), { merge: true });

  const teamId = str(existing.teamId).trim() || options.teamId || current.teamId;
  const flagPatch = entryFlagStatePatch(next, existing, flagState, { teamId, actorUid });
  if (flagPatch) await setDoc(flagRef, stripUndefined(flagPatch), { merge: true });
}

export async function deleteEntry(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, id));
  // Best effort: a flag state with no entry is harmless (readers match flag states to entries by id).
  await deleteDoc(doc(db, FLAG_COLLECTION, flagStateDocId(id))).catch(() => {});
}
