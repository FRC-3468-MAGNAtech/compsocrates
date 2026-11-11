import { EVENT_CONFIG } from "@/config/event";
import { getEventStatus } from "@/lib/events/event-status";
import type { EventInfo, EventMatch, EventRanking, EventTeam, MatchType } from "@/lib/events/types";

/**
 * Pure mappers from TBA v3 payloads to the app's neutral event types. No network, no env: the
 * HTTP side lives in tba.ts. Playoff numbering follows decision D11 and CS's
 * app/utils/reefscapeMatchSync.ts.
 */

// --- Raw TBA shapes (only the fields we read) -------------------------------

export type TbaCompLevel = "pr" | "qm" | "ef" | "qf" | "sf" | "f";

export type TbaEventRaw = {
  key: string;
  name: string;
  year?: number;
  start_date: string;
  end_date: string;
  city?: string | null;
  state_prov?: string | null;
  country?: string | null;
  location_name?: string | null;
  website?: string | null;
  timezone?: string | null;
};

export type TbaTeamRaw = {
  team_number: number;
  nickname?: string | null;
  name?: string | null;
  city?: string | null;
  state_prov?: string | null;
  country?: string | null;
  rookie_year?: number | null;
};

export type TbaAllianceRaw = { team_keys?: string[]; score?: number | null };

export type TbaMatchRaw = {
  key: string;
  comp_level: TbaCompLevel | string;
  set_number: number;
  match_number: number;
  alliances?: { red?: TbaAllianceRaw; blue?: TbaAllianceRaw };
  time?: number | null;
  predicted_time?: number | null;
  actual_time?: number | null;
  post_result_time?: number | null;
  winning_alliance?: "red" | "blue" | "" | null;
  score_breakdown?: { red?: { foulPoints?: number }; blue?: { foulPoints?: number } } | null;
};

export type TbaRankingRaw = {
  rank?: number;
  team_key?: string;
  matches_played?: number;
  record?: { wins?: number; losses?: number; ties?: number } | null;
  sort_orders?: number[] | null;
};

export type TbaRankingsPayload = { rankings?: TbaRankingRaw[] | null } | null;

// --- Events, teams, rankings ------------------------------------------------

export function toEventInfo(raw: TbaEventRaw, season?: number): EventInfo {
  const timezone = raw.timezone ?? null;
  return {
    code: raw.key,
    season: season ?? raw.year ?? Number(raw.key.slice(0, 4)),
    name: raw.name,
    dateStart: raw.start_date,
    dateEnd: raw.end_date,
    city: raw.city ?? null,
    stateProv: raw.state_prov ?? null,
    country: raw.country ?? null,
    venue: raw.location_name ?? null,
    website: raw.website ?? null,
    timezone,
    status: getEventStatus({ dateStart: raw.start_date, dateEnd: raw.end_date, timezone }),
  };
}

export function toEventTeam(raw: TbaTeamRaw): EventTeam {
  const short = raw.nickname?.trim() || `Team ${raw.team_number}`;
  return {
    teamNumber: raw.team_number,
    nameShort: short,
    nameFull: raw.name?.trim() || short,
    city: raw.city ?? null,
    stateProv: raw.state_prov ?? null,
    country: raw.country ?? null,
    rookieYear: raw.rookie_year ?? null,
  };
}

/** `"frc254"` -> 254; NaN-safe (returns null for anything else). */
export function teamNumberFromKey(key: string): number | null {
  const match = /^frc(\d+)$/i.exec(String(key || "").trim());
  return match ? Number(match[1]) : null;
}

export function teamNumbersFromKeys(keys: string[] | undefined): number[] {
  return (keys ?? []).map(teamNumberFromKey).filter((n): n is number => n !== null);
}

export function toEventRanking(raw: TbaRankingRaw): EventRanking | null {
  const teamNumber = teamNumberFromKey(raw.team_key ?? "");
  if (teamNumber === null || typeof raw.rank !== "number") return null;
  const wins = raw.record?.wins ?? 0;
  const losses = raw.record?.losses ?? 0;
  const ties = raw.record?.ties ?? 0;
  const first = raw.sort_orders?.[0];
  return {
    teamNumber,
    rank: raw.rank,
    wins,
    losses,
    ties,
    matchesPlayed: raw.matches_played ?? wins + losses + ties,
    // TBA lists the sort criteria in order; the first is the ranking score / ranking points.
    rankingPoints: typeof first === "number" ? first : null,
  };
}

// --- Matches ----------------------------------------------------------------

const COMP_LEVEL_ORDER: Record<string, number> = { pr: 0, qm: 1, ef: 2, qf: 3, sf: 4, f: 5 };

/** qm -> Qualification; qf/sf/f -> Playoff. Practice ("pr") and eighths ("ef") are not mapped here. */
export function matchTypeForCompLevel(level: string): MatchType | null {
  if (level === "qm") return "Qualification";
  if (level === "qf" || level === "sf" || level === "f") return "Playoff";
  if (level === "pr") return "Practice";
  return null;
}

/** Seconds since the epoch the schedule uses: actual, else predicted, else scheduled. 0 when unknown. */
export function getTbaScheduleTime(match: Pick<TbaMatchRaw, "actual_time" | "predicted_time" | "time">): number {
  const value = Number(match.actual_time || match.predicted_time || match.time || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** CS's isTbaMatchCompleted: a match is done when it has a score, an actual time, a result time or a winner. */
export function isTbaMatchCompleted(match: TbaMatchRaw): boolean {
  const red = match.alliances?.red?.score;
  const blue = match.alliances?.blue?.score;
  if (typeof red === "number" && typeof blue === "number" && red >= 0 && blue >= 0) return true;
  if (Number(match.actual_time || 0) > 0) return true;
  if (Number(match.post_result_time || 0) > 0) return true;
  if (match.winning_alliance === "red" || match.winning_alliance === "blue") return true;
  return Boolean(match.score_breakdown && Object.keys(match.score_breakdown).length > 0);
}

/**
 * The 2026 double-elimination bracket slot (1..13) for a TBA qf/sf match, or null. Ported from
 * CS mapPlayoffToBracketSlot: 2026 feeds encode the slot as SF{slot}M{n}; the qf and the
 * set/match branches below it cover older feed shapes.
 */
export function mapPlayoffToBracketSlot(match: Pick<TbaMatchRaw, "comp_level" | "set_number" | "match_number" | "key">): number | null {
  const key = String(match.key || "").toLowerCase();
  const level =
    String(match.comp_level || "").toLowerCase() ||
    (/_qf\d+m\d+/.test(key) ? "qf" : /_sf\d+m\d+/.test(key) ? "sf" : /_f\d+m\d+/.test(key) ? "f" : "");
  const set = Number(match.set_number || 0);
  const num = Number(match.match_number || 0);
  const maxSlot = EVENT_CONFIG.playoff.bracketSlots;

  if (level === "sf" && set >= 1 && set <= maxSlot) return set;
  if (level === "qf") {
    if (set >= 1 && set <= 4) return set;
    if (num >= 2 && set === 1) return 7;
    if (num >= 2 && set === 2) return 8;
    return null;
  }
  if (level === "sf") {
    if (num === 1 && set === 1) return 5;
    if (num === 1 && set === 2) return 6;
    if (num === 2 && set === 1) return 9;
    if (num === 2 && set === 2) return 10;
    if (num === 3 && set === 1) return 11;
    if (num === 3 && set === 2) return 12;
    return null;
  }
  return null;
}

/** Finals series number (1..3, 4+ for overtime) from a TBA `f` match. Ported from CS parseFinalsSeriesNumber. */
export function finalsSeriesNumber(match: Pick<TbaMatchRaw, "key" | "set_number" | "match_number">): number {
  const keyMatch = String(match.key || "").match(/_f(\d+)m(\d+)/i);
  if (keyMatch) {
    const setNum = Number(keyMatch[1]);
    const matchNum = Number(keyMatch[2]);
    if (setNum >= 14 && setNum <= 16) return setNum - 13;
    if (setNum === 1 && matchNum >= 1 && matchNum <= 3) return matchNum;
    if (setNum >= 1 && setNum <= 3 && matchNum === 1) return setNum;
  }
  const setNum = Number(match.set_number || 0);
  const matchNum = Number(match.match_number || 0);
  if (setNum >= 14 && setNum <= 16) return setNum - 13;
  if (setNum >= 1 && setNum <= 3 && matchNum === 1) return setNum;
  if (matchNum >= 1 && matchNum <= 3) return matchNum;
  return matchNum || 1;
}

/**
 * D11: the `matchNumber` an app Playoff match carries. Bracket matches use their slot 1..13;
 * finals f1..f3 use 14..16 (overtime finals continue 17, 18). Null when the TBA match is not part
 * of the double-elimination bracket (eighths, unrecognised shapes).
 */
export function playoffMatchNumber(match: Pick<TbaMatchRaw, "comp_level" | "set_number" | "match_number" | "key">): number | null {
  if (match.comp_level === "f") return EVENT_CONFIG.playoff.finalsOffset + finalsSeriesNumber(match);
  if (match.comp_level === "qf" || match.comp_level === "sf") return mapPlayoffToBracketSlot(match);
  return null;
}

/** App `matchNumber` for any TBA match (qm and pr use the TBA match number), or null to skip it. */
export function appMatchNumber(match: TbaMatchRaw): number | null {
  if (match.comp_level === "qm" || match.comp_level === "pr") return match.match_number;
  return playoffMatchNumber(match);
}

function describe(match: TbaMatchRaw, type: MatchType, matchNumber: number): string {
  if (type === "Qualification") return `Qualification ${matchNumber}`;
  if (type === "Practice") return `Practice ${matchNumber}`;
  if (match.comp_level === "f") return `Finals ${matchNumber - EVENT_CONFIG.playoff.finalsOffset}`;
  return `Match ${matchNumber}`;
}

function toScore(value: number | null | undefined, completed: boolean): number | null {
  // TBA reports -1 for an unplayed match.
  return completed && typeof value === "number" && value >= 0 ? value : null;
}

function toPenalty(match: TbaMatchRaw, side: "red" | "blue"): number | null {
  const breakdown = match.score_breakdown?.[side];
  if (!breakdown) return null;
  return Number(breakdown.foulPoints || 0);
}

function isoFromSeconds(seconds: number): string | null {
  return seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
}

/** One TBA match -> EventMatch, or null when it has no app match number (skipped). */
export function toEventMatch(match: TbaMatchRaw): EventMatch | null {
  const type = matchTypeForCompLevel(match.comp_level);
  const matchNumber = type ? appMatchNumber(match) : null;
  if (!type || matchNumber === null) return null;

  const completed = isTbaMatchCompleted(match);
  const redScore = toScore(match.alliances?.red?.score, completed);
  const blueScore = toScore(match.alliances?.blue?.score, completed);
  return {
    id: `${type}-${matchNumber}`,
    matchNumber,
    type,
    description: describe(match, type, matchNumber),
    series: type === "Playoff" ? matchNumber : null,
    played: completed && redScore !== null && blueScore !== null,
    redTeams: teamNumbersFromKeys(match.alliances?.red?.team_keys),
    blueTeams: teamNumbersFromKeys(match.alliances?.blue?.team_keys),
    redScore,
    blueScore,
    redPenaltyPoints: completed ? toPenalty(match, "red") : null,
    bluePenaltyPoints: completed ? toPenalty(match, "blue") : null,
    startTime: isoFromSeconds(getTbaScheduleTime(match)),
  };
}

/**
 * Maps and filters a whole TBA match list to one app match type, sorted by `matchNumber`. Two TBA
 * matches can claim one number (a replayed bracket match is `sf3m1` then `sf3m2`); the latest
 * replay wins, since the earlier result was voided.
 */
export function toEventMatches(raw: TbaMatchRaw[], wanted: Exclude<MatchType, "Practice">): EventMatch[] {
  const best = new Map<number, { source: TbaMatchRaw; mapped: EventMatch }>();
  for (const source of raw) {
    if (matchTypeForCompLevel(source.comp_level) !== wanted) continue;
    const mapped = toEventMatch(source);
    if (!mapped) continue;
    const existing = best.get(mapped.matchNumber);
    if (!existing || replayOrder(source) >= replayOrder(existing.source)) best.set(mapped.matchNumber, { source, mapped });
  }
  return Array.from(best.values())
    .map((entry) => entry.mapped)
    .sort((a, b) => a.matchNumber - b.matchNumber);
}

function replayOrder(match: TbaMatchRaw): number {
  return (COMP_LEVEL_ORDER[match.comp_level] ?? 9) * 10_000 + Number(match.match_number || 0);
}
