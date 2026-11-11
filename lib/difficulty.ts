import { DEFAULT_DIFFICULTY_THRESHOLDS, GAME_DEFINITIONS } from "@/config/games";

export type Difficulty = "easy" | "medium" | "hard";

/** An alliance-score cut-off pair: <= `easyMax` is "easy", <= `mediumMax` (and above `easyMax`) is "medium", anything higher is "hard". */
export type DifficultyThresholds = { readonly easyMax: number; readonly mediumMax: number };

/**
 * The cut-offs of a game, from its definition (`config/games/*`, `thresholds.difficulty`; CS's `scoreToDifficulty` in
 * practice-scouting: CHARGED UP 80 / 120, every other game 200 / 400). `game` is a game id (`CHARGED_UP`) or a season id
 * (`charged_up`), any case. A game the app has no definition for (or no game at all) gets the default 200 / 400, which is what CS
 * itself uses for every game except CHARGED UP.
 */
export function difficultyThresholdsFor(game: string | null | undefined): DifficultyThresholds {
  const id = typeof game === "string" ? game.trim().toUpperCase() : "";
  const definition = Object.prototype.hasOwnProperty.call(GAME_DEFINITIONS, id) ? GAME_DEFINITIONS[id as keyof typeof GAME_DEFINITIONS] : null;
  return definition ? definition.thresholds.difficulty : DEFAULT_DIFFICULTY_THRESHOLDS;
}

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

// Fixed semantic colors, same convention as lib/accuracy/engine.ts's status
// tiers and lib/roles.ts — written as complete literal class names so
// Tailwind's compiler picks them up.
export const DIFFICULTY_CLASSNAMES: Record<Difficulty, string> = {
  easy: "bg-emerald-500/15 text-emerald-300 border border-emerald-400/30",
  medium: "bg-amber-500/15 text-amber-300 border border-amber-400/30",
  hard: "bg-red-500/15 text-red-300 border border-red-400/30",
};

/**
 * Difficulty is computed per alliance, from that alliance's own official score and the game it was played in (a score means
 * something different in each season). A score that is not a finite number counts as "easy", as in CS.
 */
export function getDifficulty(officialAllianceScore: number, game: string | null | undefined): Difficulty {
  const { easyMax, mediumMax } = difficultyThresholdsFor(game);
  if (!Number.isFinite(officialAllianceScore) || officialAllianceScore <= easyMax) return "easy";
  if (officialAllianceScore <= mediumMax) return "medium";
  return "hard";
}
