// Analytics lists events by the selected game's season: a 2027 event has nothing to show for a 2025 game, so it is not offered
// there (an event with data under the game is always listed by the caller). Archiving plays no part here: it only declutters the
// scouting pickers, never the analytics data.

/** The events (from the team's selection) that belong to the game's season; the rest are left for the games they belong to. */
export function eventsOfGameSeason<T extends { season: number }>(events: readonly T[], gameSeason: number): T[] {
  return events.filter((e) => e.season === gameSeason);
}
