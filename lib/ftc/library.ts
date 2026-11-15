import { PROGRAMS } from "@/config/programs";
import type { EventMatch, MatchType } from "@/lib/events/types";
import { decideMatchWrite, libraryMatchId, originOf, type LibraryOrigin } from "@/lib/library/ids";
import type { LibraryEventRef, LibraryWrite } from "@/lib/library/schedule";
import type { LibraryEvent } from "@/lib/library/store";
import { getDifficulty } from "@/lib/difficulty";
import type { LibraryMatch } from "@/lib/match-library";

// Pure rules for the FTC match library (docs/FTC_COMPLETION_PLAN.md, batch 2): the documents under `programs/ftc/libraryEvents` and
// `programs/ftc/libraryMatches`, what the schedule import writes, and how a stored doc becomes the app's `LibraryMatch`. No React, no Firebase.
//
// An FTC library match is a SCHEDULED match: two red and two blue teams and an optional start time. It carries no score (the FTC Events API import
// reads the schedule only). Additive fields, FTC only: `scheduledTime`, and `teamId` on hand-made (manual) events and matches (their owner team).

// --- ids -------------------------------------------------------------------------------

/** `${eventCode}_${Q|P|F}${n}`: the same id on every import, so importing twice updates instead of duplicating. */
export const ftcMatchId = (eventCode: string, matchType: MatchType, matchNumber: number): string => libraryMatchId(eventCode, matchType, matchNumber);

/** Event codes are upper case; the API's own codes are accepted as typed. Returns null for something that cannot be one. */
export function normalizeApiEventCode(input: string): string | null {
  const code = input.trim().toUpperCase();
  return /^[A-Z0-9-]{2,24}$/.test(code) ? code : null;
}

/** A manual event's generated code: `MAN-` + a slug of the name + 4 random characters, so two teams never collide on the shared collection. */
export function generateFtcManualEventCode(name: string, taken: ReadonlySet<string>, random: () => number = Math.random): string {
  const slug = name.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 8) || "EVENT";
  const takenUpper = new Set([...taken].map((t) => t.toUpperCase()));
  for (let i = 0; i < 20; i++) {
    const suffix = Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(random() * 32)]).join("");
    const code = `MAN-${slug}-${suffix}`;
    if (!takenUpper.has(code)) return code;
  }
  return `MAN-${slug}-${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

// --- schedule import -------------------------------------------------------------------------------

export type ImportPlan = {
  writes: LibraryWrite[];
  created: number;
  updated: number;
  /** Ids left alone because a manual match already has them. */
  skippedManual: string[];
  /** Scheduled matches with no teams posted yet; a later import picks them up. */
  skippedNoTeams: number;
  /** Matches written with the official score the API already has for them (a played match). */
  scored: number;
};

const apiScore = (value: number | null | undefined): number | null => (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 9999 ? value : null);

/**
 * What an import writes. Matches already stored are updated in place (their `published` choice and creation time are kept), new ones are created
 * published; a manual match with the same id is never touched. A match with no teams at all is skipped; one with a missing slot is stored with the
 * teams that are posted. The same schedule planned twice against its own result gives the same ids and no new docs.
 */
export function planScheduleImport(args: { event: LibraryEventRef; matches: readonly EventMatch[]; existing: ReadonlyMap<string, Record<string, unknown>>; uid: string; now: string }): ImportPlan {
  const { event, matches, existing, uid, now } = args;
  const plan: ImportPlan = { writes: [], created: 0, updated: 0, skippedManual: [], skippedNoTeams: 0, scored: 0 };
  const seen = new Set<string>();
  const size = ftcAllianceSize();
  for (const m of matches) {
    if (m.type === "Practice") continue;
    if (!Number.isInteger(m.matchNumber) || m.matchNumber < 1) continue;
    const red = m.redTeams.slice(0, size);
    const blue = m.blueTeams.slice(0, size);
    if (red.length === 0 && blue.length === 0) {
      plan.skippedNoTeams++;
      continue;
    }
    const id = ftcMatchId(event.eventCode, m.type, m.matchNumber);
    if (seen.has(id)) continue;
    seen.add(id);
    const current = existing.get(id) ?? null;
    const decision = decideMatchWrite(current, "api");
    if (decision === "skip-other-origin") {
      plan.skippedManual.push(id);
      continue;
    }
    // A played match brings its official score (and the foul points awarded to each alliance). An unplayed one writes none, so a re-import never erases a score an
    // admin entered by hand: a merge write only touches the fields it carries.
    const redScore = m.played ? apiScore(m.redScore) : null;
    const blueScore = m.played ? apiScore(m.blueScore) : null;
    const scored = redScore !== null && blueScore !== null;
    if (scored) plan.scored++;
    const base = {
      seasonId: event.seasonId,
      eventCode: event.eventCode,
      eventName: event.eventName,
      matchType: m.type,
      matchNumber: m.matchNumber,
      alliances: scored
        ? { red: { teams: red, score: redScore, penaltyPoints: apiScore(m.redPenaltyPoints) ?? 0 }, blue: { teams: blue, score: blueScore, penaltyPoints: apiScore(m.bluePenaltyPoints) ?? 0 } }
        : { red: { teams: red }, blue: { teams: blue } },
      ...(scored ? { scoresUpdatedAt: now } : {}),
      scheduledTime: m.startTime ?? null,
      origin: "api" as const,
      updatedAt: now,
    };
    if (decision === "create") {
      plan.created++;
      plan.writes.push({ id, merge: false, data: { ...base, published: true, createdBy: uid, createdAt: now } });
    } else {
      plan.updated++;
      plan.writes.push({ id, merge: true, data: { ...base, ...(typeof current?.published === "boolean" ? {} : { published: true }) } });
    }
  }
  return plan;
}

// --- reading stored docs ---------------------------------------------------------------------------

/** A stored score or penalty: a whole number from 0 to 9999 (the rules' bounds). */
const isScoreValue = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 9999;

/** A stored match video (no screen writes one yet): a YouTube link with an optional clip window. Anything else reads as no video. */
function readVideo(value: unknown): LibraryMatch["video"] {
  if (typeof value !== "object" || value === null) return null;
  const v = value as { youtubeUrl?: unknown; startSec?: unknown; endSec?: unknown };
  if (typeof v.youtubeUrl !== "string" || v.youtubeUrl.trim() === "") return null;
  const sec = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null);
  return { youtubeUrl: v.youtubeUrl, startSec: sec(v.startSec), endSec: sec(v.endSec) };
}

const asTeams = (value: unknown): number[] => (Array.isArray(value) ? value.filter((t): t is number => typeof t === "number" && Number.isFinite(t)) : []);
const asIso = (value: unknown): string => (typeof value === "string" ? value : "");

const MATCH_TYPES: readonly MatchType[] = ["Practice", "Qualification", "Playoff"];

/**
 * A stored FTC library doc as the app's `LibraryMatch`. Tolerates partial data: a missing alliance or slot reads as fewer teams, never a throw.
 * Returns null only when the doc cannot be identified (no valid type or number). The official score is optional per alliance (an admin enters it, or the
 * import brings it once the match is played): an alliance with none has `scoreKnown: false` and placeholder score fields (0, "easy") that no reader may
 * show, total or compare against; `scheduleOnly` is true when neither alliance has one. A known score gets its difficulty from the game's own cut-offs.
 */
export function ftcDocToLibraryMatch(id: string, data: Record<string, unknown>): LibraryMatch | null {
  const matchType = MATCH_TYPES.find((t) => t === data.matchType);
  if (!matchType || typeof data.matchNumber !== "number" || !Number.isInteger(data.matchNumber)) return null;
  const alliances = (typeof data.alliances === "object" && data.alliances !== null ? data.alliances : {}) as Record<string, unknown>;
  const seasonId = typeof data.seasonId === "string" ? data.seasonId : "";
  const side = (key: "red" | "blue"): LibraryMatch["alliances"]["red"] => {
    const raw = (alliances[key] ?? {}) as { teams?: unknown; score?: unknown; penaltyPoints?: unknown };
    const teams = asTeams(raw.teams);
    // The official score is optional (a scheduled match has none yet). A stored score that is not a whole, non-negative number is treated as missing, never as 0.
    if (!isScoreValue(raw.score)) return { teams, score: 0, penaltyPoints: 0, difficulty: "easy", scoreKnown: false };
    const penaltyPoints = isScoreValue(raw.penaltyPoints) ? raw.penaltyPoints : 0;
    return { teams, score: raw.score, penaltyPoints, difficulty: getDifficulty(raw.score, seasonId, "ftc"), scoreKnown: true };
  };
  const red = side("red");
  const blue = side("blue");
  return {
    id,
    seasonId: typeof data.seasonId === "string" ? data.seasonId : "",
    eventCode: typeof data.eventCode === "string" ? data.eventCode : "",
    eventName: typeof data.eventName === "string" ? data.eventName : "",
    matchType,
    matchNumber: data.matchNumber,
    alliances: { red, blue },
    video: readVideo(data.video),
    importedAt: asIso(data.createdAt ?? data.importedAt),
    scoresUpdatedAt: asIso(data.scoresUpdatedAt),
    origin: originOf(data) as LibraryOrigin,
    published: typeof data.published === "boolean" ? data.published : undefined,
    needsReview: typeof data.needsReview === "boolean" ? data.needsReview : undefined,
    createdBy: typeof data.createdBy === "string" ? data.createdBy : undefined,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : undefined,
    scheduleOnly: !red.scoreKnown && !blue.scoreKnown,
    scheduledTime: typeof data.scheduledTime === "string" ? data.scheduledTime : null,
    teamId: typeof data.teamId === "string" ? data.teamId : undefined,
  };
}

/** Converts stored rows, dropping (and counting) the ones that cannot be identified; sorted by type then number. */
export function ftcDocsToLibraryMatches(rows: readonly { id: string; data: Record<string, unknown> }[]): { matches: LibraryMatch[]; unreadable: number } {
  const matches: LibraryMatch[] = [];
  let unreadable = 0;
  for (const row of rows) {
    const match = ftcDocToLibraryMatch(row.id, row.data);
    if (match) matches.push(match);
    else unreadable++;
  }
  matches.sort((a, b) => (a.matchType === b.matchType ? a.matchNumber - b.matchNumber : MATCH_TYPES.indexOf(a.matchType) - MATCH_TYPES.indexOf(b.matchType)));
  return { matches, unreadable };
}

export function ftcDocToLibraryEvent(id: string, data: Record<string, unknown>): LibraryEvent {
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    eventCode: id,
    eventName: typeof data.eventName === "string" && data.eventName !== "" ? data.eventName : id,
    seasonId: typeof data.seasonId === "string" ? data.seasonId : "",
    origin: originOf(data),
    date: str(data.date),
    sourceUrl: str(data.sourceUrl),
    defaultVideoUrl: str(data.defaultVideoUrl),
    createdBy: typeof data.createdBy === "string" ? data.createdBy : "",
    createdAt: str(data.createdAt) ?? undefined,
    updatedAt: str(data.updatedAt) ?? undefined,
    teamId: str(data.teamId) ?? undefined,
  };
}

// --- merging the two queries a library read needs ------------------------------------------------------

export type RawRow = { id: string; data: Record<string, unknown> };

/**
 * The rules cannot prove one query is readable when the collection holds both shared API docs and a team's own manual docs, so a read is two queries
 * (`origin == 'api'` and `teamId == <mine>`). This merges their rows (by id) and delivers once EVERY query has answered. The first failure is reported
 * once and nothing is delivered after it: a half-answer is never shown as the full list.
 */
export function createMergedFeed(count: number, onRows: (rows: RawRow[]) => void, onError: (err: unknown) => void) {
  const latest: (RawRow[] | null)[] = Array(count).fill(null);
  let failed = false;
  return {
    update(index: number, rows: RawRow[]) {
      if (failed) return;
      latest[index] = rows;
      if (latest.some((r) => r === null)) return;
      const byId = new Map<string, RawRow>();
      for (const rows of latest as RawRow[][]) for (const row of rows) byId.set(row.id, row);
      onRows([...byId.values()]);
    },
    fail(err: unknown) {
      if (failed) return;
      failed = true;
      onError(err);
    },
  };
}

// --- sizes and messages -------------------------------------------------------------------------------------

/** The alliance size of the program (two teams). */
export const ftcAllianceSize = (): number => PROGRAMS.ftc.event.allianceSize;

/** The typed API error shown by the import, naming the variable to fix. */
export function importErrorMessage(error: { code: string; message: string }): string {
  if (error.code === "missing_credentials") return `${error.message} Manual entry still works.`;
  if (error.code === "unauthorized") return "The FIRST API rejected the configured key. Check FTC_API_USERNAME and FTC_API_KEY (the values, not just that they are set). Manual entry still works.";
  return `${error.message} Nothing was changed.`;
}
