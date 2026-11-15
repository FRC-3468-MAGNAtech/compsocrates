import { describe, expect, it } from "vitest";
import { FORM_TYPES } from "@/lib/forms/types";
import { listGameDefinitions } from "@/config/games";
import { FTC_GAME_DEFINITIONS, FTC_GAME_ID_LIST } from "@/config/games/ftc";
import { BUILTIN_FORMS } from "@/lib/forms/builtin";
import { FTC_BUILTIN_FORMS } from "@/lib/ftc/games";
import { displayNameOfForm, formDisplayName, formTypeDisplayName, formTypeLabel, FORM_TYPE_LABELS, gameLabel } from "@/lib/forms/form-display-name";

describe("formDisplayName", () => {
  it("builds `<GAME> <Form Type> Form` from the issue's examples", () => {
    expect(formDisplayName("REBUILT", "match-scout")).toBe("REBUILT Match Scout Form");
    expect(formDisplayName("REEFSCAPE", "drive-reflection")).toBe("REEFSCAPE Drive Reflection Form");
    expect(formDisplayName("CHARGED UP", "helper")).toBe("CHARGED UP Helper Form");
    expect(formDisplayName("BIOBUZZ", "match-scout")).toBe("BIOBUZZ Match Scout Form");
  });

  it("covers every game of both programs and every built-in form type", () => {
    const games = [...listGameDefinitions().map((g) => g.label), ...FTC_GAME_ID_LIST.map((id) => FTC_GAME_DEFINITIONS[id].label)];
    expect(games).toEqual(["REBUILT", "REEFSCAPE", "CHARGED UP", "BIOBUZZ"]);
    for (const game of games) {
      for (const type of FORM_TYPES) {
        if (type === "custom") continue;
        const name = formDisplayName(game, type);
        expect(name).toBe(`${game} ${FORM_TYPE_LABELS[type]} Form`);
        expect(name.match(/Form/g)).toHaveLength(1);
        expect(name.split(game)).toHaveLength(2);
      }
    }
  });

  it("accepts a game object (a definition or a season)", () => {
    expect(formDisplayName({ label: "REBUILT" }, "pit-scout")).toBe("REBUILT Pit Scout Form");
    expect(formDisplayName({ name: "REEFSCAPE" }, "lead-scout")).toBe("REEFSCAPE Lead Scout Form");
    expect(gameLabel({ label: "  CHARGED   UP " })).toBe("CHARGED UP");
  });

  it("never repeats the game or the word Form", () => {
    expect(formDisplayName("REBUILT", "match-scout", { typeLabel: "REBUILT Match Scout" })).toBe("REBUILT Match Scout Form");
    expect(formDisplayName("REBUILT", "match-scout", { typeLabel: "REBUILT Match Scout Form" })).toBe("REBUILT Match Scout Form");
    expect(formDisplayName("REBUILT", "match-scout", { typeLabel: "Match Scout Form Form" })).toBe("REBUILT Match Scout Form");
    expect(formDisplayName("CHARGED UP", "helper", { typeLabel: "charged_up Helper form" })).toBe("CHARGED UP Helper Form");
    expect(formDisplayName("REBUILT", "match-scout", { typeLabel: "REBUILT" })).toBe("REBUILT Form");
  });

  it("falls back to the type alone with no game, and to the stored name for a type with no label", () => {
    expect(formDisplayName(null, "pit-scout")).toBe("Pit Scout Form");
    expect(formDisplayName("", "helper")).toBe("Helper Form");
    expect(formDisplayName(undefined, "helper")).toBe("Helper Form");
    expect(formDisplayName("REBUILT", "custom", { fallback: "Robot Photos" })).toBe("Robot Photos");
    expect(formDisplayName("REBUILT", "no-such-type")).toBe("");
    expect(formDisplayName("REBUILT", null, { fallback: "x" })).toBe("x");
    expect(formTypeLabel("custom")).toBeNull();
    expect(formTypeLabel("toString")).toBeNull();
    expect(formTypeDisplayName("match-scout")).toBe("Match Scout Form");
  });
});

describe("displayNameOfForm", () => {
  it("renames the built-in forms' default names, for every game and both programs", () => {
    for (const form of Object.values(BUILTIN_FORMS)) {
      const game = form.formType === "match-scout" ? form.name : "REBUILT";
      const shown = displayNameOfForm(form, game);
      expect(shown).toBe(formDisplayName(game, form.formType));
      expect(shown.match(/Form/g)).toHaveLength(1);
    }
    for (const form of Object.values(FTC_BUILTIN_FORMS)) {
      expect(displayNameOfForm(form, "BIOBUZZ")).toBe(formDisplayName("BIOBUZZ", form.formType));
    }
    expect(displayNameOfForm(BUILTIN_FORMS.reefscape, "REEFSCAPE")).toBe("REEFSCAPE Match Scout Form");
    expect(displayNameOfForm(BUILTIN_FORMS.charged_up, "CHARGED UP")).toBe("CHARGED UP Match Scout Form");
    expect(displayNameOfForm(FTC_BUILTIN_FORMS.biobuzz, "BIOBUZZ")).toBe("BIOBUZZ Match Scout Form");
  });

  it("does not touch the stored form", () => {
    const form = { name: "Helper", formType: "helper", origin: "built-in" } as const;
    displayNameOfForm(form, "REBUILT");
    expect(form.name).toBe("Helper");
  });

  it("keeps a custom or template form's own name, and an admin's own name for a built-in", () => {
    expect(displayNameOfForm({ name: "Robot Photos", formType: "custom", origin: "custom" }, "REBUILT")).toBe("Robot Photos");
    expect(displayNameOfForm({ name: "Pit Scout", formType: "pit-scout", origin: "template" }, "REBUILT")).toBe("Pit Scout");
    expect(displayNameOfForm({ name: "Our Pit Checklist", formType: "pit-scout", origin: "built-in-override" }, "REBUILT")).toBe("Our Pit Checklist");
    expect(displayNameOfForm({ name: "Pit Scout", formType: "pit-scout", origin: "built-in-override" }, "REBUILT")).toBe("REBUILT Pit Scout Form");
    expect(displayNameOfForm({ name: "REBUILT Pit Scout Form", formType: "pit-scout", origin: "built-in" }, "REBUILT")).toBe("REBUILT Pit Scout Form");
    expect(displayNameOfForm({ name: "Mystery", formType: "custom", origin: "built-in" }, "REBUILT")).toBe("Mystery");
  });
});
