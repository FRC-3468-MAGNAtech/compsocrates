"use client";

import { useCallback } from "react";
import type { FormType } from "@/lib/forms/types";
import { useFormDisplayNames } from "@/lib/forms/use-form-display-name";

/**
 * The text of a navigation entry or a page-access row. An entry that opens a form (it carries a `formType`) reads `<GAME> <Form Type> Form` for the program's
 * current game, from the one helper (`formDisplayName`); any other entry keeps its own text. The static `label`/`title` stays the fallback and what tests read.
 */
export function useNavLabel(): (entry: { label?: string; title?: string; formType?: FormType }) => string {
  const names = useFormDisplayNames();
  return useCallback((entry) => (entry.formType ? names.forType(entry.formType, entry.label ?? entry.title) : (entry.label ?? entry.title ?? "")), [names]);
}
