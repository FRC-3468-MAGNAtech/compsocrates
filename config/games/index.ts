import { CHARGED_UP_CONFIG } from "@/config/games/charged-up";
import type { GameDefinition, GameId } from "@/config/games/definition";
import { REBUILT_CONFIG } from "@/config/games/rebuilt";
import { REEFSCAPE_CONFIG } from "@/config/games/reefscape";

export { CHARGED_UP_CONFIG } from "@/config/games/charged-up";
export { REBUILT_CONFIG } from "@/config/games/rebuilt";
export { REEFSCAPE_CONFIG } from "@/config/games/reefscape";
export * from "@/config/games/definition";
export * from "@/config/games/shared";

/** Every game the app knows, newest first. This and the three config files are the only places that name a game. */
export const GAME_ID_LIST = ["REBUILT", "REEFSCAPE", "CHARGED_UP"] as const satisfies readonly GameId[];
export type ConfigGameId = (typeof GAME_ID_LIST)[number];

/** The game a CS doc belongs to when it has no `game` field (CS quirk, docs/AUDIT.md section 3.4): the one whose definition says `docsWithoutGame`. */
export const DEFAULT_GAME_ID: ConfigGameId = "REEFSCAPE";

/** The game new entries are scouted for unless the scout picks another (the scout form and practice scouting offer every game). */
export const CURRENT_GAME_ID: ConfigGameId = "REBUILT";

/** One definition per game. A game with no `formulas` key is a pure point table whose plugin and form are generated from it. */
export const GAME_DEFINITIONS: Readonly<Record<GameId, GameDefinition>> = {
  REBUILT: REBUILT_CONFIG,
  REEFSCAPE: REEFSCAPE_CONFIG,
  CHARGED_UP: CHARGED_UP_CONFIG,
};

/** The same table under its older name. */
export const GAME_CONFIGS = GAME_DEFINITIONS;

/** The definitions in registry order. */
export const listGameDefinitions = (): GameDefinition[] => GAME_ID_LIST.map((id) => GAME_DEFINITIONS[id]);

/** The season id of a game (`CHARGED_UP` -> `charged_up`): stored library data and the analytics Game filter key on it. */
export const seasonIdOfGame = (id: GameId): string => id.toLowerCase();
