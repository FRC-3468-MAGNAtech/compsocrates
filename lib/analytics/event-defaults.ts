// Which event Analytics opens on, and which events count as "All Events" (Session 2). Pure: the season-to-game mapping is handed in from the program's
// games (`useForms().seasons`), so nothing here names a year, a game or a program.

import type { EventInfo } from "@/lib/events/types";
import { sameEventCode } from "@/lib/analytics/filters";

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

/**
 * Is an event offered under the selected game? Only when its season is the game's, or is not known (an event we cannot place stays: its entries carry
 * the game's own form). Practice events follow the same rule as real-event ones, so a 2023 regional never shows up under a 2026 game.
 */
export function offeredUnderGame(eventSeason: number | undefined, gameSeason: number): boolean {
  return eventSeason === undefined || eventSeason === gameSeason;
}

/** The events API season of each event the practice library holds (library matches name their game), by lower-cased event code. */
export function librarySeasons(matches: readonly { eventCode: string; seasonId: string }[], seasons: readonly GameSeason[]): Map<string, number> {
  const byGame = new Map(seasons.map((s) => [s.id, s.apiSeason]));
  const out = new Map<string, number>();
  for (const m of matches) {
    const year = byGame.get(m.seasonId);
    if (year !== undefined) out.set(m.eventCode.toLowerCase(), year);
  }
  return out;
}

/** A game the program has named for a coming season but not released: it has events, no form and no stats yet. */
export type UpcomingGame = { id: string; name: string; apiSeason: number };

/** The id an upcoming game takes in the Analytics Game filter (the URL's `game=`): its name, lower-cased (`BIOCORE` is `biocore`). */
export const upcomingGameId = (name: string): string => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");

/** The program's upcoming games, newest first, from its `ProgramEventRules.otherGames` (the entries flagged `upcoming`). */
export function upcomingGamesOf(otherGames: readonly { apiSeason: number; name: string; upcoming?: boolean }[] | undefined): UpcomingGame[] {
  return (otherGames ?? [])
    .filter((g) => g.upcoming)
    .map((g) => ({ id: upcomingGameId(g.name), name: g.name, apiSeason: g.apiSeason }))
    .sort((a, b) => b.apiSeason - a.apiSeason);
}

/** The upcoming game a Game filter value names, or null for a real game. */
export const upcomingGameFor = (games: readonly UpcomingGame[], gameId: string): UpcomingGame | null => games.find((g) => g.id === gameId) ?? null;

/** The sentence shown where the stats would be while an upcoming game is selected. */
export const upcomingGameNote = (name: string): string => `${name} has not been announced yet, so there are no stats to show.`;

/** The picked events whose game is not configured yet: drives the "game not configured" empty state (never a blank table or a crash). */
export function pickedWithoutGameConfig(options: readonly { code: string; noGameConfig?: boolean }[], pickedCodes: readonly string[]): string[] {
  return pickedCodes.filter((c) => options.some((o) => o.noGameConfig && sameEventCode(o.code, c)));
}

export const GAME_NOT_CONFIGURED_NOTE = "The game for this event is not configured yet, so there is nothing to show. Pick an event from a configured season.";

/*
 * "All Events" has no scope of its own beyond the game: an entry carries the form it was scouted with, which ties it to one game (so a game never mixes with
 * another), and archived events are part of it, current or not. (A season check on top of that would drop entries stored under a legacy event key.)
 */
