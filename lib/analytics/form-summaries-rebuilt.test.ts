import { describe, expect, it } from "vitest";
import { csDocToFormEntry, type CsFormType } from "@/data/cs/forms";
import { SUBMITTED, leadDoc } from "@/data/cs/fixtures";
import type { CsRecord } from "@/data/cs/types";
import type { FormEntry } from "@/lib/form-entries-model";
import {
  compareRobotToPlan,
  disposition,
  helperRebuiltAnalytics,
  leadRebuiltSummary,
  modeOf,
  parseFuelScale,
  parseWeightLb,
  pitRebuiltOverview,
  pitRebuiltRows,
  planCapability,
  planForReflection,
  planRebuiltRows,
  reflectionRebuiltRows,
  strategyRebuiltSummary,
  teamRebuiltProfile,
  teamsInText,
  titleCase,
  wentToPlanRebuilt,
} from "@/lib/analytics/form-summaries-rebuilt";

// Entries are real CS documents run through the adapter's converter, so these tests read the exact `values` keys the app produces.

let n = 0;
const read = (type: CsFormType, doc: CsRecord, id = `${type}-${++n}`): FormEntry => csDocToFormEntry(type, id, { teamId: "MAG2403", eventKey: "2026arli", game: "REBUILT", scoutName: "Ada Lovelace", scoutId: "uid-ada", ...doc });
const at = (ms: number) => ({ createdAt: SUBMITTED + ms, submittedAt: SUBMITTED + ms, timestamp: SUBMITTED + ms });

const pit = (team: string, over: CsRecord = {}, ms = 0, id?: string) =>
  read("pit-scout", { teamNumber: team, robotWeight: "118 lbs", rookieTeam: false, robotPictureUrl: "https://example.com/r.jpg", pitDisposition: true, driveDisposition: false, fuelPreloadCapacity: "8", fuelBallsPerSecond: "10-13", fuelCarryingCapacity: "x", climbLevel1: true, climbLevel2: true, climbLevel3: false, typicalFuelCycleTime: "6.5", typicalClimbTime: "4", autoCycleDescription: "Depot then shoot", notes: "Tidy wiring", ...at(ms), ...over }, id);

const strategy = (team: string, over: CsRecord = {}, ms = 0) =>
  read("team-strategy", { teamNumber: team, preferredStartingPosition: "outpost-trench", bestAt: "shooting", clearsBump: false, clearsTrench: true, canShootWhileIntaking: false, canMoveAndShootSimultaneously: true, notes: "", ...at(ms), ...over });

const robot = (team: string, over: CsRecord = {}) => ({ teamNumber: team, startingPosition: "middle", role: "Offense", autoClimb: false, endgameClimb: "", ...over });
const plan = (match: string, robots: CsRecord[], over: CsRecord = {}, ms = 0, id?: string) => read("match-strategy", { matchKey: match, matchId: match, robots, notes: "", ...at(ms), ...over }, id);
const reflection = (match: string, robots: CsRecord[], over: CsRecord = {}, ms = 0, id?: string) => read("drive-reflection", { matchKey: match, matchId: match, robots, notes: "", ...at(ms), ...over }, id);

describe("small readers", () => {
  it("titleCases like CS's formatAnalyticsText", () => {
    expect(titleCase("outpost-trench")).toBe("Outpost Trench");
    expect(titleCase("level-2")).toBe("Level 2");
    expect(titleCase("  not_there ")).toBe("Not There");
    expect(titleCase(undefined)).toBe("");
  });

  it("reads the fuel scales: digits, a range (its midpoint), x and blank", () => {
    expect(parseFuelScale("8")).toEqual({ text: "8", value: 8 });
    expect(parseFuelScale("10-13")).toEqual({ text: "10-13", value: 11.5 });
    expect(parseFuelScale("x")).toEqual({ text: "x", value: null });
    expect(parseFuelScale(undefined)).toEqual({ text: "", value: null });
    expect(parseFuelScale(12)).toEqual({ text: "12", value: 12 });
    expect(parseFuelScale("lots").value).toBeNull();
  });

  it("reads the weight in pounds from free text", () => {
    expect(parseWeightLb("118 lbs")).toBe(118);
    expect(parseWeightLb("55kg")).toBe(121.3);
    expect(parseWeightLb("heavy")).toBeNull();
    expect(parseWeightLb(undefined)).toBeNull();
  });

  it("shows a disposition as Yes / No, or the text an old CSV import stored", () => {
    expect(disposition(true)).toEqual({ text: "Yes", positive: true });
    expect(disposition(false)).toEqual({ text: "No", positive: false });
    expect(disposition(undefined)).toEqual({ text: "No", positive: false });
    expect(disposition("friendly")).toEqual({ text: "Friendly", positive: false });
    expect(disposition("yes")).toMatchObject({ positive: true });
  });

  it("takes the first most-common value for a mode, like CS", () => {
    expect(modeOf(["a", "b", "b", "a"])).toBe("a");
    expect(modeOf(["", undefined, "x"])).toBe("x");
    expect(modeOf([])).toBeNull();
  });
});

describe("pit scout", () => {
  it("summarises a CS pit document: scales, climb levels, weight, dispositions, times", () => {
    const [row] = pitRebuiltRows([pit("254")]);
    expect(row).toMatchObject({
      teamNumber: 254,
      eventCode: "2026arli",
      scoutName: "Ada Lovelace",
      weightText: "118 lbs",
      weightLb: 118,
      rookie: false,
      pictureUrl: "https://example.com/r.jpg",
      preload: { text: "8", value: 8 },
      ballsPerSecond: { text: "10-13", value: 11.5 },
      carry: { text: "x", value: null },
      climb: [true, true, false],
      highestClimb: 2,
      fuelCycleSeconds: 6.5,
      climbSeconds: 4,
      autoCycle: "Depot then shoot",
      notes: "Tidy wiring",
      entryCount: 1,
    });
    expect(row.pitDisposition.text).toBe("Yes");
    expect(row.driveDisposition.text).toBe("No");
  });

  it("keeps the latest entry per team and event, counts the rest, and sorts by team", () => {
    const rows = pitRebuiltRows([pit("1678", { robotWeight: "100 lbs" }, 10), pit("254", { robotWeight: "110 lbs" }, 0), pit("254", { robotWeight: "120 lbs" }, 50), pit("254", { eventKey: "2026lake" }, 20)]);
    expect(rows.map((r) => [r.teamNumber, r.eventCode, r.weightLb, r.entryCount])).toEqual([
      [254, "2026arli", 120, 2],
      [254, "2026lake", 118, 1],
      [1678, "2026arli", 100, 1],
    ]);
  });

  it("lists every entry newest first with latestOnly false", () => {
    const rows = pitRebuiltRows([pit("254", { robotWeight: "110 lbs" }, 0), pit("254", { robotWeight: "120 lbs" }, 50)], { latestOnly: false });
    expect(rows.map((r) => r.weightLb)).toEqual([120, 110]);
  });

  it("drops excluded entries and a bad picture URL, and tolerates a sparse or legacy document", () => {
    expect(pitRebuiltRows([pit("254", { excludeFromStats: true })])).toEqual([]);
    const [row] = pitRebuiltRows([read("pit-scout", { teamNumber: "77", robotPictureUrl: "javascript:alert(1)", pitDisposition: "Friendly", fuelPreloadCapacity: " " })]);
    expect(row).toMatchObject({ teamNumber: 77, pictureUrl: null, weightLb: null, rookie: null, highestClimb: 0, climb: [false, false, false] });
    expect(row.pitDisposition.text).toBe("Friendly");
    expect(row.preload).toEqual({ text: "", value: null });
  });

  it("overview counts the climb levels and the average weight over each team's latest row", () => {
    const rows = pitRebuiltRows([pit("254", { climbLevel3: true }), pit("1678", { climbLevel1: false, climbLevel2: false, robotWeight: "130 lbs" }), pit("118", { robotWeight: "heavy" })]);
    const o = pitRebuiltOverview(rows);
    expect(o).toMatchObject({ teams: 3, climbCounts: [2, 2, 1], highestClimbCounts: [1, 0, 1, 1], averageWeightLb: 124 });
  });
});

describe("team strategy", () => {
  it("reads preferred start, best at and the four abilities", () => {
    const { rows } = strategyRebuiltSummary([strategy("254")]);
    expect(rows[0]).toMatchObject({ teamNumber: 254, preferredStartingPosition: "outpost-trench", bestAt: "shooting", abilities: { clearsBump: false, clearsTrench: true, canShootWhileIntaking: false, canMoveAndShootSimultaneously: true } });
  });

  it("reads the older `startingPosition` alias the converter maps", () => {
    const e = read("team-strategy", { teamNumber: "9", startingPosition: "depot-side", bestAt: "passing" });
    expect(strategyRebuiltSummary([e]).rows[0].preferredStartingPosition).toBe("depot-side");
  });

  it("counts teams per best-at, per starting position and per ability over the latest entry of each team", () => {
    const s = strategyRebuiltSummary([
      strategy("254", { bestAt: "cycling" }, 0),
      strategy("254", { bestAt: "shooting" }, 10),
      strategy("1678", { bestAt: "shooting", preferredStartingPosition: "middle", clearsTrench: false }),
      strategy("118", { bestAt: "stealing", clearsBump: true }),
    ]);
    expect(s.rows.map((r) => r.teamNumber)).toEqual([118, 254, 1678]);
    expect(s.bestAtCounts).toEqual({ stealing: 1, shooting: 2 });
    expect(s.startCounts).toEqual({ "outpost-trench": 2, middle: 1 });
    expect(s.abilityCounts).toEqual({ clearsBump: 1, clearsTrench: 2, canShootWhileIntaking: 0, canMoveAndShootSimultaneously: 3 });
    expect(s.rows.find((r) => r.teamNumber === 254)?.entryCount).toBe(2);
  });

  it("ignores excluded entries", () => {
    expect(strategyRebuiltSummary([strategy("254", { excludeFromStats: true })]).rows).toEqual([]);
  });
});

describe("lead scout", () => {
  const lead = (match: string, robots: CsRecord[], overall: CsRecord, over: CsRecord = {}, ms = 0) => read("lead-scout", { ...leadDoc(), matchKey: match, matchId: match, alliance: "red", robots, overallAlliance: overall, ...at(ms), ...over });

  it("reads the per-robot skills and notes and the alliance's own", () => {
    const e = lead("q12", [{ teamNumber: "254", notes: "fast", skillLevel: 5 }, { teamNumber: "1678", notes: "", skillLevel: 3 }, { teamNumber: "118", notes: "slow intake", skillLevel: 0 }], { teams: "RED / 254, 1678, 118", notes: "strong alliance", skillLevel: 4 });
    const s = leadRebuiltSummary([e]);
    expect(s.alliances).toHaveLength(1);
    expect(s.alliances[0]).toMatchObject({ matchKey: "Q12", alliance: "red", teams: [254, 1678, 118], allianceSkill: 4, allianceNotes: "strong alliance", scoutName: "Ada Lovelace" });
    expect(s.alliances[0].robots).toEqual([
      { slot: 1, team: 254, skill: 5, notes: "fast" },
      { slot: 2, team: 1678, skill: 3, notes: "" },
      { slot: 3, team: 118, skill: null, notes: "slow intake" },
    ]);
  });

  it("averages a team's skill over its ratings, skipping CS's 0 for unset, and lists its notes in the order written", () => {
    const s = leadRebuiltSummary([
      lead("q1", [{ teamNumber: "254", notes: "first", skillLevel: 5 }], { skillLevel: 0 }, {}, 0),
      lead("q9", [{ teamNumber: "254", notes: "later", skillLevel: 3 }, { teamNumber: "118", notes: "", skillLevel: 0 }], { skillLevel: 2 }, { alliance: "blue" }, 100),
    ]);
    const t254 = s.teams.find((t) => t.teamNumber === 254)!;
    expect(t254).toMatchObject({ averageSkill: 4, entries: 2 });
    expect(t254.notes.map((x) => [x.matchKey, x.text])).toEqual([["Q1", "first"], ["Q9", "later"]]);
    expect(s.teams.find((t) => t.teamNumber === 118)).toMatchObject({ averageSkill: null, entries: 1 });
    expect(s.alliances[0].allianceSkill).toBeNull();
    expect(s.alliances.map((a) => a.matchKey)).toEqual(["Q1", "Q9"]);
  });

  it("falls back to the overall teams text when no robot names a team, and skips excluded entries", () => {
    const e = lead("q3", [], { teams: "BLUE / 111, 222, 333", skillLevel: 3 }, { alliance: "blue" });
    expect(leadRebuiltSummary([e]).alliances[0].teams).toEqual([111, 222, 333]);
    expect(leadRebuiltSummary([{ ...e, excluded: true }])).toEqual({ teams: [], alliances: [] });
    expect(teamsInText("RED / 254, 1678")).toEqual([254, 1678]);
    expect(teamsInText("1, 2, 3")).toEqual([1, 2, 3]);
  });

  it("reads CS's fixture lead document", () => {
    const e = read("lead-scout", leadDoc());
    const s = leadRebuiltSummary([e]);
    expect(s.teams).toEqual([{ teamNumber: 1, averageSkill: 3, entries: 1, notes: [] }]);
    expect(s.alliances[0]).toMatchObject({ allianceSkill: 3, teams: [1] });
  });
});

describe("match strategy", () => {
  const red = [robot("254", { startingPosition: "outpost-trench", role: "Offense", autoClimb: true, endgameClimb: "level-3" }), robot("1678", { role: "Defense" }), robot("118", { role: "Feeder", endgameClimb: "level-1" })];
  const blue = [robot("971"), robot("111"), robot("222")];

  it("reads each robot's starting position, role and climbs", () => {
    const [row] = planRebuiltRows([plan("q12", red, { notes: "play it safe" })]);
    expect(row).toMatchObject({ matchKey: "Q12", alliance: null, notes: "play it safe" });
    expect(row.robots[0]).toEqual({ slot: 1, team: 254, startingPosition: "outpost-trench", role: "Offense", autoClimb: true, endgameClimb: "level-3" });
    expect(row.robots.map((r) => r.team)).toEqual([254, 1678, 118]);
  });

  it("keeps both alliances of a match apart even though CS stores no alliance, and keeps the latest of the same teams", () => {
    const rows = planRebuiltRows([plan("q12", red, {}, 0), plan("q12", blue, {}, 5), plan("q12", [robot("254", { role: "Defense" }), ...red.slice(1)], {}, 20)]);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.robots[0].team === 254)?.robots[0].role).toBe("Defense");
    expect(planRebuiltRows([plan("q12", red, {}, 0), plan("q12", red, {}, 9)], { latestOnly: false })).toHaveLength(2);
  });

  it("orders by event, then match number, then alliance (the app's additive alliance included)", () => {
    const rows = planRebuiltRows([plan("q10", red), plan("q2", red), plan("q2", blue, { alliance: "blue" }), plan("q2", red, { alliance: "red" })]);
    expect(rows.map((r) => [r.matchKey, r.alliance])).toEqual([["Q2", null], ["Q2", "blue"], ["Q2", "red"], ["Q10", null]]);
  });

  it("skips robots without a team and blank slots", () => {
    const [row] = planRebuiltRows([plan("q1", [robot("254"), robot(""), { teamNumber: "", role: "x" }])]);
    expect(row.robots.map((r) => r.team)).toEqual([254]);
  });
});

describe("drive reflection against the plan", () => {
  const planned = [robot("254", { startingPosition: "outpost-trench", autoClimb: true, endgameClimb: "level-3" }), robot("1678", { role: "Defense" }), robot("118", { endgameClimb: "level-1" })];

  it("joins a reflection to the plan of the same match and lists what differs", () => {
    const p = plan("q12", planned, {}, 0, "plan-1");
    const r = reflection("q12", [robot("254", { startingPosition: "depot-trench", role: "cycler", autoClimb: false, endgameClimb: "level-2" }), robot("1678", { role: "passer" }), robot("118", { endgameClimb: "level-1" })]);
    const [row] = reflectionRebuiltRows([r], [p]);
    expect(row.plan?.entryId).toBe("plan-1");
    expect(row.differences).toEqual([
      { team: 254, field: "startingPosition", planned: "Outpost Trench", actual: "Depot Trench" },
      { team: 254, field: "autoClimb", planned: "Yes", actual: "No" },
      { team: 254, field: "endgameClimb", planned: "Level 3", actual: "Level 2" },
    ]);
  });

  it("does not flag the role (CS's two forms use different role lists) or a blank endgame climb", () => {
    expect(compareRobotToPlan({ slot: 1, team: 1, startingPosition: "middle", role: "cycler", autoClimb: false, endgameClimb: "" }, { slot: 1, team: 1, startingPosition: "middle", role: "Offense", autoClimb: false, endgameClimb: "level-3" })).toEqual([]);
  });

  it("treats a planned 'any' starting position as a match, and compares by team, not by slot", () => {
    expect(compareRobotToPlan({ slot: 1, team: 1, startingPosition: "middle", role: "", autoClimb: false, endgameClimb: "" }, { slot: 3, team: 1, startingPosition: "Any", role: "", autoClimb: false, endgameClimb: "" })).toEqual([]);
    const p = plan("q5", [robot("1"), robot("2")], {}, 0, "p");
    const r = reflection("q5", [robot("2"), robot("1", { startingPosition: "depot-side" })]);
    const [row] = reflectionRebuiltRows([r], [p]);
    expect(row.differences).toEqual([{ team: 1, field: "startingPosition", planned: "Middle", actual: "Depot Side" }]);
  });

  it("prefers the linked plan, else the plan of the match with the most robots in common, ignoring excluded and other matches", () => {
    const a = plan("q7", [robot("1"), robot("2"), robot("3")], {}, 0, "a");
    const b = plan("q7", [robot("1"), robot("9"), robot("8")], {}, 5, "b");
    const other = plan("q8", [robot("1"), robot("2"), robot("3")], {}, 5, "c");
    const r = reflection("q7", [robot("1"), robot("2"), robot("3")]);
    expect(planForReflection(r, [a, b, other])?.id).toBe("a");
    expect(planForReflection({ ...r, linkedEntryId: "b" }, [a, b, other])?.id).toBe("b");
    expect(planForReflection(r, [{ ...a, excluded: true }, other])).toBeNull();
    expect(planForReflection(reflection("q7", [robot("500")]), [a, b])).toBeNull();
  });

  it("does not join across alliances when both sides name one", () => {
    const p = plan("q9", [robot("1")], { alliance: "red" }, 0, "p");
    expect(planForReflection(reflection("q9", [robot("1")], { alliance: "blue" }), [p])).toBeNull();
    expect(planForReflection(reflection("q9", [robot("1")], { alliance: "red" }), [p])?.id).toBe("p");
  });

  it("reports the share of reflections with a plan that went exactly to plan", () => {
    const p1 = plan("q1", [robot("1"), robot("2")], {}, 0, "p1");
    const p2 = plan("q2", [robot("3"), robot("4")], {}, 0, "p2");
    const rows = reflectionRebuiltRows([reflection("q1", [robot("1"), robot("2")]), reflection("q2", [robot("3", { autoClimb: true }), robot("4")]), reflection("q3", [robot("5")])], [p1, p2]);
    expect(rows.map((r) => [r.matchKey, r.plan?.entryId ?? null, r.differences.length])).toEqual([["Q1", "p1", 0], ["Q2", "p2", 1], ["Q3", null, 0]]);
    expect(wentToPlanRebuilt(rows)).toEqual({ planned: 2, onPlan: 1, percent: 50 });
    expect(wentToPlanRebuilt([])).toEqual({ planned: 0, onPlan: 0, percent: null });
  });
});

describe("helper", () => {
  const helper = (name: string, ok: boolean, over: CsRecord = {}, ms = 0) => read("helper", { helperName: name, assistedTeamNumber: "254", wasSuccessful: ok, issueSolved: "Swapped a motor", notes: "", ...at(ms), ...over });

  it("counts assists and the success rate overall and per scout", () => {
    const a = helperRebuiltAnalytics([helper("Ada", true, {}, 0), helper("Ada", false, {}, 10), helper("Ben", true, { assistedTeamNumber: "118" }, 20), helper("Ben", true, { excludeFromStats: true })]);
    expect(a).toMatchObject({ total: 3, successful: 2, rate: 67 });
    expect(a.perScout).toEqual([{ scoutName: "Ada", assists: 2, successful: 1, rate: 50 }, { scoutName: "Ben", assists: 1, successful: 1, rate: 100 }]);
    expect(a.log.map((e) => e.teamNumber)).toEqual([118, 254, 254]);
  });

  it("is empty with no entries", () => {
    expect(helperRebuiltAnalytics([])).toMatchObject({ total: 0, rate: null, perScout: [] });
  });
});

describe("team profile", () => {
  const entries = [
    pit("254", { robotWeight: "100 lbs" }, 0),
    pit("254", { robotWeight: "125 lbs" }, 50),
    strategy("254", { bestAt: "cycling" }, 0),
    strategy("1678"),
    read("lead-scout", { ...leadDoc(), matchKey: "q4", matchId: "q4", robots: [{ teamNumber: "254", notes: "good", skillLevel: 4 }], overallAlliance: { skillLevel: 3 }, ...at(0) }),
    read("lead-scout", { ...leadDoc(), matchKey: "q8", matchId: "q8", robots: [{ teamNumber: "254", notes: "better", skillLevel: 5 }], overallAlliance: { skillLevel: 3 }, ...at(100) }),
    plan("q4", [robot("254", { startingPosition: "outpost-trench", role: "Offense", autoClimb: true, endgameClimb: "level-3" }), robot("1678")], {}, 0),
    plan("q8", [robot("254", { startingPosition: "outpost-trench", role: "Defense", autoClimb: false, endgameClimb: "level-3" }), robot("118")], {}, 0),
    plan("q9", [robot("254", { startingPosition: "middle", role: "Defense", autoClimb: true, endgameClimb: "level-2" })], {}, 0),
    reflection("q4", [robot("254", { startingPosition: "outpost-trench", role: "cycler", autoClimb: true, endgameClimb: "level-3" })], {}, 0),
  ];

  it("combines the latest pit and strategy entries, the lead-scout skill and the plan and reflection capability", () => {
    const p = teamRebuiltProfile(254, entries);
    expect(p.any).toBe(true);
    expect(p.pit?.weightLb).toBe(125);
    expect(p.pit?.entryCount).toBe(2);
    expect(p.strategy?.bestAt).toBe("cycling");
    expect(p.lead).toMatchObject({ skill: 4.5, ratings: 2 });
    expect(p.lead.notes.map((x) => x.text)).toEqual(["better", "good"]);
    expect(p.plan).toEqual({ entries: 3, startingPosition: "outpost-trench", role: "Defense", autoClimbRate: 67, endgameClimb: "level-3" });
    expect(p.reflection).toEqual({ entries: 1, startingPosition: "outpost-trench", role: "cycler", autoClimbRate: 100, endgameClimb: "level-3" });
  });

  it("is empty for a team nobody scouted", () => {
    const p = teamRebuiltProfile(9999, entries);
    expect(p).toMatchObject({ pit: null, strategy: null, any: false, plan: { entries: 0, autoClimbRate: null, startingPosition: null }, lead: { skill: null, ratings: 0 } });
  });

  it("shows a team that only appears in a plan", () => {
    expect(teamRebuiltProfile(118, entries)).toMatchObject({ any: true, pit: null, plan: { entries: 1 } });
  });

  it("ignores excluded plan entries when comparing capability", () => {
    const plans = entries.filter((e) => e.formType === "match-strategy");
    expect(planCapability(254, plans).entries).toBe(3);
    expect(planCapability(254, plans.map((e) => ({ ...e, excluded: true }))).entries).toBe(0);
  });
});
