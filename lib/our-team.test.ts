import { describe, expect, it } from "vitest";
import { chooseAccountTeam, ourTeamFrom } from "@/lib/our-team";
import { parseTeamNumber, readTeamIdentity, teamLabel } from "@/lib/team-number";

describe("ourTeamFrom", () => {
  it("reads CS's raw team doc: teamNumber is a string, teamName the name", () => {
    expect(ourTeamFrom({ teamNumber: "3468", teamName: "MAGNAtech" })).toEqual({ number: 3468, name: "MAGNAtech", loaded: true });
  });

  it("reads the adapter's TeamDoc (number / name) too, and prefers CS's own fields when both exist", () => {
    expect(ourTeamFrom({ number: 254, name: "Cheesy Poofs" })).toMatchObject({ number: 254, name: "Cheesy Poofs" });
    expect(ourTeamFrom({ teamNumber: "1114", number: 254 })).toMatchObject({ number: 1114 });
  });

  it("is empty (not loaded-gated) for a missing doc or a malformed number, and trims the name", () => {
    expect(ourTeamFrom(null)).toEqual({ number: null, name: null, loaded: true });
    expect(ourTeamFrom(undefined, false)).toEqual({ number: null, name: null, loaded: false });
    expect(ourTeamFrom({ teamNumber: "abc", teamName: "  " })).toEqual({ number: null, name: null, loaded: true });
    expect(ourTeamFrom({ teamNumber: "0" }).number).toBeNull();
    expect(ourTeamFrom({ teamNumber: "123456" }).number).toBeNull();
    expect(ourTeamFrom({ teamNumber: 971, teamName: " Spartan Robotics " })).toMatchObject({ number: 971, name: "Spartan Robotics" });
  });

  it("passes the loaded flag through", () => {
    expect(ourTeamFrom({ teamNumber: "1" }, false).loaded).toBe(false);
  });
});

describe("team numbers", () => {
  it("parses plain FRC numbers of 1 to 5 digits only", () => {
    expect(parseTeamNumber("3468")).toBe(3468);
    expect(parseTeamNumber(" 7 ")).toBe(7);
    expect(parseTeamNumber(35792)).toBe(35792);
    for (const bad of ["", "0", "-5", "12.5", "1e3", "123456", "abc", null, undefined]) expect(parseTeamNumber(bad as string | null | undefined)).toBeNull();
  });

  it("labels a team without any program prefix", () => {
    expect(teamLabel(3468)).toBe("Team 3468");
    expect(teamLabel(3468, " MAGNAtech ")).toBe("Team 3468 · MAGNAtech");
    expect(teamLabel(3468, "")).toBe("Team 3468");
  });

  it("readTeamIdentity is the server-safe half of ourTeamFrom", () => {
    expect(readTeamIdentity({ teamNumber: "3468", teamName: "A" })).toEqual({ number: 3468, name: "A" });
    expect(readTeamIdentity(null)).toEqual({ number: null, name: null });
  });
});

describe("chooseAccountTeam", () => {
  const teams = [
    { id: "a", number: 111, name: "Alpha" },
    { id: "b", number: 222, name: null },
    { id: "c", number: 333, name: "Gamma" },
  ];

  it("selects the stored pick while it is available, else the first", () => {
    expect(chooseAccountTeam(teams, "b").selected?.id).toBe("b");
    expect(chooseAccountTeam(teams, "gone").selected?.id).toBe("a");
    expect(chooseAccountTeam(teams, null).selected?.id).toBe("a");
    expect(chooseAccountTeam(teams, "b").teams.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("a member assigned to some teams can only pick those; the stored pick of another is ignored", () => {
    const r = chooseAccountTeam(teams, "a", ["c", "b"]);
    expect(r.teams.map((t) => t.id)).toEqual(["b", "c"]);
    expect(r.selected?.id).toBe("b");
    expect(chooseAccountTeam(teams, "c", ["c", "b"]).selected?.id).toBe("c");
  });

  it("no assignment (absent or empty), or one that matches nothing, means all teams", () => {
    for (const assigned of [undefined, null, [], ["zzz"]]) expect(chooseAccountTeam(teams, null, assigned).teams.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("no teams: nothing to choose", () => {
    expect(chooseAccountTeam([], "a")).toEqual({ teams: [], selected: null });
  });
});
