import { describe, expect, it } from "vitest";
import { predictionHistory, predictTeams, scheduleMatches, teamsInSchedule } from "@/lib/analytics/match-prediction";
import { rebuiltEntry } from "@/lib/analytics/cs-test-fixtures";
import type { OfficialMatch } from "@/lib/analytics/match-breakdown";

const m = (matchType: OfficialMatch["matchType"], matchNumber: number, red: number[], blue: number[]): OfficialMatch => ({
  eventCode: "2026arli",
  matchType,
  matchNumber,
  played: false,
  red: { teams: red, score: null, penaltyPoints: null },
  blue: { teams: blue, score: null, penaltyPoints: null },
});

describe("predictionHistory", () => {
  it("drops excluded entries and counts entries of other games as skipped", () => {
    const good = rebuiltEntry("a");
    const excluded = { ...rebuiltEntry("b"), excluded: true };
    const other = { ...rebuiltEntry("c"), formId: "charged-up", game: "CHARGED_UP" as const };
    const { docs, skipped } = predictionHistory([good, excluded, other]);
    expect(docs).toHaveLength(1);
    expect(skipped).toBe(1);
  });
});

describe("predictTeams", () => {
  const entries = [
    rebuiltEntry("a", { team: "254", match: "q1", autoFuel: 20, teleFuel: 30, status: "level-3" }),
    rebuiltEntry("b", { team: "254", match: "q2", autoFuel: 10, teleFuel: 20, status: "level-1" }),
    rebuiltEntry("c", { team: "254", match: "p1", autoFuel: 5, teleFuel: 5, practice: true }),
    rebuiltEntry("d", { team: "1678", match: "q1" }),
  ];
  const { docs } = predictionHistory(entries);

  it("predicts from the plugin: combined uses every row, official skips practice", () => {
    const combined = predictTeams(["254"], docs, "combined", 85).get("254")!;
    const official = predictTeams(["254"], docs, "official", 85).get("254")!;
    const practice = predictTeams(["254"], docs, "practice", 85).get("254")!;
    expect(combined.sampleSize).toBe(3);
    expect(official.sampleSize).toBe(2);
    expect(practice.sampleSize).toBe(1);
    // official: totals 80 and 40 (30 climb + 50, 10 climb + 30): avg 60, 85th percentile index ceil(1.7)-1 = 1 -> 80, (60 + 80) / 2 = 70
    expect(official.estimatedPoints).toBe(70);
    expect(official.role).toBe("Offense");
    expect(official.climbProbability).toBe(100);
  });

  it("gives a team with no history a zero prediction", () => {
    const p = predictTeams(["9999"], docs, "combined", 90).get("9999")!;
    expect(p.sampleSize).toBe(0);
    expect(p.estimatedPoints).toBe(0);
    expect(p.role).toBe("Defense");
  });
});

describe("scheduleMatches", () => {
  it("orders practice, qualification, playoff and stringifies teams", () => {
    const list = scheduleMatches([m("Playoff", 1, [1, 2, 3], [4, 5, 6]), m("Qualification", 2, [7, 8, 9], [10, 11, 12]), m("Practice", 1, [1, 2, 3], [4, 5, 6]), m("Qualification", 1, [1, 2, 3], [4, 5, 6])]);
    expect(list.map((x) => x.title)).toEqual(["Practice 1", "Qualification 1", "Qualification 2", "Playoff 1"]);
    expect(list[0].red).toEqual(["1", "2", "3"]);
    expect(teamsInSchedule(list).size).toBe(12);
  });
});
