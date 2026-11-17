import { CURRENT_GAME_ID, PREDICTION } from "@/config/games";
import type { OfficialMatch } from "@/lib/analytics/match-breakdown";
import { MATCH_TYPE_PREFIX, matchSortValue } from "@/lib/analytics/game-schema";
import { docsForGame } from "@/lib/analytics/cs-docs";
import { getGamePlugin } from "@/lib/games/registry";
import type { ConfidenceTier, CsDoc, GameId, PredictionSource, TacticalPrediction } from "@/lib/games/types";
import type { ScoutEntry } from "@/lib/scout-entries";

// Pure model behind Match Prediction (CS app/analytics/match-prediction + predictionEngine.ts). The calculation itself is the
// game plugin's `predict`; this module picks the history it runs on and shapes the schedule it is shown against.

export const PREDICTION_SOURCES: ReadonlyArray<{ value: PredictionSource; label: string }> = [
  { value: "official", label: "Official Event Data" },
  { value: "practice", label: "Practice Scouted Data" },
  { value: "combined", label: "Combined Hybrid" },
];

export const CONFIDENCE_TIERS: readonly ConfidenceTier[] = PREDICTION.confidenceTiers;
export const DEFAULT_CONFIDENCE_TIER: ConfidenceTier = PREDICTION.defaultConfidenceTier;

export const isPredictionSource = (v: string): v is PredictionSource => PREDICTION_SOURCES.some((s) => s.value === v);

export type PredictionHistory = {
  docs: CsDoc[];
  /** Entries left out: other games, and games whose documents cannot be rebuilt (read-only games). */
  skipped: number;
};

/**
 * The scouting history predictions run on: every entry of the game the prediction is for (all events, official and practice, as
 * CS reads the whole `scouting` history), minus entries excluded from stats. The source filter is applied by the plugin.
 */
export function predictionHistory(entries: readonly ScoutEntry[], gameId: GameId = CURRENT_GAME_ID): PredictionHistory {
  const { items, skipped } = docsForGame(
    entries.filter((e) => !e.excluded),
    gameId
  );
  return { docs: items.map((i) => i.doc), skipped };
}

/** One prediction per team number, by the game plugin. */
export function predictTeams(teams: Iterable<string>, docs: readonly CsDoc[], source: PredictionSource, tier: ConfidenceTier, gameId: GameId = CURRENT_GAME_ID): Map<string, TacticalPrediction> {
  const plugin = getGamePlugin(gameId);
  const out = new Map<string, TacticalPrediction>();
  for (const team of teams) out.set(team, plugin.predict(team, docs, source, tier));
  return out;
}

export type ScheduleMatch = {
  key: string;
  /** "Qualification 12". */
  title: string;
  red: string[];
  blue: string[];
};

const TYPE_TITLE = { Practice: "Practice", Qualification: "Qualification", Playoff: "Playoff" } as const;

/** The schedule in play order (practice, qualification, playoff), with the team numbers of each alliance as strings. */
export function scheduleMatches(matches: readonly OfficialMatch[]): ScheduleMatch[] {
  return [...matches]
    .sort((a, b) => matchSortValue(a) - matchSortValue(b) || a.eventCode.localeCompare(b.eventCode))
    .map((m) => ({
      key: `${m.eventCode}|${m.matchType}|${m.matchNumber}`,
      title: `${TYPE_TITLE[m.matchType]} ${m.matchNumber}`,
      red: m.red.teams.map(String),
      blue: m.blue.teams.map(String),
    }));
}

export const teamsInSchedule = (matches: readonly ScheduleMatch[]): Set<string> => new Set(matches.flatMap((m) => [...m.red, ...m.blue]));

/** "P3" style short label, kept for screen-reader text where the title is too long. */
export const matchShortLabel = (m: Pick<OfficialMatch, "matchType" | "matchNumber">): string => `${MATCH_TYPE_PREFIX[m.matchType]}${m.matchNumber}`;
