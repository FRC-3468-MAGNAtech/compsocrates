// Which event Analytics opens on, and which events count as "All Events" (Session 2). Pure: the season-to-game mapping is handed in from the program's
// games (`useForms().seasons`), so nothing here names a year, a game or a program.

import type { EventInfo } from "@/lib/events/types";

/** A game the program scouts: its id and the events API season (year) it is played in. */
export type GameSeason = { id: string; apiSeason: number };

/** The game played in an events-API season, or null when the program has no game config for that year (an announced-later season such as the next one). */
export function gameOfSeason<S extends GameSeason>(seasons: readonly S[], year: number | null | undefined): S | null {
  return year === null || year === undefined ? null : (seasons.find((s) => s.apiSeason === year) ?? null);
}

/** True when the events API season has a game config in this program. */
export function hasGameConfig(seasons: readonly GameSeason[], year: number | null | undefined): boolean {
  return gameOfSeason(seasons, year) !== null;
}

/** An event's start as a sortable number; an unparseable or missing date sorts last (so list order decides among those). */
function startOf(event: Pick<EventInfo, "dateStart">): number {
  const t = Date.parse(event.dateStart);
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

/**
 * The default event: the FIRST event of the game's season in the team's event list, meaning the earliest start date, with list order as the tiebreak
 * and the fallback for events with no usable date. An event whose season has no game config is never picked, and neither is an event of another
 * game. `null` when the team has no event in that season.
 */
export function pickDefaultEvent(input: {
  events: readonly Pick<EventInfo, "code" | "season" | "dateStart">[];
  seasons: readonly GameSeason[];
  /** The game (season id) the page is on: the Analytics Game filter, whose default is the program's current game. */
  seasonId: string;
}): string | null {
  const game = input.seasons.find((s) => s.id === input.seasonId);
  if (!game) return null;
  let best: { code: string; start: number } | null = null;
  for (const e of input.events) {
    if (e.season !== game.apiSeason) continue;
    const start = startOf(e);
    if (best === null || start < best.start) best = { code: e.code, start };
  }
  return best?.code ?? null;
}

/** The picked events whose game is not configured yet: drives the "game not configured" empty state (never a blank table or a crash). */
export function pickedWithoutGameConfig(options: readonly { code: string; noGameConfig?: boolean }[], pickedCodes: readonly string[]): string[] {
  return pickedCodes.filter((c) => options.some((o) => o.noGameConfig && o.code.toUpperCase() === c.toUpperCase()));
}

export const GAME_NOT_CONFIGURED_NOTE = "The game for this event is not configured yet, so there is nothing to show. Pick an event from a configured season.";

/**
 * Where "All Events" stops: the entries of the selected game at any event of that game's season, minus archived events unless the viewer asked to
 * see them. An event with no known season (it is not in the team's list or the season's event list) is kept: the game's own form already ties the
 * entry to the game, and dropping data we cannot place would hide real entries.
 */
export type AllEventsScope = {
  /** The events API season of the selected game. */
  gameSeason: number;
  /** The season of an event code when it is known (team list, season event list). */
  seasonOf: (code: string) => number | undefined;
  /** Archived event codes to leave out (empty when "Show archived events" is on). */
  excluded: ReadonlySet<string>;
};

export function inAllEventsScope(code: string, scope: AllEventsScope): boolean {
  if (scope.excluded.has(code)) return false;
  const season = scope.seasonOf(code);
  return season === undefined || season === scope.gameSeason;
}
