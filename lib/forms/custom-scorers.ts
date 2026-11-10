import { getGamePlugin } from "@/lib/games/registry";
import type { GameId, GameValues } from "@/lib/games/types";

// CS rebuild: the custom scoring hook. A form with `scoring: { mode: "custom", scorer: "<key>" }` is scored by the function registered under
// that key instead of by its fields' own rules. The key `game:<GameId>` (for example `game:REBUILT`) resolves to the game plugin's `scoreValues`,
// so a game whose scoring has cross-field logic keeps it in `lib/games/*` and the form only names it. Pure: a scorer maps values to points.

/** What a custom scorer returns: the three standard phases and their total (a game plugin's `PhaseScore`). */
export type CustomScore = { auto: number; teleop: number; endgame: number; total: number };

export type CustomScorer = (values: GameValues) => CustomScore;

export const GAME_SCORER_PREFIX = "game:";

const registered = new Map<string, CustomScorer>();

/** Registers (or replaces) a scorer under `key`. Keys starting `game:` are reserved for game plugins and can't be registered here. */
export function registerCustomScorer(key: string, scorer: CustomScorer): void {
  if (key.startsWith(GAME_SCORER_PREFIX)) throw new Error(`"${GAME_SCORER_PREFIX}" keys are reserved for game plugins.`);
  registered.set(key, scorer);
}

/** Removes a scorer registered with `registerCustomScorer` (for tests). */
export function unregisterCustomScorer(key: string): void {
  registered.delete(key);
}

/** The scorer a custom-scoring form names, or null when the key is unknown (a missing game plugin, a typo, a scorer that was never registered). */
export function resolveCustomScorer(key: string): CustomScorer | null {
  if (key.startsWith(GAME_SCORER_PREFIX)) {
    const id = key.slice(GAME_SCORER_PREFIX.length) as GameId;
    try {
      const plugin = getGamePlugin(id);
      return plugin ? (values) => plugin.scoreValues(values) : null;
    } catch {
      return null;
    }
  }
  return registered.get(key) ?? null;
}

export const hasCustomScorer = (key: string): boolean => resolveCustomScorer(key) !== null;

const finite = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) ? n : 0);

/** Runs a scorer and makes sure what comes back is four finite numbers (a scorer that throws, or returns junk, scores 0 rather than breaking the form). */
export function runCustomScorer(scorer: CustomScorer, values: GameValues): CustomScore {
  try {
    const r = scorer(values);
    return { auto: finite(r.auto), teleop: finite(r.teleop), endgame: finite(r.endgame), total: finite(r.total) };
  } catch {
    return { auto: 0, teleop: 0, endgame: 0, total: 0 };
  }
}
