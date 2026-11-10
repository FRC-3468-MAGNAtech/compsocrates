/**
 * Adapter between CS's practice collections and CE's practice types. docs/ROUTES.md D1, D10. No React, no Firebase.
 *
 *  `practiceMatches` (CS, one doc per ALLIANCE per match with a YouTube video, written only by the owner's import scripts, so
 *    clients read it and never write it)  ->  CE `LibraryMatch` (one match with both alliances): `csPracticeMatchesToLibrary`,
 *    merged into the scout-facing library lists by `mergeLibraryMatches` (CE's own `libraryMatches` win a collision).
 *  `practiceSessions` (CS: a snapshot written when a session finishes; the same collection also holds CS's live-lobby docs)
 *    <->  CE `PracticeSession` (a document that lives through in-progress / paused / completed):
 *      READ   `csSessionToPractice`   a CE-written doc passes through; a CS-written one is mapped; a CS lobby doc is not a session.
 *      WRITE  `practicePatchToCsFields`   the CS-named fields to add to every CE session write, so a doc CE wrote reads in CS.
 *
 * What CE does not write into a session (documented gaps): CS's embedded `scoutedData` / `allScoutedData` (CE keeps the scouted
 * values in `scouting` rows, linked by `entryIds`; those rows carry the practice markers CS reads) and `scoringWeights`.
 */
import { normalizeEventKey } from "@/config/event";
import { appMatchToCsKey } from "@/data/cs/assignments";
import { csDocMatchRef } from "@/data/cs/match-id";
import type { CsRecord } from "@/data/cs/types";
import { asRecord, digitsToNumber, isoFromMs, isRecord, str, toEpochMs } from "@/data/cs/util";
import { getDifficulty, type Difficulty } from "@/lib/difficulty";
import type { MatchType } from "@/lib/ftc/types";
import type { LibraryAlliance, LibraryMatch } from "@/lib/match-library";
import type { PracticeSession } from "@/lib/practice-sessions";
import { DEFAULT_SEASON_ID, SEASONS } from "@/lib/seasons";

export const CS_PRACTICE_MATCHES = "practiceMatches";
export const CS_PRACTICE_SESSIONS = "practiceSessions";

/** A CS doc with its id. */
export type CsPracticeRow = { id: string; data: CsRecord };

// ---------------------------------------------------------------------------------------------------------------------
// practiceMatches -> LibraryMatch
// ---------------------------------------------------------------------------------------------------------------------

const MATCH_PREFIX: Record<MatchType, string> = { Practice: "P", Qualification: "Q", Playoff: "F" };

/** The `seasonId` of a CS `game` ("REBUILT", "CHARGED_UP"); the default season for an unknown or missing game. */
export function seasonIdForGame(game: unknown): string {
  const id = str(game).trim().toLowerCase();
  return SEASONS.some((s) => s.id === id) ? id : DEFAULT_SEASON_ID;
}

/** The CS `game` string of a season id (`rebuilt` -> `REBUILT`). */
export function gameForSeasonId(seasonId: string): string {
  return seasonId.toUpperCase();
}

function readDifficulty(value: unknown, score: number): Difficulty {
  const v = str(value).trim().toLowerCase();
  return v === "easy" || v === "medium" || v === "hard" ? v : getDifficulty(score);
}

function teamNumbers(value: unknown): number[] {
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return items.map((v) => digitsToNumber(v)).filter((n) => n > 0);
}

/** `officialData.score` / `officialData.penaltyPoints` when the doc has them, else the flat fields (CS `readOfficialData`). */
function officialOf(data: CsRecord): { score: number; penaltyPoints: number } {
  const od = asRecord(data.officialData);
  const score = [od.score, data.officialScore, data.actualScore].map(Number).find((n) => Number.isFinite(n) && n > 0) ?? 0;
  const penalty = [od.penaltyPoints, data.penaltyPoints].map(Number).find((n) => Number.isFinite(n) && n >= 0) ?? 0;
  return { score, penaltyPoints: penalty };
}

function allianceSideOf(data: CsRecord): "red" | "blue" | null {
  const v = str(data.alliance).trim().toLowerCase();
  return v === "red" || v === "blue" ? v : null;
}

/** The `LibraryMatch.id` of a CS-imported match: `cs:{eventKey}_{P|Q|F}{number}` (never a CE `libraryMatches` doc id). */
export function importedMatchId(eventKey: string, matchType: MatchType, matchNumber: number): string {
  return `cs:${normalizeEventKey(eventKey)}_${MATCH_PREFIX[matchType]}${matchNumber}`;
}

const EMPTY_ALLIANCE: LibraryAlliance = { teams: [], score: 0, penaltyPoints: 0, difficulty: "medium" };

/**
 * CS `practiceMatches` docs -> CE library matches. Docs of the same match (same event, match type and number) merge into one
 * match; an alliance CS has no doc for (CS only imports alliances whose video exists) is empty (`teams: []`), which every list
 * builder skips. Docs with no parsable match, no event or no alliance are dropped. `id` is `cs:{eventKey}_{P|Q|F}{number}`,
 * `published` is true, `origin` is `api` (CE's `libraryMatches` never holds these), and `cs` records where the match came from:
 * the alliance doc ids (a session written for it stores the matching `matchId`) and the original `matchKey`.
 */
export function csPracticeMatchesToLibrary(rows: readonly CsPracticeRow[]): LibraryMatch[] {
  const byMatch = new Map<string, LibraryMatch>();
  for (const row of rows) {
    const data = row.data;
    const eventKey = normalizeEventKey(str(data.eventKey));
    const side = allianceSideOf(data);
    if (!eventKey || !side) continue;
    const ref = csDocMatchRef({ matchKey: data.matchKey, matchType: data.matchType, matchNumber: data.matchNumber });
    if (ref.matchNumber <= 0) continue;
    const id = importedMatchId(eventKey, ref.matchType, ref.matchNumber);
    const { score, penaltyPoints } = officialOf(data);
    const teams = teamNumbers(data.allianceTeams);
    const existing = byMatch.get(id);
    const alliance: LibraryAlliance = { teams, score, penaltyPoints, difficulty: readDifficulty(data.difficulty, score) };
    const video = str(data.videoUrl).trim();
    const createdMs = toEpochMs(data.createdAt);
    if (!existing) {
      byMatch.set(id, {
        id,
        seasonId: seasonIdForGame(data.game),
        eventCode: eventKey,
        eventName: str(data.eventName).trim() || eventKey,
        matchType: ref.matchType,
        matchNumber: ref.matchNumber,
        alliances: { red: { ...EMPTY_ALLIANCE }, blue: { ...EMPTY_ALLIANCE }, [side]: alliance } as LibraryMatch["alliances"],
        video: video ? { youtubeUrl: video, startSec: null, endSec: null } : null,
        importedAt: isoFromMs(createdMs),
        scoresUpdatedAt: isoFromMs(createdMs),
        origin: "api",
        published: true,
        cs: { matchKey: str(data.matchKey), docIds: { [side]: row.id } },
      });
    } else {
      existing.alliances[side] = alliance;
      existing.cs = { matchKey: existing.cs?.matchKey || str(data.matchKey), docIds: { ...existing.cs?.docIds, [side]: row.id } };
      // Both alliances of a match share one video; keep the first one found.
      if (!existing.video && video) existing.video = { youtubeUrl: video, startSec: null, endSec: null };
    }
  }
  return [...byMatch.values()].sort(compareMatches);
}

function compareMatches(a: LibraryMatch, b: LibraryMatch): number {
  return a.eventCode.localeCompare(b.eventCode) || (a.matchType === b.matchType ? a.matchNumber - b.matchNumber : a.matchType.localeCompare(b.matchType));
}

/** Is this library match one CS imported (read-only, not in CE's `libraryMatches`)? */
export function isCsImportedMatch(match: Pick<LibraryMatch, "cs">): boolean {
  return Boolean(match.cs);
}

/**
 * CE's own matches plus the CS-imported ones, without duplicates: an imported match with the same event, type and number as a CE
 * one is dropped (the admin-curated copy wins, it may have a trimmed video window). Imported matches keep `cs`, so the UI can
 * flag them. `filter` narrows the imported set (a season, an event).
 */
export function mergeLibraryMatches(own: readonly LibraryMatch[], imported: readonly LibraryMatch[], filter?: (m: LibraryMatch) => boolean): LibraryMatch[] {
  const taken = new Set(own.map((m) => `${m.eventCode.toLowerCase()}|${m.matchType}|${m.matchNumber}`));
  const extra = imported.filter((m) => (filter ? filter(m) : true) && !taken.has(`${m.eventCode.toLowerCase()}|${m.matchType}|${m.matchNumber}`));
  return [...own, ...extra];
}

// ---------------------------------------------------------------------------------------------------------------------
// practiceSessions <-> PracticeSession
// ---------------------------------------------------------------------------------------------------------------------

/** CS's own lobby docs share the collection: they have none of a session's fields. */
export function isCsLobbyDoc(data: CsRecord): boolean {
  return "playersByUid" in data || "hostId" in data || "matchJson" in data || "assignmentsJson" in data || "submissionsJson" in data;
}

const KINDS = ["solo", "live", "lobby"] as const;
const STATUSES = ["in-progress", "paused", "completed"] as const;

/** Wire milliseconds -> the ISO string CE's session fields hold; an ISO string stays. */
function msToIso(value: unknown): string | null {
  if (typeof value === "string" && value && Number.isNaN(Number(value))) return value;
  const ms = toEpochMs(value);
  return ms > 0 ? isoFromMs(ms) : null;
}

function platformOf(deviceType: unknown): "pc" | "mobile" {
  const v = str(deviceType).toLowerCase();
  return v === "mobile" || v === "tablet" || v === "phone" ? "mobile" : "pc";
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mapCsSession(id: string, data: CsRecord): PracticeSession {
  const scouted = Array.isArray(data.allScoutedData) ? data.allScoutedData : isRecord(data.scoutedData) ? [data.scoutedData] : [];
  const robots = scouted.map((r) => digitsToNumber(asRecord(r).teamNumber)).filter((n) => n > 0);
  const eventKey = normalizeEventKey(str(data.eventKey));
  const ref = csDocMatchRef({ matchKey: data.matchKey, matchType: data.matchType, matchNumber: data.matchNumber });
  const alliance = allianceSideOf(data);
  const mode = str(data.mode).toLowerCase();
  const difficulty = str(data.difficulty).toLowerCase();
  const startedMs = toEpochMs(data.startedAt) || toEpochMs(data.timestamp);
  const finishedMs = toEpochMs(data.completedAt) || toEpochMs(data.timestamp) || startedMs;
  const live = Boolean(data.isLivePracticeScouting);
  return {
    ...(data as object),
    id,
    teamId: str(data.teamId),
    uid: str(data.scoutId),
    scoutName: str(data.scoutName),
    kind: "solo",
    seasonId: seasonIdForGame(data.game),
    mode: mode === "trial" || mode === "competitive" ? mode : null,
    difficulty: difficulty === "easy" || difficulty === "medium" || difficulty === "hard" ? difficulty : null,
    libraryMatchId: eventKey && ref.matchNumber > 0 ? importedMatchId(eventKey, ref.matchType, ref.matchNumber) : null,
    eventCode: eventKey || null,
    alliance,
    robots,
    status: "completed",
    completedRobots: robots,
    entryIds: [],
    accuracy: finiteOrNull(data.accuracy),
    scoutedTotal: finiteOrNull(data.scoutedScore),
    penaltyPoints: finiteOrNull(data.penaltyPoints),
    officialScore: finiteOrNull(data.officialScore) ?? finiteOrNull(data.actualScore),
    platform: platformOf(data.deviceType),
    flags: [],
    excluded: false,
    lobbyId: null,
    pairId: null,
    startedAt: startedMs > 0 ? isoFromMs(startedMs) : "",
    finishedAt: finishedMs > 0 ? isoFromMs(finishedMs) : null,
    matchType: ref.matchNumber > 0 ? ref.matchType : null,
    matchNumber: ref.matchNumber > 0 ? ref.matchNumber : null,
    allianceTeams: robots.length >= 2 ? robots : null,
    streamUrl: live ? str(data.liveVideoUrl).trim() || null : null,
    streamStartSec: null,
    streamEndSec: null,
  } as PracticeSession;
}

/**
 * A `practiceSessions` doc as a `PracticeSession`, or null when it is not a session (a CS live-lobby doc, or no team). A doc CE
 * wrote (`kind` + `status`) keeps its fields with the CS-style millisecond times turned back into ISO strings and `uid` filled
 * from `scoutId` when missing. A doc CS wrote (a finished snapshot) is mapped field by field as a completed `solo` session; its
 * `libraryMatchId` is the id the imported library gives that match (`importedMatchId`), so status, labels and stats find it.
 */
export function csSessionToPractice(id: string, data: CsRecord): PracticeSession | null {
  if (isCsLobbyDoc(data)) return null;
  const ceShaped = (KINDS as readonly unknown[]).includes(data.kind) && (STATUSES as readonly unknown[]).includes(data.status);
  if (!ceShaped) return str(data.teamId) ? mapCsSession(id, data) : null;
  const out = { ...data, id } as unknown as PracticeSession;
  if (!out.uid) out.uid = str(data.scoutId);
  out.startedAt = msToIso(data.startedAt) ?? "";
  out.finishedAt = msToIso(data.finishedAt) ?? msToIso(data.completedAt);
  return out;
}

/** What a session write knows about the match beyond the patch (the library match the session is for). */
export type SessionWriteContext = {
  /** The session's kind, set when the doc was claimed and not part of later patches. */
  kind?: "solo" | "live" | "lobby";
  /** The library match, for `matchId`, `matchKey`, `eventName`. */
  match?: Pick<LibraryMatch, "id" | "eventCode" | "eventName" | "matchType" | "matchNumber" | "cs"> | null;
  /** Epoch ms of the write (injectable for tests). */
  now?: number;
};

const CS_SESSION_MATCH_TYPE: Record<MatchType, "practice" | "qualification" | "playoff"> = { Practice: "practice", Qualification: "qualification", Playoff: "playoff" };

/** The CS practice-session `matchType` of a CE match type. */
export function csSessionMatchType(matchType: MatchType): "practice" | "qualification" | "playoff" {
  return CS_SESSION_MATCH_TYPE[matchType];
}

/**
 * The CS field names for the values of a CE session patch, to be merged into the same write. Only values the patch carries are
 * mapped (a partial patch stays partial). CS reads `scoutId` (the uid), `eventKey`, `matchId/Key/Number/Type`, `mode`,
 * `difficulty`, `alliance`, `isLivePracticeScouting`, `liveVideoUrl`, scores (`officialScore` + `actualScore`, `scoutedScore`,
 * `penaltyPoints`, `accuracy`), `game`, `deviceType` and the epoch-ms `timestamp` / `startedAt` / `completedAt`. `startedAt` and
 * `finishedAt` are CE's ISO strings; CS's `startedAt` is a number, so the converted value replaces the patch's one (`wireTimes`).
 */
export function practicePatchToCsFields(patch: Partial<PracticeSession>, ctx: SessionWriteContext = {}): CsRecord {
  const out: CsRecord = {};
  const now = ctx.now ?? Date.now();
  const match = ctx.match ?? null;

  if (patch.uid) out.scoutId = patch.uid;
  if (patch.scoutName !== undefined) out.scoutName = patch.scoutName;
  if (patch.eventCode !== undefined) out.eventKey = patch.eventCode ? normalizeEventKey(patch.eventCode) : "";
  if (match?.eventName) out.eventName = match.eventName;
  if (patch.seasonId) out.game = gameForSeasonId(patch.seasonId);
  if (patch.alliance !== undefined) out.alliance = patch.alliance ?? "";
  if (patch.difficulty) out.difficulty = patch.difficulty;
  if (patch.mode) out.mode = patch.mode;

  const kind = ctx.kind;
  if (kind) out.isLivePracticeScouting = kind === "live";
  if (patch.streamUrl !== undefined) out.liveVideoUrl = patch.streamUrl ?? "";

  const matchType = patch.matchType ?? match?.matchType ?? null;
  const matchNumber = patch.matchNumber ?? match?.matchNumber ?? null;
  if (matchType && matchNumber != null) {
    out.matchType = csSessionMatchType(matchType);
    out.matchNumber = matchNumber;
    const eventKey = patch.eventCode ?? match?.eventCode;
    out.matchKey = match?.cs?.matchKey || (eventKey ? appMatchToCsKey(eventKey, matchType, matchNumber) : "");
  }
  if (patch.libraryMatchId !== undefined) {
    const side = patch.alliance ?? null;
    const csDocId = side && match?.cs ? match.cs.docIds[side] : undefined;
    out.matchId = csDocId ?? patch.libraryMatchId ?? "";
  }

  if (patch.accuracy !== undefined) out.accuracy = patch.accuracy;
  if (patch.officialScore !== undefined) {
    out.officialScore = patch.officialScore;
    out.actualScore = patch.officialScore;
  }
  if (patch.scoutedTotal !== undefined) out.scoutedScore = patch.scoutedTotal;
  if (patch.penaltyPoints !== undefined) out.penaltyPoints = patch.penaltyPoints;
  if (patch.platform) out.deviceType = patch.platform === "mobile" ? "mobile" : "desktop";

  Object.assign(out, wireTimes(patch, now));
  return out;
}

/**
 * The epoch-ms times for a patch's ISO `startedAt` / `finishedAt`: `startedAt` (ms, replacing the ISO value on the wire) and, when
 * the session finishes, `completedAt` and `timestamp` (CS sorts and filters on `timestamp || completedAt || startedAt`).
 * A session claimed without a patch time still gets `timestamp`, so CS's number reads never meet a string.
 */
export function wireTimes(patch: Partial<PracticeSession>, now: number): CsRecord {
  const out: CsRecord = {};
  if (patch.startedAt) out.startedAt = Date.parse(patch.startedAt) || now;
  if (patch.finishedAt) {
    const ms = Date.parse(patch.finishedAt) || now;
    out.completedAt = ms;
    out.timestamp = ms;
  } else if (patch.status === "completed") {
    out.completedAt = now;
    out.timestamp = now;
  }
  return out;
}
