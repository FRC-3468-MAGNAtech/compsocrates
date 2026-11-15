import { describe, expect, it } from "vitest";
import { BUILTIN_FORMS } from "@/lib/forms/builtin";
import { withoutSystemFields } from "@/lib/forms/editable-form";
import { isSystemField } from "@/lib/forms/types";

describe("the form an admin edits an entry with", () => {
  it("every built-in form keeps its answer fields and loses its system pickers", () => {
    for (const form of Object.values(BUILTIN_FORMS)) {
      const editable = withoutSystemFields(form);
      const fields = editable.sections.flatMap((s) => s.fields);
      expect(fields.length, form.id).toBeGreaterThan(0);
      expect(fields.some(isSystemField), form.id).toBe(false);
      expect(editable.sections.every((s) => s.fields.length > 0), form.id).toBe(true);
    }
  });

  it("does not change the form it is given", () => {
    const form = BUILTIN_FORMS["pit-scout-v1"];
    const before = JSON.stringify(form);
    withoutSystemFields(form);
    expect(JSON.stringify(form)).toBe(before);
  });
});
