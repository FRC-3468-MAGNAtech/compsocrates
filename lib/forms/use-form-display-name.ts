"use client";

import { useMemo } from "react";
import { displayNameOfForm, formDisplayName } from "@/lib/forms/form-display-name";
import { useForms } from "@/lib/forms/forms-context";
import type { Form } from "@/lib/forms/types";

export type FormDisplayNames = {
  /** The game (season) label the names are built with ("REBUILT"). */
  gameName: string;
  /** `<GAME> <Form Type> Form` for a form type ("match-scout"); `fallback` for a type with no label (a custom form). */
  forType: (formType: string | null | undefined, fallback?: string) => string;
  /** The name to show for a form object: the game of its own season tag when it has one, else this hook's game. Custom forms keep their name. */
  forForm: (form: Pick<Form, "name" | "formType" | "origin" | "tags">) => string;
};

/**
 * The display-name helper bound to the active program's game list (`useForms().seasons`: the program's own games).
 * `seasonId` picks the game; omitted, the program's current one. Display only: never write the result to Firestore.
 */
export function useFormDisplayNames(seasonId?: string): FormDisplayNames {
  const forms = useForms();
  return useMemo(() => {
    const season = forms.seasonFor(seasonId);
    const gameName = season.name;
    const seasonOfTag = (tags: readonly string[] | undefined): string | null => {
      const tag = tags?.map((t) => t.toLowerCase().replace(/-/g, "_")).find((t) => forms.seasons.some((s) => s.id === t));
      return tag ? forms.seasonFor(tag).name : null;
    };
    return {
      gameName,
      forType: (formType, fallback) => formDisplayName(gameName, formType, { fallback }),
      forForm: (form) => displayNameOfForm(form, seasonOfTag(form.tags) ?? gameName),
    };
  }, [forms, seasonId]);
}
