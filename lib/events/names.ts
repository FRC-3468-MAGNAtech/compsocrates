import { staticEventName } from "@/config/event-names";
import { EVENT_CONFIG, normalizeEventKey, type EventConfig } from "@/config/event";

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

/**
 * One-line text for places that cannot render a component (CSV cells, aria labels, document titles, `<option>` text).
 * `withKey` appends the key in parentheses when the name is a real one: "Bayou Regional (2026lake)".
 */
export function eventLabel(args: ResolveEventNameArgs & { withKey?: boolean }): string {
  const { name, source } = resolveEventName(args);
  const key = String(args.key ?? "").trim();
  return args.withKey && source !== "key" && key ? `${name} (${key})` : name;
}
