/**
 * Adapter between CS's `scouting` collection (+ `scoutingFlagStates`) and CE's in-app `ScoutEntry` (docs/ROUTES.md D1, D10).
 *
 * Pure converters, no Firebase and no React:
 *  - `classifyCsRow(doc)`            what kind of row a `scouting` doc is (official / practice / sub-in / lead / other)
 *  - `csDocToScoutEntry(id, doc, s)` CS doc (+ its flag state) -> ScoutEntry, or null for rows that are not entries
 *  - `scoutEntryToCsDoc(entry, doc)` ScoutEntry -> the CS doc to write with a merge; an unchanged entry reproduces `doc` exactly
 *  - `scoutEntryToCsPatch`           only the top-level keys that changed (what `setDoc(..., { merge: true })` needs)
 *  - `entryFlagStatePatch`           the `scoutingFlagStates` write for a changed flag/dismissal/exclusion
 *
 * Rules the converters keep (D10): a field this adapter does not understand is never dropped or rewritten; identity strings
 * that parse to the same CE value (`matchId` "qf2", `teamNumber` " 254") are left exactly as stored; CS stores no score, so
 * `score` is computed at read time with the game plugin (`plugin.scoreDoc`) and never written.
 */
import { normalizeEventKey } from "@/config/event";
import { appMatchToCs, csDocMatchRef } from "@/data/cs/match-id";
import type { CsFlagState, CsRecord, CsRowKind } from "@/data/cs/types";
import { asRecord, changedTopLevel, cloneValue, deepEqual, deepMerge, digitsToNumber, isoFromMs, isRecord, str, toEpochMs } from "@/data/cs/util";
import { incidentsFromValues, incidentValuesFromList } from "@/lib/forms/builtin-rebuilt";
import type { FormValues } from "@/lib/forms/types";
import { gameForDoc, listGamePlugins } from "@/lib/games/registry";
import type { FullGamePlugin, GameId, GameValues } from "@/lib/games/types";
import type { AccuracyResult, AutoFlag, ManualFlag, ManualFlagReason, ScoutEntry, ScoutEntryLegacy } from "@/lib/scout-entries";

// ---------------------------------------------------------------------------------------------------------------------
// Row classification (CS app/utils/analyticsEvents.ts: isSubInRequestEntry, isLeadScoutingEntry, isPracticeScoutedEntry)
// ---------------------------------------------------------------------------------------------------------------------

/** CS `isSubInRequestEntry`. */
export function isSubInRow(doc: CsRecord): boolean {
  const type = str(doc.entryType || doc.formType).toLowerCase().trim();
  return type === "sub-in-request" || type === "sub-in-claim" || type === "sub-in";
}

/** CS `isLeadScoutingEntry`. */
export function isLeadRow(doc: CsRecord): boolean {
  if (Boolean(doc.isLeadScouting)) return true;
  const type = str(doc.entryType || doc.formType).toLowerCase().trim();
  return type === "lead" || type === "lead-scout" || type === "lead-scouting";
}

/** The "practice" branch of CS `getExplicitMatchTypeFromLabel` (typo tolerant, and `test` counts, exactly as CS). */
function isPracticeLabel(raw: unknown): boolean {
  const value = str(raw).trim().toLowerCase();
  if (!value) return false;
  const compact = value.replace(/[^a-z0-9]/g, "");
  return value.includes("practice") || /pract|prct|pratc|prac|warmup|test/i.test(compact) || /^p[\s#-]*\d+/i.test(value) || /^p\d+/i.test(compact);
}

/** CS `isPracticeMatchEntry`: an event's practice match (`p3`), not a practice-scouting session. */
export function isEventPracticeMatchRow(doc: CsRecord): boolean {
  if (str(doc.matchType).toLowerCase().trim() === "practice") return true;
  return [doc.matchLabel, doc.matchId, doc.matchKey].some(isPracticeLabel);
}

/** CS `isPracticeScoutedEntry`. */
export function isPracticeSessionRow(doc: CsRecord): boolean {
  if (isEventPracticeMatchRow(doc)) return false;
  return Boolean(doc.isPracticeScouting) || Boolean(doc.practiceMode) || Boolean(doc.practiceSessionId);
}

/**
 * What a `scouting` row is, in the order CS's analytics decides: sub-in rows, then lead rows, then a game no plugin knows
 * ("other"), then practice-scouting sessions; everything else is an official entry (a row with no `game` is REEFSCAPE).
 */
export function classifyCsRow(doc: CsRecord): CsRowKind {
  if (isSubInRow(doc)) return "sub-in";
  if (isLeadRow(doc)) return "lead";
  if (!gameForDoc(doc)) return "other";
  return isPracticeSessionRow(doc) ? "practice" : "official";
}

/** True for the kinds that become a `ScoutEntry`. */
export function isEntryRow(kind: CsRowKind): kind is "official" | "practice" {
  return kind === "official" || kind === "practice";
}

// ---------------------------------------------------------------------------------------------------------------------
// Flag states (CS app/utils/scoutingFlags.ts)
// ---------------------------------------------------------------------------------------------------------------------

/** `scoutingFlagStates` doc id of a scouting entry: `scoutingEntry:<entryId>`. */
export function flagStateDocId(entryId: string): string {
  return `scoutingEntry:${String(entryId || "").trim()}`;
}

/**
 * The flag state CS would use for an entry: its `scoutingFlagStates` doc when there is one, else the legacy per-doc fields
 * (`flagDismissed`, `manualFlagged`, `manualReason`, ...), as CS `getEntryFlagState` does.
 */
export function effectiveFlagState(doc: CsRecord, state?: CsFlagState | null): CsFlagState {
  if (state) return state;
  const at = (value: unknown) => toEpochMs(value) || undefined;
  return {
    dismissed: Boolean(doc.flagDismissed),
    dismissedAt: at(doc.flagDismissedAt),
    dismissedBy: str(doc.flagDismissedBy) || undefined,
    manualFlagged: Boolean(doc.manualFlagged),
    manualFlaggedAt: at(doc.manualFlaggedAt),
    manualFlaggedBy: str(doc.manualFlaggedBy) || undefined,
    manualReason: str(doc.manualReason) || undefined,
  };
}

const CE_REASONS: readonly ManualFlagReason[] = [
  "No teleop score",
  "No auto score",
  "Unrealistic scoring",
  "Wrong team scouted",
  "Scout started late",
  "Scout left early",
  "Duplicate entry",
  "Other",
];

const CS_REASON_LABELS: Record<string, { reason: ManualFlagReason; note?: string }> = {
  "no-teleop-score": { reason: "No teleop score" },
  "excessive-auto-score": { reason: "Unrealistic scoring", note: "Excessive auto score" },
  "excessive-human-player-score": { reason: "Unrealistic scoring", note: "Excessive human player score" },
  other: { reason: "Other" },
};

const CE_REASON_TO_CS: Partial<Record<ManualFlagReason, string>> = {
  "No teleop score": "no-teleop-score",
  "Unrealistic scoring": "excessive-auto-score",
};

function isCeReason(value: unknown): value is ManualFlagReason {
  return typeof value === "string" && (CE_REASONS as readonly string[]).includes(value);
}

/** CE manual flags for a CS flag state (CS keeps one boolean + reason; it reads as one flag with the stable id `cs-manual`). */
export function manualFlagsFromState(state: CsFlagState, fallbackAtMs: number): ManualFlag[] {
  if (!state.manualFlagged) return [];
  const raw = str(state.manualReason).trim();
  const mapped = CS_REASON_LABELS[raw];
  const reason: ManualFlagReason = isCeReason(state.ceManualReason) ? state.ceManualReason : (mapped?.reason ?? "Other");
  const note = typeof state.ceManualNote === "string" ? state.ceManualNote : (mapped ? mapped.note : raw) || undefined;
  return [
    {
      id: "cs-manual",
      reason,
      ...(note ? { note } : {}),
      addedAt: isoFromMs(toEpochMs(state.manualFlaggedAt) || fallbackAtMs),
    },
  ];
}

// ---------------------------------------------------------------------------------------------------------------------
// Accuracy (CS: `accuracy` percent, `accuracyDetails`, `accuracyScriptStatus`; CE: AccuracyResult with a 0..1 value)
// ---------------------------------------------------------------------------------------------------------------------

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** CS `calculateMatchAccuracyFromTotals` (app/utils/scoutAccuracy.ts). */
function accuracyFromTotals(scouted: number, official: number): number | null {
  if (!Number.isFinite(scouted) || !Number.isFinite(official) || official <= 0) return null;
  return Math.max(0, Math.min(1, 1 - Math.abs(scouted - official) / official));
}

/**
 * CS accuracy -> CE `AccuracyResult`. `accuracyDetails` (`scoutedPoints`, `actualPoints`, `penaltyPoints`, `allRobotsScouted`)
 * maps to `scoutedTotal`, `officialScore`, `penaltyPoints` and the status; the value is CS's own `resolveMatchAccuracy`
 * (totals first, else the stored percent / 100). Null when the doc carries no accuracy at all.
 */
export function csAccuracyToEntry(doc: CsRecord): AccuracyResult | null {
  const details = asRecord(doc.accuracyDetails);
  const scouted = finiteNumber(details.scoutedPoints);
  const percent = finiteNumber(doc.accuracy);
  const script = str(doc.accuracyScriptStatus || doc.scriptStatus).trim().toLowerCase();

  if (scouted !== null) {
    const actual = finiteNumber(details.actualPoints);
    const penalty = finiteNumber(details.penaltyPoints) ?? 0;
    if (actual === null) {
      return { status: "awaiting-results", value: null, scoutedTotal: scouted, penaltyPoints: penalty, officialScore: null };
    }
    const allRobots = str(details.allRobotsScouted).trim().toLowerCase();
    const complete = allRobots === "yes" || (allRobots !== "no" && script === "complete");
    const value = accuracyFromTotals(scouted, actual) ?? (percent !== null ? Math.max(0, Math.min(1, percent / 100)) : null);
    return { status: complete ? "complete" : "needs-robots", value, scoutedTotal: scouted, penaltyPoints: penalty, officialScore: actual };
  }
  if (percent !== null) {
    return {
      status: script && script !== "complete" ? "needs-robots" : "complete",
      value: Math.max(0, Math.min(1, percent / 100)),
      scoutedTotal: null,
      penaltyPoints: finiteNumber(doc.penaltyPoints),
      officialScore: null,
    };
  }
  return null;
}

/**
 * CE accuracy -> the CS fields to merge-write (`accuracy` rounded percent, `accuracyDetails`, `accuracyScriptStatus`,
 * `accuracyUpdatedAt`), as CS's own analytics snapshot writes them. A null or not-applicable accuracy writes nothing (CS data is
 * never deleted). Unknown sub-fields of an existing `accuracyDetails` are kept.
 */
export function entryAccuracyToCsPatch(accuracy: AccuracyResult | null, existing: CsRecord, matchLabel: string, eventKey: string, now: number): CsRecord {
  if (!accuracy || accuracy.status === "not-applicable") return {};
  const previous = asRecord(existing.accuracyDetails);
  const details: CsRecord = {
    ...previous,
    scoutedPoints: accuracy.scoutedTotal ?? finiteNumber(previous.scoutedPoints) ?? 0,
    actualPoints: accuracy.officialScore,
    penaltyPoints: accuracy.penaltyPoints ?? 0,
    allRobotsScouted: accuracy.status === "complete" ? "yes" : accuracy.status === "needs-robots" ? "no" : "unknown",
    eventKeyUsed: str(previous.eventKeyUsed) || eventKey,
    matchLabelUsed: str(previous.matchLabelUsed) || matchLabel,
  };
  const patch: CsRecord = { accuracyDetails: details, accuracyUpdatedAt: now };
  if (accuracy.status === "complete" && accuracy.value !== null) {
    patch.accuracy = Math.round(accuracy.value * 100);
    patch.accuracyScriptStatus = "complete";
  } else if (accuracy.status === "needs-robots") {
    patch.accuracyScriptStatus = "missing robots";
  }
  return patch;
}

// ---------------------------------------------------------------------------------------------------------------------
// CS doc -> ScoutEntry
// ---------------------------------------------------------------------------------------------------------------------

export type CsReadContext = {
  /** The team the doc was queried for. Used when an older doc has no `teamId` (reached through the scout-uid fallback). */
  fallbackTeamId?: string;
};

/**
 * CS doc -> form values for the entry. REBUILT's form keeps incidents as seven boolean fields, the plugin as CS's
 * `incidents: string[]`: the list is converted here (the plugin's `incidents` key is dropped).
 */
export function docToFormValues(plugin: FullGamePlugin, doc: CsRecord): GameValues {
  const values = plugin.docToValues(doc);
  if (plugin.id !== "REBUILT") return values;
  const rest: GameValues = { ...values };
  delete rest.incidents;
  return { ...rest, ...incidentValuesFromList(doc.incidents) };
}

/** Form values -> the game part of a CS doc (REBUILT: the seven incident booleans become `incidents: string[]` first). Null for read-only games. */
export function formValuesToCsDoc(plugin: FullGamePlugin, values: GameValues): CsRecord | null {
  if (plugin.id !== "REBUILT") return plugin.valuesToDoc(values);
  return plugin.valuesToDoc({ ...values, incidents: incidentsFromValues(values) });
}

function pluginFormId(plugin: FullGamePlugin): string {
  return plugin.formId ?? plugin.id.toLowerCase();
}

function allianceOf(doc: CsRecord): "red" | "blue" | null {
  const value = str(doc.alliance || doc.allianceColor).trim().toLowerCase();
  return value === "red" || value === "blue" ? value : null;
}

function practiceModeOf(doc: CsRecord): "trial" | "competitive" | null {
  const mode = str(doc.practiceMode).trim().toLowerCase();
  return mode === "trial" || mode === "competitive" ? mode : null;
}

function submittedMsOf(doc: CsRecord): number {
  return toEpochMs(doc.submittedAt) || toEpochMs(doc.timestamp) || toEpochMs(doc.createdAt);
}

function legacyOf(doc: CsRecord, kind: "official" | "practice"): ScoutEntryLegacy {
  const out: ScoutEntryLegacy = { kind };
  if (typeof doc.matchId === "string") out.matchId = doc.matchId;
  if (typeof doc.matchType === "string") out.matchType = doc.matchType;
  if (typeof doc.matchNumber === "string") out.matchNumber = doc.matchNumber;
  else if (typeof doc.matchNumber === "number") out.matchNumber = String(doc.matchNumber);
  if (typeof doc.teamNumber === "string") out.teamNumber = doc.teamNumber;
  else if (typeof doc.teamNumber === "number") out.teamNumber = String(doc.teamNumber);
  if (typeof doc.eventKey === "string") out.eventKey = doc.eventKey;
  return out;
}

/**
 * One CS `scouting` doc -> a CE `ScoutEntry`. Returns null for rows that are not entries (sub-in, lead, unknown game; see
 * `classifyCsRow`). `flagState` is the entry's `scoutingFlagStates` doc (`scoutingEntry:<id>`), when it has one.
 *
 * The entry's `score` is computed here with the game plugin, never read (CS stores none).
 */
export function csDocToScoutEntry(id: string, doc: CsRecord, flagState?: CsFlagState | null, context: CsReadContext = {}): ScoutEntry | null {
  const kind = classifyCsRow(doc);
  if (!isEntryRow(kind)) return null;
  const plugin = gameForDoc(doc);
  if (!plugin) return null;

  const match = csDocMatchRef(doc);
  const submittedMs = submittedMsOf(doc);
  const state = effectiveFlagState(doc, flagState);
  const phaseScore = plugin.scoreDoc(doc);
  const flags = plugin.flags(doc);
  const comments = str(doc.notes);
  const stickyNotes = Array.isArray(doc.stickyNotes) ? (doc.stickyNotes as ScoutEntry["stickyNotes"]) : undefined;

  const entry: ScoutEntry = {
    id,
    teamId: str(doc.teamId).trim() || context.fallbackTeamId || "",
    uid: str(doc.scoutId),
    source: kind === "practice" ? "practice" : "event",
    mode: practiceModeOf(doc),
    formId: pluginFormId(plugin),
    formVersion: 1,
    scoutName: str(doc.scoutName),
    eventCode: normalizeEventKey(str(doc.eventKey)),
    matchType: match.matchType,
    matchNumber: match.matchNumber,
    teamNumber: digitsToNumber(doc.teamNumber),
    // The plugin's value keys follow the KEY CONVENTION in lib/games/types.ts; FormValues is the same flat shape.
    values: docToFormValues(plugin, doc) as FormValues,
    score: {
      auto: phaseScore.auto,
      teleop: phaseScore.teleop,
      endgame: phaseScore.endgame,
      total: phaseScore.total,
    },
    comments,
    ...(stickyNotes && stickyNotes.length > 0 ? { stickyNotes } : {}),
    alliance: allianceOf(doc),
    submittedAt: isoFromMs(submittedMs),
    excluded: doc.excludeFromStats === true,
    autoFlags: flags.map((flag): AutoFlag => ({ ruleId: flag.code, dismissed: Boolean(state.dismissed) })),
    manualFlags: manualFlagsFromState(state, submittedMs),
    accuracy: csAccuracyToEntry(doc),
    sessionId: str(doc.practiceSessionId).trim() || null,
    libraryMatchId: str(doc.practiceMatchId).trim() || null,
    game: plugin.id,
    excludeFromAccuracy: state.excludeFromAccuracy === true,
    legacy: legacyOf(doc, kind),
  };
  return entry;
}

// ---------------------------------------------------------------------------------------------------------------------
// ScoutEntry -> CS doc
// ---------------------------------------------------------------------------------------------------------------------

/** The plugin an entry belongs to: its existing doc's game, else the form it was scouted with, else its `game`. Null when unknown. */
export function pluginForEntry(entry: Pick<ScoutEntry, "formId" | "game">, existing?: CsRecord): FullGamePlugin | null {
  if (existing) return gameForDoc(existing);
  const plugins = listGamePlugins();
  return plugins.find((p) => p.formId !== null && p.formId === entry.formId) ?? plugins.find((p) => pluginFormId(p) === entry.formId) ?? plugins.find((p) => p.id === entry.game) ?? null;
}

/** Whether `entry`'s form can be stored in the CS schema (a game with a writable form). */
export function canWriteToCs(entry: Pick<ScoutEntry, "formId" | "game">): boolean {
  const plugin = pluginForEntry(entry);
  return plugin !== null && formValuesToCsDoc(plugin, {}) !== null;
}

function legacyAsDoc(legacy: ScoutEntryLegacy | undefined): CsRecord {
  if (!legacy) return {};
  const doc: CsRecord = {};
  if (legacy.matchId !== undefined) doc.matchId = legacy.matchId;
  if (legacy.matchType !== undefined) doc.matchType = legacy.matchType;
  if (legacy.matchNumber !== undefined) doc.matchNumber = legacy.matchNumber;
  if (legacy.teamNumber !== undefined) doc.teamNumber = legacy.teamNumber;
  if (legacy.eventKey !== undefined) doc.eventKey = legacy.eventKey;
  return doc;
}

function hasAny(doc: CsRecord, keys: readonly string[]): boolean {
  return keys.some((key) => doc[key] !== undefined);
}

const MATCH_KEYS = ["matchId", "matchKey", "matchLabel", "matchType", "matchNumber"] as const;

function matchLabelFor(entry: ScoutEntry, csMatchId: string): string {
  return entry.legacy?.matchId || csMatchId;
}

export type CsWriteOptions = {
  /** Clock for fields the adapter stamps (`excludeFromStatsAt`, `accuracyUpdatedAt`). Tests pass a fixed value. */
  now?: number;
  /** Who made the change (stamped as `excludeFromStatsBy`). */
  actorUid?: string;
};

/**
 * ScoutEntry -> the full CS doc (the existing doc with the entry's changes merged in). With `existingDoc`, everything the
 * entry did not change is left exactly as stored: unknown fields, original `matchId` / `teamNumber` / `eventKey` strings,
 * `teamId`, `scoringWeights`, `submittedAt` / `timestamp`. Without it, a complete new doc in the shape CS writes today
 * (`legacy`, when the entry carries it, supplies the original identity strings).
 *
 * Throws for an entry whose form cannot be stored in CS (a read-only game, or a form no plugin owns).
 */
export function scoutEntryToCsDoc(entry: ScoutEntry, existingDoc?: CsRecord, options: CsWriteOptions = {}): CsRecord {
  const now = options.now ?? Date.now();
  const existing = existingDoc;
  const plugin = pluginForEntry(entry, existing);
  if (!plugin) throw new Error(`Entry form "${entry.formId}" does not belong to any CompSocrates game, so it cannot be stored in the scouting collection.`);
  const idSource: CsRecord = existing ?? legacyAsDoc(entry.legacy);
  const next: CsRecord = existing ? cloneValue(existing) : {};

  // --- the game part (nested phases) -------------------------------------------------------------------------------
  const currentValues: GameValues = existing ? docToFormValues(plugin, existing) : {};
  const valuesChanged = !existing || !deepEqual(entry.values ?? {}, currentValues);
  if (valuesChanged) {
    const gameDoc = formValuesToCsDoc(plugin, (entry.values ?? {}) as GameValues);
    if (gameDoc === null) {
      if (!existing) throw new Error(`${plugin.label} entries are read-only: the game has no writable form.`);
      // A read-only game's values cannot be written back; the doc keeps its stored phases.
    } else {
      if (existing && isRecord(existing.scoringWeights)) delete gameDoc.scoringWeights;
      Object.assign(next, deepMerge(next, gameDoc));
    }
  }

  // --- identity fields ---------------------------------------------------------------------------------------------
  if (!existing) {
    next.teamId = entry.teamId;
    next.game = plugin.id;
  }
  if (entry.uid && entry.uid !== str(idSource.scoutId)) next.scoutId = entry.uid;
  if (entry.scoutName !== str(idSource.scoutName) && (entry.scoutName || existing)) next.scoutName = entry.scoutName;

  const sourceEvent = str(idSource.eventKey);
  if (sourceEvent !== "" && normalizeEventKey(sourceEvent) === entry.eventCode) {
    if (!existing) next.eventKey = sourceEvent;
  } else if (entry.eventCode || sourceEvent !== "") {
    next.eventKey = entry.eventCode;
  }

  const sourceMatch = hasAny(idSource, MATCH_KEYS) ? csDocMatchRef(idSource) : null;
  const csMatch = appMatchToCs(entry.matchType, entry.matchNumber);
  if (sourceMatch && sourceMatch.matchType === entry.matchType && sourceMatch.matchNumber === entry.matchNumber) {
    if (!existing) {
      for (const key of ["matchId", "matchType", "matchNumber"] as const) if (idSource[key] !== undefined) next[key] = idSource[key];
    }
  } else {
    next.matchId = csMatch.matchId;
    next.matchType = csMatch.matchType;
    next.matchNumber = csMatch.matchNumber;
    if (typeof next.matchKey === "string" && existing && csDocMatchRef({ matchKey: next.matchKey }).matchNumber !== entry.matchNumber) next.matchKey = csMatch.matchId;
  }

  const sourceTeam = idSource.teamNumber;
  if (sourceTeam !== undefined && digitsToNumber(sourceTeam) === entry.teamNumber) {
    if (!existing) next.teamNumber = sourceTeam;
  } else {
    next.teamNumber = String(entry.teamNumber);
  }

  // --- time --------------------------------------------------------------------------------------------------------
  const entryMs = Date.parse(entry.submittedAt);
  if (existing) {
    if (Number.isFinite(entryMs) && entry.submittedAt !== isoFromMs(submittedMsOf(existing))) next.submittedAt = entryMs;
  } else {
    const ms = Number.isFinite(entryMs) && entryMs > 0 ? entryMs : now;
    next.submittedAt = ms;
    next.timestamp = ms;
  }

  // --- notes -------------------------------------------------------------------------------------------------------
  if (entry.stickyNotes && entry.stickyNotes.length > 0) {
    // CS has no sticky notes: their text rides in `notes` (the derived comment), the notes themselves in an additive field.
    if (entry.comments !== str(next.notes)) next.notes = entry.comments;
    if (!deepEqual(entry.stickyNotes, next.stickyNotes)) next.stickyNotes = entry.stickyNotes;
  } else if (existing && !valuesChanged && entry.comments !== str(existing.notes)) {
    next.notes = entry.comments;
  }

  // --- practice rows -----------------------------------------------------------------------------------------------
  if (!existing && entry.source === "practice") {
    next.isPracticeScouting = true;
    next.practiceMode = entry.mode ?? "trial";
    if (entry.sessionId) next.practiceSessionId = entry.sessionId;
    if (entry.libraryMatchId) next.practiceMatchId = entry.libraryMatchId;
    if (entry.alliance) {
      next.alliance = entry.alliance;
      next.allianceColor = entry.alliance;
    }
  } else if (existing) {
    if (entry.mode !== practiceModeOf(existing) && entry.mode) next.practiceMode = entry.mode;
    if (entry.sessionId && entry.sessionId !== str(existing.practiceSessionId)) next.practiceSessionId = entry.sessionId;
    if (entry.alliance && entry.alliance !== allianceOf(existing)) {
      next.alliance = entry.alliance;
      next.allianceColor = entry.alliance;
    }
  }

  // --- exclusion + accuracy ----------------------------------------------------------------------------------------
  if (entry.excluded !== (existing ? existing.excludeFromStats === true : false)) {
    next.excludeFromStats = entry.excluded;
    next.excludeFromStatsAt = now;
    if (options.actorUid) next.excludeFromStatsBy = options.actorUid;
  }
  const currentAccuracy = existing ? csAccuracyToEntry(existing) : null;
  if (!deepEqual(entry.accuracy ?? null, currentAccuracy)) {
    Object.assign(next, entryAccuracyToCsPatch(entry.accuracy, next, matchLabelFor(entry, csMatch.matchId), entry.eventCode, now));
  }

  return next;
}

/** The top-level keys of `scoutEntryToCsDoc(entry, existingDoc)` that changed: the payload of `setDoc(ref, patch, { merge: true })`. */
export function scoutEntryToCsPatch(entry: ScoutEntry, existingDoc: CsRecord, options: CsWriteOptions = {}): CsRecord {
  return changedTopLevel(existingDoc, scoutEntryToCsDoc(entry, existingDoc, options));
}

// ---------------------------------------------------------------------------------------------------------------------
// ScoutEntry flags -> scoutingFlagStates
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The `scoutingFlagStates/scoutingEntry:<id>` merge-write for the entry's current flags, or null when nothing differs from
 * `current` (the state CS would use today, see `effectiveFlagState`).
 *
 *  - dismissed: CS keeps one boolean for all of an entry's auto flags. It is true when every CE auto flag is dismissed; an
 *    entry with no auto flags leaves it untouched.
 *  - manual flag: CS keeps one flag (boolean + reason). The LAST of the entry's manual flags is written (a second one
 *    overwrites the first: a CS limitation); an empty list clears it. The CE reason travels in `ceManualReason` / `ceManualNote`.
 *  - excludeFromAccuracy: written as is.
 */
export function entryFlagStatePatch(
  entry: Pick<ScoutEntry, "id" | "teamId" | "autoFlags" | "manualFlags" | "excludeFromAccuracy" | "submittedAt">,
  doc: CsRecord,
  existingState: CsFlagState | null,
  options: CsWriteOptions & { teamId?: string } = {}
): CsRecord | null {
  const now = options.now ?? Date.now();
  const current = effectiveFlagState(doc, existingState);
  const patch: CsRecord = {};

  const wantDismissed = entry.autoFlags.length > 0 ? entry.autoFlags.every((flag) => flag.dismissed) : Boolean(current.dismissed);
  if (wantDismissed !== Boolean(current.dismissed)) {
    patch.dismissed = wantDismissed;
    patch.dismissedAt = wantDismissed ? now : null;
    patch.dismissedBy = wantDismissed ? (options.actorUid ?? "") : "";
  }

  const wanted = entry.manualFlags.length > 0 ? entry.manualFlags[entry.manualFlags.length - 1] : null;
  const currentFlag = manualFlagsFromState(current, toEpochMs(entry.submittedAt))[0] ?? null;
  const sameFlag = wanted === null ? currentFlag === null : currentFlag !== null && wanted.reason === currentFlag.reason && (wanted.note ?? "") === (currentFlag.note ?? "");
  if (!sameFlag) {
    if (wanted) {
      patch.manualFlagged = true;
      patch.manualReason = CE_REASON_TO_CS[wanted.reason] ?? "other";
      patch.ceManualReason = wanted.reason;
      patch.ceManualNote = wanted.note ?? "";
      patch.manualFlaggedAt = now;
      patch.manualFlaggedBy = options.actorUid ?? "";
    } else {
      patch.manualFlagged = false;
      patch.manualReason = "";
      patch.ceManualReason = "";
      patch.ceManualNote = "";
      patch.manualFlaggedAt = null;
      patch.manualFlaggedBy = "";
    }
  }

  const wantExcludeAccuracy = entry.excludeFromAccuracy === true;
  if (wantExcludeAccuracy !== (current.excludeFromAccuracy === true)) {
    patch.excludeFromAccuracy = wantExcludeAccuracy;
    patch.excludedAt = wantExcludeAccuracy ? now : null;
    patch.excludedBy = wantExcludeAccuracy ? (options.actorUid ?? "") : "";
  }

  if (Object.keys(patch).length === 0) return null;
  return {
    teamId: options.teamId ?? entry.teamId,
    entityType: "scoutingEntry",
    entityId: entry.id,
    ...patch,
  };
}

/** Index of `scoutingFlagStates` rows by the entry id they describe (only `scoutingEntry` rows; practice-session rows are skipped). */
export function indexFlagStates(rows: ReadonlyArray<CsFlagState>): Map<string, CsFlagState> {
  const out = new Map<string, CsFlagState>();
  for (const row of rows) {
    const entityId = str(row.entityId).trim();
    if (!entityId || (row.entityType !== undefined && row.entityType !== "scoutingEntry")) continue;
    out.set(entityId, row);
  }
  return out;
}

/** Converts a batch of snapshot docs into entries, skipping non-entry rows. Output order follows input order. */
export function csDocsToScoutEntries(
  docs: ReadonlyArray<{ id: string; data: CsRecord }>,
  flagStates: ReadonlyMap<string, CsFlagState>,
  context: CsReadContext = {}
): ScoutEntry[] {
  const out: ScoutEntry[] = [];
  for (const { id, data } of docs) {
    const entry = csDocToScoutEntry(id, data, flagStates.get(id) ?? null, context);
    if (entry) out.push(entry);
  }
  return out;
}

export type { GameId };
