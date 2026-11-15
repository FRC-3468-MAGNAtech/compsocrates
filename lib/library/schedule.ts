import type { MatchType } from "@/lib/events/types";
import type { EventFormErrors } from "@/lib/library/event-form";
import type { LibraryEvent } from "@/lib/library/store";
import type { LibraryMatch } from "@/lib/match-library";
import type { ValidMatch } from "@/lib/library/manual-match";

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

export type SideScore = { score: number; penaltyPoints: number };
/**
 * What the shared match dialog adds to a schedule input (all optional; absent keeps the old rules, which carry an existing score and video over):
 * `scores` (a side `null` = no official score: its fields are left out), `video`, `notes`, and `keepTime` (an input with no time keeps the stored one).
 */
export type ScheduleMatchExtra = { scores?: { red: SideScore | null; blue: SideScore | null }; video?: { youtubeUrl: string; startSec: number | null; endSec: number | null } | null; notes?: string; keepTime?: boolean };
export type ScheduleMatchInput = { matchType: MatchType; matchNumber: number; red: number[]; blue: number[]; scheduledTime: string | null; extra?: ScheduleMatchExtra };

/**
 * A match from the shared dialog, fast entry or bulk import, as the schedule library stores it. `keepScores` (fast entry, bulk import) leaves the stored
 * official score alone, so re-entering a row's teams never erases a score; the edit dialog sends its scores as typed (a blank score clears it).
 */
export function scheduleInputFromValid(m: ValidMatch, options: { keepScores?: boolean } = {}): ScheduleMatchInput {
  const side = (a: ValidMatch["red"]): SideScore | null => (a.scoreKnown === false ? null : { score: a.score, penaltyPoints: a.penaltyPoints });
  return {
    matchType: m.matchType,
    matchNumber: m.matchNumber,
    red: m.red.teams,
    blue: m.blue.teams,
    scheduledTime: m.scheduledTime ?? null,
    extra: { ...(options.keepScores ? {} : { scores: { red: side(m.red), blue: side(m.blue) } }), video: m.video, notes: m.notes, keepTime: m.scheduledTime === undefined },
  };
}
/** The score fields an existing stored alliance already has, to carry over when its doc is rewritten. */
function keptScore(existing: Record<string, unknown> | null, side: "red" | "blue"): { score?: number; penaltyPoints?: number } {
  const alliances = existing?.alliances;
  const stored = typeof alliances === "object" && alliances !== null ? (alliances as Record<string, unknown>)[side] : null;
  if (typeof stored !== "object" || stored === null) return {};
  const { score, penaltyPoints } = stored as { score?: unknown; penaltyPoints?: unknown };
  return { ...(typeof score === "number" ? { score } : {}), ...(typeof penaltyPoints === "number" ? { penaltyPoints } : {}) };
}

/** The score fields of one side: the dialog's typed scores when it sent any, otherwise what the stored doc already had. */
function scoreFields(match: ScheduleMatchInput, existing: Record<string, unknown> | null, side: "red" | "blue"): { score?: number; penaltyPoints?: number } {
  const typed = match.extra?.scores;
  if (!typed) return keptScore(existing, side);
  const s = typed[side];
  return s ? { score: s.score, penaltyPoints: s.penaltyPoints } : {};
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
    alliances: { red: { teams: match.red, ...scoreFields(match, existing, "red") }, blue: { teams: match.blue, ...scoreFields(match, existing, "blue") } },
    ...(match.extra?.scores
      ? match.extra.scores.red || match.extra.scores.blue ? { scoresUpdatedAt: now } : {}
      : typeof existing?.scoresUpdatedAt === "string" ? { scoresUpdatedAt: existing.scoresUpdatedAt } : {}),
    scheduledTime: match.extra?.keepTime && match.scheduledTime === null ? (typeof existing?.scheduledTime === "string" ? existing.scheduledTime : null) : match.scheduledTime,
    ...(match.extra?.video !== undefined ? { video: match.extra.video } : existing?.video ? { video: existing.video } : {}),
    ...(match.extra?.notes ? { notes: match.extra.notes } : {}),
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

// --- results the port hands back --------------------------------------------------------------------------

export type CreateEventResult = { ok: true; event: LibraryEvent } | { ok: false; error: string; fieldErrors?: EventFormErrors };
export type UpsertResult = { created: number; updated: number; ids: string[]; skipped?: { id: string; reason: string }[] };
export type ImportSummary = { eventCode: string; eventName: string; created: number; updated: number; skippedManual: string[]; skippedNoTeams: number; batches: number; /** Matches written with the official score the API had for them. */ scored?: number };
/** An import either wrote its schedule or failed BEFORE writing anything, with a message for the admin. */
export type ImportOutcome = { ok: true; summary: ImportSummary } | { ok: false; message: string };

// --- the import result both programs report -------------------------------------------------------------

/** What an import wrote, in one shape: `written` matches, `skipped` ones the source could not give yet (with its reason), manual matches left alone. */
export type LibraryImportSummary = { eventCode: string; eventName: string; written: number; skipped: number; skippedReason: string; skippedManual: string[]; detail?: string };
export type LibraryImportOutcome = { ok: true; summary: LibraryImportSummary } | { ok: false; message: string };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The sentence under the import controls: the same for every program, `detail` is the program's extra line (new / updated / scored). */
export function importMessage(s: LibraryImportSummary): string {
  return (
    `${s.eventName}: imported ${plural(s.written, "match", "matches")}, skipped ${s.skipped} ${s.skippedReason}.` +
    (s.skippedManual.length > 0 ? ` Left ${plural(s.skippedManual.length, "manual match", "manual matches")} untouched (${s.skippedManual.join(", ")}).` : "") +
    (s.detail ? ` ${s.detail}` : "")
  );
}
