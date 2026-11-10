/**
 * Game-independent tuning constants that CS applies to every game (declarative config only).
 * Sources: app/utils/scoutVerification.ts, predictionEngine.ts, scoutAccuracy.ts, performanceReliability.ts,
 * stats-calculator.ts, scoutingFlags.ts.
 */

/** A lead scout's entry verifies a junior's when this share of metrics are within tolerance (scoutVerification.ts). */
export const VERIFICATION_THRESHOLD = 0.85;

/** `key` is a dotted path into the CS doc. Identical for every game in CS today. */
export const DEFAULT_VERIFICATION_METRICS = [
  { key: "auto.estimatedFuel", label: "Auto Fuel", tolerance: 2 },
  { key: "teleop.estimatedFuel", label: "Teleop Fuel", tolerance: 4 },
  { key: "endgame.estimatedFuel", label: "Endgame Fuel", tolerance: 2 },
  { key: "auto.successfulClimb", label: "Auto Climb", tolerance: 0 },
  { key: "endgame.status", label: "Endgame Status", tolerance: 0 },
] as const;

/** Text values `normalizeComparable` maps to a number when comparing non-numeric metrics (scoutVerification.ts). */
export const VERIFICATION_STATUS_LEVELS = {
  /** Compared as 0. */
  none: ["", "none", "not parked"],
  /** Compared as 1 when equal to "level-1" or when the text contains one of these fragments. */
  level1: { equals: "level-1", includes: ["shallow", "park"] },
  level2: { equals: "level-2" },
  /** Compared as 3 when equal to "level-3" or when the text contains this fragment. */
  level3: { equals: "level-3", includes: ["deep"] },
} as const;

/** Tactical prediction (predictionEngine.ts). */
export const PREDICTION = {
  confidenceTiers: [75, 85, 90],
  defaultConfidenceTier: 85,
  /** Estimated points at or above this make a team an Offense robot. */
  offenseMinPoints: 25,
  /** Below Offense: Feeder when climb successes reach this share of rows (at least 1), otherwise Defense. */
  feederMinClimbShare: 0.5,
  /** A row counts as a climb success when `endgame.status` matches this (case-insensitive) or `auto.successfulClimb` is set. */
  climbSuccessStatusPattern: "level|deep|shallow|park",
  /** Used when no row records a starting position. */
  fallbackStartingPosition: { defense: "middle", other: "outpost-side" },
} as const;

/** Scout accuracy score (scoutAccuracy.ts). */
export const SCOUT_ACCURACY = {
  environmentWeights: { trial: 0.5, competitive: 0.8, real: 1.0 },
  priorMatches: 5,
  priorAccuracy: 0.8,
  minMatches: 5,
  highAccuracyThreshold: 0.9,
  lowAccuracyThreshold: 0.7,
  highConfidenceBonus: 1.1,
  lowAccuracyPenalty: 0.5,
  /** Verification feeds the accuracy score with these overrides (scoutVerification.ts `buildVerificationAccuracy`). */
  verification: { minMatches: 3, highAccuracyThreshold: 0.9 },
  confidence: { highMinHighAccuracyMatches: 6, mediumMinHighAccuracyMatches: 3 },
  /** Display-accuracy cut-offs per mode. */
  statusThresholds: {
    competitive: { certified: 80, studentIntervention: 51 },
    default: { excellent: 90, good: 75, studentIntervention: 51 },
  },
} as const;

/** Misc analytics thresholds. */
export const ANALYTICS_THRESHOLDS = {
  /** performanceReliability.ts: fewer entries than this is a small sample. */
  sampleWarning: 3,
  /** stats-calculator.ts: a scout whose average accuracy (percent) is at least this counts as ready. */
  readyScoutAccuracyPercent: 80,
  /** scoutingFlags.ts `shouldExcludeEntryFromStats` default minimum accuracy (percent; unused by CS, kept for parity). */
  minimumAccuracyPercent: 75,
} as const;

/** One field in a rescout comparison. `key` is a dotted CS doc path. */
export type RescoutFieldSpec = {
  key: string;
  label: string;
  kind: "number" | "boolean" | "string" | "array";
  weight: number;
};

/** Weight CS gives each kind unless a field overrides it (rescoutComparison.ts). */
export const RESCOUT_DEFAULT_WEIGHTS = { number: 1, boolean: 1, string: 1, array: 0.25 } as const;

const spec = (kind: RescoutFieldSpec["kind"]) => (key: string, label: string, weight: number = RESCOUT_DEFAULT_WEIGHTS[kind]): RescoutFieldSpec => ({
  key,
  label,
  kind,
  weight,
});
export const rescoutNumber = spec("number");
export const rescoutBoolean = spec("boolean");
export const rescoutString = spec("string");
export const rescoutArray = spec("array");
