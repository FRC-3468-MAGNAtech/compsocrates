import { describe, expect, it } from "vitest";
import { parseJoinCode, validateNewTeam } from "@/lib/team-setup";

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
