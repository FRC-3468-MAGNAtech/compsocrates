import { METRICS, type AchievementFacts, type MetricId } from "./metrics";

// Session 8: the achievement engine. Pure. A definition is data (a metric id and a threshold); there is no eval and no expression.

export type AchievementScope = "all" | "season";

export type AchievementDefinition = {
  id: string;
  /** Plain text. */
  name: string;
  /** Plain text. */
  description: string;
  /** A glyph name: a built-in glyph (profile badge icons) or an icon from the app's icon set (lib/sidebar/icons.ts). */
  icon: string;
  metric: MetricId;
  /** Whole number, 1 to 100000. */
  threshold: number;
  scope: AchievementScope;
  /** For averaged metrics: how many samples are needed before a value counts. Default 1. */
  minSamples?: number;
  hidden: boolean;
};

export type AchievementProgress = {
  current: number;
  target: number;
  /** current / target, capped at 1. */
  ratio: number;
  earned: boolean;
  /** True when there is nothing to measure yet (no data, too few samples): current is shown as 0 but is NOT a measured 0. */
  noData: boolean;
};

/**
 * One definition against one person's facts. Returns null when the definition cannot be measured at all (a metric that no longer exists,
 * or a season scope on a metric without one): the caller skips it, it never throws.
 */
export function evaluate(def: AchievementDefinition, facts: AchievementFacts): AchievementProgress | null {
  const metric = Object.hasOwn(METRICS, def.metric) ? METRICS[def.metric] : null;
  if (!metric) return null;
  if (def.scope === "season" && !metric.seasonScope) return null;
  const entry = facts[def.metric];
  const measured = def.scope === "season" ? (entry?.season ?? null) : (entry?.all ?? null);
  const target = def.threshold;
  const needed = Math.max(1, def.minSamples ?? 1);
  if (!measured || measured.value === null || (metric.usesSamples && measured.samples < needed)) return { current: 0, target, ratio: 0, earned: false, noData: true };
  const ratio = target > 0 ? Math.min(1, Math.max(0, measured.value / target)) : 0;
  return { current: measured.value, target, ratio, earned: measured.value >= target, noData: false };
}
