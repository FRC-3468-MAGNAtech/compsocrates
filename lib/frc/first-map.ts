import type { FtcMatch, FtcRanking, FtcTeam, MatchType } from "@/lib/ftc/types";

/**
 * Pure mappers for the FIRST FRC API v3.0 (practice schedule, plus fallback teams, rankings and
 * qualification schedule). Ported from CS app/utils/firstSchedule.ts and app/api/first/*. The API's
 * field names have varied between payload versions, so rows are read as loose records and every
 * field is tried under its known spellings, exactly as CS does.
 */

export type FirstRow = Record<string, unknown>;

export type FirstScheduleTeam = { teamNumber: number; station: string };

export type FirstScheduleMatch = {
  matchNumber: number;
  /** Seconds since the epoch; 0 when the API gave no usable time. */
  startTime: number;
  tournamentLevel: string;
  description: string | null;
  teams: FirstScheduleTeam[];
  redScore: number | null;
  blueScore: number | null;
};

function asRow(value: unknown): FirstRow | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as FirstRow) : null;
}

/** The first array found under any of `keys` (the API capitalises its envelopes inconsistently). */
export function pickRows(payload: unknown, keys: string[]): FirstRow[] {
  const root = asRow(payload);
  if (!root) return [];
  for (const key of keys) {
    const value = root[key];
    if (Array.isArray(value)) return value.map(asRow).filter((r): r is FirstRow => r !== null);
  }
  return [];
}

export function normalizeStation(team: FirstRow): string {
  const direct = String(team.station || team.teamStation || team.stationId || "").trim();
  if (direct) return direct;
  const color = String(team.stationColor || team.color || team.alliance || "").trim();
  const number = String(team.stationNumber || team.stationNum || team.position || "").trim();
  if (color) return `${color}${number || ""}`.trim();
  return "";
}

/** Epoch seconds from a number (ms or s) or a date string; 0 when unparseable. */
export function parseStartTime(raw: unknown): number {
  if (typeof raw === "number") {
    if (raw > 1_000_000_000_000) return Math.floor(raw / 1000);
    if (raw > 1_000_000_000) return Math.floor(raw);
  }
  const parsed = Date.parse(String(raw || ""));
  return Number.isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
}

function parseScoreValue(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function readScore(row: FirstRow, alliance: "red" | "blue"): number | null {
  const upper = alliance === "red" ? "Red" : "Blue";
  const candidates = [
    `score${upper}Final`,
    `score${upper}FinalScore`,
    `score${upper}FinalPoints`,
    `score${upper}`,
    `${alliance}Score`,
    `${alliance}FinalScore`,
    `${alliance}ScoreFinal`,
    `${upper}Score`,
    `${upper}FinalScore`,
  ];
  for (const key of candidates) {
    const value = parseScoreValue(row[key]);
    if (value !== null) return value;
  }
  const block = asRow(row.alliances ?? row.Alliances);
  const entry = block ? asRow(block[alliance] ?? block[upper]) : null;
  if (entry) {
    const value = parseScoreValue(entry.score ?? entry.finalScore ?? entry.totalScore ?? entry.totalPoints);
    if (value !== null) return value;
  }
  return parseScoreValue(row[`${alliance}AllianceScore`] ?? row[`${upper}AllianceScore`]);
}

export function normalizeScheduleRow(row: FirstRow): FirstScheduleMatch | null {
  const matchNumber = Number(row.matchNumber ?? row.match_number ?? row.match ?? row.matchNo ?? 0);
  if (!Number.isFinite(matchNumber) || matchNumber <= 0) return null;
  const teamsRaw = pickRows(row, ["teams", "Teams"]);
  const teams = teamsRaw
    .map((team) => ({ teamNumber: Number(team.teamNumber ?? team.team ?? 0), station: normalizeStation(team) }))
    .filter((team) => Number.isFinite(team.teamNumber) && team.teamNumber > 0);
  const description = typeof row.description === "string" && row.description.trim() ? row.description.trim() : null;
  return {
    matchNumber,
    startTime: parseStartTime(row.startTime ?? row.startTimeLocal ?? row.startTimeUTC ?? row.time ?? row.matchTime),
    tournamentLevel: String(row.tournamentLevel ?? row.tournament_level ?? row.level ?? row.matchType ?? row.match_type ?? "").trim(),
    description,
    teams,
    redScore: readScore(row, "red"),
    blueScore: readScore(row, "blue"),
  };
}

/** Rows from a `/schedule/{code}` payload (`Schedule`, `schedule` or `matches`), normalised and sorted. */
export function normalizeSchedule(payload: unknown): FirstScheduleMatch[] {
  return pickRows(payload, ["Schedule", "schedule", "matches"])
    .map(normalizeScheduleRow)
    .filter((m): m is FirstScheduleMatch => m !== null)
    .sort((a, b) => a.matchNumber - b.matchNumber);
}

/** Red and blue team numbers from station names ("Red1", "Blue3"). */
export function splitFirstAllianceTeams(match: Pick<FirstScheduleMatch, "teams">): { red: number[]; blue: number[] } {
  const red: number[] = [];
  const blue: number[] = [];
  for (const team of match.teams) {
    const station = String(team.station || "").trim().toLowerCase();
    if (station.startsWith("r") || station.includes("red")) red.push(team.teamNumber);
    else if (station.startsWith("b") || station.includes("blue")) blue.push(team.teamNumber);
  }
  return { red, blue };
}

/** A FIRST schedule row -> FtcMatch of the given app type. Penalties are not in the schedule payload. */
export function firstScheduleToFtcMatch(row: FirstScheduleMatch, type: MatchType): FtcMatch {
  const { red, blue } = splitFirstAllianceTeams(row);
  const played = row.redScore !== null && row.blueScore !== null;
  const label = type === "Practice" ? "Practice" : type === "Qualification" ? "Qualification" : "Match";
  return {
    id: `${type}-${row.matchNumber}`,
    matchNumber: row.matchNumber,
    type,
    description: row.description ?? `${label} ${row.matchNumber}`,
    series: null,
    played,
    redTeams: red,
    blueTeams: blue,
    redScore: row.redScore,
    blueScore: row.blueScore,
    redPenaltyPoints: null,
    bluePenaltyPoints: null,
    startTime: row.startTime > 0 ? new Date(row.startTime * 1000).toISOString() : null,
  };
}

export function firstScheduleToFtcMatches(payload: unknown, type: MatchType): FtcMatch[] {
  return normalizeSchedule(payload).map((row) => firstScheduleToFtcMatch(row, type));
}

/** `/teams?eventCode=` rows -> FtcTeam (fallback when TBA is unavailable). */
export function firstTeamsToFtcTeams(payload: unknown): FtcTeam[] {
  return pickRows(payload, ["teams", "Teams"])
    .map((row): FtcTeam | null => {
      const teamNumber = Number(row.teamNumber ?? 0);
      if (!Number.isFinite(teamNumber) || teamNumber <= 0) return null;
      const short = String(row.nameShort || row.name || `Team ${teamNumber}`);
      return {
        teamNumber,
        nameShort: short,
        nameFull: String(row.nameFull || short),
        city: typeof row.city === "string" ? row.city : null,
        stateProv: typeof row.stateProv === "string" ? row.stateProv : null,
        country: typeof row.country === "string" ? row.country : null,
        rookieYear: typeof row.rookieYear === "number" ? row.rookieYear : null,
      };
    })
    .filter((t): t is FtcTeam => t !== null)
    .sort((a, b) => a.teamNumber - b.teamNumber);
}

/** `/rankings/{code}` rows (`Rankings` or `rankings`) -> FtcRanking (fallback when TBA is unavailable). */
export function firstRankingsToFtcRankings(payload: unknown): FtcRanking[] {
  return pickRows(payload, ["Rankings", "rankings"])
    .map((row): FtcRanking | null => {
      const teamNumber = Number(row.teamNumber ?? 0);
      const rank = Number(row.rank ?? 0);
      if (!Number.isFinite(teamNumber) || teamNumber <= 0 || !Number.isFinite(rank) || rank <= 0) return null;
      const wins = Number(row.wins ?? 0);
      const losses = Number(row.losses ?? 0);
      const ties = Number(row.ties ?? 0);
      const played = Number(row.matchesPlayed ?? wins + losses + ties);
      const rp = parseScoreValue(row.sortOrder1 ?? row.rankingScore);
      return { teamNumber, rank, wins, losses, ties, matchesPlayed: played, rankingPoints: rp };
    })
    .filter((r): r is FtcRanking => r !== null);
}
