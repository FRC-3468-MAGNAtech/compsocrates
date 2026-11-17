import { effectiveAchievements, type AchievementConfig } from "./config";
import { evaluate, type AchievementDefinition, type AchievementProgress } from "./engine";
import { METRICS, type AchievementFacts, type MetricCategory } from "./metrics";

// Session 8: what the Achievements page and the profile section show. Pure. Hidden and unavailable achievements never appear here, so they never
// count in "earned of N" and a custom one whose metric is gone is skipped without an error.

export type AchievementItem = { id: string; def: AchievementDefinition; builtin: boolean; category: MetricCategory; progress: AchievementProgress };
export type AchievementFilter = "all" | "earned" | "in-progress";

export function buildItems(config: AchievementConfig, facts: AchievementFacts, programMetrics: "all" | readonly string[] | undefined): AchievementItem[] {
  const items: AchievementItem[] = [];
  for (const a of effectiveAchievements(config, programMetrics)) {
    if (a.hidden || a.unavailable) continue;
    const progress = evaluate(a.def, facts);
    if (!progress) continue;
    items.push({ id: a.def.id, def: a.def, builtin: a.builtin, category: METRICS[a.def.metric].category, progress });
  }
  return items;
}

/** The filter, then "Next up": unearned first, the closest to done first (no data last), then the earned ones in their display order. */
export function filterAndSort(items: AchievementItem[], filter: AchievementFilter): AchievementItem[] {
  const kept = items.filter((i) => (filter === "earned" ? i.progress.earned : filter === "in-progress" ? !i.progress.earned : true));
  const position = new Map(items.map((i, n) => [i.id, n]));
  return [...kept].sort((a, b) => {
    if (a.progress.earned !== b.progress.earned) return a.progress.earned ? 1 : -1;
    if (!a.progress.earned && a.progress.ratio !== b.progress.ratio) return b.progress.ratio - a.progress.ratio;
    return (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0);
  });
}

export const CATEGORY_ORDER: readonly MetricCategory[] = ["Practice", "Accuracy", "Events and scouting"];

export function groupByCategory(items: AchievementItem[]): { category: MetricCategory; items: AchievementItem[] }[] {
  return CATEGORY_ORDER.map((category) => ({ category, items: items.filter((i) => i.category === category) })).filter((g) => g.items.length > 0);
}

/** Earned count, total shown, and the closest unearned one (null when all are earned, or nothing has been started and there is nothing to point at). */
export function summarize(items: AchievementItem[]): { earned: number; total: number; next: AchievementItem | null } {
  const earned = items.filter((i) => i.progress.earned).length;
  const next = filterAndSort(items, "in-progress")[0] ?? null;
  return { earned, total: items.length, next };
}

/** What another person sees on a profile: earned achievements only, with no progress. */
export const earnedOnly = (items: AchievementItem[]): AchievementItem[] => items.filter((i) => i.progress.earned);
