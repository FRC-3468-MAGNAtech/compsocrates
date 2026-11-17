import { describe, expect, it } from "vitest";
import { FTC_GAME_DEFINITIONS, FTC_GAME_ID_LIST } from "@/config/games/ftc";
import { displayNameOfForm, formDisplayName } from "@/lib/forms/form-display-name";
import { FTC_BUILTIN_FORMS } from "@/lib/ftc/games";

// the second program's game names its forms the same way
describe("form display names of this program's game", () => {
  it("builds `<GAME> <Form Type> Form` from the game's own label", () => {
    const label = FTC_GAME_DEFINITIONS[FTC_GAME_ID_LIST[0]].label;
    expect(label).toBe("BIOBUZZ");
    expect(formDisplayName(label, "match-scout")).toBe("BIOBUZZ Match Scout Form");
    expect(formDisplayName(label, "helper")).toBe("BIOBUZZ Helper Form");
  });

  it("renames every built-in form's default name, and the match form reads BIOBUZZ Match Scout Form", () => {
    for (const form of Object.values(FTC_BUILTIN_FORMS)) {
      const shown = displayNameOfForm(form, "BIOBUZZ");
      expect(shown).toBe(formDisplayName("BIOBUZZ", form.formType));
      expect(shown.match(/Form/g)).toHaveLength(1);
    }
    expect(displayNameOfForm(FTC_BUILTIN_FORMS.biobuzz, "BIOBUZZ")).toBe("BIOBUZZ Match Scout Form");
  });
});
