import { EVENT_CONFIG } from "@/config/event";

// Client-safe (no server-only): the season helpers the event pages call. The season is the configured game season
// (config/event.ts), not derived from the date.

export function getDefaultSeason(): number {
  return EVENT_CONFIG.season;
}

/** The configured season, the next one (for events posted early) and the two before it. */
export function getSelectableSeasons(): number[] {
  const current = EVENT_CONFIG.season;
  return [current + 1, current, current - 1, current - 2];
}
