// Session 8: the METRICS an achievement can measure. Every metric is something the app already computes for one person from data the
// profile page already loads (team-wide reads, client-side filter). Pure: no React, no Firebase. A definition names a metric by id
// and a threshold; nothing here evaluates an expression.

export const METRIC_IDS = [
  "practice-sessions",
  "longest-streak",
  "events-attended",
  "scout-entries",
  "best-accuracy",
  "average-accuracy",
  "excellent-categories",
  "perfect-entries",
] as const;
export type MetricId = (typeof METRIC_IDS)[number];

export type MetricCategory = "Practice" | "Accuracy" | "Events and scouting";

export type MetricDef = {
  id: MetricId;
  label: string;
  /** Plural unit shown next to a number ("sessions", "%"). */
  unit: string;
  /** One line for the editor's metric picker. */
  help: string;
  category: MetricCategory;
  /** Can the metric be limited to the program's current season? (Practice sessions carry no season, so they cannot.) */
  seasonScope: boolean;
  /** Is the value an average over samples, so "minimum samples" applies? */
  usesSamples: boolean;
};

export const METRICS: Record<MetricId, MetricDef> = {
  "practice-sessions": { id: "practice-sessions", label: "Practice sessions completed", unit: "sessions", help: "Solo practice sessions you finished (Trial and Competitive).", category: "Practice", seasonScope: false, usesSamples: false },
  "longest-streak": { id: "longest-streak", label: "Longest practice streak", unit: "days", help: "Your longest run of days with a practice session.", category: "Practice", seasonScope: false, usesSamples: false },
  "events-attended": { id: "events-attended", label: "Events attended", unit: "events", help: "Events whose attendance list includes you.", category: "Events and scouting", seasonScope: true, usesSamples: false },
  "scout-entries": { id: "scout-entries", label: "Matches scouted", unit: "matches", help: "Event and live scouting entries you submitted (practice and excluded entries do not count).", category: "Events and scouting", seasonScope: true, usesSamples: false },
  "best-accuracy": { id: "best-accuracy", label: "Best practice accuracy", unit: "%", help: "Your best single practice session, rounded to a whole percent.", category: "Accuracy", seasonScope: false, usesSamples: false },
  "average-accuracy": { id: "average-accuracy", label: "Average practice accuracy", unit: "%", help: "Your average over practice sessions that have an accuracy (a session with none is skipped, never counted as 0).", category: "Accuracy", seasonScope: false, usesSamples: true },
  "excellent-categories": { id: "excellent-categories", label: "Categories at Excellent status", unit: "categories", help: "How many of Trial, Competitive and Real Event are at Excellent accuracy status.", category: "Accuracy", seasonScope: false, usesSamples: false },
  "perfect-entries": { id: "perfect-entries", label: "Entries scouted at 100%", unit: "entries", help: "Event or live entries with a complete accuracy of 100%.", category: "Accuracy", seasonScope: false, usesSamples: false },
};

export const isMetricId = (v: unknown): v is MetricId => typeof v === "string" && Object.hasOwn(METRICS, v);

/** One measurement. `value` is null when there is nothing to measure yet (never 0 for "no data"); `samples` is how many things it was measured over. */
export type MetricValue = { value: number | null; samples: number };

/** What the engine reads: per metric, the all-time value and (when the program and metric support it) the current-season value. */
export type AchievementFacts = Partial<Record<MetricId, { all: MetricValue; season: MetricValue | null }>>;

/** The metrics a program offers (its config: `achievementMetrics`, "all" or a list). Unknown ids are ignored. */
export function metricsForProgram(allowed: "all" | readonly string[] | undefined): MetricId[] {
  if (allowed === undefined || allowed === "all") return [...METRIC_IDS];
  return METRIC_IDS.filter((id) => allowed.includes(id));
}
