import { describe, expect, it } from "vitest";
import { difficultyThresholdsFor, getDifficulty } from "@/lib/difficulty";
import { GAME_DEFINITIONS, GAME_ID_LIST } from "@/config/games";

// Batch 3: the cut-offs follow the PROGRAM'S game. REMAINING.md had not checked this: `difficultyThresholdsFor` used to read only the default program's game
// table, so the other program's game fell through to 200 / 400.
describe("difficulty cut-offs per program", () => {
  it("the other program's game uses its own cut-offs (40 / 79), not the default 200 / 400", () => {
    expect(difficultyThresholdsFor("BIOBUZZ", "ftc")).toEqual({ easyMax: 40, mediumMax: 79 });
    expect(difficultyThresholdsFor("biobuzz", "ftc")).toEqual({ easyMax: 40, mediumMax: 79 });
    expect(getDifficulty(40, "biobuzz", "ftc")).toBe("easy");
    expect(getDifficulty(41, "biobuzz", "ftc")).toBe("medium");
    expect(getDifficulty(79, "biobuzz", "ftc")).toBe("medium");
    expect(getDifficulty(80, "biobuzz", "ftc")).toBe("hard");
    // the same score is "easy" under the default table, so the program matters
    expect(getDifficulty(80, "BIOBUZZ")).toBe("easy");
  });

  it("an unknown game in that program gets the default cut-offs", () => {
    expect(difficultyThresholdsFor("NO_SUCH_GAME", "ftc")).toEqual({ easyMax: 200, mediumMax: 400 });
    expect(difficultyThresholdsFor(null, "ftc")).toEqual({ easyMax: 200, mediumMax: 400 });
  });

  it("the default program is untouched: every game keeps its own cut-offs, with or without naming the program", () => {
    for (const id of GAME_ID_LIST) {
      expect(difficultyThresholdsFor(id, "frc")).toEqual(GAME_DEFINITIONS[id].thresholds.difficulty);
      expect(difficultyThresholdsFor(id)).toEqual(GAME_DEFINITIONS[id].thresholds.difficulty);
    }
    expect(getDifficulty(81, "CHARGED_UP", "frc")).toBe("medium");
    // the other program's game is not a game of the default program
    expect(difficultyThresholdsFor("BIOBUZZ", "frc")).toEqual({ easyMax: 200, mediumMax: 400 });
  });
});
