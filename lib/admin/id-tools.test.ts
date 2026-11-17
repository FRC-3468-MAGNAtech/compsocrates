import { describe, expect, it } from "vitest";
import type { PracticeSession } from "@/lib/practice-sessions";
import type { ScoutEntry } from "@/lib/scout-entries";
import {
  buildSummary,
  filterMatchScoutIdRows,
  filterPracticeSessionIdRows,
  formatMatchId,
  formatMatchType,
  matchScoutIdRows,
  matchesSearch,
  practiceSessionIdRows,
} from "./id-tools";

// A fixture: only the fields the ID tools read are filled in (the rest of ScoutEntry / PracticeSession is irrelevant to them).
const entry = (over: Partial<ScoutEntry> = {}): ScoutEntry =>
  ({
    id: "e1",
    teamId: "t",
    uid: "u1",
    source: "event",
    mode: null,
    scoutName: "Ann",
    eventCode: "2026arli",
    matchType: "Qualification",
    matchNumber: 12,
    teamNumber: 254,
    score: { auto: 0, teleop: 0, endgame: 0, total: 40 },
    comments: "",
    submittedAt: "2026-03-01T10:00:00.000Z",
    sessionId: null,
    accuracy: null,
    ...over,
  }) as ScoutEntry;

const session = (over: Partial<PracticeSession> = {}): PracticeSession =>
  ({
    id: "PS-AAAAAA",
    teamId: "t",
    uid: "u1",
    scoutName: "Ann",
    kind: "solo",
    seasonId: "REBUILT",
    mode: "trial",
    libraryMatchId: null,
    eventCode: null,
    robots: [111, 222],
    accuracy: null,
    scoutedTotal: null,
    startedAt: "2026-03-01T09:00:00.000Z",
    finishedAt: null,
    matchType: null,
    matchNumber: null,
    ...over,
  }) as PracticeSession;

describe("CS formatters", () => {
  it("formatMatchId normalises f/q/p numbers, keeps other ids, dashes blanks", () => {
    expect(formatMatchId("q12")).toBe("Q12");
    expect(formatMatchId(" F3 ")).toBe("F3");
    expect(formatMatchId("p1")).toBe("P1");
    expect(formatMatchId("qf2")).toBe("qf2");
    expect(formatMatchId("")).toBe("-");
  });

  it("formatMatchType names the three types and capitalises the rest", () => {
    expect(formatMatchType("finals")).toBe("Finals");
    expect(formatMatchType("QUALIFICATION")).toBe("Qualification");
    expect(formatMatchType("practice")).toBe("Practice");
    expect(formatMatchType("playoff")).toBe("Playoff");
    expect(formatMatchType("Playoff")).toBe("Playoff");
    expect(formatMatchType("")).toBe("-");
  });

  it("buildSummary shows three then '+N more'", () => {
    expect(buildSummary([])).toBe("-");
    expect(buildSummary(["a", "b", "c"])).toBe("a, b, c");
    expect(buildSummary(["a", "b", "c", "d", "e"])).toBe("a, b, c +2 more");
  });
});

describe("matchScoutIdRows", () => {
  it("lists only official event entries, newest first", () => {
    const rows = matchScoutIdRows([
      entry({ id: "old", submittedAt: "2026-03-01T10:00:00.000Z" }),
      entry({ id: "new", submittedAt: "2026-03-02T10:00:00.000Z" }),
      entry({ id: "practice", source: "practice", sessionId: "PS-1" }),
      entry({ id: "live", source: "live", sessionId: "LV-1" }),
      entry({ id: "tagged", sessionId: "PS-2" }),
      entry({ id: "legacy-practice", legacy: { kind: "practice" } }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["new", "old"]);
  });

  it("derives the columns CS showed", () => {
    const [row] = matchScoutIdRows([
      entry({
        id: "doc1",
        comments: "fast",
        game: "REBUILT",
        legacy: { kind: "official", matchId: "q12", matchType: "qualification", eventKey: "2026arli" },
        accuracy: { status: "complete", value: 0.876, scoutedTotal: 40, penaltyPoints: 0, officialScore: 45 },
      }),
    ]);
    expect(row).toMatchObject({ id: "doc1", scoutName: "Ann", scoutId: "u1", match: "Q12", matchType: "Qualification", game: "REBUILT", team: "254", event: "2026arli", score: 40, accuracy: 88, notes: "fast" });
  });

  it("builds the match label from the entry when there is no CS match id, and shows a finals entry's type as stored", () => {
    const rows = matchScoutIdRows([entry({ id: "a", matchType: "Playoff", matchNumber: 14 }), entry({ id: "b", legacy: { kind: "official", matchType: "finals", matchId: "f14" } })]);
    const a = rows.find((r) => r.id === "a")!;
    const b = rows.find((r) => r.id === "b")!;
    expect(a).toMatchObject({ match: "F14", matchType: "Playoff" });
    expect(b).toMatchObject({ match: "F14", matchType: "Finals" });
  });

  it("has no accuracy when the entry has none or 0", () => {
    const rows = matchScoutIdRows([
      entry({ id: "none", accuracy: null }),
      entry({ id: "zero", accuracy: { status: "complete", value: 0, scoutedTotal: 0, penaltyPoints: 0, officialScore: 0 } }),
      entry({ id: "n/a", accuracy: { status: "not-applicable", value: null, scoutedTotal: null, penaltyPoints: null, officialScore: null } }),
    ]);
    for (const r of rows) expect(r.accuracy, r.id).toBeNull();
  });

  it("searches every column, case-insensitively, and an empty search keeps all", () => {
    const rows = matchScoutIdRows([entry({ id: "AbC123", scoutName: "Bo", teamNumber: 971, comments: "Great climb" }), entry({ id: "zzz", teamNumber: 254 })]);
    expect(filterMatchScoutIdRows(rows, "")).toHaveLength(2);
    expect(filterMatchScoutIdRows(rows, "abc1").map((r) => r.id)).toEqual(["AbC123"]);
    expect(filterMatchScoutIdRows(rows, "971").map((r) => r.id)).toEqual(["AbC123"]);
    expect(filterMatchScoutIdRows(rows, "GREAT CLIMB").map((r) => r.id)).toEqual(["AbC123"]);
    expect(filterMatchScoutIdRows(rows, "nope")).toEqual([]);
  });
});

describe("practiceSessionIdRows", () => {
  it("summarises the entries saved under each session", () => {
    const [row] = practiceSessionIdRows(
      [session({ id: "PS-AAAAAA", eventCode: "2026arli" })],
      [
        entry({ id: "e1", source: "practice", sessionId: "PS-AAAAAA", scoutName: "Ann", teamNumber: 111, matchNumber: 3, game: "REBUILT", score: { auto: 0, teleop: 0, endgame: 0, total: 30 }, submittedAt: "2026-03-01T10:00:00.000Z", accuracy: { status: "complete", value: 0.8, scoutedTotal: 30, penaltyPoints: 0, officialScore: 35 } }),
        entry({ id: "e2", source: "practice", sessionId: "PS-AAAAAA", scoutName: "Ann", teamNumber: 222, matchNumber: 3, score: { auto: 0, teleop: 0, endgame: 0, total: 25 }, submittedAt: "2026-03-01T10:05:00.000Z", accuracy: { status: "complete", value: 0.6, scoutedTotal: 25, penaltyPoints: 0, officialScore: 35 } }),
        entry({ id: "other", source: "practice", sessionId: "PS-ZZZZZZ", teamNumber: 999 }),
      ]
    );
    expect(row).toMatchObject({ id: "PS-AAAAAA", scoutSummary: "Ann", scoutId: "u1", matchSummary: "Q3", game: "REBUILT", teamSummary: "111, 222", event: "2026arli", totalScore: 55, averageAccuracy: 70 });
    expect(row.submittedAt).toBe(Date.parse("2026-03-01T10:05:00.000Z"));
  });

  it("prefers the session's own score when it has one", () => {
    const [row] = practiceSessionIdRows([session({ scoutedTotal: 99.4 })], [entry({ sessionId: "PS-AAAAAA", source: "practice" })]);
    expect(row.totalScore).toBe(99);
  });

  it("falls back to the session's own scout, robots, match and accuracy when it has no entries", () => {
    const [row] = practiceSessionIdRows([session({ kind: "live", matchType: "Qualification", matchNumber: 7, accuracy: 81.6 })], []);
    expect(row).toMatchObject({ scoutSummary: "Ann", teamSummary: "111, 222", matchSummary: "Q7", matchType: "Qualification", game: "REBUILT", totalScore: 0, averageAccuracy: 82 });
    expect(row.submittedAt).toBe(Date.parse("2026-03-01T09:00:00.000Z"));
  });

  it("defaults the type to Practice and is '-' where there is nothing", () => {
    const [row] = practiceSessionIdRows([session({ scoutName: "", robots: [] })], []);
    expect(row).toMatchObject({ matchType: "Practice", scoutSummary: "-", teamSummary: "-", matchSummary: "-", averageAccuracy: null });
  });

  it("lists every session, newest first", () => {
    const rows = practiceSessionIdRows([session({ id: "PS-OLD", startedAt: "2026-01-01T00:00:00.000Z" }), session({ id: "PS-NEW", startedAt: "2026-02-01T00:00:00.000Z" })], []);
    expect(rows.map((r) => r.id)).toEqual(["PS-NEW", "PS-OLD"]);
  });

  it("searches the id, scouts and teams", () => {
    const rows = practiceSessionIdRows([session({ id: "PS-AAAAAA", scoutName: "Zed" }), session({ id: "LV-BBBBBB", scoutName: "Ann", robots: [3468] })], []);
    expect(filterPracticeSessionIdRows(rows, "lv-bb").map((r) => r.id)).toEqual(["LV-BBBBBB"]);
    expect(filterPracticeSessionIdRows(rows, "zed").map((r) => r.id)).toEqual(["PS-AAAAAA"]);
    expect(filterPracticeSessionIdRows(rows, "3468").map((r) => r.id)).toEqual(["LV-BBBBBB"]);
  });
});

describe("matchesSearch", () => {
  it("ignores null and undefined values", () => {
    expect(matchesSearch([null, undefined, "x"], "x")).toBe(true);
    expect(matchesSearch([null], "null")).toBe(false);
  });
});
