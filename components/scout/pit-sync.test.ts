import { describe, expect, it } from "vitest";
import { parsePitValue, pitMismatchMessages, pitPrefill, pitValueFitsScale, pitValuesFromEntries, scaleRangeForIndex } from "@/components/scout/pit-sync";

describe("parsePitValue (CS)", () => {
  it("reads numbers, ranges (upper bound) and the first number in text", () => {
    expect(parsePitValue(8)).toBe(8);
    expect(parsePitValue("8")).toBe(8);
    expect(parsePitValue("10-13")).toBe(13);
    expect(parsePitValue("10 - 13")).toBe(13);
    expect(parsePitValue("about 12 balls")).toBe(12);
    expect(parsePitValue("2.5")).toBe(2.5);
  });
  it("is null for blank, x, zero and negatives", () => {
    for (const v of ["", "x", "0", 0, undefined, null, "-", "0-0"]) expect(parsePitValue(v), String(v)).toBeNull();
  });
});

describe("scaleRangeForIndex (CS)", () => {
  it("matches CS's tables step for step", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => scaleRangeForIndex("bps", i))).toEqual([
      { min: 0, max: 0 }, { min: 1, max: 3 }, { min: 4, max: 6 }, { min: 7, max: 9 }, { min: 10, max: 13 }, { min: 14, max: 17 }, { min: 18, max: 21 }, { min: 22, max: 24 }, { min: 25, max: Infinity },
    ]);
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => scaleRangeForIndex("carry", i))).toEqual([
      { min: 0, max: 0 }, { min: 1, max: 12 }, { min: 13, max: 23 }, { min: 24, max: 32 }, { min: 33, max: 42 }, { min: 43, max: 53 }, { min: 54, max: 64 }, { min: 65, max: 74 }, { min: 75, max: Infinity },
    ]);
    expect([0, 1, 2, 3, 4].map((i) => scaleRangeForIndex("preload", i))).toEqual([{ min: 0, max: 0 }, { min: 1, max: 2 }, { min: 3, max: 4 }, { min: 5, max: 6 }, { min: 7, max: 8 }]);
  });
});

describe("pitValueFitsScale", () => {
  it("accepts a value inside the step and refuses outside, at the edges too", () => {
    expect(pitValueFitsScale("bps", 13, 4)).toBe(true);
    expect(pitValueFitsScale("bps", 14, 4)).toBe(false);
    expect(pitValueFitsScale("bps", 99, 8)).toBe(true);
    expect(pitValueFitsScale("preload", 9, 4)).toBe(false);
    expect(pitValueFitsScale("carry", 24, 3)).toBe(true);
    expect(pitValueFitsScale("bps", null, 0)).toBe(false);
  });
});

describe("pitValuesFromEntries", () => {
  it("takes the newest entry and parses its strings", () => {
    const pit = pitValuesFromEntries([
      { createdAtMs: 1, values: { fuelBallsPerSecond: "4-6", fuelPreloadCapacity: "8", fuelCarryingCapacity: "x" } },
      { createdAtMs: 5, values: { fuelBallsPerSecond: "10-13", fuelPreloadCapacity: "", fuelCarryingCapacity: "40" } },
    ]);
    expect(pit).toEqual({ preload: null, bps: 13, carry: 40 });
    expect(pitValuesFromEntries([])).toBeNull();
  });
});

describe("pitPrefill", () => {
  it("sets the scale steps for the numbers that exist, BPS and carry in auto and teleop", () => {
    expect(pitPrefill({ preload: 8, bps: 13, carry: 40 })).toEqual({ auto_preloadScale: 4, auto_bpsScale: 4, teleop_bpsScale: 4, auto_carryingScale: 4, teleop_carryingScale: 4 });
  });
  it("leaves a blank number's sliders alone", () => {
    expect(pitPrefill({ preload: null, bps: 5, carry: null })).toEqual({ auto_bpsScale: 2, teleop_bpsScale: 2 });
  });
});

describe("pitMismatchMessages", () => {
  const pit = { preload: 8, bps: 13, carry: 40 };
  const fits = { auto_preloadScale: 4, auto_bpsScale: 4, teleop_bpsScale: 4, auto_carryingScale: 4, teleop_carryingScale: 4 };
  it("is silent with no pit entry or when every scale fits", () => {
    expect(pitMismatchMessages(null, fits)).toEqual([]);
    expect(pitMismatchMessages(pit, fits)).toEqual([]);
  });
  it("names each scale that no longer contains the pit value, in CS's order and words", () => {
    expect(pitMismatchMessages(pit, { ...fits, auto_preloadScale: 1, teleop_bpsScale: 2, teleop_carryingScale: 7 })).toEqual([
      "Preload Capacity scale does not include pit value 8.",
      "Teleop Balls Per Second scale does not include pit value 13.",
      "Teleop Carrying Capacity scale does not include pit value 40.",
    ]);
  });
  it("skips a blank pit number", () => {
    expect(pitMismatchMessages({ preload: null, bps: null, carry: null }, { auto_bpsScale: 0 })).toEqual([]);
  });
  it("reads a missing slider as step 0", () => {
    expect(pitMismatchMessages({ preload: null, bps: 5, carry: null }, {})).toEqual(["Autonomous Balls Per Second scale does not include pit value 5.", "Teleop Balls Per Second scale does not include pit value 5."]);
  });
});
