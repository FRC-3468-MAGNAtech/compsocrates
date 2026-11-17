import { describe, expect, it } from "vitest";
import { analyticsEntry } from "@/lib/analytics/cs-test-fixtures";
import type { AnalyticsEntry } from "@/lib/analytics/entries";
import { ROLE_SPLIT_TOTALS_NOTE, buildTeamReliability, isLowSample, roleSplitNote } from "@/lib/analytics/performance-reliability";
import { getBuiltinForm } from "@/lib/forms/builtin";
import { DEFAULT_FTC_FORM_ID, FTC_GAME_FORMS } from "@/lib/ftc/games";

// Performance Reliability on FTC data (BIOBUZZ): two-team alliances, role-split totals, few and no entries.

const withTotal = (id: string, team: string, match: string, total: number): AnalyticsEntry => {
  const e = analyticsEntry(id, { team, match });
  return { ...e, score: { ...e.score, total } };
};

describe("buildTeamReliability with alliances of two or of three", () => {
  // The model has no alliance dimension (one row per team), so the alliance size cannot break it: same code, 2 or 3 teams per match.
  const twoTeam = [withTotal("a", "100", "q1", 30), withTotal("b", "200", "q1", 50), withTotal("c", "100", "q2", 40), withTotal("d", "200", "q2", 10)];
  const threeTeam = [...twoTeam, withTotal("e", "300", "q1", 20), withTotal("f", "300", "q2", 20)];

  it("two teams per match", () => {
    const teams = buildTeamReliability(twoTeam);
    expect(teams.map((t) => t.teamNumber).sort()).toEqual([100, 200]);
    expect(teams.find((t) => t.teamNumber === 100)).toMatchObject({ avgScore: 35, entriesCount: 2 });
    expect(teams.find((t) => t.teamNumber === 200)).toMatchObject({ avgScore: 30, entriesCount: 2 });
  });

  it("three teams per match", () => {
    const teams = buildTeamReliability(threeTeam);
    expect(teams).toHaveLength(3);
    expect(teams.find((t) => t.teamNumber === 300)).toMatchObject({ avgScore: 20, stdDev: 0 });
  });
});

describe("role-split totals (BIOBUZZ Hive and Garden)", () => {
  // A Hive scout's entry holds Hive points; the Garden scout's entry (same team, another match) holds Garden points. The page keeps the same
  // totals every other page uses (mean of the entries' totals) and says so; no new scoring logic.
  it("averages each entry's recorded total as is", () => {
    const [t] = buildTeamReliability([withTotal("a", "100", "q1", 60), withTotal("b", "100", "q2", 12)]);
    expect(t.avgScore).toBe(36);
    expect(t.entriesCount).toBe(2);
  });

  it("the note shows for a game with role-split objectives and not otherwise", () => {
    expect(roleSplitNote(FTC_GAME_FORMS[DEFAULT_FTC_FORM_ID])).toBe(ROLE_SPLIT_TOTALS_NOTE);
    expect(ROLE_SPLIT_TOTALS_NOTE).toBe("Totals include only the objectives each scout recorded.");
    const frcForm = getBuiltinForm("rebuilt");
    expect(frcForm).not.toBeNull();
    expect(roleSplitNote(frcForm!)).toBeNull();
  });
});

describe("few entries and none", () => {
  it("a team with one entry is a low sample with zero deviation, and the count is what the numbers rest on", () => {
    const [t] = buildTeamReliability([withTotal("a", "100", "q1", 33)]);
    expect(t).toMatchObject({ entriesCount: 1, avgScore: 33, stdDev: 0 });
    expect(isLowSample(t.entriesCount)).toBe(true);
  });
  it("no entries means no teams", () => {
    expect(buildTeamReliability([])).toEqual([]);
  });
});

describe("the page reads nothing itself", () => {
  it("it takes its entries from the shared analytics hooks, never from a collection", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("components/analytics/performance-reliability-view.tsx", "utf8");
    expect(source).not.toMatch(/firebase/i);
    expect(source).toContain("useAnalyticsEntries");
  });
});
