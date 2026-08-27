import { scoreEntryForGame, type ScoringEntry } from "@/app/utils/analyticsScoring";
import type { AnalyticsGame } from "@/app/utils/analyticsEvents";

export type PredictionSource = "official" | "practice" | "combined";
export type ConfidenceTier = 75 | 85 | 90;

export type TacticalPrediction = {
  teamNumber: string;
  startingPosition: string;
  role: "Offense" | "Defense" | "Feeder";
  climbProbability: number;
  estimatedPoints: number;
  sampleSize: number;
  confidenceTier: ConfidenceTier;
};

export type PredictionEntry = ScoringEntry & {
  teamNumber?: string;
  startingPosition?: string;
  isPracticeScouting?: boolean;
  practiceMode?: string;
  matchType?: string;
  game?: string;
  auto?: ScoringEntry["auto"] & { successfulClimb?: boolean };
  endgame?: ScoringEntry["endgame"] & { status?: string };
};

function sourceMatches(entry: PredictionEntry, source: PredictionSource) {
  const isPractice = Boolean(entry.isPracticeScouting || entry.practiceMode || entry.matchType === "practice");
  if (source === "official") return !isPractice;
  if (source === "practice") return isPractice;
  return true;
}

function percentile(values: number[], confidence: ConfidenceTier) {
  if (values.length === 0) return 0;
  const ordered = values.slice().sort((a, b) => a - b);
  const index = Math.max(0, Math.min(ordered.length - 1, Math.ceil((confidence / 100) * ordered.length) - 1));
  return ordered[index] || 0;
}

export function buildTacticalPrediction(
  teamNumber: string,
  entries: PredictionEntry[],
  game: AnalyticsGame,
  source: PredictionSource,
  confidenceTier: ConfidenceTier
): TacticalPrediction {
  const safeTeam = String(teamNumber || "").trim();
  const rows = entries.filter((entry) => String(entry.teamNumber || "").trim() === safeTeam && sourceMatches(entry, source));
  const scores = rows.map((entry) => scoreEntryForGame(entry, game)).filter((score) => Number.isFinite(score));
  const climbRows = rows.filter((entry) => Boolean(entry.auto?.successfulClimb || String(entry.endgame?.status || "").trim()));
  const climbSuccesses = climbRows.filter((entry) => Boolean(entry.auto?.successfulClimb) || /level|deep|shallow|park/i.test(String(entry.endgame?.status || ""))).length;
  const average = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0;
  const conservativeEstimate = Math.round((average + percentile(scores, confidenceTier)) / (scores.length > 1 ? 2 : 1));
  const role = conservativeEstimate >= 25 ? "Offense" : climbSuccesses >= Math.max(1, Math.ceil(rows.length * 0.5)) ? "Feeder" : "Defense";
  const startingPosition =
    rows.map((entry) => String(entry.startingPosition || "").trim()).filter(Boolean)[0] ||
    (role === "Defense" ? "middle" : "outpost-side");

  return {
    teamNumber: safeTeam,
    startingPosition,
    role,
    climbProbability: climbRows.length ? Math.round((climbSuccesses / climbRows.length) * 100) : 0,
    estimatedPoints: conservativeEstimate,
    sampleSize: rows.length,
    confidenceTier,
  };
}
