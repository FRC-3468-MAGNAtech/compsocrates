export type MetricVisibilityRule = {
  metricId: string;
  label: string;
  public: boolean;
  gameYear: string;
  eventKey: string;
  teamNumber: string;
  matchLevel: "all" | "practice" | "qualification" | "playoff";
};

export type PublicMetricRecord = Record<string, unknown>;

const PRIVATE_IDENTITY_KEYS = new Set([
  "scoutId",
  "scoutName",
  "submittedBy",
  "userId",
  "userEmail",
  "userName",
  "displayName",
  "email",
  "memberId",
  "memberName",
]);

export function sanitizePublicMetricRecord(input: PublicMetricRecord): PublicMetricRecord {
  return Object.fromEntries(
    Object.entries(input).filter(([key]) => !PRIVATE_IDENTITY_KEYS.has(key))
  );
}

export function normalizeMetricVisibilityRules(input: unknown): MetricVisibilityRule[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((row): MetricVisibilityRule | null => {
      if (!row || typeof row !== "object") return null;
      const value = row as Record<string, unknown>;
      const metricId = String(value.metricId || "").trim();
      if (!metricId) return null;
      const level = String(value.matchLevel || "all");
      return {
        metricId,
        label: String(value.label || metricId),
        public: Boolean(value.public),
        gameYear: String(value.gameYear || "all"),
        eventKey: String(value.eventKey || "all"),
        teamNumber: String(value.teamNumber || "all"),
        matchLevel: level === "practice" || level === "qualification" || level === "playoff" ? level : "all",
      };
    })
    .filter((row): row is MetricVisibilityRule => Boolean(row));
}
