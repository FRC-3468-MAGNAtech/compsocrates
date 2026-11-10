import { describe, expect, it } from "vitest";
import { assignedTeamsFor, myTeamFor, scoutedTeamsFor, teamMark, teamMarks } from "@/components/scout/team-status";
import type { ScheduleSlot } from "@/lib/scheduler/types";

const entry = (over: Partial<{ source: string; eventCode: string; matchType: "Practice" | "Qualification" | "Playoff"; matchNumber: number; teamNumber: number }> = {}) => ({ source: "event", eventCode: "2026arli", matchType: "Qualification" as const, matchNumber: 5, teamNumber: 254, ...over });
const slot = (matchNumber: number, teamNumber: number, scoutUid: string | null): ScheduleSlot => ({ matchType: "Qualification", matchNumber, slot: "red1", teamNumber, scoutUid });

describe("scoutedTeamsFor", () => {
  it("counts this match's event entries, resolving legacy event aliases", () => {
    const set = scoutedTeamsFor([entry(), entry({ teamNumber: 1 }), entry({ eventCode: "2025lake", teamNumber: 7 }), entry({ matchNumber: 6, teamNumber: 2 }), entry({ matchType: "Practice", teamNumber: 3 }), entry({ source: "practice", teamNumber: 4 })], "2026arli", "Qualification", 5);
    expect([...set].sort((a, b) => a - b)).toEqual([1, 254]);
    expect([...scoutedTeamsFor([entry({ eventCode: "2025lake", teamNumber: 7 })], "2026lake", "Qualification", 5)]).toEqual([7]);
  });
});

describe("assigned", () => {
  const slots = [slot(5, 254, "a"), slot(5, 971, "b"), slot(5, 1678, null), slot(6, 1, "a")];
  it("assignedTeamsFor lists teams with a scout in this match", () => {
    expect([...assignedTeamsFor(slots, "Qualification", 5)].sort((a, b) => a - b)).toEqual([254, 971]);
  });
  it("myTeamFor takes my slot, a claimed sub-in over it", () => {
    expect(myTeamFor(slots, [], "a", "Qualification", 5)).toBe(254);
    expect(myTeamFor(slots, [], "z", "Qualification", 5)).toBeNull();
    expect(myTeamFor(slots, [{ matchType: "Qualification", matchNumber: 5, teamNumber: 971 }], "a", "Qualification", 5)).toBe(971);
  });
});

describe("marks", () => {
  const parts = { scouted: new Set([1]), sub: new Map<number, "requested" | "assigned">([[1, "assigned"], [2, "assigned"], [3, "requested"], [4, "requested"]]), assigned: new Set([4, 5]) };
  it("picks Scouted, then Sub Assigned, Sub Req, Assigned (CS order)", () => {
    expect([1, 2, 3, 4, 5, 6].map((t) => teamMark(t, parts))).toEqual(["scouted", "subAssigned", "subRequested", "subRequested", "assigned", null]);
  });
  it("teamMarks lists only marked teams", () => {
    expect([...teamMarks(parts).keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });
});
