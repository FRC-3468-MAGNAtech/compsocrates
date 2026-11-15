// Session D: the Game select on My Scouting filters entries and sessions by game. Pure, so it is unit tested.
// A record with no `game` counts as the program's "unspecified game" (REEFSCAPE for the program that scouted it first, as old CS did; see docs/FIREBASE_FINDINGS.md),
// else the program's default game. A program with one game never filters.

/** A stored `game` string ("REBUILT", "CHARGED UP", "charged_up") as a season id of the program, or the fallback when it is blank or unknown. */
export function gameSeasonId(raw: unknown, seasonIds: readonly string[], fallback: string): string {
  const id = typeof raw === "string" ? raw.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
  return seasonIds.includes(id) ? id : fallback;
}

export type GameFilterOptions = {
  /** The selected season id; "" or null means every game. */
  seasonId: string | null;
  /** The program's season ids. One id: nothing is filtered. */
  seasonIds: readonly string[];
  /** The season a record with no (or an unknown) game counts as. */
  fallbackSeasonId: string;
};

/** Items whose game (read by `gameOf`) is the selected one; every item when no game is selected or the program has a single game. */
export function filterByGame<T>(items: readonly T[], gameOf: (item: T) => unknown, { seasonId, seasonIds, fallbackSeasonId }: GameFilterOptions): T[] {
  if (!seasonId || seasonIds.length <= 1) return [...items];
  return items.filter((item) => gameSeasonId(gameOf(item), seasonIds, fallbackSeasonId) === seasonId);
}

/** The selected game from the URL's `game` query: a known season id, else the default. "all" selects every game. */
export function readGameParam(param: string | null, seasonIds: readonly string[], defaultSeasonId: string): string {
  if (param === "all") return "";
  const id = (param ?? "").trim().toLowerCase();
  return seasonIds.includes(id) ? id : defaultSeasonId;
}
