import { describe, expect, it } from "vitest";
import { ALLIANCE_SIZE, allianceSlots, isSlotId, isValidAllianceTeams, slotAlliance, slotId, slotIndex, slotLabel } from "./alliance";

describe("alliance config", () => {
  it("defaults to a configured size of at least 2", () => {
    expect(Number.isInteger(ALLIANCE_SIZE)).toBe(true);
    expect(ALLIANCE_SIZE).toBeGreaterThanOrEqual(2);
  });

  it("lists slots red first, for any size", () => {
    expect(allianceSlots(3)).toEqual(["red1", "red2", "red3", "blue1", "blue2", "blue3"]);
    expect(allianceSlots(2)).toEqual(["red1", "red2", "blue1", "blue2"]);
    expect(allianceSlots()).toHaveLength(ALLIANCE_SIZE * 2);
  });

  it("reads a slot's alliance and position", () => {
    expect(slotAlliance("red3")).toBe("red");
    expect(slotAlliance("blue1")).toBe("blue");
    expect(slotAlliance("green1")).toBeNull();
    expect(slotIndex("red1")).toBe(0);
    expect(slotIndex("blue3")).toBe(2);
    expect(slotIndex("nope")).toBe(-1);
    expect(slotId("blue", 2)).toBe("blue3");
    expect(allianceSlots(3).every((s) => slotId(slotAlliance(s)!, slotIndex(s)) === s)).toBe(true);
  });

  it("recognizes slot ids and labels them", () => {
    expect(isSlotId("red2")).toBe(true);
    expect(isSlotId("red")).toBe(false);
    expect(isSlotId(4)).toBe(false);
    expect(slotLabel("red1")).toBe("Red 1");
    expect(slotLabel("blue3")).toBe("Blue 3");
    expect(slotLabel("weird")).toBe("weird");
  });

  it("accepts an alliance of 2 teams up to the configured size, nothing smaller or larger", () => {
    expect(isValidAllianceTeams([1, 2], 3)).toBe(true);
    expect(isValidAllianceTeams([1, 2, 3], 3)).toBe(true);
    expect(isValidAllianceTeams([1, 2, 3, 4], 3)).toBe(false);
    expect(isValidAllianceTeams([1], 3)).toBe(false);
    expect(isValidAllianceTeams([], 2)).toBe(false);
    expect(isValidAllianceTeams([1, 2, 3], 2)).toBe(false);
  });
});
