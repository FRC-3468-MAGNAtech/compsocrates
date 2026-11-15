// Session E: the ONE place a form's human-readable name is built: `<GAME> <Form Type> Form` ("REBUILT Match Scout Form", "CHARGED UP Helper Form").
// Display only. A stored form id, a collection name or a saved form doc's own `name` is never renamed or rewritten from here, so existing data keeps matching.
// Pure (no React, no Firebase): the hook that feeds it the program's game label is `lib/forms/use-form-display-name.ts`.

import type { Form, FormType } from "@/lib/forms/types";

/** What each built-in form type is called inside the name (no game, no trailing "Form"). `custom` has no label: a custom form keeps its own name. */
export const FORM_TYPE_LABELS: Readonly<Record<Exclude<FormType, "custom">, string>> = {
  "match-scout": "Match Scout",
  "lead-scout": "Lead Scout",
  "pit-scout": "Pit Scout",
  "team-strategy": "Team Strategy",
  "match-strategy": "Match Strategy",
  "drive-reflection": "Drive Reflection",
  helper: "Helper",
};

/** A game as the helper accepts it: the label itself, or any object carrying one (`GameDefinition.label`, `Season.name`). */
export type GameLike = string | { label?: string; name?: string } | null | undefined;

const squash = (text: string): string => text.replace(/\s+/g, " ").trim();
const normalizedWords = (text: string): string => squash(text).toLowerCase().replace(/[_-]+/g, " ");

/** The label of a game, whatever shape it came in ("" when there is none). */
export function gameLabel(game: GameLike): string {
  if (!game) return "";
  return squash(typeof game === "string" ? game : (game.label ?? game.name ?? ""));
}

/** The type's own label ("Match Scout"), or null for `custom` and for a type this module does not know. */
export function formTypeLabel(formType: string | null | undefined): string | null {
  return formType && Object.hasOwn(FORM_TYPE_LABELS, formType) ? FORM_TYPE_LABELS[formType as keyof typeof FORM_TYPE_LABELS] : null;
}

/** `text` without the game at the front (`REBUILT Match Scout` -> `Match Scout`), repeated, and without the word "Form" at the end, repeated. */
function stripGameAndForm(text: string, game: string): string {
  let out = squash(text);
  const gameWords = normalizedWords(game);
  for (;;) {
    const lower = normalizedWords(out);
    if (gameWords && lower.startsWith(`${gameWords} `)) {
      // (`_` and `-` normalise one for one, so the game's length is the length of what to drop)
      out = squash(out.slice(game.length));
      continue;
    }
    if (gameWords && lower === gameWords) return "";
    if (/\sform$/i.test(out) || /^form$/i.test(out)) {
      out = squash(out.replace(/\s*form$/i, ""));
      continue;
    }
    return out;
  }
}

/**
 * `<GAME> <Form Type> Form`. A game or type label that already carries the game or the word "Form" is not repeated, so
 * `formDisplayName("REBUILT", "match-scout")` and a label of "REBUILT Match Scout Form" both read "REBUILT Match Scout Form".
 * With no game it is `<Form Type> Form`. A type with no label (`custom`, unknown) returns `options.fallback` (the stored name) or "".
 */
export function formDisplayName(game: GameLike, formType: string | null | undefined, options: { typeLabel?: string; fallback?: string } = {}): string {
  const label = gameLabel(game);
  const type = options.typeLabel ?? formTypeLabel(formType);
  if (!type) return options.fallback ?? "";
  const core = stripGameAndForm(type, label);
  if (!core) return squash([label, "Form"].filter(Boolean).join(" "));
  return squash([label, core, "Form"].filter(Boolean).join(" "));
}

/**
 * The name to show for a form object. A built-in (or an account's copy of one) whose stored name is just the default (the game, the type, with or without
 * "Form") reads as `formDisplayName`. A custom or template form, and a built-in an admin renamed to something of their own, keep the stored name unchanged.
 */
export function displayNameOfForm(form: Pick<Form, "name" | "formType" | "origin">, game: GameLike): string {
  const stored = form.name;
  if (form.origin === "custom" || form.origin === "template") return stored;
  const type = formTypeLabel(form.formType);
  if (!type) return stored;
  const label = gameLabel(game);
  const core = normalizedWords(stripGameAndForm(stored, label));
  const isDefault = core === "" || core === normalizedWords(type);
  return isDefault ? formDisplayName(game, form.formType) : stored;
}

/** The form's display name when the game is not at hand: the form's own season tag does not name the label, so this is only the type's ("Match Scout Form"). */
export const formTypeDisplayName = (formType: string | null | undefined, fallback = ""): string => formDisplayName(null, formType, { fallback });
