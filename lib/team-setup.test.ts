import { describe, expect, it } from "vitest";
import { parseJoinCode, validateNewTeam, validateCreate, validateJoin } from "@/lib/team-setup";

const ok = { teamNumber: "1234", teamName: "Robo Owls", location: "", displayName: "Sam" };

describe("validateNewTeam", () => {
  it("accepts a number of 1 to 5 digits, a name and an optional location", () => {
    expect(validateNewTeam(ok)).toEqual({ number: 1234, errors: {} });
    expect(validateNewTeam({ ...ok, teamNumber: "7", location: "Austin, TX" }).errors).toEqual({});
  });
  it.each(["", "0", "123456", "12a", "-5", "1.5"])("rejects the team number %j", (teamNumber) => {
    expect(validateNewTeam({ ...ok, teamNumber }).errors.teamNumber).toBeTruthy();
  });
  it("requires a team name and your name, and bounds their length", () => {
    expect(validateNewTeam({ ...ok, teamName: "  " }).errors.teamName).toBeTruthy();
    expect(validateNewTeam({ ...ok, displayName: "" }).errors.displayName).toBeTruthy();
    expect(validateNewTeam({ ...ok, teamName: "x".repeat(81) }).errors.teamName).toBeTruthy();
    expect(validateNewTeam({ ...ok, location: "x".repeat(81) }).errors.location).toBeTruthy();
  });
});

describe("parseJoinCode", () => {
  it("uppercases and trims, and rejects anything that cannot be a document id", () => {
    expect(parseJoinCode(" ab3d9xk2 ")).toBe("AB3D9XK2");
    expect(parseJoinCode("")).toBeNull();
    expect(parseJoinCode("ab/cd")).toBeNull();
    expect(parseJoinCode("ab cd")).toBeNull();
  });
});

describe("validateJoin / validateCreate (the one setup form of both programs)", () => {
  it("join: needs a usable code and a name", () => {
    expect(validateJoin({ joinCode: " abcd2345 ", displayName: "Ada" })).toEqual({ code: "ABCD2345", errors: {} });
    expect(validateJoin({ joinCode: "a/b", displayName: " " }).errors).toEqual({ joinCode: expect.any(String), displayName: expect.any(String) });
    expect(validateJoin({ joinCode: "ABCD2345", displayName: "x".repeat(81) }).errors.displayName).toMatch(/under 80/);
  });

  it("create: a 1-5 digit team number, an optional team name of at most 80 characters", () => {
    expect(validateCreate({ teamNumber: "3468", teamName: "" })).toEqual({ number: 3468, teamName: "", errors: {} });
    expect(validateCreate({ teamNumber: " 12 ", teamName: " Owls " })).toMatchObject({ number: 12, teamName: "Owls", errors: {} });
    expect(validateCreate({ teamNumber: "0", teamName: "" }).errors.teamNumber).toBeDefined();
    expect(validateCreate({ teamNumber: "123456", teamName: "" }).errors.teamNumber).toBeDefined();
    expect(validateCreate({ teamNumber: "1", teamName: "x".repeat(81) }).errors.teamName).toMatch(/under 80/);
  });
});

import { creationMode, TEAM_CREATION_CLOSED_TEXT } from "@/lib/team-setup";

describe("creationMode (the Create tab's state, one rule for every program)", () => {
  it("is unknown while loading, open only on an explicit true, and otherwise an application or a closed notice", () => {
    expect(creationMode(null, true)).toBe("loading");
    expect(creationMode(null, false)).toBe("loading");
    expect(creationMode(true, true)).toBe("open");
    expect(creationMode(true, false)).toBe("open");
    expect(creationMode(false, true)).toBe("apply");
    expect(creationMode(false, false)).toBe("closed");
  });
  it("the closed notice says applications are not open yet and points at the join code", () => {
    expect(TEAM_CREATION_CLOSED_TEXT).toContain("aren't open yet");
    expect(TEAM_CREATION_CLOSED_TEXT).toContain("join code");
  });
});
