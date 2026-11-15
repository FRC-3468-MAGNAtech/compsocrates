import { describe, expect, it } from "vitest";
import type { LibraryMatch } from "@/lib/match-library";
import { buildMatchRows } from "@/lib/practice-match-rows";
import type { PracticeSession } from "@/lib/practice-sessions";

// Batch 3: a scheduled match can have no official score yet. Its alliance has no difficulty, is listed when every difficulty is asked for, and is never put
// under a difficulty it does not have.
const alliance = (teams: number[], score: number | null, difficulty: "easy" | "medium" | "hard" = "easy") =>
  score === null ? { teams, score: 0, penaltyPoints: 0, difficulty: "easy" as const, scoreKnown: false } : { teams, score, penaltyPoints: 0, difficulty, scoreKnown: true };

const match = (id: string, red: ReturnType<typeof alliance>, blue: ReturnType<typeof alliance>): LibraryMatch => ({
  id, seasonId: "game1", eventCode: "EV", eventName: "Event", matchType: "Qualification", matchNumber: Number(id.slice(-1)), alliances: { red, blue }, video: null, importedAt: "", scoresUpdatedAt: "", origin: "manual", published: true,
});

const matches = [match("EV_Q1", alliance([1, 2], 30, "easy"), alliance([3, 4], 60, "medium")), match("EV_Q2", alliance([5, 6], null), alliance([7, 8], null))];
const none: PracticeSession[] = [];

describe("buildMatchRows with matches that have no official score", () => {
  it("every difficulty (null) lists all four alliances, the unscored ones without a difficulty", () => {
    const rows = buildMatchRows(matches, none, "u", null);
    expect(rows.map((r) => `${r.libraryMatchId}:${r.alliance}`)).toEqual(["EV_Q1:red", "EV_Q1:blue", "EV_Q2:red", "EV_Q2:blue"]);
    expect(rows.filter((r) => r.difficulty === null).map((r) => r.libraryMatchId)).toEqual(["EV_Q2", "EV_Q2"]);
    expect(rows.find((r) => r.libraryMatchId === "EV_Q2")?.scoreKnown).toBe(false);
    expect(rows.find((r) => r.libraryMatchId === "EV_Q1")?.scoreKnown).toBeUndefined();
  });

  it("one difficulty never includes an alliance with no score (it has none)", () => {
    expect(buildMatchRows(matches, none, "u", "easy").map((r) => `${r.libraryMatchId}:${r.alliance}`)).toEqual(["EV_Q1:red"]);
    expect(buildMatchRows(matches, none, "u", "medium").map((r) => `${r.libraryMatchId}:${r.alliance}`)).toEqual(["EV_Q1:blue"]);
    expect(buildMatchRows(matches, none, "u", "hard")).toEqual([]);
  });

  it("an alliance with no teams yet is not offered", () => {
    expect(buildMatchRows([match("EV_Q3", alliance([], null), alliance([9, 10], null))], none, "u", null).map((r) => r.alliance)).toEqual(["blue"]);
  });
});
