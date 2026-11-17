import { BUILTIN_ACHIEVEMENTS } from "./builtins";
import { effectiveAchievements, type AchievementConfig, type AchievementOverride } from "./config";
import type { AchievementDefinition } from "./engine";
import type { MetricId } from "./metrics";

// Session 8: the editor's pure operations on a draft config (Admin Panel > Achievements). Nothing here touches the network.

const DEFAULTS = new Map(BUILTIN_ACHIEVEMENTS.map((d) => [d.id, d]));

/** Every achievement id in the order the team sees them. */
export const orderedIds = (config: AchievementConfig): string[] => effectiveAchievements(config, "all").map((a) => a.def.id);

/** Move one achievement a place up (-1) or down (+1). The result lists every id, so the order is explicit from then on. */
export function moveAchievement(config: AchievementConfig, id: string, delta: -1 | 1): AchievementConfig {
  const ids = orderedIds(config);
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length) return config;
  const next = [...ids];
  [next[from], next[to]] = [next[to], next[from]];
  return { ...config, order: next };
}

/** Change a built-in's name, description or hidden flag. A value equal to the default is not stored; no change left removes the override. */
export function setBuiltinOverride(config: AchievementConfig, id: string, patch: AchievementOverride): AchievementConfig {
  const base = DEFAULTS.get(id);
  if (!base) return config;
  const merged: AchievementOverride = { ...config.overrides[id], ...patch };
  const clean: AchievementOverride = {};
  if (merged.name !== undefined && merged.name.trim() !== "" && merged.name !== base.name) clean.name = merged.name;
  if (merged.description !== undefined && merged.description.trim() !== "" && merged.description !== base.description) clean.description = merged.description;
  if (merged.hidden === true) clean.hidden = true;
  const overrides = { ...config.overrides };
  if (Object.keys(clean).length === 0) delete overrides[id];
  else overrides[id] = clean;
  return { ...config, overrides };
}

export const resetBuiltin = (config: AchievementConfig, id: string): AchievementConfig => {
  const overrides = { ...config.overrides };
  delete overrides[id];
  return { ...config, overrides };
};

export function upsertCustom(config: AchievementConfig, def: AchievementDefinition): AchievementConfig {
  const exists = config.custom.some((c) => c.id === def.id);
  return { ...config, custom: exists ? config.custom.map((c) => (c.id === def.id ? def : c)) : [...config.custom, def] };
}

export const removeCustom = (config: AchievementConfig, id: string): AchievementConfig => ({ ...config, custom: config.custom.filter((c) => c.id !== id), order: config.order.filter((x) => x !== id) });

export const setCustomHidden = (config: AchievementConfig, id: string, hidden: boolean): AchievementConfig => ({ ...config, custom: config.custom.map((c) => (c.id === id ? { ...c, hidden } : c)) });

export function newCustomId(random: () => number = Math.random): string {
  return `custom-${Math.floor(random() * 36 ** 6).toString(36).padStart(6, "0")}`;
}

export const blankCustom = (metric: MetricId, id = newCustomId()): AchievementDefinition => ({ id, name: "", description: "", icon: "Trophy", metric, threshold: 5, scope: "all", hidden: false });

/** Is the draft different from what is saved? (Order only counts when it names something.) */
export function isDirty(saved: AchievementConfig, draft: AchievementConfig): boolean {
  const pick = (c: AchievementConfig) => JSON.stringify({ o: c.overrides, c: c.custom, r: c.order });
  return pick(saved) !== pick(draft);
}
