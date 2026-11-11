import { describe, expect, it } from "vitest";
import { difficultyThresholdsFor, getDifficulty } from "@/lib/difficulty";
import { GAME_DEFINITIONS, GAME_ID_LIST } from "@/config/games";

// Boundaries are CS's `scoreToDifficulty` (practice-scouting page and migrate-practice-difficulty-thresholds script):
// CHARGED UP <= 80 easy, <= 120 medium, else hard; every other game <= 200 easy, <= 400 medium, else hard.
describe("getDifficulty, CHARGED UP (80 / 120)", () => {
  it("is easy at and below 80", () => {
    expect(getDifficulty(0, "CHARGED_UP")).toBe("easy");
    expect(getDifficulty(80, "CHARGED_UP")).toBe("easy");
  });

  it("is medium from 81 to 120", () => {
    expect(getDifficulty(81, "CHARGED_UP")).toBe("medium");
    expect(getDifficulty(120, "CHARGED_UP")).toBe("medium");
  });

  it("is hard above 120", () => {
    expect(getDifficulty(121, "CHARGED_UP")).toBe("hard");
    expect(getDifficulty(500, "CHARGED_UP")).toBe("hard");
  });
});

describe.each(["REBUILT", "REEFSCAPE"] as const)("getDifficulty, %s (200 / 400)", (game) => {
  it("is easy at and below 200, medium from 201 to 400, hard above 400", () => {
    expect(getDifficulty(0, game)).toBe("easy");
    expect(getDifficulty(200, game)).toBe("easy");
    expect(getDifficulty(201, game)).toBe("medium");
    expect(getDifficulty(400, game)).toBe("medium");
    expect(getDifficulty(401, game)).toBe("hard");
  });

  it("does not use the CHARGED UP scale", () => {
    expect(getDifficulty(121, game)).toBe("easy");
  });
});

describe("which game a difficulty is for", () => {
  it("accepts a season id in any case, like the library stores it", () => {
    expect(getDifficulty(100, "charged_up")).toBe("medium");
    expect(getDifficulty(100, " Charged_Up ")).toBe("medium");
  });

  it("uses CS's default scale (200 / 400) for an unknown game, a missing game or an empty one", () => {
    for (const game of ["POWER_PLAY", "", undefined, null, "toString", "__proto__"]) {
      expect(difficultyThresholdsFor(game), String(game)).toEqual({ easyMax: 200, mediumMax: 400 });
      expect(getDifficulty(200, game)).toBe("easy");
      expect(getDifficulty(201, game)).toBe("medium");
      expect(getDifficulty(401, game)).toBe("hard");
    }
  });

  it("treats a score that is not a number as easy, as CS does", () => {
    expect(getDifficulty(Number.NaN, "CHARGED_UP")).toBe("easy");
    expect(getDifficulty(Number.NaN, "REBUILT")).toBe("easy");
  });
});

describe("thresholds come from the game definitions", () => {
  it("returns each definition's own thresholds", () => {
    for (const id of GAME_ID_LIST) expect(difficultyThresholdsFor(id)).toEqual(GAME_DEFINITIONS[id].thresholds.difficulty);
    expect(difficultyThresholdsFor("CHARGED_UP")).toEqual({ easyMax: 80, mediumMax: 120 });
  });
});
