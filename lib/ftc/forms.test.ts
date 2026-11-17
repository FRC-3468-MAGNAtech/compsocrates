import { describe, expect, it } from "vitest";
import { checkForm } from "@/lib/forms/validate";
import { FTC_BUILTIN_FORMS, FTC_GAME_FORMS } from "@/lib/ftc/games";
import { PIT_BUILTIN_FORMS } from "@/lib/ftc/forms/pit-forms";
import { TEAM_BUILTIN_FORMS } from "@/lib/ftc/forms/team-forms";
import { BUILTIN_FORMS } from "@/lib/forms/builtin";
import { ftcProgramData } from "@/lib/ftc/program-data";

// The ids and form types are the ones the stored entries and form docs of this program already use (the sister app's built-in forms).
const EXPECTED: Record<string, string> = {
  "lead-scout-v1": "lead-scout",
  "match-strategy-v1": "match-strategy",
  "drive-reflection-v1": "drive-reflection",
  "pit-scout-v1": "pit-scout",
  "team-strategy-v1": "team-strategy",
  "helper-v1": "helper",
};

describe("the FTC program's built-in forms", () => {
  it("has the six non-match forms under the ids and types stored entries use, beside the match form", () => {
    const all = { ...TEAM_BUILTIN_FORMS, ...PIT_BUILTIN_FORMS };
    expect(Object.fromEntries(Object.entries(all).map(([id, f]) => [id, f.formType]))).toEqual(EXPECTED);
    expect(Object.keys(FTC_BUILTIN_FORMS).sort()).toEqual([...Object.keys(EXPECTED), ...Object.keys(FTC_GAME_FORMS)].sort());
    expect(ftcProgramData.games.builtinForms).toBe(FTC_BUILTIN_FORMS);
  });

  it("every form is keyed by its own id and is valid in this engine (no blocking issue)", () => {
    for (const [id, form] of Object.entries(FTC_BUILTIN_FORMS)) {
      expect(form.id, id).toBe(id);
      expect(checkForm(form).filter((i) => i.severity === "error"), id).toEqual([]);
    }
  });

  it("none of them leaks into the default program's built-in forms", () => {
    for (const id of ["biobuzz"]) expect(BUILTIN_FORMS[id]).toBeUndefined();
    // the default program has its own forms under the same ids; they are different objects
    for (const id of Object.keys(EXPECTED)) if (BUILTIN_FORMS[id]) expect(BUILTIN_FORMS[id]).not.toBe(FTC_BUILTIN_FORMS[id]);
  });
});
