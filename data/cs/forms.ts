/**
 * Adapter for CS's six form collections <-> CE's `FormEntry` (docs/ROUTES.md D1, D10). Pure: no React, no Firestore client.
 *
 * CE keeps every non-match form in one `formEntries` collection; CS keeps them in six collections with six shapes
 * (`pitScouting`, `leadScouting`, `strategyScouting`, `matchStrategyPlans`, `driveScouting`, `helperReports`). The table
 * `CS_FORM_SPECS` below says how each maps, and `data/cs/form-field-keys.ts` says which value keys each form carries.
 *
 * WHAT MAPS WHERE (confirmed against the CS pages, which differ from docs/AUDIT.md in places, see the report):
 *   identity   teamId, uid (`scoutId` / pit `submittedBy` / helper `helperId`), scoutName (helper `helperName`)
 *   event      `eventKey` (alias-resolved into `eventCode`; the raw string stays in `legacy.eventKey`). Helper docs have NONE.
 *   time       `createdAt` -> createdAtMs, `submittedAt` -> updatedAtMs (CS resets both on edit; there is no `updatedAt`)
 *   match      lead: `matchId` / `matchKey` (short id) + `matchType` + `matchNumber` + `matchLabel`;
 *              match strategy and drive reflection: `matchKey` (a TBA key such as `2026arli_qm12`, or a short id) + `matchLabel`.
 *              All become CE `matchKey` (`Q12`, `P3`, `F7`, `F15`, D11 numbering) via `data/cs/match-id.ts`; the CS strings are
 *              kept in `legacy` and written back untouched while the CE match key still means the same match.
 *   alliance   lead: `alliance`. Strategy / drive: none in CS (an additive `alliance` is written only when the entry has one).
 *   team       pit and team strategy: `teamNumber`; helper: `assistedTeamNumber`. Strings in CS, numbers in CE.
 *   values     see form-field-keys.ts (flat keys, `robots[i].x` -> `robot{i+1}_x`, `overallAlliance.x` -> `overallAlliance_x`).
 *   flags      `scoutingFlagStates/<entityType>:<id>`: `manualFlagged` + `manualReason` -> `flags[0]`; the doc's own
 *              `excludeFromStats` (the CS analytics Config modal writes it) or the state's `excludeFromAccuracy` -> `excluded`.
 *
 * UNKNOWN FIELDS (D10). `formEntryToCsDoc(entry, existing)` returns `{ ...existing, ...knownFields }`, so a doc's other fields
 * (and the unknown keys of each `robots[]` element and of `overallAlliance`) survive. Callers write with `merge: true`. Without
 * `existing` only the known fields are returned; because `robots` is an array, a merge write replaces it whole, so callers MUST
 * read the doc first when editing.
 */
import { CURRENT_GAME_ID, DEFAULT_GAME_ID } from "@/config/games";
import { expandEventKeyAliases, isTbaEventKey, normalizeEventKey } from "@/config/event";
import { appMatchToCs, csDocMatchRef, normalizeCsMatchId } from "@/data/cs/match-id";
import type { CsFlagState, CsRecord } from "@/data/cs/types";
import {
  CS_FORM_COLLECTIONS,
  CS_FORM_FIELD_SPECS,
  CS_FORM_TYPES,
  CS_LEAD_FALLBACK_COLLECTION,
  type CsFieldKey,
  type CsFlagEntityType,
  type CsFormCollection,
  type CsFormType,
  type CsValueKind,
  robotPrefix,
} from "@/data/cs/form-field-keys";
import { formMatchKey, parseFormMatchKey, type FormEntry, type FormEntryFlag, type FormEntryLegacy, type FormEntryType } from "@/lib/form-entries-model";
import type { FormValue, FormValues, StickyNote } from "@/lib/forms/types";

export { CS_FORM_COLLECTIONS, CS_FORM_TYPES, CS_LEAD_FALLBACK_COLLECTION };
export type { CsFlagEntityType, CsFormCollection, CsFormType };

// ---------------------------------------------------------------------------------------------------------------------
// The table

type MatchStyle = "none" | "lead" | "plan";
type AllianceStyle = "column" | "additive" | "none";

export type CsFormSpec = {
  formType: CsFormType;
  collection: CsFormCollection;
  flagEntityType: CsFlagEntityType;
  /** The CE built-in form an entry read from CS is attributed to (CS docs carry no form id). Change when the REBUILT forms get new ids. */
  formId: string;
  formVersion: number;
  /** Field the uid is written to, and the fields it is read from (first non-empty wins). */
  uidWrite: string;
  uidRead: readonly string[];
  nameWrite: string;
  nameRead: readonly string[];
  /** The team column: written to `teamWrite`, read from `teamRead` (first present wins). null = the form has no single team. */
  teamWrite: string | null;
  teamRead: readonly string[];
  match: MatchStyle;
  alliance: AllianceStyle;
  /** What CS treats a doc without a `game` as, for this form's pages (pit: REEFSCAPE; every other page: REBUILT). */
  gameWhenMissing: string;
  /** Lead rows also carry a `timestamp` and the lead markers. */
  isLead: boolean;
};

export const CS_FORM_SPECS: Readonly<Record<CsFormType, CsFormSpec>> = {
  "pit-scout": { formType: "pit-scout", collection: "pitScouting", flagEntityType: "pitScouting", formId: "pit-scout-v1", formVersion: 1, uidWrite: "submittedBy", uidRead: ["submittedBy", "scoutId"], nameWrite: "scoutName", nameRead: ["scoutName"], teamWrite: "teamNumber", teamRead: ["teamNumber"], match: "none", alliance: "none", gameWhenMissing: DEFAULT_GAME_ID, isLead: false },
  "lead-scout": { formType: "lead-scout", collection: "leadScouting", flagEntityType: "leadScouting", formId: "lead-scout-v1", formVersion: 1, uidWrite: "scoutId", uidRead: ["scoutId", "submittedBy"], nameWrite: "scoutName", nameRead: ["scoutName"], teamWrite: null, teamRead: [], match: "lead", alliance: "column", gameWhenMissing: CURRENT_GAME_ID, isLead: true },
  "team-strategy": { formType: "team-strategy", collection: "strategyScouting", flagEntityType: "strategyScouting", formId: "team-strategy-v1", formVersion: 1, uidWrite: "scoutId", uidRead: ["scoutId", "submittedBy"], nameWrite: "scoutName", nameRead: ["scoutName"], teamWrite: "teamNumber", teamRead: ["teamNumber"], match: "none", alliance: "none", gameWhenMissing: CURRENT_GAME_ID, isLead: false },
  "match-strategy": { formType: "match-strategy", collection: "matchStrategyPlans", flagEntityType: "matchStrategyPlan", formId: "match-strategy-v1", formVersion: 1, uidWrite: "scoutId", uidRead: ["scoutId", "submittedBy"], nameWrite: "scoutName", nameRead: ["scoutName"], teamWrite: null, teamRead: [], match: "plan", alliance: "additive", gameWhenMissing: CURRENT_GAME_ID, isLead: false },
  "drive-reflection": { formType: "drive-reflection", collection: "driveScouting", flagEntityType: "driveScouting", formId: "drive-reflection-v1", formVersion: 1, uidWrite: "scoutId", uidRead: ["scoutId", "submittedBy"], nameWrite: "scoutName", nameRead: ["scoutName"], teamWrite: null, teamRead: [], match: "plan", alliance: "additive", gameWhenMissing: CURRENT_GAME_ID, isLead: false },
  helper: { formType: "helper", collection: "helperReports", flagEntityType: "helperReport", formId: "helper-v1", formVersion: 1, uidWrite: "helperId", uidRead: ["helperId", "scoutId", "submittedBy"], nameWrite: "helperName", nameRead: ["helperName", "scoutName"], teamWrite: "assistedTeamNumber", teamRead: ["assistedTeamNumber", "teamNumber"], match: "none", alliance: "none", gameWhenMissing: CURRENT_GAME_ID, isLead: false },
};

export const isCsFormType = (t: string): t is CsFormType => (CS_FORM_TYPES as readonly string[]).includes(t);

/** Is this CE form type persisted in a CS collection? (`custom` is not: CS has no equivalent, it stays in CE's `formEntries`.) */
export const isCsBackedFormType = (t: FormEntryType): t is CsFormType => isCsFormType(t);

export const csCollectionFor = (formType: CsFormType): CsFormCollection => CS_FORM_SPECS[formType].collection;

export function csFormTypeForCollection(collection: CsFormCollection | typeof CS_LEAD_FALLBACK_COLLECTION): CsFormType {
  if (collection === CS_LEAD_FALLBACK_COLLECTION) return "lead-scout";
  return CS_FORM_TYPES.find((t) => CS_FORM_SPECS[t].collection === collection) as CsFormType;
}

/** The CE form type of a built-in CS form id (`pit-scout-v1`), or null for any other form id. */
export function formTypeForFormId(formId: string): CsFormType | null {
  return CS_FORM_TYPES.find((t) => CS_FORM_SPECS[t].formId === formId) ?? null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Small helpers

const isRecord = (v: unknown): v is CsRecord => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "");

/** Epoch ms from a CS time field: a number (what CS writes), a numeric string, or a Firestore Timestamp-like object. 0 when unusable. */
export function csTimeMs(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return v.trim() !== "" && Number.isFinite(n) ? n : 0;
  }
  if (isRecord(v) && typeof v.toMillis === "function") {
    const n = (v as { toMillis: () => number }).toMillis();
    return Number.isFinite(n) ? n : 0;
  }
  if (isRecord(v) && typeof v.seconds === "number") return v.seconds * 1000;
  return 0;
}

const defined = (n: number): number | undefined => (typeof n === "number" && n > 0 ? n : undefined);

/** A team number string as the number CE uses (non-digits stripped, as CS's own inputs do); null when there are no digits. */
export function parseTeamNumber(raw: unknown): number | null {
  const digits = str(raw).replace(/[^\d]/g, "");
  return digits ? Number(digits) : null;
}

const parseAlliance = (raw: unknown): "red" | "blue" | null => {
  const v = str(raw).trim().toLowerCase();
  return v === "red" || v === "blue" ? v : null;
};

/** Does `entry`'s event match a wanted one, ignoring case and CS's legacy aliases (`2025lake` is `2026lake`)? An empty wanted event matches everything. */
export function eventCodesMatch(entryEventCode: string, wanted: string | null | undefined): boolean {
  if (!wanted) return true;
  return normalizeEventKey(entryEventCode) === normalizeEventKey(wanted);
}

/** Every spelling stored docs may use for one event (canonical, raw, legacy aliases): for server-side `where eventKey in [...]` queries. */
export const csEventQueryKeys = (eventCode: string): string[] => expandEventKeyAliases(eventCode);

/** The CS `game` of a doc as CS's page for that form reads it (a missing `game` means different things per page). */
export function csDocGame(formType: CsFormType, doc: CsRecord): string {
  const game = str(doc.game).trim().toUpperCase();
  return game || CS_FORM_SPECS[formType].gameWhenMissing;
}

/** CS `isPracticeScoutedEntry`: practice-SCOUTING rows (a practice session's output) as opposed to a scouted practice MATCH. CS's default analytics hide them. */
export function isPracticeScoutedDoc(doc: CsRecord): boolean {
  const matchType = str(doc.matchType).trim().toLowerCase();
  const practiceLabel = (raw: unknown): boolean => {
    const value = str(raw).trim().toLowerCase();
    if (!value) return false;
    const compact = value.replace(/[^a-z0-9]/g, "");
    return value.includes("practice") || /pract|prct|pratc|prac|warmup|test/i.test(compact) || /^p[\s#-]*\d+/i.test(value) || /^p\d+/i.test(compact);
  };
  const practiceMatch = matchType === "practice" || [doc.matchLabel, doc.matchId, doc.matchKey].some(practiceLabel);
  if (practiceMatch) return false;
  return Boolean(doc.isPracticeScouting) || Boolean(doc.practiceMode) || Boolean(doc.practiceSessionId);
}

/** Is a `scouting` row a lead-scout row (CS's permission fallback)? Sub-in rows never are. */
export function isLeadFallbackDoc(doc: CsRecord): boolean {
  const type = str(doc.entryType || doc.formType).trim().toLowerCase();
  if (type === "sub-in-request" || type === "sub-in-claim" || type === "sub-in") return false;
  return type === "lead" || type === "lead-scout" || type === "lead-scouting" || doc.isLeadScouting === true;
}

// ---------------------------------------------------------------------------------------------------------------------
// Match keys

const SHORT_ID = /^(p|q|qf|sf|f)\d+$/;

/**
 * The CE match key (`Q12`, `P3`, `F7`, `F15`) a CS form doc is for, or null when none of `matchId`, `matchKey`, `matchLabel` (nor `matchType` +
 * `matchNumber`) identify a match. Playoff numbering is D11 (bracket slots 1..13, finals 14..16), via `data/cs/match-id.ts`.
 */
export function csDocMatchKey(doc: CsRecord): string | null {
  const parsable = [doc.matchId, doc.matchKey, doc.matchLabel].some((c) => SHORT_ID.test(normalizeCsMatchId(c)));
  const typed = str(doc.matchType).trim() !== "" && Number(str(doc.matchNumber).replace(/[^\d]/g, "")) > 0;
  if (!parsable && !typed) return null;
  const ref = csDocMatchRef(doc);
  if (ref.matchNumber <= 0) return null;
  return formMatchKey(ref.matchType, ref.matchNumber);
}

const MATCH_FIELD_NAMES = ["matchKey", "matchId", "matchLabel", "matchType", "matchNumber"] as const;

/** The CS match fields for a CE match key, in the style of each form (a fresh write; an unchanged match writes its legacy strings instead). */
export function freshCsMatchFields(style: Exclude<MatchStyle, "none">, matchKey: string, eventCode: string): CsRecord {
  const ref = parseFormMatchKey(matchKey);
  if (!ref) return {};
  const cs = appMatchToCs(ref.matchType, ref.matchNumber);
  const isFinalsSeries = cs.matchId.startsWith("f");
  if (style === "lead") {
    const matchLabel = cs.matchType === "practice" ? `Practice ${cs.matchNumber}` : cs.matchType === "qualification" ? `Qualification ${cs.matchNumber}` : isFinalsSeries ? `Finals ${cs.matchNumber}` : `Match ${cs.matchNumber}`;
    return { matchKey: cs.matchId, matchId: cs.matchId, matchType: cs.matchType, matchNumber: cs.matchNumber, matchLabel, isPracticeScouting: cs.matchType === "practice" };
  }
  // plan: CS stores the TBA key (its plan sync compares `matchKey` for equality) when the event is a real TBA event, else the short id
  const event = normalizeEventKey(eventCode);
  const tba = isTbaEventKey(event);
  const n = cs.matchNumber;
  if (cs.matchType === "practice") return { matchKey: tba ? `${event}_pr${n}` : cs.matchId, matchLabel: `Practice Match ${n}` };
  if (cs.matchType === "qualification") return { matchKey: tba ? `${event}_qm${n}` : cs.matchId, matchLabel: `Qualification Match ${n}` };
  if (isFinalsSeries) return { matchKey: tba ? `${event}_f1m${n}` : cs.matchId, matchLabel: `Finals ${n}` };
  return { matchKey: tba ? `${event}_sf${n}m1` : cs.matchId, matchLabel: `Match ${n}` };
}

// ---------------------------------------------------------------------------------------------------------------------
// Flag states

const FLAG_ID = "cs-manual";

const MANUAL_REASON_LABELS: Record<string, string> = {
  "no-teleop-score": "No teleop score",
  "excessive-auto-score": "Excessive auto score",
  "excessive-human-player-score": "Excessive human player score",
  other: "Other",
};
const MANUAL_REASON_CODES = Object.fromEntries(Object.entries(MANUAL_REASON_LABELS).map(([code, label]) => [label, code]));

/** `scoutingFlagStates` doc id: `<entityType>:<entityId>` (CS `flagStateDocId`). */
export const csFlagStateDocId = (entityType: CsFlagEntityType, entityId: string): string => `${entityType}:${String(entityId || "").trim()}`;

/** The flag-state entity type for an entry's collection (a lead row in `scouting` is a `scoutingEntry`, as CS's lead page treats it). */
export function csFlagEntityTypeFor(formType: CsFormType, collection: CsFormCollection | typeof CS_LEAD_FALLBACK_COLLECTION = CS_FORM_SPECS[formType].collection): CsFlagEntityType {
  return collection === CS_LEAD_FALLBACK_COLLECTION ? "scoutingEntry" : CS_FORM_SPECS[formType].flagEntityType;
}

function flagsFromState(state: CsFlagState | undefined): FormEntryFlag[] {
  if (!state?.manualFlagged) return [];
  const code = str(state.manualReason).trim();
  const reason = str(state.ceManualReason).trim() || MANUAL_REASON_LABELS[code] || code || "Other";
  const at = csTimeMs(state.manualFlaggedAt);
  return [{ id: FLAG_ID, reason, ...(str(state.ceManualNote) ? { note: str(state.ceManualNote) } : {}), addedAt: new Date(at).toISOString() }];
}

/**
 * The write that makes `scoutingFlagStates` agree with `entry.flags` / `entry.excluded` (merge it with `setDoc(..., { merge: true })`), or null when
 * the stored state already agrees. Mirrors the CS Config modal's payloads: `manualFlagged` + `manualReason` + `manualFlaggedAt/By`, cleared with
 * `""` / `null` when removed. A CE reason with no CS equivalent is written as `other` plus the additive `ceManualReason` / `ceManualNote`.
 */
export function formEntryToFlagStatePatch(entry: Pick<FormEntry, "id" | "teamId" | "formType" | "flags" | "excluded" | "legacy">, existing?: CsFlagState, opts: { now?: number; actorUid?: string } = {}): { id: string; data: CsFlagState } | null {
  if (!isCsFormType(entry.formType)) return null;
  const formType = entry.formType;
  const entityType = csFlagEntityTypeFor(formType, entry.legacy?.collection);
  const now = opts.now ?? Date.now();
  const data: CsFlagState = {};
  const flag = entry.flags[0];
  const wasFlagged = Boolean(existing?.manualFlagged);

  if (flag) {
    const current = flagsFromState(existing)[0];
    const unchanged = current !== undefined && current.reason === flag.reason && (current.note ?? "") === (flag.note ?? "");
    if (!unchanged) {
      const mapped = MANUAL_REASON_CODES[flag.reason] ?? (MANUAL_REASON_LABELS[flag.reason] ? flag.reason : undefined);
      const ceReason = mapped ? "" : flag.reason;
      const ceNote = flag.note ?? "";
      const at = Date.parse(flag.addedAt);
      data.manualFlagged = true;
      data.manualReason = mapped ?? "other";
      data.manualFlaggedAt = at > 0 ? at : now;
      data.manualFlaggedBy = existing?.manualFlaggedBy || opts.actorUid || "";
      if (ceReason || existing?.ceManualReason) data.ceManualReason = ceReason;
      if (ceNote || existing?.ceManualNote) data.ceManualNote = ceNote;
    }
  } else if (wasFlagged) {
    data.manualFlagged = false;
    data.manualReason = "";
    data.manualFlaggedAt = null;
    data.manualFlaggedBy = "";
    if (existing?.ceManualReason) data.ceManualReason = "";
    if (existing?.ceManualNote) data.ceManualNote = "";
  }

  // An entry the user re-includes must also stop being excluded by the accuracy exclusion, or it would read as excluded again.
  if (!entry.excluded && existing?.excludeFromAccuracy === true) data.excludeFromAccuracy = false;

  if (Object.keys(data).length === 0) return null;
  return {
    id: csFlagStateDocId(entityType, entry.id),
    data: { teamId: entry.teamId, entityType, entityId: entry.id, dismissed: existing?.dismissed ?? false, ...data },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading a CS doc

type FieldRead = { value: unknown; path: string } | null;

function readField(container: CsRecord, root: CsRecord, f: CsFieldKey): FieldRead {
  for (const p of [f.path, ...(f.aliases ?? [])]) {
    const v = p.startsWith("/") ? root[p.slice(1)] : container[p];
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      if (typeof v === "number" && !Number.isFinite(v)) continue;
      return { value: v, path: p };
    }
  }
  return null;
}

export type CsReadOptions = {
  /** Which collection the doc was read from (`scouting` for a lead fallback row). Defaults to the form's own collection. */
  collection?: CsFormCollection | typeof CS_LEAD_FALLBACK_COLLECTION;
  /** Event for a doc without `eventKey` (CS infers it from the timestamp window); the rebuild has no event calendar, so the default is "". */
  inferEventCode?: (timestampMs: number) => string;
};

/** A CS doc as a CE `FormEntry`. `flagState` is the doc's `scoutingFlagStates` row when there is one. */
export function csDocToFormEntry(formType: CsFormType, id: string, doc: CsRecord, flagState?: CsFlagState, options: CsReadOptions = {}): FormEntry {
  const spec = CS_FORM_SPECS[formType];
  const fields = CS_FORM_FIELD_SPECS[formType];
  const collection = options.collection ?? spec.collection;
  const paths: Record<string, string> = {};
  const values: FormValues = {};

  const takeField = (container: CsRecord, f: CsFieldKey, valueKey: string) => {
    const r = readField(container, doc, f);
    if (!r) return;
    values[valueKey] = r.value as FormValue;
    if (r.path !== f.path) paths[valueKey] = r.path;
  };

  for (const f of fields.fields) takeField(doc, f, f.key);
  if (fields.overallFields && isRecord(doc.overallAlliance)) {
    for (const f of fields.overallFields) takeField(doc.overallAlliance, f, `overallAlliance_${f.key}`);
  } else if (fields.overallFields) {
    // no overallAlliance object: only the top-level legacy aliases can apply
    for (const f of fields.overallFields) takeField({}, f, `overallAlliance_${f.key}`);
  }
  const robots = Array.isArray(doc.robots) ? doc.robots : [];
  if (fields.robotFields) {
    robots.forEach((robot, i) => {
      if (!isRecord(robot)) return;
      for (const f of fields.robotFields ?? []) takeField(robot, f, `${robotPrefix(i)}_${f.key}`);
    });
  }

  // identity
  const firstOf = (names: readonly string[]): string => {
    for (const n of names) {
      const v = str(doc[n]).trim();
      if (v) return v;
    }
    return "";
  };
  const times = { createdAt: defined(csTimeMs(doc.createdAt)), submittedAt: defined(csTimeMs(doc.submittedAt)), timestamp: defined(csTimeMs(doc.timestamp)) };
  const createdAtMs = times.createdAt ?? times.submittedAt ?? times.timestamp ?? 0;
  const updatedAtMs = times.submittedAt ?? times.createdAt ?? times.timestamp ?? 0;
  const rawEvent = str(doc.eventKey).trim();
  const eventCode = rawEvent ? normalizeEventKey(rawEvent) : (options.inferEventCode?.(updatedAtMs) ?? "");

  // team
  let teamNumber: number | null = null;
  let rawTeam: string | undefined;
  for (const name of spec.teamRead) {
    if (doc[name] === undefined || doc[name] === null || str(doc[name]) === "") continue;
    teamNumber = parseTeamNumber(doc[name]);
    const raw = str(doc[name]);
    if (teamNumber === null || String(teamNumber) !== raw) rawTeam = raw;
    if (name !== spec.teamWrite) paths["@team"] = name;
    break;
  }

  const matchKey = spec.match === "none" ? null : csDocMatchKey(doc);
  const legacy: FormEntryLegacy = {
    collection,
    ...(typeof doc.game === "string" ? { game: doc.game } : {}),
    ...(rawEvent ? { eventKey: rawEvent } : {}),
    times,
    ...(rawTeam !== undefined ? { teamNumber: rawTeam } : {}),
    ...(Object.keys(paths).length ? { paths } : {}),
    ...(fields.robotFields || Array.isArray(doc.robots) ? { robotCount: robots.length } : {}),
    ...(typeof doc.excludeFromStats === "boolean" ? { excludeFromStats: doc.excludeFromStats } : {}),
    ...(flagState?.excludeFromAccuracy === true ? { excludedByAccuracy: true } : {}),
    ...(isPracticeScoutedDoc(doc) ? { practiceScouted: true } : {}),
  };
  if (spec.match !== "none") {
    const rec = legacy as Record<string, unknown>;
    for (const name of MATCH_FIELD_NAMES) {
      const v = doc[name];
      if (typeof v === "string") rec[name] = v;
      else if (typeof v === "number" && Number.isFinite(v)) rec[name] = String(v);
    }
  }

  return {
    id,
    teamId: str(doc.teamId),
    uid: firstOf(spec.uidRead),
    scoutName: firstOf(spec.nameRead),
    formId: spec.formId,
    formVersion: spec.formVersion,
    formType,
    eventCode,
    matchKey,
    alliance: spec.alliance === "none" ? null : parseAlliance(doc.alliance),
    teamNumber,
    values,
    stickyNotes: Array.isArray(doc.stickyNotes) ? (doc.stickyNotes as StickyNote[]) : [],
    linkedEntryId: typeof doc.linkedEntryId === "string" ? doc.linkedEntryId : null,
    ...(typeof doc.planDifferences === "number" ? { planDifferences: doc.planDifferences } : {}),
    flags: flagsFromState(flagState),
    excluded: doc.excludeFromStats === true || flagState?.excludeFromAccuracy === true,
    createdAtMs,
    updatedAtMs,
    legacy,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Writing a CS doc

function coerceForWrite(kind: CsValueKind, v: unknown, existingAt: unknown): unknown {
  if (v === undefined || v === null) return undefined;
  if (kind === "string") {
    if (typeof v === "string") return v;
    if (typeof v === "number" && Number.isFinite(v)) return typeof existingAt === "number" ? v : String(v);
    return undefined;
  }
  if (kind === "boolean") {
    if (typeof v === "boolean") return v;
    if (typeof v === "string") return v; // an old CSV import stored text here: pass it through, a toggle never produces a string
    return Boolean(v);
  }
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return typeof existingAt === "string" ? v : Number(v);
  return undefined;
}

function putField(container: CsRecord, root: CsRecord, existingContainer: CsRecord | undefined, existingRoot: CsRecord | undefined, f: CsFieldKey, value: unknown, usedPath: string | undefined) {
  const path = usedPath ?? f.path;
  const toRoot = path.startsWith("/");
  const name = toRoot ? path.slice(1) : path;
  const existingAt = toRoot ? existingRoot?.[name] : existingContainer?.[name];
  const v = coerceForWrite(f.kind, value, existingAt);
  if (v === undefined) return;
  (toRoot ? root : container)[name] = v;
}

const robotIndexes = (values: FormValues): number[] => {
  const idx = new Set<number>();
  for (const k of Object.keys(values)) {
    const m = /^robot(\d+)_/.exec(k);
    if (m) idx.add(Number(m[1]) - 1);
  }
  return [...idx].filter((i) => i >= 0).sort((a, b) => a - b);
};

/**
 * The CS doc fields for an entry. With `existing` (the stored doc) the result is `{ ...existing, ...known }` with nested `robots[]` and
 * `overallAlliance` objects merged field by field, so nothing CS stores is dropped. Without it the result holds only the known fields.
 */
export function formEntryToCsDoc(entry: FormEntry, existing?: CsRecord): CsRecord {
  const known = formEntryToCsPatch(entry, existing);
  return existing ? { ...existing, ...known } : known;
}

/**
 * Only the fields this adapter knows, computed with `existing` in view (so a `robots[]` array keeps its unknown keys). Write it with
 * `setDoc(ref, patch, { merge: true })`: every other field of the doc, including ones CS or a concurrent writer added, is left alone.
 */
export function formEntryToCsPatch(entry: FormEntry, existing?: CsRecord): CsRecord {
  if (!isCsFormType(entry.formType)) throw new Error(`formEntryToCsDoc: "${entry.formType}" has no CS collection`);
  const spec = CS_FORM_SPECS[entry.formType];
  const fields = CS_FORM_FIELD_SPECS[entry.formType];
  const legacy = entry.legacy;
  const isNew = !legacy && !existing;
  const out: CsRecord = {};

  // identity
  out.teamId = entry.teamId;
  if (entry.uid) out[spec.uidWrite] = entry.uid;
  out[spec.nameWrite] = entry.scoutName;

  // event: the raw CS spelling while it still means the same event
  const canonicalEvent = normalizeEventKey(entry.eventCode);
  if (legacy?.eventKey && normalizeEventKey(legacy.eventKey) === canonicalEvent) out.eventKey = legacy.eventKey;
  else if (canonicalEvent) out.eventKey = canonicalEvent;

  // game: only new docs get one (a doc without it keeps meaning what it meant)
  if (existing ? existing.game !== undefined : legacy ? legacy.game !== undefined : true) out.game = existing?.game ?? legacy?.game ?? CURRENT_GAME_ID;

  // team
  if (spec.teamWrite) {
    const field = legacy?.paths?.["@team"] ?? spec.teamWrite;
    if (entry.teamNumber === null || entry.teamNumber === undefined) out[field] = legacy?.teamNumber !== undefined && parseTeamNumber(legacy.teamNumber) === null ? legacy.teamNumber : "";
    else out[field] = legacy?.teamNumber !== undefined && parseTeamNumber(legacy.teamNumber) === entry.teamNumber ? legacy.teamNumber : String(entry.teamNumber);
  }

  // match
  if (spec.match !== "none" && entry.matchKey) {
    const stillSame = legacy && MATCH_FIELD_NAMES.some((n) => legacy[n] !== undefined) && csDocMatchKey(legacy as unknown as CsRecord) === entry.matchKey;
    if (stillSame && legacy) {
      for (const n of MATCH_FIELD_NAMES) if (legacy[n] !== undefined) out[n] = legacy[n];
    } else {
      Object.assign(out, freshCsMatchFields(spec.match, entry.matchKey, entry.eventCode));
    }
  }

  // alliance
  if (spec.alliance !== "none" && entry.alliance) out.alliance = entry.alliance;

  // values
  const values = entry.values;
  for (const f of fields.fields) {
    if (!(f.key in values)) continue;
    putField(out, out, existing, existing, f, values[f.key], legacy?.paths?.[f.key]);
  }
  if (fields.overallFields) {
    const existingOverall = isRecord(existing?.overallAlliance) ? (existing.overallAlliance as CsRecord) : undefined;
    const overall: CsRecord = { ...existingOverall };
    let touched = false;
    for (const f of fields.overallFields) {
      const key = `overallAlliance_${f.key}`;
      if (!(key in values)) continue;
      putField(overall, out, existingOverall, existing, f, values[key], legacy?.paths?.[key]);
      touched = true;
    }
    if (touched) out.overallAlliance = overall;
  }
  if (fields.robotFields) {
    const wanted = robotIndexes(values);
    const existingRobots = Array.isArray(existing?.robots) ? (existing.robots as unknown[]) : [];
    const count = Math.max(legacy?.robotCount ?? 0, existingRobots.length, wanted.length ? wanted[wanted.length - 1] + 1 : 0);
    if (wanted.length > 0 || count > 0) {
      out.robots = Array.from({ length: count }, (_, i) => {
        const prior = isRecord(existingRobots[i]) ? (existingRobots[i] as CsRecord) : undefined;
        const robot: CsRecord = { ...prior };
        for (const f of fields.robotFields ?? []) {
          const key = `${robotPrefix(i)}_${f.key}`;
          if (!(key in values)) continue;
          putField(robot, robot, prior, prior, f, values[key], legacy?.paths?.[key]);
        }
        return robot;
      });
    }
  }

  // times: CS has createdAt + submittedAt (+ timestamp on lead rows); `submittedAt` doubles as "updated"
  const t = legacy?.times;
  const derivedCreated = t ? (t.createdAt ?? t.submittedAt ?? t.timestamp ?? 0) : 0;
  const derivedUpdated = t ? (t.submittedAt ?? t.createdAt ?? t.timestamp ?? 0) : 0;
  if (isNew || t?.createdAt !== undefined || entry.createdAtMs !== derivedCreated) out.createdAt = entry.createdAtMs;
  if (isNew || t?.submittedAt !== undefined || entry.updatedAtMs !== derivedUpdated) out.submittedAt = entry.updatedAtMs;
  if (spec.isLead && (isNew || t?.timestamp !== undefined)) out.timestamp = t?.timestamp !== undefined && entry.updatedAtMs === derivedUpdated ? t.timestamp : entry.updatedAtMs;
  if (spec.isLead && isNew) {
    out.entryType = "lead";
    out.isLeadScouting = true;
  }

  // additive CE parts, only when the entry has them
  if (entry.stickyNotes.length > 0) out.stickyNotes = entry.stickyNotes;
  else if (existing && "stickyNotes" in existing) out.stickyNotes = [];
  if (entry.linkedEntryId) out.linkedEntryId = entry.linkedEntryId;
  if (typeof entry.planDifferences === "number") out.planDifferences = entry.planDifferences;

  // exclusion: the doc's own `excludeFromStats` (what CS's Config modal writes)
  const onlyByAccuracy = entry.excluded && legacy?.excludedByAccuracy === true && legacy.excludeFromStats !== true && existing?.excludeFromStats !== true;
  if (entry.excluded && !onlyByAccuracy) out.excludeFromStats = true;
  else if (!entry.excluded && (legacy?.excludeFromStats !== undefined || existing?.excludeFromStats !== undefined)) out.excludeFromStats = false;

  return out;
}

/** The collection an entry is stored in (its own, or `scouting` for a lead fallback row). */
export function csCollectionForEntry(entry: Pick<FormEntry, "formType" | "legacy">): CsFormCollection | typeof CS_LEAD_FALLBACK_COLLECTION {
  if (entry.legacy?.collection) return entry.legacy.collection;
  if (!isCsFormType(entry.formType)) throw new Error(`"${entry.formType}" has no CS collection`);
  return CS_FORM_SPECS[entry.formType].collection;
}

// ---------------------------------------------------------------------------------------------------------------------
// Completions ("which matches are already scouted"), the pure half of CS's /api/scout/completions

/** Collections CS's completions route read: the match-scout rows and the three match-based forms (pit, strategy and helper forms have no match). */
export const CS_COMPLETION_COLLECTIONS = ["scouting", "leadScouting", "matchStrategyPlans", "driveScouting"] as const;
export type CsCompletionCollection = (typeof CS_COMPLETION_COLLECTIONS)[number];

export type CompletedMatches = {
  /** CE match keys (`Q12`, `P3`, `F7`, `F15`) done in any of the collections. */
  keys: Set<string>;
  /** The same, per collection (the lead form cares about `leadScouting`, the plan form about `matchStrategyPlans`, ...). */
  byCollection: Record<CsCompletionCollection, Set<string>>;
};

/**
 * The matches already done at an event, from raw docs. Skips sub-in rows (as CS does), practice-session rows (CS counted them) and docs with no event or another event: CS inferred a
 * missing `eventKey` from the timestamp window, the rebuild has no event calendar, so those rows are left out rather than guessed.
 */
export function csCompletedMatchKeys(rows: ReadonlyArray<{ collection: CsCompletionCollection; doc: CsRecord }>, eventCode: string): CompletedMatches {
  const out: CompletedMatches = { keys: new Set(), byCollection: { scouting: new Set(), leadScouting: new Set(), matchStrategyPlans: new Set(), driveScouting: new Set() } };
  for (const { collection, doc } of rows) {
    const type = str(doc.entryType || doc.formType).trim().toLowerCase();
    if (type === "sub-in-request" || type === "sub-in-claim" || type === "sub-in") continue;
    if (isPracticeScoutedDoc(doc)) continue; // a practice session's output says nothing about the real match
    const rawEvent = str(doc.eventKey).trim();
    if (!rawEvent || !eventCodesMatch(rawEvent, eventCode)) continue;
    const key = csDocMatchKey(doc);
    if (!key) continue;
    out.keys.add(key);
    out.byCollection[collection].add(key);
  }
  return out;
}
