import { MATCH_TYPE_PREFIX } from "@/lib/analytics/game-schema";
import type { MatchType } from "@/lib/events/types";
import { libraryMatchId, parseMatchType } from "@/lib/library/ids";
import { splitBulkText } from "@/lib/library/bulk";
import type { EventFormErrors } from "@/lib/library/event-form";
import type { LibraryEvent } from "@/lib/library/store";
import type { LibraryMatch } from "@/lib/match-library";

// Program-neutral pure rules of the SCHEDULED match library (a program whose library holds scheduled matches: teams and an optional start time, no
// score): hand-entered matches, what the admin list shows, batching. The program's own documents and import live with its data layer. No React, no Firebase.

/** Firestore allows 500 writes per batch; 400 data writes leave room for the audit entry (the migration script uses the same number). */
export const LIBRARY_BATCH_SIZE = 400;

export function chunk<T>(items: readonly T[], size: number = LIBRARY_BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type LibraryWrite = { id: string; data: Record<string, unknown>; merge: boolean };
export type LibraryActor = { teamId: string; uid: string; name: string };
export type LibraryEventRef = { eventCode: string; eventName: string; seasonId: string };

// --- manual entry --------------------------------------------------------------------------

export type RawScheduleMatch = { matchType: string; matchNumber: string; red: string[]; blue: string[]; scheduledTime: string };

export const emptyRawScheduleMatch = (size: number): RawScheduleMatch => ({ matchType: "Q", matchNumber: "", red: Array(size).fill(""), blue: Array(size).fill(""), scheduledTime: "" });

export type ScheduleMatchInput = { matchType: MatchType; matchNumber: number; red: number[]; blue: number[]; scheduledTime: string | null };
export type ScheduleMatchErrors = Partial<Record<"matchType" | "matchNumber" | "red" | "blue" | "scheduledTime" | "teams", string>>;

const toTeamNumber = (value: string): number | null => (/^\d{1,5}$/.test(value.trim()) && Number(value) > 0 ? Number(value) : null);

/** Validates one hand-entered match: type Q/P/F, a number 1 to 9999, exactly `size` distinct teams per alliance (each 1 to 5 digits), an optional time. */
export function validateRawScheduleMatch(raw: RawScheduleMatch, size: number): { ok: true; match: ScheduleMatchInput } | { ok: false; errors: ScheduleMatchErrors } {
  const errors: ScheduleMatchErrors = {};
  const matchType = parseMatchType(raw.matchType);
  if (!matchType) errors.matchType = "Use Q (qualification), P (practice) or F (final).";
  const number = /^\d{1,4}$/.test(raw.matchNumber.trim()) ? Number(raw.matchNumber) : NaN;
  if (!(number >= 1 && number <= 9999)) errors.matchNumber = "Enter a match number from 1 to 9999.";
  const parse = (values: string[], key: "red" | "blue") => {
    const teams = Array.from({ length: size }, (_, i) => toTeamNumber(values[i] ?? ""));
    if (teams.some((t) => t === null)) {
      errors[key] = `Enter ${size} team numbers (digits only).`;
      return [] as number[];
    }
    return teams as number[];
  };
  const red = parse(raw.red, "red");
  const blue = parse(raw.blue, "blue");
  const all = [...red, ...blue];
  if (!errors.red && !errors.blue && new Set(all).size !== all.length) errors.teams = "A team can only appear once in a match.";
  let scheduledTime: string | null = null;
  if (raw.scheduledTime.trim() !== "") {
    const ms = Date.parse(raw.scheduledTime);
    if (Number.isNaN(ms)) errors.scheduledTime = "Use a date and time, or leave it blank.";
    else scheduledTime = new Date(ms).toISOString();
  }
  if (Object.keys(errors).length > 0 || !matchType) return { ok: false, errors };
  return { ok: true, match: { matchType, matchNumber: number, red, blue, scheduledTime } };
}

/** The score fields an existing stored alliance already has, to carry over when its doc is rewritten. */
function keptScore(existing: Record<string, unknown> | null, side: "red" | "blue"): { score?: number; penaltyPoints?: number } {
  const alliances = existing?.alliances;
  const stored = typeof alliances === "object" && alliances !== null ? (alliances as Record<string, unknown>)[side] : null;
  if (typeof stored !== "object" || stored === null) return {};
  const { score, penaltyPoints } = stored as { score?: unknown; penaltyPoints?: unknown };
  return { ...(typeof score === "number" ? { score } : {}), ...(typeof penaltyPoints === "number" ? { penaltyPoints } : {}) };
}

/** The stored doc of a hand-made match. `existing` keeps `published` / `createdBy` / `createdAt` on an edit; a new match starts as an unpublished draft. */
export type UpsertOptions = {
  /** `published` for a match that does not exist yet (an existing one keeps its own). As in CE: typed entry publishes at once, an import starts unpublished. */
  newPublished: boolean;
  /** `needsReview` for a match that does not exist yet (imports start as true, so an admin looks before publishing). */
  newNeedsReview: boolean;
};

export function buildManualMatchDoc(match: ScheduleMatchInput, event: LibraryEventRef, existing: Record<string, unknown> | null, teamId: string, uid: string, now: string, options: UpsertOptions = { newPublished: false, newNeedsReview: false }): Record<string, unknown> {
  const isNew = !existing;
  return {
    seasonId: event.seasonId,
    eventCode: event.eventCode,
    eventName: event.eventName,
    matchType: match.matchType,
    matchNumber: match.matchNumber,
    // An edit of the teams or the time keeps the official score an admin entered (the whole doc is rewritten, so it is carried over by hand).
    alliances: { red: { teams: match.red, ...keptScore(existing, "red") }, blue: { teams: match.blue, ...keptScore(existing, "blue") } },
    ...(typeof existing?.scoresUpdatedAt === "string" ? { scoresUpdatedAt: existing.scoresUpdatedAt } : {}),
    scheduledTime: match.scheduledTime,
    origin: "manual",
    published: typeof existing?.published === "boolean" ? existing.published : options.newPublished,
    ...(isNew ? (options.newNeedsReview ? { needsReview: true } : {}) : typeof existing?.needsReview === "boolean" ? { needsReview: existing.needsReview } : {}),
    teamId,
    createdBy: typeof existing?.createdBy === "string" ? existing.createdBy : uid,
    createdAt: typeof existing?.createdAt === "string" ? existing.createdAt : now,
    updatedAt: now,
  };
}

// --- official scores ------------------------------------------------------------------------------

/** What an admin types for one match: the official score of each alliance and the foul points awarded to it (blank = none). */
export type RawMatchScores = { redScore: string; redPenalty: string; blueScore: string; bluePenalty: string };
export type MatchScores = { red: { score: number; penaltyPoints: number }; blue: { score: number; penaltyPoints: number } };
export type MatchScoreErrors = Partial<Record<keyof RawMatchScores, string>>;

export const emptyRawMatchScores = (): RawMatchScores => ({ redScore: "", redPenalty: "", blueScore: "", bluePenalty: "" });

/** The form values of a match that already has scores (blank for an alliance without one). */
export function rawScoresOf(match: Pick<LibraryMatch, "alliances">): RawMatchScores {
  const of = (a: LibraryMatch["alliances"]["red"]) => (a.scoreKnown === false ? { score: "", penalty: "" } : { score: String(a.score), penalty: String(a.penaltyPoints) });
  const red = of(match.alliances.red);
  const blue = of(match.alliances.blue);
  return { redScore: red.score, redPenalty: red.penalty, blueScore: blue.score, bluePenalty: blue.penalty };
}

const toPoints = (value: string): number | null => (/^\d{1,4}$/.test(value.trim()) ? Number(value) : null);

/** Both scores are required (a whole number, 0 to 9999); a blank penalty is 0. Never stores a blank score as 0. */
export function validateRawScores(raw: RawMatchScores): { ok: true; scores: MatchScores } | { ok: false; errors: MatchScoreErrors } {
  const errors: MatchScoreErrors = {};
  const redScore = toPoints(raw.redScore);
  const blueScore = toPoints(raw.blueScore);
  if (redScore === null) errors.redScore = "Enter the red score (0 to 9999).";
  if (blueScore === null) errors.blueScore = "Enter the blue score (0 to 9999).";
  const penalty = (value: string, key: "redPenalty" | "bluePenalty") => {
    if (value.trim() === "") return 0;
    const n = toPoints(value);
    if (n === null) errors[key] = "Use a whole number from 0 to 9999, or leave it blank.";
    return n ?? 0;
  };
  const redPenalty = penalty(raw.redPenalty, "redPenalty");
  const bluePenalty = penalty(raw.bluePenalty, "bluePenalty");
  if (Object.keys(errors).length > 0 || redScore === null || blueScore === null) return { ok: false, errors };
  return { ok: true, scores: { red: { score: redScore, penaltyPoints: redPenalty }, blue: { score: blueScore, penaltyPoints: bluePenalty } } };
}

/** "R 42 · B 55", or "No score" when neither alliance has one. */
export function scoreLabel(match: Pick<LibraryMatch, "alliances">): string {
  const { red, blue } = match.alliances;
  if (red.scoreKnown === false && blue.scoreKnown === false) return "No score";
  return `R ${red.scoreKnown === false ? "?" : red.score} · B ${blue.scoreKnown === false ? "?" : blue.score}`;
}

// --- what the admin list shows -----------------------------------------------------------------------

/** One row of the event list: the event plus its match and published counts. */
export type LibraryEventSummary = { event: LibraryEvent; matchCount: number; publishedCount: number };

export function summarizeEvents(events: readonly LibraryEvent[], matches: readonly Pick<LibraryMatch, "eventCode" | "published">[]): LibraryEventSummary[] {
  const counts = new Map<string, { total: number; published: number }>();
  for (const m of matches) {
    const c = counts.get(m.eventCode) ?? { total: 0, published: 0 };
    c.total++;
    if (m.published === true) c.published++;
    counts.set(m.eventCode, c);
  }
  return [...events]
    .sort((a, b) => a.eventName.localeCompare(b.eventName))
    .map((event) => ({ event, matchCount: counts.get(event.eventCode)?.total ?? 0, publishedCount: counts.get(event.eventCode)?.published ?? 0 }));
}

/** "Published", "Draft" or "Partly published (2 of 5)". An event with no matches is a draft. */
export function publishedLabel(total: number, published: number): string {
  if (total === 0 || published === 0) return "Draft";
  return published === total ? "Published" : `Partly published (${published} of ${total})`;
}

export const scheduleMatchLabel = (m: Pick<LibraryMatch, "matchType" | "matchNumber">): string => `${MATCH_TYPE_PREFIX[m.matchType]}${m.matchNumber}`;

// --- results the port hands back --------------------------------------------------------------------------

export type CreateEventResult = { ok: true; event: LibraryEvent } | { ok: false; error: string; fieldErrors?: EventFormErrors };
export type UpsertResult = { created: number; updated: number; ids: string[] };
export type ImportSummary = { eventCode: string; eventName: string; created: number; updated: number; skippedManual: string[]; skippedNoTeams: number; batches: number; /** Matches written with the official score the API had for them. */ scored?: number };
/** An import either wrote its schedule or failed BEFORE writing anything, with a message for the admin. */
export type ImportOutcome = { ok: true; summary: ImportSummary } | { ok: false; message: string };

// --- fast entry and bulk paste (as CE added matches) -------------------------------------------------------------

/** The next free match number of a type: what "Save and add next" fills in. */
export function nextScheduleMatchNumber(matches: readonly Pick<LibraryMatch, "matchType" | "matchNumber">[], matchType: MatchType): number {
  return matches.filter((m) => m.matchType === matchType).reduce((max, m) => Math.max(max, m.matchNumber), 0) + 1;
}

export const scheduleMatchId = (eventCode: string, m: Pick<ScheduleMatchInput, "matchType" | "matchNumber">): string => libraryMatchId(eventCode, m.matchType, m.matchNumber);

/** A note that never blocks saving: the match replaces one that already exists. */
export function scheduleMatchWarnings(match: ScheduleMatchInput, ctx: { eventCode: string; existing: readonly Pick<LibraryMatch, "id">[] }): string[] {
  const id = scheduleMatchId(ctx.eventCode, match);
  return ctx.existing.some((m) => m.id === id) ? [`${scheduleMatchLabel(match)} already exists in this event: saving will replace it.`] : [];
}

/** The columns of the paste template, in order, for an alliance of `size` teams. */
export function bulkScheduleColumns(size: number): string[] {
  return ["matchType", "matchNumber", ...["red", "blue"].flatMap((c) => Array.from({ length: size }, (_, i) => `${c}${i + 1}`)), "scheduledTime"];
}

export const bulkScheduleTemplate = (size: number): string => `${bulkScheduleColumns(size).join(",")}\nQ,1,${Array.from({ length: size * 2 }, (_, i) => 1000 + i).join(",")},\n`;

export type BulkScheduleRow = {
  rowNumber: number;
  id: string | null;
  match: ScheduleMatchInput | null;
  errors: string[];
  action: "create" | "update" | null;
  /** A later row with the same match replaces this one. */
  superseded: boolean;
};
export type BulkScheduleResult = { columnErrors: string[]; rows: BulkScheduleRow[] };

const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Checks pasted spreadsheet text or a CSV row by row before anything is saved. A header row (any column order; type, match/number, red1.., blue1.., time)
 * is used when present; without one the columns are the template's, and the type column may be left out (then `defaultType` applies).
 */
export function validateBulkSchedule(args: { text: string; eventCode: string; size: number; defaultType: MatchType | null; existingIds: ReadonlySet<string> }): BulkScheduleResult {
  const { text, eventCode, size, defaultType, existingIds } = args;
  const table = splitBulkText(text).filter((r) => r.some((c) => c.trim() !== ""));
  if (table.length === 0) return { columnErrors: ["Paste or choose some rows first."], rows: [] };

  const slots = bulkScheduleColumns(size);
  const aliases: Record<string, string> = { type: "matchType", match: "matchNumber", matchno: "matchNumber", number: "matchNumber", time: "scheduledTime", start: "scheduledTime", starttime: "scheduledTime", scheduled: "scheduledTime" };
  for (const c of slots) aliases[norm(c)] = c;
  const header = table[0].map((c) => aliases[norm(c)] ?? null);
  const hasHeader = header.filter(Boolean).length >= 3;
  let columns: (string | null)[];
  let body = table;
  if (hasHeader) {
    columns = header;
    body = table.slice(1);
    const missing = ["matchNumber", ...slots.filter((c) => /^(red|blue)\d$/.test(c))].filter((c) => !columns.includes(c));
    if (missing.length > 0) return { columnErrors: [`Missing column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`], rows: [] };
  } else {
    // No header: the template order, or the same without the type column.
    const first = table[0];
    const withType = parseMatchType(first[0] ?? "") !== null && first.length >= 2 + size * 2;
    columns = withType ? slots : slots.slice(1);
    if (!withType && !defaultType) return { columnErrors: ["Choose a default match type, or include a type column (Q, P or F)."], rows: [] };
  }

  const rows: BulkScheduleRow[] = body.map((cells, i) => {
    const cell = (name: string) => (cells[columns.indexOf(name)] ?? "").trim();
    const raw: RawScheduleMatch = {
      matchType: cell("matchType") || (defaultType ? MATCH_TYPE_PREFIX[defaultType] : ""),
      matchNumber: cell("matchNumber"),
      red: Array.from({ length: size }, (_, k) => cell(`red${k + 1}`)),
      blue: Array.from({ length: size }, (_, k) => cell(`blue${k + 1}`)),
      scheduledTime: cell("scheduledTime"),
    };
    const checked = validateRawScheduleMatch(raw, size);
    const rowNumber = i + 1 + (hasHeader ? 1 : 0);
    if (!checked.ok) return { rowNumber, id: null, match: null, errors: Object.values(checked.errors), action: null, superseded: false };
    const id = scheduleMatchId(eventCode, checked.match);
    return { rowNumber, id, match: checked.match, errors: [], action: existingIds.has(id) ? "update" : "create", superseded: false };
  });
  // A match listed twice keeps the last row.
  const last = new Map<string, number>();
  rows.forEach((r, i) => {
    if (r.id) last.set(r.id, i);
  });
  rows.forEach((r, i) => {
    if (r.id && last.get(r.id) !== i) r.superseded = true;
  });
  return { columnErrors: [], rows };
}

export type BulkScheduleSummary = { total: number; errors: number; creates: number; updates: number; superseded: number; importable: ScheduleMatchInput[] };

export function summarizeBulkSchedule(result: BulkScheduleResult): BulkScheduleSummary {
  const ok = result.rows.filter((r) => r.match && !r.superseded);
  return {
    total: result.rows.length,
    errors: result.rows.filter((r) => r.errors.length > 0).length,
    creates: ok.filter((r) => r.action === "create").length,
    updates: ok.filter((r) => r.action === "update").length,
    superseded: result.rows.filter((r) => r.superseded).length,
    importable: ok.map((r) => r.match!),
  };
}
