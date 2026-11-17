import { describe, expect, it } from "vitest";
import { MAX_ACCOUNT_TEAMS, effectiveTeamIds, membersAssignedTo, newAccountTeamId, removalCheck, sameIds, sanitizeTeamName, toggleAssignment, upsertTeam, validateAccountTeams } from "@/lib/account-teams";
import type { AccountTeam } from "@/lib/team-number";

const A: AccountTeam = { id: "ft-1", number: 35792, name: "Alpha" };
const B: AccountTeam = { id: "ft-2", number: 35794, name: null };
const C: AccountTeam = { id: "ft-3", number: 100, name: "Gamma" };

describe("sanitizeTeamName", () => {
  it("strips control characters, collapses spaces and limits the length", () => {
    expect(sanitizeTeamName("  Robo\u0000\u0007 \n Tigers  ")).toBe("Robo Tigers");
    expect(sanitizeTeamName("x".repeat(200))).toHaveLength(60);
    expect(sanitizeTeamName(42)).toBe("");
  });
});

describe("validateAccountTeams", () => {
  it("accepts a good list", () => expect(validateAccountTeams([A, B])).toEqual([]));
  it("needs one team, at most the limit, valid unique numbers and ids", () => {
    expect(validateAccountTeams([])).toHaveLength(1);
    const many = Array.from({ length: MAX_ACCOUNT_TEAMS + 1 }, (_, i) => ({ id: `t${i}`, number: i + 1, name: null }));
    expect(validateAccountTeams(many).join(" ")).toContain("at most");
    expect(validateAccountTeams([A, { ...B, number: 35792 }]).join(" ")).toContain("already on this account");
    expect(validateAccountTeams([{ ...A, number: 123456 }]).join(" ")).toContain("1 to 5 digits");
    expect(validateAccountTeams([A, { ...B, id: "ft-1" }]).join(" ")).toContain("repeated id");
    expect(validateAccountTeams([{ ...A, name: "n".repeat(61) }]).join(" ")).toContain("at most 60");
  });
});

describe("assignment", () => {
  it("a member with no list, or a stale one, counts as every team", () => {
    expect(effectiveTeamIds(undefined, [A, B])).toEqual(["ft-1", "ft-2"]);
    expect(effectiveTeamIds([], [A, B])).toEqual(["ft-1", "ft-2"]);
    expect(effectiveTeamIds(["gone"], [A, B])).toEqual(["ft-1", "ft-2"]);
    expect(effectiveTeamIds(["ft-2"], [A, B])).toEqual(["ft-2"]);
  });
  it("only an explicit listing blocks a removal, and the last team is never removable", () => {
    const members = [{ uid: "u1", name: "Ada", assignedTeamIds: ["ft-2"] }, { uid: "u2", name: "Bo" }];
    expect(membersAssignedTo("ft-2", members).map((m) => m.uid)).toEqual(["u1"]);
    expect(removalCheck("ft-2", [A, B], members)).toEqual({ ok: false, reason: "assigned", members: [{ uid: "u1", name: "Ada" }] });
    expect(removalCheck("ft-1", [A, B], members)).toEqual({ ok: true });
    expect(removalCheck("ft-1", [A], members)).toMatchObject({ ok: false, reason: "last-team" });
  });
  it("toggling starts from what the member effectively has and never leaves them with none", () => {
    expect(toggleAssignment(undefined, "ft-1", false, [A, B, C])).toEqual(["ft-2", "ft-3"]);
    expect(toggleAssignment(["ft-2"], "ft-1", true, [A, B, C])).toEqual(["ft-1", "ft-2"]);
    expect(toggleAssignment(["ft-2"], "ft-2", false, [A, B, C])).toBeNull();
  });
});

describe("misc", () => {
  it("upsertTeam renames in place and appends a new team", () => {
    expect(upsertTeam([A, B], { ...A, name: "Renamed" })[0].name).toBe("Renamed");
    expect(upsertTeam([A], B)).toEqual([A, B]);
  });
  it("ids look like fteam_xxxxxxxx; sameIds ignores order", () => {
    expect(newAccountTeamId(() => 0.5)).toMatch(/^fteam_[a-z0-9]{8}$/);
    expect(sameIds(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameIds(["a"], ["a", "b"])).toBe(false);
  });
});
