import { staticEventName } from "@/config/event-names";
import { EVENT_CONFIG, normalizeEventKey, type EventConfig } from "@/config/event";
import { parseEventKey, seasonLabel } from "@/lib/events/event-key";

/**
 * Pure event-name resolution (no React, no network). The chain, first usable name wins:
 *
 *   1. `api`     the name the data API (TBA) gave for the key,
 *   2. `stored`  a name already stored in the team's data (`selectedEventNames` on the team doc, `eventName` on practice
 *                sessions, library events and imported practice matches),
 *   3. `static`  the table in `config/event-names.ts` (names CS's own code states),
 *   4. `key`     the raw key, the documented last resort (never an empty string).
 *
 * A candidate is unusable ("missing") when it is not a string, is empty after trimming, or equals the key (compared
 * case-insensitively, also against the alias-resolved key): the placeholder `data/cs/teams.ts` builds from a bare key and
 * CS's `eventName || eventKey` fallback both look like that, and neither is a real name.
 */

export type EventNameSource = "api" | "stored" | "static" | "key";

export type ResolvedEventName = { name: string; source: EventNameSource };

export type ResolveEventNameArgs = {
  key: string;
  /** The name from the data API, when it answered. */
  api?: string | null;
  /** A name already stored in the team's data. */
  stored?: string | null;
  /**
   * A caller-supplied clock. The chain itself does not depend on time (no name expires here: the API cache lives in
   * `lib/events/name-store.ts`), so this is accepted and ignored; it exists so a caller that threads a clock through
   * every helper does not have to special-case this one.
   */
  now?: number | Date;
  config?: EventConfig;
};

/** Shown when even the key is empty, so a caller never renders a blank. */
export const UNKNOWN_EVENT_NAME = "Unknown event";

/** `value` trimmed, or null when it is not a usable name for `key` (not a string, empty, or just the key again). */
export function usableEventName(value: unknown, key: string, config: EventConfig = EVENT_CONFIG): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (!name) return null;
  const lower = name.toLowerCase();
  const rawKey = String(key ?? "").trim().toLowerCase();
  if (lower === rawKey || lower === normalizeEventKey(rawKey, config)) return null;
  return name;
}

export function resolveEventName({ key, api, stored, config = EVENT_CONFIG }: ResolveEventNameArgs): ResolvedEventName {
  const fromApi = usableEventName(api, key, config);
  if (fromApi) return { name: fromApi, source: "api" };
  const fromStored = usableEventName(stored, key, config);
  if (fromStored) return { name: fromStored, source: "stored" };
  const fromStatic = usableEventName(staticEventName(key, config), key, config);
  if (fromStatic) return { name: fromStatic, source: "static" };
  const trimmed = String(key ?? "").trim();
  return { name: trimmed || UNKNOWN_EVENT_NAME, source: "key" };
}

const FIRST_SEASON = 1992;
const LAST_SEASON = 2100;

/**
 * The season an event key belongs to, shown as the year label for a display name: a "tba" key (`2026lake`) gives `2026`, a "season-code" key
 * (`2025-USCALAB`) gives the two-year form `2025-26`. Null when the key carries no season (`app-testing`, `week0`, empty): the season is never guessed.
 * Pure and program-free: the key's own shape says which form it is (the two shapes cannot overlap, see `lib/events/event-key.ts`).
 */
export function eventYearLabel(key: string, config: EventConfig = EVENT_CONFIG): string | null {
  const raw = String(key ?? "").trim();
  if (!raw) return null;
  const inRange = (season: number) => season >= FIRST_SEASON && season <= LAST_SEASON;
  const coded = parseEventKey("season-code", raw);
  if (coded) return inRange(coded.season) ? seasonLabel("start-year", coded.season) : null;
  const tba = parseEventKey("tba", raw) ?? parseEventKey("tba", normalizeEventKey(raw, config));
  return tba && inRange(tba.season) ? seasonLabel("calendar", tba.season) : null;
}

/** The years a name may already state for this label: `2026`, or for `2025-26` both `2025` and `2026`. */
function labelYears(label: string): string[] {
  const start = /^(\d{4})-(\d{2})$/.exec(label);
  return start ? [start[1], String(Number(start[1]) + 1)] : [label];
}

/**
 * The name for display with its season beside it: "Arkansas Regional" becomes "Arkansas Regional 2026" (a name whose key has a season-code shape gets "2025-26").
 * Display only: callers never store this or put it in a machine-readable export. The name is returned unchanged when the key has no
 * season, when it already states the year anywhere (a whole number, so "FIRST 2026 Arkansas" and "Arkansas 2025-26" are left alone), and when
 * it is only the raw key (a placeholder, not a name).
 */
export function withEventYear(name: string, key: string, config: EventConfig = EVENT_CONFIG): string {
  const text = String(name ?? "").trim();
  if (!text) return String(name ?? "");
  const label = eventYearLabel(key, config);
  if (!label) return text;
  const rawKey = String(key ?? "").trim().toLowerCase();
  if (text.toLowerCase() === rawKey || text.toLowerCase() === normalizeEventKey(rawKey, config)) return text;
  if (labelYears(label).some((year) => new RegExp(`(?<!\\d)${year}(?!\\d)`).test(text))) return text;
  return `${text} ${label}`;
}

/** `withEventYear` for a record that carries its own code and name (an `EventInfo`, a library event): the one call a component makes for an event title. */
export function eventTitle(event: { code: string; name: string }): string {
  return withEventYear(event.name, event.code);
}

/**
 * One-line text for places that cannot render a component (CSV cells, aria labels, document titles, `<option>` text).
 * `withKey` appends the key in parentheses when the name is a real one: "Bayou Regional (2026lake)".
 */
export function eventLabel(args: ResolveEventNameArgs & { withKey?: boolean }): string {
  const { name, source } = resolveEventName(args);
  const key = String(args.key ?? "").trim();
  return args.withKey && source !== "key" && key ? `${name} (${key})` : name;
}

/**
 * `eventTitle` for an event whose KEY carries no season (a program whose keys are bare codes): the year comes from the event's own season instead,
 * in the program's wording (`seasonKind`: "calendar" gives 2026, "start-year" gives 2025-26). A key that states its season, a name that already
 * states the year, a bare-key placeholder and an unknown season are all left exactly as `eventTitle` has them.
 */
export function eventTitleInSeason(event: { code: string; name: string }, season: number | null | undefined, seasonKind: "calendar" | "start-year"): string {
  const keyed = eventTitle(event);
  const text = String(event.name ?? "").trim();
  if (keyed !== text || !text || season === null || season === undefined || !Number.isFinite(season)) return keyed;
  if (text.toLowerCase() === String(event.code ?? "").trim().toLowerCase()) return keyed;
  const label = seasonLabel(seasonKind, season);
  if (labelYears(label).some((year) => new RegExp(`(?<!\d)${year}(?!\d)`).test(text))) return keyed;
  return `${text} ${label}`;
}
