import { describe, expect, it } from "vitest";
import { FTC_JOIN_CODE_LENGTH, ftcJoinRequestDoc, ftcNewTeamDocs, newFtcJoinCode } from "@/data/ftc/enrollment";

const input = { uid: "u1", email: "a@b.co", name: " Sam ", teamNumber: 1234, teamName: " Robo Owls ", location: " Austin " };

describe("newFtcJoinCode", () => {
  it("is 8 characters from the unambiguous alphabet, and random", () => {
    const a = newFtcJoinCode();
    expect(a).toMatch(new RegExp(`^[A-HJ-NP-Z2-9]{${FTC_JOIN_CODE_LENGTH}}$`));
    expect(new Set(Array.from({ length: 20 }, () => newFtcJoinCode())).size).toBeGreaterThan(15);
  });
});

describe("ftcNewTeamDocs", () => {
  const { team, user } = ftcNewTeamDocs("ABCD2345", input, "TS");
  it("keys the team by the code, never the number, and owns it", () => {
    expect(team).toMatchObject({ number: 1234, name: "Robo Owls", location: "Austin", ownerUid: "u1", joinCode: "ABCD2345", createdAt: "TS" });
    expect(team.activeEventCodes).toEqual([]);
  });
  it("lists the first team of the account, ids in step", () => {
    expect(team.fieldTeams).toEqual([{ id: "ft-1234", number: 1234, name: "Robo Owls" }]);
    expect(team.fieldTeamIdList).toEqual(["ft-1234"]);
  });
  it("makes the creator admin and owner on that team", () => {
    expect(user).toMatchObject({ teamId: "ABCD2345", isAdmin: true, isOwner: true, name: "Sam", secondaryRoles: [], fieldTeamIds: ["ft-1234"] });
  });
  it("omits an empty location", () => {
    expect(ftcNewTeamDocs("ABCD2345", { ...input, location: " " }, "TS").team).not.toHaveProperty("location");
  });
});

describe("ftcJoinRequestDoc", () => {
  it("is pending for the applicant", () => {
    expect(ftcJoinRequestDoc({ uid: "u2", name: " Kim " }, "TS")).toEqual({ uid: "u2", name: "Kim", status: "pending", createdAt: "TS" });
  });
});
