/**
 * Game plugin registry (docs/ROUTES.md D3). Maps a GameId to its plugin and picks the plugin for a CS doc.
 */
import { DEFAULT_GAME_ID, GAME_ID_LIST } from "@/config/games";
import { chargedUpPlugin } from "@/lib/games/charged-up";
import { rebuiltPlugin } from "@/lib/games/rebuilt";
import { reefscapePlugin } from "@/lib/games/reefscape";
import type { CsDoc, FullGamePlugin, GameId } from "@/lib/games/types";

export const GAME_IDS: readonly GameId[] = GAME_ID_LIST;

const PLUGINS: Record<GameId, FullGamePlugin> = {
  REBUILT: rebuiltPlugin,
  REEFSCAPE: reefscapePlugin,
  CHARGED_UP: chargedUpPlugin,
};

export function isGameId(value: unknown): value is GameId {
  return typeof value === "string" && (GAME_IDS as readonly string[]).includes(value);
}

export function getGamePlugin(id: GameId): FullGamePlugin {
  return PLUGINS[id];
}

export function listGamePlugins(): FullGamePlugin[] {
  return GAME_IDS.map((id) => PLUGINS[id]);
}

/** The plugin whose `matches` accepts the doc (a doc with no `game` field is REEFSCAPE). Null for an unknown game name. */
export function gameForDoc(doc: CsDoc): FullGamePlugin | null {
  return listGamePlugins().find((plugin) => plugin.matches(doc)) ?? null;
}

/** `gameForDoc(doc)?.id`, falling back to the default game (REEFSCAPE) for docs of an unknown game. */
export function gameIdForDoc(doc: CsDoc): GameId {
  return gameForDoc(doc)?.id ?? DEFAULT_GAME_ID;
}
