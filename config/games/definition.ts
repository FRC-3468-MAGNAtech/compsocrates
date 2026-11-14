/**
 * `GameDefinition`: everything declarative about one game, so adding a game is one config entry (plus, only when its scoring has
 * cross-field logic, a `formulas` key naming a custom plugin in `lib/games/`).
 *
 * From a definition with a `fields` table the app GENERATES:
 *  - the game plugin (`lib/games/point-table.ts`): `score`, `docToValues`, `valuesToDoc`, `flags`, verification, prediction, rescout diff;
 *  - the match scouting `Form` (`lib/forms/game-form.ts`): sections, groups, labels, options, point badges, incident checkboxes.
 *
 * Pure data: no `server-only`, no Node APIs, no runtime imports from `lib/` (only types), safe to import from client code.
 *
 * KEY CONVENTION (shared with the adapter in `data/cs/`): a CS doc field at path `phase.field` is the form value key `phase_field`;
 * a top-level CS field keeps its name. A field spells out both (`key` and `path`) so nothing is guessed.
 */
import type { StatRole } from "@/lib/forms/types";
import type { RescoutFieldSpec } from "@/config/games/shared";

export type GameId = "REBUILT" | "REEFSCAPE" | "CHARGED_UP";

/** Where a field's points land (`prematch` and `misc` fields score nothing). */
export type GameSectionPhase = "prematch" | "auto" | "teleop" | "endgame" | "misc";

export type GameSection = {
  id: string;
  title: string;
  phase: GameSectionPhase;
  /** Sub-groups of the section (a heading above a few related fields). Fields name one by `group`. */
  groups?: readonly { id: string; title: string }[];
};

/**
 * How a field turns into points. Mirrors what CS's `analyticsScoring.ts` does:
 *  - `perTally`: `Number(value || 0) * value` (counters);
 *  - `whenOn`: `value` when the value is truthy (toggles);
 *  - `optionExact`: the trimmed, lower-cased text is a key of `points` (CHARGED UP's charge station);
 *  - `optionIncludes`: the lower-cased text is matched against the ordered `rules`, first whose `includes` fragment is contained wins
 *    (REEFSCAPE's cage status: so "not-parked", which contains "park", scores 2, exactly as CS).
 */
export type GameFieldPoints =
  | { mode: "perTally"; value: number }
  | { mode: "whenOn"; value: number }
  | { mode: "optionExact"; points: Readonly<Record<string, number>> }
  | { mode: "optionIncludes"; rules: readonly { includes: readonly string[]; points: number }[] };

/** The three point groups CS's auto-flag rules reason about (`scoutingFlags.ts`): a field with `flagGroup` counts, at its points, toward that group. */
export type GameFlagGroup = "autoRobot" | "teleopRobot" | "teleopHuman";

export type GameFieldKind = "counter" | "toggle" | "select" | "number" | "text" | "textarea";

export type GameField = {
  /** Form value key (`auto_gridBottom`, `autoCoralL1`). */
  key: string;
  /** Dotted CS doc path (`auto.gridBottom`, `autoCoralL1`). */
  path: string;
  /** More doc paths the value is also written to and, when `path` is absent, read from, in this order (CHARGED UP writes `mobility` at both `auto.mobility` and `mobility`; CS scores `auto.mobility ?? mobility`). */
  mirrors?: readonly string[];
  kind: GameFieldKind;
  label: string;
  /** The id of the section the field sits in (one of `GameDefinition.sections`). */
  section: string;
  group?: string;
  /** The middle header of the analytics table (default: the group's title, else the section's). */
  category: string;
  helpText?: string;
  placeholder?: string;
  /** `select` only: the choices (the value CS stores, and its label). The empty "nothing chosen" choice is the placeholder, not an option. */
  options?: readonly { value: string; label: string }[];
  points?: GameFieldPoints;
  flagGroup?: GameFlagGroup;
  /** Auto-flag: a counter or number above this is "unrealistic scoring" (carried onto the generated form field, which the flag rules read). */
  unrealisticAbove?: number;
  /** `textarea`/`text` that mirrors to the entry's summary comment (CS `notes`). */
  statRoles?: readonly StatRole[];
};

export type GameIncident = { value: string; label: string; statRoles?: readonly StatRole[] };

/** Auto-flag thresholds of a points game (`scoutingFlags.ts evaluateReefscapeFlags`). `{human}`, `{auto}` in a detail are replaced by the figure. */
export type GameFlagRules = {
  humanPlayerHeavy: { label: string; detail: string; minHumanPoints: number; shareOfRobotPoints: number };
  autoOnlyNoTeleop: { label: string; detail: string; minAutoPoints: number };
  zeroMainScoring: { label: string; detail: string };
};

/** What every game has, whichever way its plugin and form are made. */
export type GameBase<Id extends string = GameId> = {
  /** The id of a game of the default program is a `GameId`; another program's games name their own id type. */
  id: Id;
  label: string;
  /** Calendar year the game was played (2026 for REBUILT). */
  year: number;
  /**
   * True when entries for this game can be written (the scout form, practice scouting and the admin editor all save through the adapter).
   * A game with `submittable: false` would stay a read-only plugin; all three of CompSocrates's games are submittable.
   */
  submittable: boolean;
  /** `lib/forms` built-in form id (also the season's form): the id an entry is attributed to. */
  formId: string;
  /** A CS doc with no `game` field belongs to this game (CS quirk: those docs are REEFSCAPE). */
  docsWithoutGame?: true;
  /** CS's list of things that occurred in a match (`incidents: string[]` on the doc; one checkbox each in the form). */
  incidents: readonly GameIncident[];
  /** Rescout (exemplar) comparison fields, in CS order. */
  rescoutFields: readonly RescoutFieldSpec[];
  /** Alliance-score cut-offs CS's practice flow uses to label a match easy / medium / hard (`practice-scouting scoreToDifficulty`). */
  thresholds: { difficulty: { easyMax: number; mediumMax: number } };
  /** Strings the generated form shows. */
  strings: {
    formDescription: string;
    startingPositionPlaceholder: string;
    notesPlaceholder: string;
    penaltyHelp: string;
  };
};

/**
 * A pure point table: no `formulas`. Its plugin and its form are generated from `fields`
 * (`createPointTablePlugin`, `buildGameForm`).
 */
export type PointTableGameDefinition<Id extends string = GameId> = GameBase<Id> & {
  formulas?: undefined;
  /** Section ids, titles and score phases of the generated form, in order. The match and scout pickers are always added in front. */
  sections: readonly GameSection[];
  /** The fields, in form order. */
  fields: readonly GameField[];
  /** CS doc path of the penalty points the official result adds to a total. */
  penaltyPath?: string;
  /** Auto-flag rules, for a game that has them (CS raises none for CHARGED UP). */
  flags?: GameFlagRules;
};

/**
 * A game whose scoring has cross-field logic: `formulas` names the hand-written plugin in `lib/games/` (REBUILT's fuel formulas) and the form
 * is hand-built too (`lib/forms/builtin-rebuilt.ts`). The entry carries the numbers those use (scales, points, shifts, flag thresholds ...).
 */
export type FormulaGameDefinition = GameBase & {
  formulas: "rebuilt";
};

export type GameDefinition = PointTableGameDefinition | FormulaGameDefinition;

export const isPointTable = (def: GameDefinition): def is PointTableGameDefinition => def.formulas === undefined;
