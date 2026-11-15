import { describe, expect, it } from "vitest";
import { membersOfSelectedTeam } from "@/lib/member-scope";

const m = (uid: string, assignedTeamIds?: string[]) => ({ uid, ...(assignedTeamIds ? { assignedTeamIds } : {}) });

describe("membersOfSelectedTeam", () => {
  const roster = [m("a", ["t1"]), m("b", ["t2"]), m("c", ["t1", "t2"]), m("d"), m("e", [])];

  it("does not return a second team's members", () => {
    expect(membersOfSelectedTeam(roster, "t1").map((x) => x.uid)).toEqual(["a", "c", "d", "e"]);
    expect(membersOfSelectedTeam(roster, "t2").map((x) => x.uid)).toEqual(["b", "c", "d", "e"]);
  });

  it("keeps everyone when no team is selected (one team per account)", () => {
    expect(membersOfSelectedTeam(roster, null)).toHaveLength(5);
  });
});
