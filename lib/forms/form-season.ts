// Session E: which season (game) a form page is open on. The page keeps it in the URL (`?game=<season id>`, the same query My Scouting and Scout Accuracy use).
// Pure: the page hook (`lib/forms/use-form-season.ts`) reads and writes the URL.

import type { EventInfo } from "@/lib/events/types";

/** What a season is here: `ProgramSeason` (`lib/program/data.ts`) has these fields and more. */
export type SeasonLike = { id: string; apiSeason: number };

/**
 * The seasons a form exists for: the ones named in its tags (the REBUILT-only forms are tagged `rebuilt`). A form tagged with none of the program's seasons
 * (a custom form, the second program's forms) is offered for all of them. Never empty while the program has a season.
 */
export function seasonsOfForm<S extends SeasonLike>(form: { tags?: readonly string[] } | null | undefined, seasons: readonly S[]): S[] {
  const tags = new Set((form?.tags ?? []).map((t) => t.toLowerCase().replace(/-/g, "_")));
  const named = seasons.filter((s) => tags.has(s.id));
  return named.length > 0 ? named : [...seasons];
}

/** The season whose events API year is `year`, or null. */
export function seasonOfYear(seasons: readonly SeasonLike[], year: number | null | undefined): SeasonLike | null {
  return year === null || year === undefined ? null : (seasons.find((s) => s.apiSeason === year) ?? null);
}

/**
 * The season a form page opens on when the URL names none: the ACTIVE event's season when there is one (and the program has a game for it), else the
 * program's current season.
 */
export function defaultFormSeasonId(seasons: readonly SeasonLike[], activeEvent: Pick<EventInfo, "season"> | null | undefined, currentSeasonId: string): string {
  return seasonOfYear(seasons, activeEvent?.season)?.id ?? currentSeasonId;
}

/** The season in the URL's `game` query: a known season id, else `fallback` (an unknown or missing value, and "all", which is not a choice on a form). */
export function readFormSeasonParam(param: string | null | undefined, seasons: readonly SeasonLike[], fallback: string): string {
  const id = (param ?? "").trim().toLowerCase();
  return seasons.some((s) => s.id === id) ? id : fallback;
}

/**
 * The events a season's form offers: the events of that season's year. A program with ONE season never filters (nothing to tell apart), and an event whose
 * year is none of the program's seasons (an old or placeholder event) is offered under the current season, so no selected event disappears from every form.
 */
export function eventsForSeason<E extends Pick<EventInfo, "season">>(events: readonly E[], seasons: readonly SeasonLike[], seasonId: string, currentSeasonId: string): E[] {
  if (seasons.length <= 1) return [...events];
  return events.filter((e) => (seasonOfYear(seasons, e.season)?.id ?? currentSeasonId) === seasonId);
}

/** The URL after the season changed: the same query with `game` set (other keys stay). Returns the query string without the leading `?`. */
export function withSeasonParam(query: string, seasonId: string): string {
  const params = new URLSearchParams(query);
  params.set("game", seasonId);
  return params.toString();
}
