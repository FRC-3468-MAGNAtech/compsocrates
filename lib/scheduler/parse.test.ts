import { describe, expect, it } from "vitest";
import { parseScheduleSlots } from "./parse";

describe("parseScheduleSlots", () => {
  it("keeps legacy 2-slot and 3-slot ids and defaults a missing scoutUid to null", () => {
    const slots = parseScheduleSlots([
      { matchType: "Qualification", matchNumber: 2, slot: "blue2", teamNumber: 9, scoutUid: "u" },
      { matchType: "Playoff", matchNumber: 1, slot: "red3", teamNumber: 7 },
    ]);
    expect(slots).toEqual([
      { matchType: "Qualification", matchNumber: 2, slot: "blue2", teamNumber: 9, scoutUid: "u" },
      { matchType: "Playoff", matchNumber: 1, slot: "red3", teamNumber: 7, scoutUid: null },
    ]);
  });

  it("returns [] for a non-array", () => {
    expect(parseScheduleSlots(undefined)).toEqual([]);
    expect(parseScheduleSlots({})).toEqual([]);
  });
});
