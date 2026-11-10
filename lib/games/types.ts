/**
 * Game plugin contract (docs/ROUTES.md D3). One plugin per game; `lib/games/registry.ts` maps a
 * GameId to its plugin. Everything game-specific that is NOT declarative config (formulas, flag
 * rules, prediction) lives behind this interface so a new game is: a config file in `config/games/`,
 * optionally a form in `lib/forms/`, and a plugin only if its scoring has cross-field logic.
 *
 * KEY CONVENTION for form values (shared by the adapter in `data/cs/` and the built-in forms):
 *   A CS document field at path `phase.field` becomes the form value key `phase_field`
 *   (for example `auto.cycleTimes` -> `auto_cycleTimes`, `teleop.shift1Override` -> `teleop_shift1Override`).
 *   Top-level CS fields keep their name (`startingPosition`, `incidents`, `notes`).
 *   Identity fields (`teamNumber`, `matchNumber`, `eventKey`, ...) are NOT form values: the adapter maps
 *   them onto ScoutEntry's own columns.
 */

export type GameId = "REBUILT" | "REEFSCAPE" | "CHARGED_UP";

/** A raw Firestore document from CS's `scouting` collection (already `data()`, no converters applied). */
export type CsDoc = Record<string, unknown>;

/** Flat form values, keys per the KEY CONVENTION above. */
export type GameValues = Record<string, unknown>;

export type PhaseScore = {
  auto: number;
  teleop: number;
  endgame: number;
  total: number;
};

export interface GamePlugin {
  id: GameId;
  label: string;
  /** Calendar year of the game (2026 for REBUILT). */
  season: number;
  /** `lib/forms` built-in form id when entries can be submitted; null when the game is read-only (docs/ROUTES.md D3). */
  formId: string | null;

  /** True when a CS doc belongs to this game. A doc with no `game` field belongs to REEFSCAPE (CS quirk). */
  matches(doc: CsDoc): boolean;

  /** CS doc -> flat form values (KEY CONVENTION). Must not lose information that `scoreDoc` needs. */
  docToValues(doc: CsDoc): GameValues;

  /**
   * Flat form values -> the game-specific part of a CS doc (nested phases, the shape CS writes today).
   * Returns null for read-only games. Unknown extra CS fields are the adapter's job to preserve (D10).
   */
  valuesToDoc(values: GameValues): CsDoc | null;

  /** Score a CS doc exactly as CS shows it today (golden-tested against CS scoring). */
  scoreDoc(doc: CsDoc): PhaseScore;

  /** Score flat form values (used live by the form's score bar). Must equal `scoreDoc(valuesToDoc(v))`. */
  scoreValues(values: GameValues): PhaseScore;
}
