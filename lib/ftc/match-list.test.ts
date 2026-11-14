import { describe, expect, it } from "vitest";
import type { OfficialMatch } from "@/lib/analytics/match-breakdown";
import { buildMatchRows } from "@/lib/match-list/model";

// The Match List is shared with the other program, whose alliances have three robots. FTC alliances have two: nothing in the rows may depend on the size.

const match = (matchNumber: number, red: number[], blue: number[], scores: [number, number] | null, type: OfficialMatch["matchType"] = "Qualification"): OfficialMatch => ({
  eventCode: "EV1",
  matchType: type,
  matchNumber,
  played: scores !== null,
  series: null,
  startTime: "2026-01-10T10:00:00",
  red: { teams: red, score: scores ? scores[0] : null, penaltyPoints: scores ? 0 : null },
  blue: { teams: blue, score: scores ? scores[1] : null, penaltyPoints: scores ? 0 : null },
});

// 10:00 in Chicago is 16:00Z: by default it is still early morning, before any match is scheduled
const input = (matches: OfficialMatch[], isOurTeam: (n: number) => boolean, now = "2026-01-10T14:00:00Z") => ({ eventCode: "EV1", matches, timeZone: "America/Chicago", now: Date.parse(now), isOurTeam });

describe("Match List rows for two-robot alliances", () => {
  const matches = [match(2, [300, 400], [500, 600], null), match(1, [100, 200], [300, 400], [88, 64])];

  it("keeps both robots of each alliance, in schedule order, with scores only for played matches", () => {
    const rows = buildMatchRows(input(matches, () => false));
    expect(rows.map((r) => r.matchNumber)).toEqual([1, 2]);
    expect(rows[0]).toMatchObject({ red: [100, 200], blue: [300, 400], redScore: 88, blueScore: 64, played: true, status: "completed" });
    expect(rows[1]).toMatchObject({ red: [300, 400], blue: [500, 600], redScore: null, blueScore: null, played: false, status: "upcoming" });
  });

  it("marks a match ours when either alliance has any of the account's teams (a multi-team account has several)", () => {
    const ours = new Set([200, 600]);
    const rows = buildMatchRows(input(matches, (n) => ours.has(n)));
    expect(rows.map((r) => r.ours)).toEqual([true, true]);
    expect(buildMatchRows(input(matches, (n) => n === 100)).map((r) => r.ours)).toEqual([true, false]);
  });

  it("the first upcoming match is the next one", () => {
    const rows = buildMatchRows(input(matches, () => false));
    expect(rows.filter((r) => r.isNext).map((r) => r.matchNumber)).toEqual([2]);
  });

  it("a match whose scheduled start has just passed is the one on the field, and the one after it is next", () => {
    const rows = buildMatchRows(input([match(1, [100, 200], [300, 400], [88, 64]), match(2, [1, 2], [3, 4], null), match(3, [5, 6], [7, 8], null)], () => false, "2026-01-10T16:05:00Z"));
    expect(rows.map((r) => r.status)).toEqual(["completed", "in-progress", "upcoming"]);
    expect(rows.filter((r) => r.isNext).map((r) => r.matchNumber)).toEqual([3]);
  });

  it("playoff matches build too", () => {
    const rows = buildMatchRows(input([match(1, [1, 2], [3, 4], [10, 20], "Playoff"), match(2, [1, 2], [5, 6], null, "Playoff")], () => false));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.matchType === "Playoff")).toBe(true);
  });
});
