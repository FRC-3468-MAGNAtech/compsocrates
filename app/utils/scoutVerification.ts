import { calculateScoutAccuracy } from "@/app/utils/scoutAccuracy";

export type VerificationMetric = {
  key: string;
  label: string;
  tolerance: number;
};

export type VerificationResult = {
  verified: boolean;
  accuracy: number;
  matchedMetrics: number;
  totalMetrics: number;
  mismatches: Array<{ key: string; label: string; junior: number; lead: number; delta: number }>;
};

export const DEFAULT_VERIFICATION_METRICS: VerificationMetric[] = [
  { key: "auto.estimatedFuel", label: "Auto Fuel", tolerance: 2 },
  { key: "teleop.estimatedFuel", label: "Teleop Fuel", tolerance: 4 },
  { key: "endgame.estimatedFuel", label: "Endgame Fuel", tolerance: 2 },
  { key: "auto.successfulClimb", label: "Auto Climb", tolerance: 0 },
  { key: "endgame.status", label: "Endgame Status", tolerance: 0 },
];

function readPath(entry: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, part) => {
    if (!acc || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[part];
  }, entry);
}

function normalizeComparable(value: unknown): number {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value || "").trim().toLowerCase();
  if (!text || text === "none" || text === "not parked") return 0;
  if (text === "level-1" || text.includes("shallow") || text.includes("park")) return 1;
  if (text === "level-2") return 2;
  if (text === "level-3" || text.includes("deep")) return 3;
  return Number(text) || 0;
}

export function compareScoutToLead(
  juniorEntry: Record<string, unknown>,
  leadEntry: Record<string, unknown>,
  metrics: VerificationMetric[] = DEFAULT_VERIFICATION_METRICS,
  threshold = 0.85
): VerificationResult {
  const mismatches: VerificationResult["mismatches"] = [];
  let matchedMetrics = 0;

  metrics.forEach((metric) => {
    const junior = normalizeComparable(readPath(juniorEntry, metric.key));
    const lead = normalizeComparable(readPath(leadEntry, metric.key));
    const delta = Math.abs(junior - lead);
    if (delta <= metric.tolerance) {
      matchedMetrics += 1;
      return;
    }
    mismatches.push({ key: metric.key, label: metric.label, junior, lead, delta });
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

export function buildVerificationAccuracy(previous: number[], nextAccuracyPercent: number) {
  const inputs = [...previous, nextAccuracyPercent].map((accuracy) => ({
    accuracy: Math.max(0, Math.min(1, accuracy / 100)),
    environment: "real" as const,
  }));
  return calculateScoutAccuracy(inputs, { minMatches: 3, highAccuracyThreshold: 0.9 });
}
