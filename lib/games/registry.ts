/**
 * Game plugin registry (docs/ROUTES.md D3). Maps a GameId to its plugin and picks the plugin for a CS doc.
 *
 * Every plugin comes from a `GameDefinition` in `config/games/`: a game with `formulas` uses its hand-written plugin (REBUILT's fuel
 * formulas), every other game's plugin is generated from its point table (`createPointTablePlugin`). Adding a game is one config entry.
 */
import { DEFAULT_GAME_ID, GAME_DEFINITIONS, GAME_ID_LIST, isPointTable, type GameDefinition } from "@/config/games";
import { createPointTablePlugin } from "@/lib/games/point-table";
import { rebuiltPlugin } from "@/lib/games/rebuilt";
import type { CsDoc, FullGamePlugin, GameId } from "@/lib/games/types";

export const GAME_IDS: readonly GameId[] = GAME_ID_LIST;

/** The hand-written plugins a definition's `formulas` key can name. */
const FORMULA_PLUGINS: Record<NonNullable<GameDefinition["formulas"]>, FullGamePlugin> = { rebuilt: rebuiltPlugin };

function pluginFor(def: GameDefinition): FullGamePlugin {
  return isPointTable(def) ? createPointTablePlugin(def) : FORMULA_PLUGINS[def.formulas];
}

const PLUGINS = Object.fromEntries(GAME_ID_LIST.map((id) => [id, pluginFor(GAME_DEFINITIONS[id])])) as Record<GameId, FullGamePlugin>;

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
