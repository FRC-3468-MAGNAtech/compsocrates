import { ANALYTICS_THRESHOLDS } from "@/config/games";
import type { AnalyticsEntry } from "@/lib/analytics/entries";
import { formatMatch, matchSortValue } from "@/lib/analytics/game-schema";
import { scoreStdDev } from "@/lib/games/accuracy";

// Pure model behind Performance Reliability (CS app/utils/performanceReliability.ts `getProcessedTeamStats`). The entry filtering
// (game, event, practice, accuracy, excluded) is the shared Analytics selection's, so this only groups and measures.

export const SAMPLE_WARNING_THRESHOLD: number = ANALYTICS_THRESHOLDS.sampleWarning;

export type ReliabilityPoint = {
  entryId: string;
  /** "Q12". */
  matchLabel: string;
  score: number;
};

export type TeamReliability = {
  teamNumber: number;
  /** "Power": the mean match score. */
  avgScore: number;
  /** "Consistency": the population standard deviation of the match scores (lower is steadier). */
  stdDev: number;
  entriesCount: number;
  /** In match order. */
  scores: ReliabilityPoint[];
};

export const isLowSample = (entriesCount: number, threshold: number = SAMPLE_WARNING_THRESHOLD): boolean => entriesCount < threshold;

/**
 * One row per team: mean score, standard deviation and the per-match scores in match order. Ordered by most matches first; among
 * teams where either has reached the sample threshold, higher mean first; otherwise by team number (CS's ordering).
 */
export function buildTeamReliability(entries: readonly AnalyticsEntry[], sampleThreshold: number = SAMPLE_WARNING_THRESHOLD): TeamReliability[] {
  const byTeam = new Map<number, AnalyticsEntry[]>();
  for (const entry of entries) {
    if (!Number.isFinite(entry.teamNumber) || entry.teamNumber <= 0) continue;
    const list = byTeam.get(entry.teamNumber);
    if (list) list.push(entry);
    else byTeam.set(entry.teamNumber, [entry]);
  }

  const teams: TeamReliability[] = [...byTeam.entries()].map(([teamNumber, list]) => {
    const ordered = [...list].sort((a, b) => matchSortValue(a) - matchSortValue(b) || a.eventCode.localeCompare(b.eventCode) || a.submittedAt.localeCompare(b.submittedAt));
    const totals = ordered.map((e) => e.score.total);
    return {
      teamNumber,
      avgScore: totals.length ? totals.reduce((sum, v) => sum + v, 0) / totals.length : 0,
      stdDev: scoreStdDev(totals),
      entriesCount: totals.length,
      scores: ordered.map((e) => ({ entryId: e.id, matchLabel: formatMatch(e), score: e.score.total })),
    };
  });

  return teams.sort((a, b) => {
    if (a.entriesCount !== b.entriesCount) return b.entriesCount - a.entriesCount;
    if (a.entriesCount >= sampleThreshold || b.entriesCount >= sampleThreshold) return b.avgScore - a.avgScore;
    return a.teamNumber - b.teamNumber;
  });
}

/** The team a numeric search term names (digits only), when it is one of the listed teams. */
export function teamFromSearch(term: string, teams: readonly Pick<TeamReliability, "teamNumber">[]): number | null {
  const digits = term.replace(/[^0-9]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return teams.some((t) => t.teamNumber === n) ? n : null;
}
