import { isSystemField, type Form } from "@/lib/forms/types";

/** The form without its system pickers (event, match, alliance, team, scout): who and what an entry is for is not an answer, so the admin answer editor leaves it out. */
export function withoutSystemFields(form: Form): Form {
  return { ...form, sections: form.sections.map((s) => ({ ...s, fields: s.fields.filter((f) => !isSystemField(f)) })).filter((s) => s.fields.length > 0) };
}
