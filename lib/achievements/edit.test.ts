import { describe, expect, it } from "vitest";
import { EMPTY_ACHIEVEMENT_CONFIG, effectiveAchievements, validateConfigInput } from "./config";
import { blankCustom, isDirty, moveAchievement, newCustomId, orderedIds, removeCustom, resetBuiltin, setBuiltinOverride, setCustomHidden, upsertCustom } from "./edit";

const base = EMPTY_ACHIEVEMENT_CONFIG;
const custom = { ...blankCustom("practice-sessions", "custom-aaaaaa"), name: "Practice Pro", description: "Five sessions." };

describe("editor operations", () => {
  it("renaming a built-in stores only what differs from the default; a default value or empty text clears it", () => {
    const renamed = setBuiltinOverride(base, "first-session", { name: "Rookie" });
    expect(renamed.overrides["first-session"]).toEqual({ name: "Rookie" });
    expect(setBuiltinOverride(renamed, "first-session", { name: "First Session" }).overrides["first-session"]).toBeUndefined();
    expect(setBuiltinOverride(renamed, "first-session", { name: "   " }).overrides["first-session"]).toBeUndefined();
    expect(setBuiltinOverride(base, "ghost", { name: "x" })).toBe(base);
  });
  it("hide and show a built-in; reset removes every override", () => {
    const hidden = setBuiltinOverride(base, "streak", { hidden: true });
    expect(hidden.overrides.streak).toEqual({ hidden: true });
    expect(setBuiltinOverride(hidden, "streak", { hidden: false }).overrides.streak).toBeUndefined();
    expect(resetBuiltin(setBuiltinOverride(hidden, "streak", { name: "Hot" }), "streak").overrides.streak).toBeUndefined();
  });
  it("create, edit, hide and delete a custom achievement", () => {
    const made = upsertCustom(base, custom);
    expect(made.custom).toHaveLength(1);
    expect(upsertCustom(made, { ...custom, name: "Renamed" }).custom.map((c) => c.name)).toEqual(["Renamed"]);
    expect(setCustomHidden(made, custom.id, true).custom[0].hidden).toBe(true);
    const gone = removeCustom(moveAchievement(made, custom.id, -1), custom.id);
    expect(gone.custom).toEqual([]);
    expect(gone.order).not.toContain(custom.id);
  });
  it("move by one place with the buttons; at the ends nothing moves", () => {
    const first = orderedIds(base)[0];
    expect(moveAchievement(base, first, -1)).toBe(base);
    const moved = moveAchievement(base, first, 1);
    expect(orderedIds(moved)[1]).toBe(first);
    const last = orderedIds(base).at(-1)!;
    expect(moveAchievement(base, last, 1)).toBe(base);
  });
  it("a moved order survives validation and shows in the effective list", () => {
    const moved = moveAchievement(upsertCustom(base, custom), custom.id, -1);
    const valid = validateConfigInput({ overrides: moved.overrides, custom: moved.custom, order: moved.order }, "all");
    expect(valid.ok).toBe(true);
    expect(effectiveAchievements(moved, "all").map((a) => a.def.id)).toEqual(moved.order);
  });
  it("dirty only when something changed", () => {
    expect(isDirty(base, base)).toBe(false);
    expect(isDirty(base, upsertCustom(base, custom))).toBe(true);
  });
  it("ids are valid custom ids", () => {
    expect(newCustomId(() => 0.5)).toMatch(/^custom-[a-z0-9]{6}$/);
    expect(validateConfigInput({ custom: [{ ...custom, id: newCustomId() }] }, "all").ok).toBe(true);
  });
});
