import { normalizeEventKey } from "@/config/event";
import { DEFAULT_GAME_ID, GAMES } from "@/lib/analytics/game-schema";

// Pure model + URL (de)serialization for the Analytics filter bar (P10). The
// React side — provider, hooks, history sync — lives in filter-context.tsx;
// everything here is plain functions so it can be unit tested.

export type PracticeModeFilter = "all" | "trial" | "competitive";
export type PracticeSourceFilter = "all" | "practice" | "live";

/**
 * Which events the dataset covers.
 * - `active`: the team's active events (`useActiveEvents()`) — the default. In
 *   practice mode there is no such thing as an "active" library event, so it
 *   reads as every event.
 * - `all`: every event that has data.
 * - `custom`: exactly these event codes.
 */
export type EventScope = { kind: "active" } | { kind: "all" } | { kind: "custom"; codes: string[] };

/** `null` = ALL (no threshold); otherwise a whole percent, 1-100. */
export type AccuracyThreshold = number | null;

export type AnalyticsFilters = {
  gameId: string;
  events: EventScope;
  practice: boolean;
  practiceMode: PracticeModeFilter;
  practiceSource: PracticeSourceFilter;
  accuracy: AccuracyThreshold;
  /** "Show archived events": archived events are listed in the Event select and counted by All Events only when on (on by default; `archived=0` turns it off). */
  archived: boolean;
};

export const ACCURACY_PRESETS = [75, 85, 90] as const;

export const DEFAULT_FILTERS: AnalyticsFilters = {
  gameId: DEFAULT_GAME_ID,
  events: { kind: "active" },
  practice: false,
  practiceMode: "all",
  practiceSource: "all",
  accuracy: null,
  archived: true,
};

/** Whole number, clamped to 1-100. */
export function clampAccuracy(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(100, Math.max(1, Math.round(n)));
}

/** What the Custom field accepts: digits only, at most 3 of them. Returns the cleaned text. */
export function sanitizeAccuracyText(text: string): string {
  return text.replace(/\D/g, "").slice(0, 3);
}

/** A custom-field draft as a threshold: `null` for an empty draft, otherwise clamped to 1-100 ("0" → 1, "150" → 100). */
export function parseAccuracyText(text: string): number | null {
  const digits = sanitizeAccuracyText(text);
  if (digits === "") return null;
  return clampAccuracy(Number(digits));
}

type ParamReader = { get(name: string): string | null };

const MODES: PracticeModeFilter[] = ["all", "trial", "competitive"];
const SOURCES: PracticeSourceFilter[] = ["all", "practice", "live"];

/**
 * Same event? The app's own event-key rule (`normalizeEventKey`): case-insensitive, and a legacy key resolves to the key the stored data was read under
 * (the older Bayou key is stored and read as the current one). A picked 2025 event therefore still finds the entries stored under its alias.
 */
export const sameEventCode = (a: string, b: string): boolean => normalizeEventKey(a) === normalizeEventKey(b);

/** Is `code` one of `codes`, ignoring case? Every event filter compares through this. */
export const eventCodeIn = (codes: readonly string[], code: string): boolean => codes.some((c) => sameEventCode(c, code));

/**
 * The event codes in the URL, in the spelling they were written (the app writes a code exactly as it is stored). They used to be upper-cased here,
 * which no longer matched a stored lower-case key (`2026lake`): picking an event then selected nothing and every table and form list was empty.
 * Duplicates differing only in case are dropped.
 */
function splitCodes(raw: string): string[] {
  const seen = new Map<string, string>();
  for (const part of raw.split(",")) {
    const code = part.trim();
    if (/^[A-Za-z0-9_-]{1,40}$/.test(code) && !seen.has(code.toLowerCase())) seen.set(code.toLowerCase(), code);
  }
  return [...seen.values()];
}

/** Reads filters off URL params; anything missing or invalid falls back to its default, so a hand-edited link can't produce an impossible state. */
export function parseFilters(params: ParamReader, validGameIds: string[] = Object.keys(GAMES), defaultGameId: string = DEFAULT_FILTERS.gameId): AnalyticsFilters {
  const game = params.get("game");
  const eventsRaw = params.get("events");
  const modeRaw = params.get("mode");
  const sourceRaw = params.get("source");
  const accRaw = params.get("acc");

  let events: EventScope = { kind: "active" };
  if (eventsRaw === "all") events = { kind: "all" };
  else if (eventsRaw && eventsRaw !== "active") {
    const codes = splitCodes(eventsRaw);
    if (codes.length > 0) events = { kind: "custom", codes };
  }

  const acc = accRaw && /^\d{1,3}$/.test(accRaw) ? clampAccuracy(Number(accRaw)) : null;

  return {
    gameId: game && validGameIds.includes(game) ? game : defaultGameId,
    events,
    practice: params.get("practice") === "1",
    practiceMode: MODES.includes(modeRaw as PracticeModeFilter) ? (modeRaw as PracticeModeFilter) : "all",
    practiceSource: SOURCES.includes(sourceRaw as PracticeSourceFilter) ? (sourceRaw as PracticeSourceFilter) : "all",
    accuracy: acc,
    archived: params.get("archived") !== "0",
  };
}

/** Only non-default values are written, so a default view has a clean URL. Mode/source are kept only while practice is on (they mean nothing otherwise). */
export function serializeFilters(filters: AnalyticsFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.gameId !== DEFAULT_FILTERS.gameId) params.set("game", filters.gameId);
  if (filters.events.kind === "all") params.set("events", "all");
  else if (filters.events.kind === "custom" && filters.events.codes.length > 0) params.set("events", filters.events.codes.join(","));
  if (filters.practice) {
    params.set("practice", "1");
    if (filters.practiceMode !== "all") params.set("mode", filters.practiceMode);
    if (filters.practiceSource !== "all") params.set("source", filters.practiceSource);
  }
  if (filters.accuracy !== null) params.set("acc", String(filters.accuracy));
  if (!filters.archived) params.set("archived", "0");
  return params;
}

const FILTER_PARAM_KEYS = ["game", "events", "practice", "mode", "source", "acc", "archived"] as const;

/**
 * `current` with its filter params replaced by `filters`'s — every other
 * param (a page's own `team=` / `match=` deep-link, say) is kept as is.
 */
export function mergeFilterParams(current: URLSearchParams | string, filters: AnalyticsFilters): URLSearchParams {
  const merged = new URLSearchParams(typeof current === "string" ? current : current.toString());
  for (const key of FILTER_PARAM_KEYS) merged.delete(key);
  for (const [key, value] of serializeFilters(filters)) merged.set(key, value);
  return merged;
}

/** `""` for the default view, otherwise `"?game=…"` — ready to append to a path. */
export function filtersToQuery(filters: AnalyticsFilters): string {
  const qs = serializeFilters(filters).toString();
  return qs ? `?${qs}` : "";
}

/**
 * The concrete event codes the dataset is limited to, or `null` for "no
 * restriction". `activeCodes` is only consulted for the `active` scope.
 */
export function resolveEventCodes(filters: AnalyticsFilters, activeCodes: string[]): string[] | null {
  const scope = filters.events;
  if (scope.kind === "all") return null;
  if (scope.kind === "custom") return scope.codes;
  // Practice/library data isn't tied to the team's active events.
  if (filters.practice) return null;
  return activeCodes;
}

/**
 * For pages that can only show one event at a time (single-event mode): the
 * first explicitly chosen event, otherwise `fallbackCode` (the page supplies
 * `pickDefaultActiveEvent`'s result).
 */
export function resolveSingleEventCode(filters: AnalyticsFilters, fallbackCode: string | null): string | null {
  if (filters.events.kind === "custom" && filters.events.codes.length > 0) return filters.events.codes[0];
  return fallbackCode;
}

/** Same events, different scope kind? Used to keep "is this the default" checks honest. */
export function isDefaultFilters(filters: AnalyticsFilters): boolean {
  return filtersToQuery(filters) === "";
}
