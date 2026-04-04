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
  accuracy: number; // 0..1
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

type ScoutAccuracyOptions = {
  priorMatches?: number;
  priorAccuracy?: number;
  minMatches?: number;
  highAccuracyThreshold?: number;
  lowAccuracyThreshold?: number;
  highConfidenceBonus?: number;
  lowAccuracyPenalty?: number;
  mode?: ScoutAccuracyEnvironment;
};

const ENV_WEIGHTS: Record<ScoutAccuracyEnvironment, number> = {
  trial: 0.5,
  competitive: 0.8,
  real: 1.0,
};

export function calculateMatchAccuracyFromTotals(scoutedTotal: number, officialTotal: number): number | null {
  if (!Number.isFinite(scoutedTotal) || !Number.isFinite(officialTotal)) return null;
  if (officialTotal <= 0) return null;
  const base = 1 - Math.abs(scoutedTotal - officialTotal) / officialTotal;
  return Math.max(0, Math.min(1, base));
}

export function calculateScoutAccuracy(
  inputs: ScoutAccuracyInput[],
  options: ScoutAccuracyOptions = {}
): ScoutAccuracyResult {
  const {
    priorMatches = 5,
    priorAccuracy = 0.8,
    minMatches = 5,
    highAccuracyThreshold = 0.9,
    lowAccuracyThreshold = 0.7,
    highConfidenceBonus = 1.1,
    lowAccuracyPenalty = 0.5,
    mode = "real",
  } = options;

  let weightedSum = 0;
  let weightTotal = 0;
  let highAccuracyMatches = 0;
  let matchCount = 0;

  inputs.forEach((input) => {
    const accuracy = Number(input.accuracy);
    if (!Number.isFinite(accuracy)) return;
    const envWeight = ENV_WEIGHTS[input.environment] ?? 1;
    let weight = envWeight;
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
  const bayesAverage =
    (rawAverage * weightTotal + priorAccuracy * priorMatches) / (weightTotal + priorMatches);
  const displayAccuracy = Math.round(bayesAverage * 100);
  const confirmed = matchCount >= minMatches;

  let confidenceLevel: ScoutAccuracyConfidence = "low";
  if (highAccuracyMatches >= 6) confidenceLevel = "high";
  else if (highAccuracyMatches >= 3) confidenceLevel = "medium";

  let status: ScoutAccuracyStatus = "undetermined";
  if (!confirmed) {
    status = "undetermined";
  } else if (mode === "competitive") {
    if (displayAccuracy >= 80) status = "certified";
    else if (displayAccuracy >= 51) status = "student-intervention";
    else status = "mentor-intervention";
  } else {
    if (displayAccuracy >= 90) status = "excellent";
    else if (displayAccuracy >= 75) status = "good";
    else if (displayAccuracy >= 51) status = "student-intervention";
    else status = "mentor-intervention";
  }

  return {
    displayAccuracy,
    confidenceLevel,
    status,
    confirmed,
    highAccuracyMatches,
    totalMatches: matchCount,
    weightedAverage: rawAverage,
  };
}
