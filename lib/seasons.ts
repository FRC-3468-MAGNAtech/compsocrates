import { CURRENT_GAME_ID, GAME_DEFINITIONS, GAME_ID_LIST, seasonIdOfGame, type GameId } from "@/config/games";

/**
 * One registry every season-select screen reads from, GENERATED from the game definitions (`config/games/*`): a game is a season. Adding a game
 * is adding its config entry, nothing here. There is no "read-only" season: all three games (REBUILT, REEFSCAPE, CHARGED UP) are scouted, practiced
 * and edited like each other.
 */
export type Season = {
  /** The id stored on library data and practice sessions: the game id lower-cased (`rebuilt`, `charged_up`). */
  id: string;
  name: string;
  /** The FIRST API's own season year (e.g. 2026 for the 2026-27 season). */
  apiSeason: number;
  /** The id of the game's built-in match scouting form. */
  formId: string;
  /** Whether new entries can be scouted for the season (the game definition's `submittable`). */
  enabled: boolean;
  /** The game this season plays. */
  gameId: GameId;
};

export const SEASONS: Season[] = GAME_ID_LIST.map((gameId) => {
  const def = GAME_DEFINITIONS[gameId];
  return { id: seasonIdOfGame(gameId), name: def.label, apiSeason: def.year, formId: def.formId, enabled: def.submittable, gameId };
});

/** The season new entries default to (REBUILT). */
export const DEFAULT_SEASON_ID = seasonIdOfGame(CURRENT_GAME_ID);

export function getSeason(id: string = DEFAULT_SEASON_ID): Season {
  return SEASONS.find((s) => s.id === id) ?? SEASONS.find((s) => s.id === DEFAULT_SEASON_ID) ?? SEASONS[0];
}

/** Seasons a new entry can be scouted for (the scout form, practice, the match library, assignments) and the analytics Game filter lists: the three games. */
export function getEnabledSeasons(): Season[] {
  return SEASONS.filter((s) => s.enabled);
}

/** The season of a game. */
export const seasonOfGame = (gameId: GameId): Season => getSeason(seasonIdOfGame(gameId));
