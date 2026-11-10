/**
 * Scout accuracy score. Port of CS app/utils/scoutAccuracy.ts and `buildVerificationAccuracy`
 * (app/utils/scoutVerification.ts). Constants live in `config/games/shared.ts` (SCOUT_ACCURACY).
 */
import { SCOUT_ACCURACY } from "@/config/games/shared";

export type ScoutAccuracyEnvironment = "trial" | "competitive" | "real";
export type ScoutAccuracyConfidence = "low" | "medium" | "high";
export type ScoutAccuracyStatus =
  | "undetermined"
  | "mentor-intervention"
  | "student-intervention"
  | "certified"
  | "good"
  | "excellent";

export type ScoutAccuracyInput = {
  /** 0..1 */
  accuracy: number;
  environment: ScoutAccuracyEnvironment;
};

export type ScoutAccuracyResult = {
  displayAccuracy: number;
  confidenceLevel: ScoutAccuracyConfidence;
  status: ScoutAccuracyStatus;
  confirmed: boolean;
  highAccuracyMatches: number;
  totalMatches: number;
  weightedAverage: number;
};

export type ScoutAccuracyOptions = {
  priorMatches?: number;
  priorAccuracy?: number;
  minMatches?: number;
  highAccuracyThreshold?: number;
  lowAccuracyThreshold?: number;
  highConfidenceBonus?: number;
  lowAccuracyPenalty?: number;
  mode?: ScoutAccuracyEnvironment;
};

/** 1 - |scouted - official| / official, clamped to 0..1. Null when either total is not finite or official <= 0. */
export function calculateMatchAccuracyFromTotals(scoutedTotal: number, officialTotal: number): number | null {
  if (!Number.isFinite(scoutedTotal) || !Number.isFinite(officialTotal)) return null;
  if (officialTotal <= 0) return null;
  const base = 1 - Math.abs(scoutedTotal - officialTotal) / officialTotal;
  return Math.max(0, Math.min(1, base));
}

export function calculateScoutAccuracy(inputs: ScoutAccuracyInput[], options: ScoutAccuracyOptions = {}): ScoutAccuracyResult {
  const {
    priorMatches = SCOUT_ACCURACY.priorMatches,
    priorAccuracy = SCOUT_ACCURACY.priorAccuracy,
    minMatches = SCOUT_ACCURACY.minMatches,
    highAccuracyThreshold = SCOUT_ACCURACY.highAccuracyThreshold,
    lowAccuracyThreshold = SCOUT_ACCURACY.lowAccuracyThreshold,
    highConfidenceBonus = SCOUT_ACCURACY.highConfidenceBonus,
    lowAccuracyPenalty = SCOUT_ACCURACY.lowAccuracyPenalty,
    mode = "real",
  } = options;

  let weightedSum = 0;
  let weightTotal = 0;
  let highAccuracyMatches = 0;
  let matchCount = 0;

  inputs.forEach((input) => {
    const accuracy = Number(input.accuracy);
    if (!Number.isFinite(accuracy)) return;
    let weight: number = SCOUT_ACCURACY.environmentWeights[input.environment] ?? 1;
    if (accuracy >= highAccuracyThreshold) {
      weight *= highConfidenceBonus;
      highAccuracyMatches += 1;
    } else if (accuracy < lowAccuracyThreshold) {
      weight *= lowAccuracyPenalty;
    }
    weightedSum += accuracy * weight;
    weightTotal += weight;
    matchCount += 1;
  });

  if (matchCount === 0) {
    return {
      displayAccuracy: 0,
      confidenceLevel: "low",
      status: "undetermined",
      confirmed: false,
      highAccuracyMatches: 0,
      totalMatches: 0,
      weightedAverage: 0,
    };
  }

  const rawAverage = weightTotal > 0 ? weightedSum / weightTotal : 0;
  const bayesAverage = (rawAverage * weightTotal + priorAccuracy * priorMatches) / (weightTotal + priorMatches);
  const displayAccuracy = Math.round(bayesAverage * 100);
  const confirmed = matchCount >= minMatches;

  let confidenceLevel: ScoutAccuracyConfidence = "low";
  if (highAccuracyMatches >= SCOUT_ACCURACY.confidence.highMinHighAccuracyMatches) confidenceLevel = "high";
  else if (highAccuracyMatches >= SCOUT_ACCURACY.confidence.mediumMinHighAccuracyMatches) confidenceLevel = "medium";

  let status: ScoutAccuracyStatus;
  if (mode === "competitive") {
    const t = SCOUT_ACCURACY.statusThresholds.competitive;
    status = displayAccuracy >= t.certified ? "certified" : displayAccuracy >= t.studentIntervention ? "student-intervention" : "mentor-intervention";
  } else {
    const t = SCOUT_ACCURACY.statusThresholds.default;
    status =
      displayAccuracy >= t.excellent
        ? "excellent"
        : displayAccuracy >= t.good
          ? "good"
          : displayAccuracy >= t.studentIntervention
            ? "student-intervention"
            : "mentor-intervention";
  }

  return { displayAccuracy, confidenceLevel, status, confirmed, highAccuracyMatches, totalMatches: matchCount, weightedAverage: rawAverage };
}

/** Fold a new verification result (percent) into a scout's running accuracy (scoutVerification.ts). */
export function buildVerificationAccuracy(previous: number[], nextAccuracyPercent: number): ScoutAccuracyResult {
  const inputs: ScoutAccuracyInput[] = [...previous, nextAccuracyPercent].map((accuracy) => ({
    accuracy: Math.max(0, Math.min(1, accuracy / 100)),
    environment: "real",
  }));
  return calculateScoutAccuracy(inputs, SCOUT_ACCURACY.verification);
}

/** Population standard deviation of match scores (performanceReliability.ts `calculateStdDev`). */
export function scoreStdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}
