import { isSidebarIconKey } from "@/lib/sidebar/icons";
import { BUILTIN_ACHIEVEMENTS, BUILTIN_IDS } from "./builtins";
import type { AchievementDefinition, AchievementScope } from "./engine";
import { isMetricId, METRICS, metricsForProgram, type MetricId } from "./metrics";

// Session 8: a team's achievement settings (`teams/{teamId}/achievementConfig/main`, FTC: the program path) and the ONE resolver that turns
// them into the list the pages show. Pure. The document is written only by the server route (Admin SDK), which validates with
// validateConfigInput(); the readers here are lenient (a bad entry is dropped, never thrown on), so a stored mistake cannot break a profile.

export const ACHIEVEMENT_LIMITS = { maxCustom: 40, nameMax: 40, descriptionMax: 140, thresholdMin: 1, thresholdMax: 100000, minSamplesMax: 1000, idMax: 40 } as const;

/** What a team may change on a built-in: its words, and whether it shows. Never its threshold. */
export type AchievementOverride = { name?: string; description?: string; hidden?: boolean };

export type AchievementConfig = {
  version: number;
  overrides: Record<string, AchievementOverride>;
  custom: AchievementDefinition[];
  /** Ids (built-in and custom) in the order the team wants; ids missing here follow in the default order. */
  order: string[];
  updatedAt: number | null;
  updatedBy: string | null;
};

export const EMPTY_ACHIEVEMENT_CONFIG: AchievementConfig = { version: 0, overrides: {}, custom: [], order: [], updatedAt: null, updatedBy: null };

/** Glyphs the built-in achievements use, plus the app's icon set (lib/sidebar/icons.ts): the only icons an achievement may name. */
export const BUILTIN_GLYPHS = ["flag", "layers", "medal", "target", "sparkles", "flame", "calendar", "trophy"] as const;
export const isAchievementIcon = (v: unknown): v is string => typeof v === "string" && ((BUILTIN_GLYPHS as readonly string[]).includes(v) || isSidebarIconKey(v));

const TAG_OR_ANGLE = /[<>]/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,39}$/;

/** Plain text only: no angle brackets (so no HTML) and no control characters; trimmed, single-spaced. Null when not acceptable. */
export function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const t = value.replace(/\s+/g, " ").trim();
  if (t === "" || t.length > max || TAG_OR_ANGLE.test(t) || CONTROL.test(t)) return null;
  return t;
}

export type ValidationFailure = { ok: false; code: string; error: string };
export type ValidatedConfig = { ok: true; overrides: AchievementConfig["overrides"]; custom: AchievementDefinition[]; order: string[] };

const fail = (code: string, error: string): ValidationFailure => ({ ok: false, code, error });
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function validateCustom(raw: unknown, index: number, allowed: ReadonlySet<MetricId>): AchievementDefinition | ValidationFailure {
  const where = `Achievement ${index + 1}`;
  if (!isRecord(raw)) return fail("invalid_achievement", `${where} is not valid.`);
  if (typeof raw.id !== "string" || !ID_PATTERN.test(raw.id) || BUILTIN_IDS.has(raw.id)) return fail("invalid_id", `${where} has an invalid id.`);
  const name = cleanText(raw.name, ACHIEVEMENT_LIMITS.nameMax);
  if (name === null) return fail("invalid_name", `${where}: the name is required, plain text, up to ${ACHIEVEMENT_LIMITS.nameMax} characters.`);
  const description = cleanText(raw.description, ACHIEVEMENT_LIMITS.descriptionMax);
  if (description === null) return fail("invalid_description", `${where}: the description is required, plain text, up to ${ACHIEVEMENT_LIMITS.descriptionMax} characters.`);
  if (!isAchievementIcon(raw.icon)) return fail("invalid_icon", `${where}: pick an icon from the list.`);
  if (!isMetricId(raw.metric)) return fail("invalid_metric", `${where}: that measure does not exist.`);
  if (!allowed.has(raw.metric)) return fail("metric_not_available", `${where}: that measure is not available in this program.`);
  const t = raw.threshold;
  if (typeof t !== "number" || !Number.isInteger(t) || t < ACHIEVEMENT_LIMITS.thresholdMin || t > ACHIEVEMENT_LIMITS.thresholdMax) {
    return fail("invalid_threshold", `${where}: the target must be a whole number from ${ACHIEVEMENT_LIMITS.thresholdMin} to ${ACHIEVEMENT_LIMITS.thresholdMax}.`);
  }
  const scope: AchievementScope | null = raw.scope === "all" || raw.scope === "season" ? raw.scope : null;
  if (scope === null) return fail("invalid_scope", `${where}: choose all time or this season.`);
  if (scope === "season" && !METRICS[raw.metric].seasonScope) return fail("invalid_scope", `${where}: that measure has no season option.`);
  let minSamples: number | undefined;
  if (raw.minSamples !== undefined && raw.minSamples !== null) {
    if (typeof raw.minSamples !== "number" || !Number.isInteger(raw.minSamples) || raw.minSamples < 1 || raw.minSamples > ACHIEVEMENT_LIMITS.minSamplesMax) {
      return fail("invalid_min_samples", `${where}: the minimum number of sessions must be a whole number from 1 to ${ACHIEVEMENT_LIMITS.minSamplesMax}.`);
    }
    if (METRICS[raw.metric].usesSamples) minSamples = raw.minSamples;
  }
  return { id: raw.id, name, description, icon: raw.icon, metric: raw.metric, threshold: t, scope, ...(minSamples !== undefined ? { minSamples } : {}), hidden: raw.hidden === true };
}

/**
 * Everything the server accepts from a client: `{ overrides, custom, order? }`. Anything unknown is refused, not ignored, so a typo cannot silently
 * save nothing. `programMetrics` is the program's own list (`ProgramConfig.achievementMetrics`).
 */
export function validateConfigInput(input: unknown, programMetrics: "all" | readonly string[] | undefined): ValidatedConfig | ValidationFailure {
  if (!isRecord(input)) return fail("invalid_body", "Send the achievement settings.");
  const allowed = new Set<MetricId>(metricsForProgram(programMetrics));

  const overrides: AchievementConfig["overrides"] = {};
  const rawOverrides = input.overrides ?? {};
  if (!isRecord(rawOverrides)) return fail("invalid_overrides", "Overrides are not valid.");
  for (const [id, raw] of Object.entries(rawOverrides)) {
    if (!BUILTIN_IDS.has(id)) return fail("invalid_override_id", "Only built-in achievements can have overrides.");
    if (!isRecord(raw)) return fail("invalid_override", "An override is not valid.");
    for (const key of Object.keys(raw)) if (key !== "name" && key !== "description" && key !== "hidden") return fail("invalid_override", `Built-in achievements cannot change "${key}".`);
    const o: AchievementOverride = {};
    if (raw.name !== undefined) {
      const name = cleanText(raw.name, ACHIEVEMENT_LIMITS.nameMax);
      if (name === null) return fail("invalid_name", `A name is plain text, up to ${ACHIEVEMENT_LIMITS.nameMax} characters.`);
      o.name = name;
    }
    if (raw.description !== undefined) {
      const description = cleanText(raw.description, ACHIEVEMENT_LIMITS.descriptionMax);
      if (description === null) return fail("invalid_description", `A description is plain text, up to ${ACHIEVEMENT_LIMITS.descriptionMax} characters.`);
      o.description = description;
    }
    if (raw.hidden !== undefined) {
      if (typeof raw.hidden !== "boolean") return fail("invalid_override", "Hidden must be true or false.");
      o.hidden = raw.hidden;
    }
    if (Object.keys(o).length > 0) overrides[id] = o;
  }

  const rawCustom = input.custom ?? [];
  if (!Array.isArray(rawCustom)) return fail("invalid_custom", "Custom achievements are not valid.");
  if (rawCustom.length > ACHIEVEMENT_LIMITS.maxCustom) return fail("too_many", `A team can have at most ${ACHIEVEMENT_LIMITS.maxCustom} custom achievements.`);
  const custom: AchievementDefinition[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < rawCustom.length; i++) {
    const result = validateCustom(rawCustom[i], i, allowed);
    if ("ok" in result) return result;
    if (seen.has(result.id)) return fail("duplicate_id", "Two achievements share an id.");
    seen.add(result.id);
    custom.push(result);
  }

  const rawOrder = input.order ?? [];
  if (!Array.isArray(rawOrder) || rawOrder.length > BUILTIN_IDS.size + ACHIEVEMENT_LIMITS.maxCustom) return fail("invalid_order", "The order is not valid.");
  const known = new Set<string>([...BUILTIN_IDS, ...seen]);
  const order: string[] = [];
  for (const id of rawOrder) {
    if (typeof id !== "string" || !known.has(id)) return fail("invalid_order", "The order names an achievement that does not exist.");
    if (!order.includes(id)) order.push(id);
  }
  return { ok: true, overrides, custom, order };
}

/** A stored document as the app reads it: invalid pieces are dropped, never thrown on. Metrics that no longer exist are KEPT (they show as unavailable in the editor). */
export function parseAchievementConfig(raw: unknown): AchievementConfig {
  if (!isRecord(raw)) return EMPTY_ACHIEVEMENT_CONFIG;
  const overrides: AchievementConfig["overrides"] = {};
  if (isRecord(raw.overrides)) {
    for (const [id, value] of Object.entries(raw.overrides)) {
      if (!BUILTIN_IDS.has(id) || !isRecord(value)) continue;
      const o: AchievementOverride = {};
      const name = cleanText(value.name, ACHIEVEMENT_LIMITS.nameMax);
      const description = cleanText(value.description, ACHIEVEMENT_LIMITS.descriptionMax);
      if (name !== null) o.name = name;
      if (description !== null) o.description = description;
      if (value.hidden === true) o.hidden = true;
      if (Object.keys(o).length > 0) overrides[id] = o;
    }
  }
  const custom: AchievementDefinition[] = [];
  if (Array.isArray(raw.custom)) {
    for (const item of raw.custom.slice(0, ACHIEVEMENT_LIMITS.maxCustom)) {
      if (!isRecord(item) || typeof item.id !== "string" || !ID_PATTERN.test(item.id) || BUILTIN_IDS.has(item.id) || custom.some((c) => c.id === item.id)) continue;
      const name = cleanText(item.name, ACHIEVEMENT_LIMITS.nameMax);
      const description = cleanText(item.description, ACHIEVEMENT_LIMITS.descriptionMax);
      const t = item.threshold;
      if (name === null || description === null || typeof t !== "number" || !Number.isInteger(t) || t < 1 || t > ACHIEVEMENT_LIMITS.thresholdMax) continue;
      if (typeof item.metric !== "string") continue;
      custom.push({
        id: item.id,
        name,
        description,
        icon: isAchievementIcon(item.icon) ? item.icon : "trophy",
        // A metric this version does not know stays as written; evaluate() returns null for it and the pages skip it.
        metric: item.metric as MetricId,
        threshold: t,
        scope: item.scope === "season" ? "season" : "all",
        ...(typeof item.minSamples === "number" && Number.isInteger(item.minSamples) && item.minSamples >= 1 ? { minSamples: item.minSamples } : {}),
        hidden: item.hidden === true,
      });
    }
  }
  const order = Array.isArray(raw.order) ? raw.order.filter((id): id is string => typeof id === "string").slice(0, 100) : [];
  return {
    version: typeof raw.version === "number" && Number.isInteger(raw.version) && raw.version >= 0 ? raw.version : 0,
    overrides,
    custom,
    order,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : null,
    updatedBy: typeof raw.updatedBy === "string" ? raw.updatedBy : null,
  };
}

export type EffectiveAchievement = {
  /** The definition as shown: built-ins carry their override name and description. */
  def: AchievementDefinition;
  builtin: boolean;
  hidden: boolean;
  /** The metric is gone (or not offered by this program) or the scope no longer fits: shown as Unavailable in the editor, skipped everywhere else. */
  unavailable: boolean;
};

/** The ONE name/description resolver: override > built-in default. */
export function applyOverride(def: AchievementDefinition, override: AchievementOverride | undefined): AchievementDefinition {
  return override ? { ...def, name: override.name ?? def.name, description: override.description ?? def.description } : def;
}

/** Every achievement of the team in display order: built-ins (with overrides) and customs, `order` first. Hidden and unavailable ones are flagged, not removed. */
export function effectiveAchievements(config: AchievementConfig, programMetrics: "all" | readonly string[] | undefined): EffectiveAchievement[] {
  const allowed = new Set<string>(metricsForProgram(programMetrics));
  const list: EffectiveAchievement[] = [
    ...BUILTIN_ACHIEVEMENTS.map((def) => ({ def: applyOverride(def, config.overrides[def.id]), builtin: true, hidden: config.overrides[def.id]?.hidden === true, unavailable: !allowed.has(def.metric) })),
    ...config.custom.map((def) => ({
      def,
      builtin: false,
      hidden: def.hidden,
      unavailable: !allowed.has(def.metric) || !isMetricId(def.metric) || (def.scope === "season" && !METRICS[def.metric].seasonScope),
    })),
  ];
  if (config.order.length === 0) return list;
  const rank = new Map(config.order.map((id, i) => [id, i]));
  return list.map((item, i) => ({ item, i })).sort((a, b) => (rank.get(a.item.def.id) ?? 1000 + a.i) - (rank.get(b.item.def.id) ?? 1000 + b.i)).map((x) => x.item);
}

/** The name an achievement goes by for this team (override > built-in default > custom name). Null for an unknown id. */
export function achievementName(config: AchievementConfig, id: string): string | null {
  const found = effectiveAchievements(config, "all").find((a) => a.def.id === id);
  return found ? found.def.name : null;
}
