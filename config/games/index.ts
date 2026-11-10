import { CHARGED_UP_CONFIG } from "@/config/games/charged-up";
import { REBUILT_CONFIG } from "@/config/games/rebuilt";
import { REEFSCAPE_CONFIG } from "@/config/games/reefscape";

export { CHARGED_UP_CONFIG } from "@/config/games/charged-up";
export { REBUILT_CONFIG } from "@/config/games/rebuilt";
export { REEFSCAPE_CONFIG } from "@/config/games/reefscape";
export * from "@/config/games/shared";

/** Every game the app knows, newest first. This and the three config files are the only places that name a game. */
export const GAME_ID_LIST = ["REBUILT", "REEFSCAPE", "CHARGED_UP"] as const;
export type ConfigGameId = (typeof GAME_ID_LIST)[number];

/** The game a CS doc belongs to when it has no `game` field (CS quirk, docs/AUDIT.md section 3.4). */
export const DEFAULT_GAME_ID: ConfigGameId = "REEFSCAPE";

/** The game new entries are scouted for. Only this game has a form (docs/ROUTES.md D3). */
export const CURRENT_GAME_ID: ConfigGameId = "REBUILT";

export const GAME_CONFIGS = {
  REBUILT: REBUILT_CONFIG,
  REEFSCAPE: REEFSCAPE_CONFIG,
  CHARGED_UP: CHARGED_UP_CONFIG,
} as const;
