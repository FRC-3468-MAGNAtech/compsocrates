/**
 * Game plugin contract (docs/ROUTES.md D3). One plugin per game; `lib/games/registry.ts` maps a
 * GameId to its plugin. Everything game-specific that is NOT declarative config (formulas, flag
 * rules, prediction) lives behind this interface so a new game is one config entry in `config/games/` (a `GameDefinition`): its plugin
 * and its form are generated from it. A hand-written plugin is only needed when the scoring has cross-field logic (`formulas`).
 *
 * KEY CONVENTION for form values (shared by the adapter in `data/cs/` and the built-in forms):
 *   A CS document field at path `phase.field` becomes the form value key `phase_field`
 *   (for example `auto.cycleTimes` -> `auto_cycleTimes`, `teleop.shift1Override` -> `teleop_shift1Override`).
 *   Top-level CS fields keep their name (`startingPosition`, `incidents`, `notes`).
 *   Identity fields (`teamNumber`, `matchNumber`, `eventKey`, ...) are NOT form values: the adapter maps
 *   them onto ScoutEntry's own columns.
 */

import type { GameId } from "@/config/games/definition";

export type { GameId };

/** A raw Firestore document from CS's `scouting` collection (already `data()`, no converters applied). */
export type CsDoc = Record<string, unknown>;

/** Flat form values, keys per the KEY CONVENTION above. */
export type GameValues = Record<string, unknown>;

export type PhaseScore = {
  auto: number;
  teleop: number;
  endgame: number;
  /** auto + teleop + endgame (+ `penalty` when present, as CS adds penalty points to REEFSCAPE and CHARGED_UP totals). */
  total: number;
  /** Penalty points added to `total` (REEFSCAPE and CHARGED_UP only, read from the doc's `penaltyPoints`). Omitted when the game has none. */
  penalty?: number;
};

/** Auto-flag codes CS raises on a scouting entry (app/utils/scoutingFlags.ts). */
export type ScoutingFlagCode = "human-player-heavy" | "auto-only-no-teleop" | "zero-main-scoring";

export type ScoutingFlag = {
  code: ScoutingFlagCode;
  label: string;
  detail: string;
};

/** One compared metric of lead-vs-junior verification (app/utils/scoutVerification.ts). `key` is a dotted CS doc path. */
export type VerificationMetric = {
  key: string;
  label: string;
  tolerance: number;
};

export type VerificationResult = {
  verified: boolean;
  /** Whole percent (0..100). */
  accuracy: number;
  matchedMetrics: number;
  totalMetrics: number;
  mismatches: Array<{ key: string; label: string; junior: number; lead: number; delta: number }>;
};

export type PredictionSource = "official" | "practice" | "combined";
export type ConfidenceTier = 75 | 85 | 90;

export type TacticalPrediction = {
  teamNumber: string;
  startingPosition: string;
  role: "Offense" | "Defense" | "Feeder";
  /** Whole percent (0..100). */
  climbProbability: number;
  estimatedPoints: number;
  sampleSize: number;
  confidenceTier: ConfidenceTier;
};

/** One field of a rescout (exemplar) comparison (app/utils/rescoutComparison.ts). */
export type RescoutField = {
  key: string;
  label: string;
  original: unknown;
  exemplar: unknown;
  diff: number;
  weight: number;
};

export type RescoutDiff = {
  /** Weighted difference as a percent with one decimal (0 = identical). */
  diffPercent: number;
  fields: RescoutField[];
};

export interface GamePlugin<Id extends string = GameId> {
  id: Id;
  label: string;
  /** Calendar year of the game (2026 for REBUILT). */
  season: number;
  /** `lib/forms` built-in form id: the id an entry of this game is attributed to. */
  formId: string;
  /** Entries of this game can be written (scout form, practice scouting, admin editor). Mirrors `GameDefinition.submittable`; `valuesToDoc` returns null when false. */
  submittable: boolean;

  /** True when a CS doc belongs to this game. A doc with no `game` field belongs to REEFSCAPE (CS quirk). */
  matches(doc: CsDoc): boolean;

  /** CS doc -> flat form values (KEY CONVENTION). Must not lose information that `scoreDoc` needs. */
  docToValues(doc: CsDoc): GameValues;

  /**
   * Flat form values -> the game-specific part of a CS doc (the shape CS writes today: `game`, nested phases or flat fields).
   * The exact inverse of `docToValues` for every key the form owns. Returns null only for a game that is not `submittable`.
   * Unknown extra CS fields are the adapter's job to preserve (D10).
   */
  valuesToDoc(values: GameValues): CsDoc | null;

  /** Score a CS doc exactly as CS shows it today (golden-tested against CS scoring). */
  scoreDoc(doc: CsDoc): PhaseScore;

  /** Score flat form values (used live by the form's score bar). Must equal `scoreDoc(valuesToDoc(v))`. */
  scoreValues(values: GameValues): PhaseScore;

  /** Default flat values for an empty form. */
  defaultValues?(): GameValues;

  /** Auto-flags for a CS doc, as CS's `evaluateScoutingFlags` raises them. */
  flags?(doc: CsDoc): ScoutingFlag[];

  /** Lead-vs-junior verification (CS `compareScoutToLead`). */
  verify?(junior: CsDoc, lead: CsDoc, options?: { metrics?: readonly VerificationMetric[]; threshold?: number }): VerificationResult;

  /** Tactical prediction for one team (CS `buildTacticalPrediction`), scored with this game's `scoreDoc`. */
  predict?(teamNumber: string, docs: readonly CsDoc[], source: PredictionSource, confidenceTier: ConfidenceTier): TacticalPrediction;

  /** Field-by-field diff of a scouted doc against an exemplar (CS `computeRescoutDiff`). */
  compareToExemplar?(original: CsDoc, exemplar: CsDoc): RescoutDiff;
}

/** A plugin with every optional member present; what the registry hands out. */
export type FullGamePlugin<Id extends string = GameId> = Required<GamePlugin<Id>>;
