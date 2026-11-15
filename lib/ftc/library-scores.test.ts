import { describe, expect, it } from "vitest";
import type { EventMatch } from "@/lib/events/types";
import { ftcDocToLibraryMatch, planScheduleImport } from "@/lib/ftc/library";
import { buildManualMatchDoc, rawScoresOf, scoreLabel, validateRawScores } from "@/lib/library/schedule";
import { resolveLobbyPairScoring } from "@/lib/lobby/scoring";
import type { ScoutEntry } from "@/lib/scout-entries";

const base = { seasonId: "biobuzz", eventCode: "EV", eventName: "Event", matchType: "Qualification", matchNumber: 4, origin: "api", published: true };
const doc = (red: Record<string, unknown>, blue: Record<string, unknown>) => ({ ...base, alliances: { red: { teams: [1, 2], ...red }, blue: { teams: [3, 4], ...blue } } });

describe("a library match official score (FTC)", () => {
  it("a scheduled match has no score: not known, placeholder fields, schedule only", () => {
    const m = ftcDocToLibraryMatch("EV_Q4", doc({}, {}))!;
    expect(m.alliances.red).toMatchObject({ scoreKnown: false, score: 0, penaltyPoints: 0 });
    expect(m.alliances.blue.scoreKnown).toBe(false);
    expect(m.scheduleOnly).toBe(true);
    expect(scoreLabel(m)).toBe("No score");
  });

  it("a scored alliance is known, with its difficulty from the game own cut-offs (40 / 79)", () => {
    const m = ftcDocToLibraryMatch("EV_Q4", doc({ score: 30, penaltyPoints: 5 }, { score: 60 }))!;
    expect(m.alliances.red).toEqual({ teams: [1, 2], score: 30, penaltyPoints: 5, difficulty: "easy", scoreKnown: true });
    expect(m.alliances.blue).toMatchObject({ score: 60, penaltyPoints: 0, difficulty: "medium", scoreKnown: true });
    expect(ftcDocToLibraryMatch("x", doc({ score: 80 }, { score: 200 }))!.alliances.red.difficulty).toBe("hard");
    expect(m.scheduleOnly).toBe(false);
  });

  it("a score of 0 is a known score, but a stored value that is not a whole number 0 to 9999 is treated as missing, never as 0", () => {
    expect(ftcDocToLibraryMatch("x", doc({ score: 0 }, {}))!.alliances.red.scoreKnown).toBe(true);
    for (const bad of ["60", -1, 12.5, 10000, null, NaN]) expect(ftcDocToLibraryMatch("x", doc({ score: bad }, {}))!.alliances.red.scoreKnown).toBe(false);
  });

  it("one scored alliance and one not: each says so", () => {
    const m = ftcDocToLibraryMatch("x", doc({ score: 10 }, {}))!;
    expect([m.alliances.red.scoreKnown, m.alliances.blue.scoreKnown]).toEqual([true, false]);
    expect(m.scheduleOnly).toBe(false);
    expect(scoreLabel(m)).toBe("R 10 · B ?");
  });

  it("an admin score form: both scores required, a blank penalty is 0, nothing is stored as a blank turned into 0", () => {
    expect(validateRawScores({ redScore: "", redPenalty: "", blueScore: "5", bluePenalty: "" })).toMatchObject({ ok: false, errors: { redScore: expect.any(String) } });
    expect(validateRawScores({ redScore: "12", redPenalty: "x", blueScore: "5", bluePenalty: "" })).toMatchObject({ ok: false, errors: { redPenalty: expect.any(String) } });
    expect(validateRawScores({ redScore: "10000", redPenalty: "", blueScore: "5", bluePenalty: "" }).ok).toBe(false);
    expect(validateRawScores({ redScore: "12", redPenalty: "", blueScore: "0", bluePenalty: "3" })).toEqual({ ok: true, scores: { red: { score: 12, penaltyPoints: 0 }, blue: { score: 0, penaltyPoints: 3 } } });
  });

  it("the form shows the stored scores back, blank for an alliance without one", () => {
    expect(rawScoresOf(ftcDocToLibraryMatch("x", doc({ score: 30, penaltyPoints: 5 }, {}))!)).toEqual({ redScore: "30", redPenalty: "5", blueScore: "", bluePenalty: "" });
  });

  it("editing a hand-made match teams or time keeps its official score", () => {
    const existing = { published: true, createdBy: "u", createdAt: "t", scoresUpdatedAt: "s", alliances: { red: { teams: [1, 2], score: 30, penaltyPoints: 5 }, blue: { teams: [3, 4], score: 60, penaltyPoints: 0 } } };
    const out = buildManualMatchDoc({ matchType: "Qualification", matchNumber: 4, red: [1, 9], blue: [3, 4], scheduledTime: null }, { eventCode: "EV", eventName: "E", seasonId: "biobuzz" }, existing, "T1", "u", "now");
    expect(out.alliances).toEqual({ red: { teams: [1, 9], score: 30, penaltyPoints: 5 }, blue: { teams: [3, 4], score: 60, penaltyPoints: 0 } });
    expect(out.scoresUpdatedAt).toBe("s");
    const fresh = buildManualMatchDoc({ matchType: "Qualification", matchNumber: 4, red: [1, 2], blue: [3, 4], scheduledTime: null }, { eventCode: "EV", eventName: "E", seasonId: "biobuzz" }, null, "T1", "u", "now");
    expect(fresh.alliances).toEqual({ red: { teams: [1, 2] }, blue: { teams: [3, 4] } });
    expect("scoresUpdatedAt" in fresh).toBe(false);
  });
});

const apiMatch = (over: Partial<EventMatch>): EventMatch => ({ id: "Q-1", matchNumber: 1, type: "Qualification", description: null, series: null, played: false, redTeams: [1, 2], blueTeams: [3, 4], redScore: null, blueScore: null, redPenaltyPoints: null, bluePenaltyPoints: null, startTime: null, ...over });
const event = { eventCode: "EV", eventName: "Event", seasonId: "biobuzz" };

describe("the schedule import and the official score", () => {
  it("a played match is written with the API score and foul points; an unplayed one carries none", () => {
    const plan = planScheduleImport({
      event,
      existing: new Map(),
      uid: "u",
      now: "NOW",
      matches: [apiMatch({ played: true, redScore: 62, blueScore: 48, redPenaltyPoints: 6, bluePenaltyPoints: null }), apiMatch({ id: "Q-2", matchNumber: 2 })],
    });
    expect(plan.scored).toBe(1);
    const [played, unplayed] = plan.writes.map((w) => w.data);
    expect(played.alliances).toEqual({ red: { teams: [1, 2], score: 62, penaltyPoints: 6 }, blue: { teams: [3, 4], score: 48, penaltyPoints: 0 } });
    expect(played.scoresUpdatedAt).toBe("NOW");
    expect(unplayed.alliances).toEqual({ red: { teams: [1, 2] }, blue: { teams: [3, 4] } });
    expect("scoresUpdatedAt" in unplayed).toBe(false);
  });

  it("importing again over an entered score never erases it: an unplayed match writes no score fields (a merge write only touches the fields it carries)", () => {
    const existing = new Map<string, Record<string, unknown>>([["EV_Q2", { published: true, origin: "api" }]]);
    const plan = planScheduleImport({ event, existing, uid: "u", now: "NOW", matches: [apiMatch({ id: "Q-2", matchNumber: 2 })] });
    expect(plan.writes[0].merge).toBe(true);
    expect(JSON.stringify(plan.writes[0].data)).not.toContain("score");
  });

  it("a score the API reports that is not a whole number 0 to 9999 is not stored", () => {
    const plan = planScheduleImport({ event, existing: new Map(), uid: "u", now: "NOW", matches: [apiMatch({ played: true, redScore: -3, blueScore: 10 })] });
    expect(plan.scored).toBe(0);
    expect(plan.writes[0].data.alliances).toEqual({ red: { teams: [1, 2] }, blue: { teams: [3, 4] } });
  });
});

describe("rescoring a practice session on a match with no official score", () => {
  const entry = (total: number): ScoutEntry => ({ score: { auto: 0, teleop: 0, endgame: 0, total } }) as ScoutEntry;
  it("keeps the robots total and has no accuracy or official score, instead of comparing with a placeholder 0", () => {
    const unscored = ftcDocToLibraryMatch("EV_Q4", doc({}, {}))!;
    const patch = resolveLobbyPairScoring(unscored, "red", [entry(20), entry(15)], "trial", false);
    expect(patch).toMatchObject({ accuracy: null, scoutedTotal: 35, officialScore: null, penaltyPoints: null });
  });
  it("on a scored match it is the shared formula, as before", () => {
    const scored = ftcDocToLibraryMatch("EV_Q4", doc({ score: 40, penaltyPoints: 5 }, {}))!;
    const patch = resolveLobbyPairScoring(scored, "red", [entry(20), entry(15)], "trial", false);
    expect(patch).toMatchObject({ scoutedTotal: 40, officialScore: 40, penaltyPoints: 5 });
    expect(patch.accuracy).toBe(100);
  });
});
