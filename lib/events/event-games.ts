// The games Event Select sorts events by (instead of by year): one entry per game the program has events for, newest first. Pure: the scouted games come from
// the program's game list (`useForms().allSeasons`) and the rest from its config (`ProgramEventRules.otherGames`), so no game or year is written here.

export type EventGame = {
  /** The events API season the game's events are listed under. */
  apiSeason: number;
  name: string;
};

/**
 * Scouted games plus the program's other games (a coming game, a past game it does not scout), one entry per season, newest first. A scouted game wins
 * over an "other" entry for the same season. A season with no game is simply not here: there is nothing to browse for it.
 */
export function eventGamesOf(
  scouted: readonly { apiSeason: number; name: string }[],
  other: readonly { apiSeason: number; name: string }[] | undefined
): EventGame[] {
  const bySeason = new Map<number, EventGame>();
  for (const g of other ?? []) bySeason.set(g.apiSeason, { apiSeason: g.apiSeason, name: g.name });
  for (const g of scouted) bySeason.set(g.apiSeason, { apiSeason: g.apiSeason, name: g.name });
  return [...bySeason.values()].sort((a, b) => b.apiSeason - a.apiSeason);
}

/** The game's name for an events API season, or null when the program has no game for it. */
export function gameNameOfSeason(games: readonly EventGame[], season: number): string | null {
  return games.find((g) => g.apiSeason === season)?.name ?? null;
}
