/**
 * Adapter between an FTC `programs/ftc/scoutEntries/{id}` document (a Match Scout entry) and the app's `ScoutEntry` (lib/scout-entries.ts).
 * No React, no Firebase.
 *
 * The stored doc already has the app's shape, so this is a tolerant read: a missing or malformed field gets its neutral value and
 * nothing throws or drops the entry. Two things are normalized on the way in:
 *  - `source` defaults to "event": entries from before practice sessions existed have none, and they are real event entries.
 *  - an entry from before keyed `values` existed (schema v1) carries the older typed `fields` object plus `comments`; its `values` are
 *    read as `{ ...fields, comments }`, which is what the old reader did, so every consumer can use `values` alone.
 * Flags and accuracy are stored on the entry itself (no separate flag-state collection), so they are read from the doc.
 */
import type { MatchType } from "@/lib/events/types";
import type { FormValues, StickyNote } from "@/lib/forms/types";
import type { AccuracyResult, AccuracyStatus, AutoFlag, ManualFlag, ManualFlagReason, SaveEntryInput, ScoreBreakdown, ScoutEntry, ScoutEntryMode, ScoutEntrySource } from "@/lib/scout-entries";
import { finiteNumber, isoFromMs, isRecord, nonEmptyString, numberOr, str, stripUndefined, toEpochMs } from "@/data/ftc/util";

/** `programs/ftc/scoutEntries/{id}` as stored (the Firestore body, keys and values untouched). */
export type FtcScoutEntryDoc = Record<string, unknown>;

/** One document as a read returns it. */
export type FtcRawRow = { id: string; data: unknown };

const MATCH_TYPES: readonly MatchType[] = ["Practice", "Qualification", "Playoff"];
const SOURCES: readonly ScoutEntrySource[] = ["event", "practice", "live"];
const MODES: readonly Exclude<ScoutEntryMode, null>[] = ["trial", "competitive"];
const ACCURACY_STATUSES: readonly AccuracyStatus[] = ["complete", "needs-robots", "awaiting-results", "not-applicable"];

/** Is this an entry of a real event (not a practice or live-practice session)? Event pages show only these. */
export const isEventEntry = (entry: Pick<ScoutEntry, "source">): boolean => entry.source === "event";

/** The phase subtotals and total (each 0 when missing); `byPhase` only when the doc has a map of numbers. */
export function readScore(value: unknown): ScoreBreakdown {
  const raw = isRecord(value) ? value : {};
  const byPhase: Record<string, number> = {};
  if (isRecord(raw.byPhase)) for (const [phase, points] of Object.entries(raw.byPhase)) if (finiteNumber(points) !== null) byPhase[phase] = points as number;
  return {
    auto: numberOr(raw.auto, 0),
    teleop: numberOr(raw.teleop, 0),
    endgame: numberOr(raw.endgame, 0),
    total: numberOr(raw.total, 0),
    ...(Object.keys(byPhase).length > 0 ? { byPhase } : {}),
  };
}

/** The stored accuracy, or null when there is none (or it is not a recognizable result). */
export function readAccuracy(value: unknown): AccuracyResult | null {
  if (!isRecord(value)) return null;
  const status = ACCURACY_STATUSES.find((s) => s === value.status);
  if (!status) return null;
  return {
    status,
    value: finiteNumber(value.value),
    scoutedTotal: finiteNumber(value.scoutedTotal),
    penaltyPoints: finiteNumber(value.penaltyPoints),
    officialScore: finiteNumber(value.officialScore),
  };
}

function readAutoFlags(value: unknown): AutoFlag[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).flatMap((flag) => {
    const ruleId = nonEmptyString(flag.ruleId);
    return ruleId ? [{ ruleId, dismissed: flag.dismissed === true }] : [];
  });
}

function readManualFlags(value: unknown): ManualFlag[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).flatMap((flag) => {
    const id = nonEmptyString(flag.id);
    const reason = nonEmptyString(flag.reason);
    if (!id || !reason) return [];
    const note = nonEmptyString(flag.note);
    return [{ id, reason: reason as ManualFlagReason, ...(note ? { note } : {}), addedAt: str(flag.addedAt) }];
  });
}

/** Sticky notes: the list items that are maps with an id and text. */
export function readStickyNotes(value: unknown): StickyNote[] {
  if (!Array.isArray(value)) return [];
  return value.filter((note): note is StickyNote => isRecord(note) && nonEmptyString(note.id) !== null && typeof note.text === "string");
}

/** The entry's values keyed by form field: the stored `values`, else (schema v1) the typed `fields` plus `comments`, else undefined. */
export function readEntryValues(doc: FtcScoutEntryDoc): FormValues | undefined {
  if (isRecord(doc.values)) return doc.values as FormValues;
  if (isRecord(doc.fields)) return { ...doc.fields, ...(typeof doc.comments === "string" ? { comments: doc.comments } : {}) } as FormValues;
  return undefined;
}

/** Reads `programs/ftc/scoutEntries/{id}` as a `ScoutEntry`. */
export function ftcDocToScoutEntry(id: string, doc: FtcScoutEntryDoc): ScoutEntry {
  const source = SOURCES.find((s) => s === doc.source) ?? "event";
  const mode = MODES.find((m) => m === doc.mode) ?? null;
  const values = readEntryValues(doc);
  const stickyNotes = readStickyNotes(doc.stickyNotes);
  const alliance = doc.alliance === "red" || doc.alliance === "blue" ? doc.alliance : null;
  const linkedEntryId = nonEmptyString(doc.linkedEntryId);
  const submittedAt = nonEmptyString(doc.submittedAt) ?? isoFromMs(toEpochMs(doc.createdAt));

  return {
    id,
    teamId: str(doc.teamId),
    uid: str(doc.uid),
    source,
    mode,
    formId: str(doc.formId),
    formVersion: numberOr(doc.formVersion, 0),
    scoutName: str(doc.scoutName),
    eventCode: str(doc.eventCode),
    matchType: MATCH_TYPES.find((t) => t === doc.matchType) ?? "Qualification",
    matchNumber: numberOr(doc.matchNumber, 0),
    teamNumber: numberOr(doc.teamNumber, 0),
    ...(values ? { values } : {}),
    score: readScore(doc.score),
    ...(doc.scored === false ? { scored: false as const } : {}),
    comments: str(doc.comments),
    ...(stickyNotes.length > 0 ? { stickyNotes } : {}),
    ...(alliance ? { alliance } : {}),
    ...(linkedEntryId ? { linkedEntryId } : {}),
    ...(finiteNumber(doc.planDifferences) !== null ? { planDifferences: doc.planDifferences as number } : {}),
    submittedAt,
    excluded: doc.excluded === true,
    autoFlags: readAutoFlags(doc.autoFlags),
    manualFlags: readManualFlags(doc.manualFlags),
    accuracy: readAccuracy(doc.accuracy),
    sessionId: nonEmptyString(doc.sessionId),
    libraryMatchId: nonEmptyString(doc.libraryMatchId),
  };
}

/**
 * The document a new Match Scout entry is stored as, in the shape the rules accept and every reader above expects: the entry's own fields (the form,
 * its values, the score as stored, the summary comment), who wrote it and for which team, where it was scouted (`source`, `mode`, session and library
 * match, defaulting to a real-event entry), a client `submittedAt` usable at once (offline too), the server `createdAt`, and no flags or accuracy yet.
 * `now` supplies `createdAt` (a server timestamp in the app; a plain value in tests). Nothing is `undefined`: Firestore refuses it.
 */
export function ftcScoutEntryDoc(teamId: string, uid: string, input: SaveEntryInput, now: () => unknown, submittedAt: string = new Date().toISOString()): Record<string, unknown> {
  const { source = "event", mode = null, sessionId = null, libraryMatchId = null, ...rest } = input;
  return stripUndefined({
    ...rest,
    teamId,
    uid,
    source,
    mode,
    sessionId,
    libraryMatchId,
    submittedAt,
    createdAt: now(),
    excluded: false,
    autoFlags: [],
    manualFlags: [],
    accuracy: null,
  });
}

/** Every row as an entry, in the order given. A row whose body is not a map (it cannot be a Firestore document) is skipped. */
export function ftcDocsToScoutEntries(rows: readonly FtcRawRow[]): ScoutEntry[] {
  return rows.flatMap((row) => (isRecord(row.data) ? [ftcDocToScoutEntry(row.id, row.data)] : []));
}
