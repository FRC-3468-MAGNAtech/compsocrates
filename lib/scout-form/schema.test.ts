import { describe, expect, it } from "vitest";
import { allFields, calculateScore, defaultValuesForSchema, getFormSchema, DEFAULT_FORM_ID } from "@/lib/scout-form/schema";
import { SAMPLE_FORM } from "@/lib/forms/test-fixtures";

const ZERO = { auto: 0, teleop: 0, endgame: 0, total: 0 };
const values = (over: Record<string, boolean | number | string>) => ({ ...defaultValuesForSchema(SAMPLE_FORM), ...over });

describe("calculateScore", () => {
  it("scores an empty match as zero", () => {
    expect(calculateScore(SAMPLE_FORM, defaultValuesForSchema(SAMPLE_FORM))).toEqual(ZERO);
  });

  it("adds up auto points", () => {
    expect(calculateScore(SAMPLE_FORM, values({ autoLeave: true, autoPark: true, autoScoreA: 2 })).auto).toBe(3 + 5 + 2 * 20);
  });

  it("adds up teleop points across the three targets", () => {
    expect(calculateScore(SAMPLE_FORM, values({ teleScoreA: 1, teleBonusB: true, teleScoreB: 3, teleScoreC: 4 })).teleop).toBe(20 + 5 + 3 * 2 + 4 * 1);
  });

  it("adds endgame park points", () => {
    expect(calculateScore(SAMPLE_FORM, values({ endgamePark: true })).endgame).toBe(5);
  });

  it("totals every section", () => {
    const score = calculateScore(SAMPLE_FORM, values({ autoLeave: true, teleScoreA: 1, endgamePark: true }));
    expect(score.total).toBe(score.auto + score.teleop + score.endgame);
    expect(score.total).toBe(3 + 20 + 5);
  });

  it("never lets a checkbox incident flag contribute points", () => {
    expect(calculateScore(SAMPLE_FORM, values({ diedDuringMatch: true, yellowCard: true, redCard: true }))).toEqual(ZERO);
  });

  it("ignores the comments text field entirely", () => {
    expect(calculateScore(SAMPLE_FORM, values({ comments: "robot tipped twice" }))).toEqual(ZERO);
  });
});

describe("allFields", () => {
  it("flattens both flat sections and grouped sections", () => {
    const keys = allFields(SAMPLE_FORM).map((f) => f.key);
    // autonomous is flat; teleop uses groups: both must surface.
    expect(keys).toContain("autoLeave");
    expect(keys).toContain("teleScoreA");
    expect(keys).toContain("teleScoreB");
    expect(keys).toContain("comments");
  });
});

describe("getFormSchema", () => {
  it("returns a built-in by id and the current game's form for an unknown one", () => {
    expect(getFormSchema("reefscape").id).toBe("reefscape");
    expect(getFormSchema("nope").id).toBe(DEFAULT_FORM_ID);
    expect(getFormSchema().id).toBe("rebuilt");
  });
});
