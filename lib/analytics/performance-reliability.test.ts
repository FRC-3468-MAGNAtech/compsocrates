import { describe, expect, it } from "vitest";
import { buildTeamReliability, isLowSample, teamFromSearch } from "@/lib/analytics/performance-reliability";
import { analyticsEntry } from "@/lib/analytics/cs-test-fixtures";

describe("buildTeamReliability", () => {
  const entries = [
    analyticsEntry("a", { team: "254", match: "q3", autoFuel: 40 }),
    analyticsEntry("b", { team: "254", match: "q1", autoFuel: 20 }),
    analyticsEntry("c", { team: "254", match: "q2", autoFuel: 30 }),
    analyticsEntry("d", { team: "1678", match: "q1", autoFuel: 100 }),
    analyticsEntry("e", { team: "118", match: "q1", autoFuel: 50 }),
    analyticsEntry("f", { team: "118", match: "q2", autoFuel: 50 }),
  ];
  const teams = buildTeamReliability(entries);

  it("computes the mean and the population standard deviation", () => {
    const t254 = teams.find((t) => t.teamNumber === 254)!;
    expect(t254.avgScore).toBe(30);
    // population: sqrt(((20-30)^2 + 0 + (40-30)^2) / 3) = sqrt(200 / 3)
    expect(t254.stdDev).toBeCloseTo(Math.sqrt(200 / 3), 10);
    expect(t254.entriesCount).toBe(3);
  });

  it("lists each team's matches in match order", () => {
    const t254 = teams.find((t) => t.teamNumber === 254)!;
    expect(t254.scores.map((s) => s.matchLabel)).toEqual(["Q1", "Q2", "Q3"]);
    expect(t254.scores.map((s) => s.score)).toEqual([20, 30, 40]);
  });

  it("orders by sample size, then by mean once a team reaches the sample threshold, else by team number", () => {
    expect(teams.map((t) => t.teamNumber)).toEqual([254, 118, 1678]);
    const lowOnly = buildTeamReliability([analyticsEntry("x", { team: "9", match: "q1" }), analyticsEntry("y", { team: "3", match: "q1", autoFuel: 90 })]);
    expect(lowOnly.map((t) => t.teamNumber)).toEqual([3, 9]);
  });

  it("gives a single match a zero deviation and an empty list no teams", () => {
    expect(teams.find((t) => t.teamNumber === 1678)!.stdDev).toBe(0);
    expect(buildTeamReliability([])).toEqual([]);
  });
});

describe("sample warning and search", () => {
  it("warns below three entries", () => {
    expect(isLowSample(2)).toBe(true);
    expect(isLowSample(3)).toBe(false);
  });
  it("resolves a numeric search to a listed team only", () => {
    const teams = [{ teamNumber: 254 }, { teamNumber: 1678 }];
    expect(teamFromSearch("Team 254", teams)).toBe(254);
    expect(teamFromSearch("999", teams)).toBeNull();
    expect(teamFromSearch("abc", teams)).toBeNull();
  });
});
