"use client";

import { getEvents } from "@/lib/events/actions";
import { createEventNameStore } from "@/lib/events/name-store";

/**
 * The app-wide event-name store (one per tab): one `getEvents({ season })` Server Action call names every event of a
 * season. See `lib/events/name-store.ts` for the cache, retry and failure rules and `lib/events/use-event-names.ts` for
 * the hooks.
 */
export const eventNameStore = createEventNameStore({ fetchSeason: (season) => getEvents({ season }) });

/** The current best name for a key, read straight from the store (API if it has answered, else stored, static, key). For non-React callers such as CSV exports. */
export function currentEventName(key: string, stored?: Readonly<Record<string, string>>): string {
  return eventNameStore.resolve(key, stored).name;
}
