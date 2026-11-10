/**
 * Game-independent helpers shared by the plugins. Faithful ports of CS's pure logic:
 * scoutVerification.ts (`compareScoutToLead`), predictionEngine.ts (`buildTacticalPrediction`),
 * rescoutComparison.ts (`computeRescoutDiff`). Tunable numbers live in `config/games/shared.ts`.
 */
import {
  DEFAULT_VERIFICATION_METRICS,
  PREDICTION,
  VERIFICATION_STATUS_LEVELS,
  VERIFICATION_THRESHOLD,
  type RescoutFieldSpec,
} from "@/config/games/shared";
import type {
  ConfidenceTier,
  CsDoc,
  PredictionSource,
  RescoutDiff,
  RescoutField,
  TacticalPrediction,
  VerificationMetric,
  VerificationResult,
} from "@/lib/games/types";

/** CS's ubiquitous `Number(value || 0)` (NaN stays NaN, exactly as CS). */
export function num(value: unknown): number {
  return Number(value || 0);
}

/** `Number(value || 0)` that falls back to 0 for non-finite results (scoutingFlags.ts `toNumber`). */
export function finiteNum(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Read a dotted path (`auto.estimatedFuel`) from a CS doc. */
export function readPath(doc: CsDoc, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, part) => {
    if (!acc || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[part];
  }, doc);
}

/** Normalise a CS `game` string for matching: trim, upper-case, spaces and dashes to underscores. */
export function normalizeGameName(value: unknown): string {
  return String(value ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
}

// ---------------------------------------------------------------------------------------------------------------------
// Verification (scoutVerification.ts)
// ---------------------------------------------------------------------------------------------------------------------

function normalizeComparable(value: unknown): number {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value || "").trim().toLowerCase();
  const levels = VERIFICATION_STATUS_LEVELS;
  if ((levels.none as readonly string[]).includes(text)) return 0;
  if (text === levels.level1.equals || levels.level1.includes.some((part) => text.includes(part))) return 1;
  if (text === levels.level2.equals) return 2;
  if (text === levels.level3.equals || levels.level3.includes.some((part) => text.includes(part))) return 3;
  return Number(text) || 0;
}

export function compareScoutToLead(
  junior: CsDoc,
  lead: CsDoc,
  metrics: readonly VerificationMetric[] = DEFAULT_VERIFICATION_METRICS,
  threshold: number = VERIFICATION_THRESHOLD,
): VerificationResult {
  const mismatches: VerificationResult["mismatches"] = [];
  let matchedMetrics = 0;

  metrics.forEach((metric) => {
    const j = normalizeComparable(readPath(junior, metric.key));
    const l = normalizeComparable(readPath(lead, metric.key));
    const delta = Math.abs(j - l);
    if (delta <= metric.tolerance) {
      matchedMetrics += 1;
      return;
    }
    mismatches.push({ key: metric.key, label: metric.label, junior: j, lead: l, delta });
  });

  const totalMetrics = metrics.length || 1;
  const accuracy = matchedMetrics / totalMetrics;
  return {
    verified: accuracy >= threshold,
    accuracy: Math.round(accuracy * 100),
    matchedMetrics,
    totalMetrics,
    mismatches,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Prediction (predictionEngine.ts)
// ---------------------------------------------------------------------------------------------------------------------

function sourceMatches(doc: CsDoc, source: PredictionSource): boolean {
  const isPractice = Boolean(doc.isPracticeScouting || doc.practiceMode || doc.matchType === "practice");
  if (source === "official") return !isPractice;
  if (source === "practice") return isPractice;
  return true;
}

function percentile(values: number[], confidence: ConfidenceTier): number {
  if (values.length === 0) return 0;
  const ordered = values.slice().sort((a, b) => a - b);
  const index = Math.max(0, Math.min(ordered.length - 1, Math.ceil((confidence / 100) * ordered.length) - 1));
  return ordered[index] || 0;
}

export function buildTacticalPrediction(
  teamNumber: string,
  docs: readonly CsDoc[],
  source: PredictionSource,
  confidenceTier: ConfidenceTier,
  scoreTotal: (doc: CsDoc) => number,
): TacticalPrediction {
  const safeTeam = String(teamNumber || "").trim();
  const rows = docs.filter((doc) => String(doc.teamNumber || "").trim() === safeTeam && sourceMatches(doc, source));
  const scores = rows.map(scoreTotal).filter((score) => Number.isFinite(score));
  const statusOf = (doc: CsDoc) => String(asRecord(doc.endgame).status || "").trim();
  const autoClimbed = (doc: CsDoc) => Boolean(asRecord(doc.auto).successfulClimb);
  const climbRows = rows.filter((doc) => Boolean(autoClimbed(doc) || statusOf(doc)));
  const successPattern = new RegExp(PREDICTION.climbSuccessStatusPattern, "i");
  const climbSuccesses = climbRows.filter((doc) => autoClimbed(doc) || successPattern.test(statusOf(doc))).length;
  const average = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0;
  const conservativeEstimate = Math.round((average + percentile(scores, confidenceTier)) / (scores.length > 1 ? 2 : 1));
  const role: TacticalPrediction["role"] =
    conservativeEstimate >= PREDICTION.offenseMinPoints
      ? "Offense"
      : climbSuccesses >= Math.max(1, Math.ceil(rows.length * PREDICTION.feederMinClimbShare))
        ? "Feeder"
        : "Defense";
  const startingPosition =
    rows.map((doc) => String(doc.startingPosition || "").trim()).filter(Boolean)[0] ||
    (role === "Defense" ? PREDICTION.fallbackStartingPosition.defense : PREDICTION.fallbackStartingPosition.other);

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

// ---------------------------------------------------------------------------------------------------------------------
// Rescout comparison (rescoutComparison.ts)
// ---------------------------------------------------------------------------------------------------------------------

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value === "boolean") return value ? 1 : 0;
  return 0;
}

function compareField(spec: RescoutFieldSpec, original: unknown, exemplar: unknown): RescoutField {
  const { key, label, weight } = spec;
  switch (spec.kind) {
    case "number": {
      const orig = toNumber(original);
      const ex = toNumber(exemplar);
      const diff = Math.abs(orig - ex) / Math.max(1, Math.abs(orig));
      return { key, label, original: orig, exemplar: ex, diff, weight };
    }
    case "boolean": {
      const orig = Boolean(original);
      const ex = Boolean(exemplar);
      return { key, label, original: orig, exemplar: ex, diff: orig === ex ? 0 : 1, weight };
    }
    case "string": {
      const orig = String(original ?? "").trim();
      const ex = String(exemplar ?? "").trim();
      return { key, label, original: orig, exemplar: ex, diff: orig.toLowerCase() === ex.toLowerCase() ? 0 : 1, weight };
    }
    case "array": {
      const origArray = Array.isArray(original) ? original.map(toNumber) : [];
      const exArray = Array.isArray(exemplar) ? exemplar.map(toNumber) : [];
      const avg = (values: number[]) => (values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0);
      const origAvg = avg(origArray);
      const diff = Math.abs(origAvg - avg(exArray)) / Math.max(1, Math.abs(origAvg));
      return { key, label, original: origArray, exemplar: exArray, diff, weight };
    }
  }
}

export function computeRescoutDiff(original: CsDoc, exemplar: CsDoc, specs: readonly RescoutFieldSpec[]): RescoutDiff {
  const fields = specs.map((spec) => compareField(spec, readPath(original, spec.key), readPath(exemplar, spec.key)));
  const totalWeight = fields.reduce((sum, f) => sum + f.weight, 0) || 1;
  const weightedDiff = fields.reduce((sum, f) => sum + f.diff * f.weight, 0);
  const diffPercent = Math.round((weightedDiff / totalWeight) * 1000) / 10;
  return { diffPercent, fields };
}
