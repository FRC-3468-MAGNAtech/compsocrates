import { describe, expect, it } from "vitest";
import { FTC_GAME_DEFINITIONS } from "@/config/games/ftc";
import { allianceRoleFor, formWithRoles, hasAllianceRoles } from "@/lib/forms/alliance-role";
import { buildFtcGameForm } from "@/lib/ftc/games";
import type { Form } from "@/lib/forms/types";

// A form override saved in Firestore before the alliance roles existed (the sister app's version of the game form) has no role block. A practice session
// scouted with it showed no "You are scouting" message and both robots recorded every objective.
const builtin = buildFtcGameForm(FTC_GAME_DEFINITIONS.BIOBUZZ);
const oldOverride: Form = {
  ...builtin,
  version: 7,
  sections: builtin.sections.map((s) => ({
    ...s,
    fields: s.fields.filter((f) => f.allianceRole === undefined && f.key !== "allianceRole").map((f) => ({ ...f, visibleWhen: undefined })),
  })),
};
const input = { eventKey: "EV_Q1", matchType: "", matchNumber: 0, alliance: "red" as const, sessionId: "PS-ABCDEF", teams: [111, 222] };

describe("the form a practice session uses", () => {
  it("the test override really has no role block, so it cannot split the roles", () => {
    expect(hasAllianceRoles(builtin)).toBe(true);
    expect(hasAllianceRoles(oldOverride)).toBe(false);
    expect(allianceRoleFor(oldOverride, { ...input, teamNumber: 111 })).toBeNull();
  });

  it("an override without roles is replaced by the built-in form, so the two robots get opposite roles", () => {
    const form = formWithRoles(oldOverride, builtin);
    expect(form).toBe(builtin);
    const a = allianceRoleFor(form, { ...input, teamNumber: 111 });
    const b = allianceRoleFor(form, { ...input, teamNumber: 222 });
    expect([a, b].sort()).toEqual(["garden", "hive"]);
  });

  it("an override that does split roles, a form with no roles in code, and a program with no built-in are all left alone", () => {
    expect(formWithRoles(builtin, builtin)).toBe(builtin);
    const custom = { ...builtin, version: 9 };
    expect(formWithRoles(custom, builtin)).toBe(custom);
    expect(formWithRoles(oldOverride, undefined)).toBe(oldOverride);
    expect(formWithRoles(oldOverride, null)).toBe(oldOverride);
    expect(formWithRoles(oldOverride, oldOverride)).toBe(oldOverride);
  });
});
