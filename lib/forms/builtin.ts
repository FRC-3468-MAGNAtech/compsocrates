import type { Form } from "@/lib/forms/types";
import { formContentHash } from "@/lib/forms/hash";
import { REBUILT_FORM } from "@/lib/forms/builtin-rebuilt";
import { REBUILT_NON_MATCH_FORMS } from "@/lib/forms/builtin-rebuilt-forms";
import { buildGameForm } from "@/lib/forms/game-form";
import { CURRENT_GAME_ID, GAME_DEFINITIONS, GAME_ID_LIST, isPointTable, type GameDefinition } from "@/config/games";
import type { CsFormType } from "@/data/cs/form-field-keys";

// P21: the forms that live in code. This file assembles them from the game definitions (config/games/*): a point-table game's match form is GENERATED from its
// definition (lib/forms/game-form.ts), a game with `formulas` names its hand-built form (REBUILT). The non-match forms (pit, lead, strategy, drive, helper)
// exist for REBUILT only, as in CS.

/** The hand-built match forms a definition's `formulas` key can name. */
const FORMULA_FORMS: Record<NonNullable<GameDefinition["formulas"]>, Form> = { rebuilt: REBUILT_FORM };

/** Each game's match scouting form, by form id (REBUILT, REEFSCAPE, CHARGED UP). */
export const GAME_FORMS: Readonly<Record<string, Form>> = Object.fromEntries(
  GAME_ID_LIST.map((id) => {
    const def = GAME_DEFINITIONS[id];
    const form = isPointTable(def) ? buildGameForm(def) : FORMULA_FORMS[def.formulas];
    return [def.formId, form] as const;
  })
);

/**
 * Every form defined in code, by id. An account's override (copy-on-write) of one of these lives in Firestore and wins when it exists.
 * The three games' match forms, and the six non-match forms under the adapter's ids ("pit-scout-v1", ...).
 */
export const BUILTIN_FORMS: Readonly<Record<string, Form>> = {
  ...GAME_FORMS,
  ...REBUILT_NON_MATCH_FORMS,
};

/** The default match form: the current game's (REBUILT). */
export const DEFAULT_FORM_ID: string = GAME_DEFINITIONS[CURRENT_GAME_ID].formId;

/** The six non-match form types CS persists, as the adapter names them (data/cs/form-field-keys.ts). */
export type NonMatchFormType = CsFormType;

/** The id of each non-match form: the ids the CS adapter attributes entries to. */
export const NON_MATCH_FORM_IDS: Readonly<Record<NonMatchFormType, string>> = {
  "pit-scout": "pit-scout-v1",
  "lead-scout": "lead-scout-v1",
  "team-strategy": "team-strategy-v1",
  "match-strategy": "match-strategy-v1",
  "drive-reflection": "drive-reflection-v1",
  helper: "helper-v1",
};

const NON_MATCH_TYPE_BY_ID = new Map<string, NonMatchFormType>((Object.entries(NON_MATCH_FORM_IDS) as [NonMatchFormType, string][]).map(([type, id]) => [id, type]));

/** The non-match form type of a built-in id ("pit-scout-v1"), or null for any other id. */
export const nonMatchTypeOfFormId = (id: string): NonMatchFormType | null => NON_MATCH_TYPE_BY_ID.get(id) ?? null;

/**
 * The form id a page should use for a non-match form: pass the id ("pit-scout-v1") or the form type ("pit-scout"); an id that is not one of the six (a custom
 * form) comes back unchanged.
 */
export function seasonFormId(idOrType: string): string {
  if (Object.hasOwn(NON_MATCH_FORM_IDS, idOrType)) return NON_MATCH_FORM_IDS[idOrType as NonMatchFormType];
  return idOrType;
}

export { REBUILT_FORM };

export function getBuiltinForm(id: string): Form | null {
  return BUILTIN_FORMS[id] ?? null;
}

/** Content hash of a built-in, stored on an override so a later change to the code-defined original can be detected. */
export function builtinHash(id: string): string | null {
  const form = BUILTIN_FORMS[id];
  return form ? formContentHash(form) : null;
}
