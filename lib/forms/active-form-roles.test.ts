import { describe, expect, it } from "vitest";
import { buildFormsValue } from "@/lib/forms/forms-context";
import { hasAllianceRoles } from "@/lib/forms/alliance-role";
import { calculateScore } from "@/lib/forms/scoring";
import { normalizeValues } from "@/lib/forms/values";
import { versionKey, type FormDoc } from "@/lib/forms/resolve";
import type { Form } from "@/lib/forms/types";
import { ftcProgramData } from "@/lib/ftc/program-data";

// Batch 5b: a form an admin made active (a built-in override or a custom form) can never take the BIOBUZZ role split away. Without the Hive/Garden block both scouts of an
// alliance would record every objective and the alliance would count twice, so the season's built-in form is used instead, exactly as the practice screen already does.

const games = ftcProgramData.games;
const season = games.seasons[0];
const builtin = games.builtinForms[season.formId] as Form;

/** The same form with every alliance-role field (and the role field itself) taken out: what a builder edit could produce. */
const withoutRoles = (form: Form, id: string, name: string): Form => ({
  ...form,
  id,
  name,
  sections: form.sections.map((s) => ({ ...s, fields: s.fields.filter((f) => f.allianceRole === undefined && f.key !== "allianceRole") })),
});

const doc = (formId: string, origin: FormDoc["origin"]): FormDoc => ({ teamId: "T1", formId, name: formId, origin, publishedVersion: 1, draft: null, active: true, archived: false, createdBy: "u1" });

function catalogWith(form: Form, origin: FormDoc["origin"]) {
  return { docs: new Map([[form.id, doc(form.id, origin)]]), versions: new Map([[versionKey(form.id, 1), form]]), builtins: games.builtinForms };
}

describe("active match form and the alliance roles", () => {
  it("the built-in form splits roles (the premise)", () => {
    expect(hasAllianceRoles(builtin)).toBe(true);
  });

  it("an edited built-in with no role block is not used for scouting: the built-in is", () => {
    const edited = withoutRoles(builtin, season.formId, "Edited");
    expect(hasAllianceRoles(edited)).toBe(false);
    const value = buildFormsValue(catalogWith(edited, "built-in-override"), true, {}, () => {}, new Set(), games);
    expect(hasAllianceRoles(value.activeFormFor(season.id))).toBe(true);
  });

  it("a custom form chosen as active without the role block falls back to the built-in", () => {
    const custom = withoutRoles(builtin, "my-form", "My form");
    const value = buildFormsValue(catalogWith(custom, "custom"), true, { [season.id]: "my-form" }, () => {}, new Set(), games);
    expect(value.activeFormIdFor(season.id)).toBe("my-form");
    expect(hasAllianceRoles(value.activeFormFor(season.id))).toBe(true);
    expect(value.activeFormFor(season.id).id).toBe(season.formId);
  });

  it("a custom form that keeps the role block is used as chosen", () => {
    const custom: Form = { ...builtin, id: "my-roles", name: "My roles" };
    const value = buildFormsValue(catalogWith(custom, "custom"), true, { [season.id]: "my-roles" }, () => {}, new Set(), games);
    expect(value.activeFormFor(season.id).id).toBe("my-roles");
  });

  it("the season's built-in is offered to the Forms tab (to say why a form is refused)", () => {
    const value = buildFormsValue({ docs: new Map(), versions: new Map(), builtins: games.builtinForms }, true, {}, () => {}, new Set(), games);
    expect(value.builtinFormFor(season.id)?.id).toBe(season.formId);
  });

  it("a saved entry's role stays absent for the other role's fields and absent counts as 0 in the score (the role logic is untouched)", () => {
    const values = normalizeValues(builtin, { allianceRole: "hive", autoTipHive: 2, teleTipHive: 1 });
    expect("flowerBottomNectar" in values).toBe(false);
    const score = calculateScore(builtin, values);
    expect(Number.isFinite(score.total)).toBe(true);
    expect(score.total).toBeGreaterThan(0);
  });
});

describe("the default program is untouched", () => {
  it("a game whose built-in has no roles uses whatever is active, as before", () => {
    const value = buildFormsValue({ docs: new Map(), versions: new Map() }, true, {}, () => {});
    expect(hasAllianceRoles(value.activeFormFor())).toBe(false);
    expect(value.builtinFormFor()?.id).toBe(value.activeFormFor().id);
  });
});
