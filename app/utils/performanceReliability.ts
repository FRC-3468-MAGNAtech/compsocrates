import {
  entryMatchesAnalyticsFilters,
  isPracticeScoutedEntry,
  normalizeMatchLabel,
  type AnalyticsEventOption,
  type AnalyticsGame,
} from "@/app/utils/analyticsEvents";
import { compareMatchLabels } from "@/app/utils/sortHelpers";
import { scoreEntryForGame, type ScoringEntry } from "@/app/utils/analyticsScoring";

export type PerformanceReliabilityEntry = ScoringEntry & {
  id?: string;
  eventKey?: string;
  eventName?: string;
  matchKey?: string;
  matchLabel?: string;
  matchId?: string;
  matchNumber?: string;
  matchType?: string;
  submittedAt?: number;
  timestamp?: number;
  teamNumber?: string;
  accuracy?: number;
  excludeFromStats?: boolean;
  game?: string;
  practiceMode?: string;
  isPracticeScouting?: boolean;
  practiceSessionId?: string;
};

export type TeamReliabilityPoint = {
  matchLabel: string;
  score: number;
};

export type TeamReliabilityStats = {
  teamNumber: string;
  avgScore: number;
  stdDev: number;
  entriesCount: number;
  scores: TeamReliabilityPoint[];
};

export type PerformanceReliabilityResult = {
  filteredEntries: PerformanceReliabilityEntry[];
  teamStats: TeamReliabilityStats[];
};

const DEFAULT_SAMPLE_WARNING_THRESHOLD = 3;

function getMatchLabel(entry: PerformanceReliabilityEntry) {
  const raw =
    String(entry.matchLabel || "").trim() ||
    String(entry.matchId || "").trim() ||
    String(entry.matchKey || "").trim() ||
    String(entry.matchNumber || "").trim();
  if (!raw) return "-";

  const normalized = normalizeMatchLabel(raw);
  const type = entry.matchType ? String(entry.matchType).toLowerCase() : normalized.matchType;
  const prefix = type === "practice" ? "P" : type === "finals" ? "F" : "Q";
  return `${prefix}${normalized.matchNumber}`;
}

function calculateStdDev(values: number[]) {
  if (values.length === 0) return 0;
  const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function getProcessedTeamStats(
  entries: PerformanceReliabilityEntry[],
  options: {
    accuracyThreshold: number;
    game: AnalyticsGame;
    selectedEvent: string;
    practiceMatchesOnly: boolean;
    rebuiltEventOptions?: AnalyticsEventOption[];
    sampleWarningThreshold?: number;
  }
): PerformanceReliabilityResult {
  const {
    accuracyThreshold,
    game,
    selectedEvent,
    practiceMatchesOnly,
    rebuiltEventOptions = [],
  } = options;

  const filteredEntries = entries.filter((entry) => {
    if (entry.excludeFromStats) return false;
    if (!entryMatchesAnalyticsFilters(entry, game, selectedEvent, game === "REBUILT" ? rebuiltEventOptions : undefined)) {
      return false;
    }
    if (practiceMatchesOnly) {
      if (!isPracticeScoutedEntry(entry)) return false;
    } else if (isPracticeScoutedEntry(entry)) {
      return false;
    }

    const accuracy = typeof entry.accuracy === "number" ? entry.accuracy : NaN;
    if (!Number.isFinite(accuracy)) return false;
    return accuracy >= accuracyThreshold;
  });

  const byTeam = new Map<string, { scores: TeamReliabilityPoint[]; numericScores: number[] }>();
  filteredEntries.forEach((entry) => {
    const teamNumber = String(entry.teamNumber || "").trim();
    if (!teamNumber) return;
    const score = scoreEntryForGame(entry, game);
    const label = getMatchLabel(entry);
    const existing = byTeam.get(teamNumber) || { scores: [], numericScores: [] };
    existing.scores.push({ matchLabel: label, score });
    existing.numericScores.push(score);
    byTeam.set(teamNumber, existing);
  });

  const teamStats: TeamReliabilityStats[] = Array.from(byTeam.entries()).map(([teamNumber, data]) => {
    const avg = data.numericScores.length > 0 ? data.numericScores.reduce((sum, v) => sum + v, 0) / data.numericScores.length : 0;
    const stdDev = calculateStdDev(data.numericScores);
    const sortedScores = data.scores.slice().sort((a, b) => compareMatchLabels(a.matchLabel, b.matchLabel, "asc"));
    return {
      teamNumber,
      avgScore: avg,
      stdDev,
      entriesCount: data.numericScores.length,
      scores: sortedScores,
    };
  });

  const sampleThreshold = options.sampleWarningThreshold ?? DEFAULT_SAMPLE_WARNING_THRESHOLD;
  teamStats.sort((a, b) => {
    if (a.entriesCount !== b.entriesCount) return b.entriesCount - a.entriesCount;
    if (a.entriesCount >= sampleThreshold || b.entriesCount >= sampleThreshold) {
      return b.avgScore - a.avgScore;
    }
    return a.teamNumber.localeCompare(b.teamNumber);
  });

  return { filteredEntries, teamStats };
}
