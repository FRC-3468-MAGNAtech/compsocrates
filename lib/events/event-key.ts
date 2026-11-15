// The event key in a URL (`/events/[eventKey]`), one pure module for every program. A program's `ProgramConfig.event.keyShape` says which
// shape it uses; nothing here names a program.
//
//   "tba"          a Blue Alliance style key, `2026lake`: the season is the four-digit prefix and the whole key is the event code.
//   "season-code"  `{season}-{CODE}`, `2025-USCALAB`: an event code alone is reused every season, so the key carries the season. The
//                  hyphen means it can never match a "tba" key (`^\d{4}[a-z0-9]+$`), and the code is stored upper case.

export type EventKeyShape = "tba" | "season-code";

export type ParsedEventKey = { season: number; code: string };

const TBA_KEY = /^(\d{4})[a-z0-9]+$/i;
const SEASON_CODE_KEY = /^(\d{4})-([a-z0-9]{2,20})$/i;

/** The season and event code a key names, or null when the key is not of this shape (a key of the other shape, `app-testing`, an empty string). */
export function parseEventKey(shape: EventKeyShape, key: string): ParsedEventKey | null {
  const trimmed = String(key ?? "").trim();
  if (shape === "tba") {
    const match = TBA_KEY.exec(trimmed);
    return match ? { season: Number(match[1]), code: trimmed } : null;
  }
  const match = SEASON_CODE_KEY.exec(trimmed);
  return match ? { season: Number(match[1]), code: match[2].toUpperCase() } : null;
}

/** The key for an event: a "tba" key is the event code as is; a "season-code" key is `{season}-{CODE}` with the code upper-cased. */
export function buildEventKey(shape: EventKeyShape, event: { code: string; season: number }): string {
  return shape === "tba" ? event.code : `${event.season}-${String(event.code).trim().toUpperCase()}`;
}

/** The program-relative path of an event's page. */
export function eventPagePath(shape: EventKeyShape, event: { code: string; season: number }): string {
  return `/events/${encodeURIComponent(buildEventKey(shape, event))}`;
}

/**
 * How a season is shown. A "calendar" season is the year; a "start-year" season is the two-year form (`2025` is `2025-26`), the way the
 * program itself names it.
 */
export function seasonLabel(kind: "calendar" | "start-year", season: number): string {
  return kind === "calendar" ? String(season) : `${season}-${String((season + 1) % 100).padStart(2, "0")}`;
}
