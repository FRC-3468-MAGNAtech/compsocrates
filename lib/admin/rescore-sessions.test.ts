import { describe, expect, it } from "vitest";
import type { LibraryMatch } from "@/lib/match-library";
import type { EventMatch } from "@/lib/events/types";
import type { PracticeSession } from "@/lib/practice-sessions";
import type { ScoutEntry } from "@/lib/scout-entries";
import { buildSessionRescorePlan, sessionRescorePatchChanges } from "./rescore-sessions";

function libraryMatch(overrides: Partial<LibraryMatch["alliances"]["red"]> = {}): LibraryMatch {
  return {
    id: "USWABON1_Q1",
    seasonId: "biobuzz",
    eventCode: "USWABON1",
    eventName: "Rookie Rumble",
    matchType: "Qualification",
    matchNumber: 1,
    alliances: {
      red: { teams: [100, 200], score: 100, penaltyPoints: 0, difficulty: "medium", ...overrides },
      blue: { teams: [300, 400], score: 50, penaltyPoints: 0, difficulty: "easy" },
    },
    video: null,
    importedAt: "2026-01-01T00:00:00.000Z",
    scoresUpdatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function session(overrides: Partial<PracticeSession> & { id: string }): PracticeSession {
  return {
    teamId: "team1",
    uid: overrides.id,
    scoutName: overrides.id,
    kind: "solo",
    seasonId: "biobuzz",
    mode: "trial",
    difficulty: "medium",
    libraryMatchId: "USWABON1_Q1",
    eventCode: "USWABON1",
    alliance: "red",
    robots: [100, 200],
    status: "completed",
    completedRobots: [100, 200],
    entryIds: [],
    accuracy: 50,
    scoutedTotal: 50,
    penaltyPoints: 0,
    officialScore: 100,
    platform: "pc",
    flags: [],
    excluded: false,
    lobbyId: null,
    pairId: null,
    startedAt: "2026-01-02T00:00:00.000Z",
    finishedAt: "2026-01-02T00:05:00.000Z",
    matchType: null,
    matchNumber: null,
    allianceTeams: null,
    streamUrl: null,
    streamStartSec: null,
    streamEndSec: null,
    ...overrides,
  };
}

function entry(
  overrides: Partial<Omit<ScoutEntry, "fields">> & { id: string; total: number; sessionId: string; fields?: Partial<ScoutEntry["fields"]> }
): ScoutEntry {
  const { fields: fieldOverrides, ...rest } = overrides;
  return {
    teamId: "team1",
    uid: overrides.id,
    source: "practice",
    mode: "trial",
    formId: "biobuzz",
    formVersion: 1,
    scoutName: overrides.id,
    eventCode: "USWABON1",
    matchType: "Qualification",
    matchNumber: 1,
    teamNumber: 100,
    fields: {
      autoLeave: false,
      autoPark: false,
      autoTipHive: 0,
      teleTipHive: 0,
      flowerBottomNectar: false,
      flowerPollenNectar: 0,
      gardenPollenNectar: 0,
      endgamePark: false,
      diedDuringMatch: false,
      neverStartedMatch: false,
      disabledByFtc: false,
      recoveredFromFreeze: false,
      tippedOver: false,
      yellowCard: false,
      redCard: false,
      ...fieldOverrides,
    },
    score: { auto: 0, teleop: 0, endgame: 0, total: overrides.total },
    comments: "",
    submittedAt: "2026-01-02T00:00:00.000Z",
    excluded: false,
    autoFlags: [],
    manualFlags: [],
    accuracy: null,
    libraryMatchId: "USWABON1_Q1",
    ...rest,
  };
}

describe("buildSessionRescorePlan — solo", () => {
  it("recomputes a solo session's accuracy from each entry's fields, not its stored score", () => {
    const sessions = [session({ id: "s1" })];
    const entries = [
      // teleTipHive is worth 20/tip in BIOBUZZ_FORM_SCHEMA — 5 tips recalculates to 100,
      // regardless of the stale `total: 50` this factory would otherwise stamp on `score`.
      entry({ id: "e1", total: 50, sessionId: "s1", teamNumber: 100, fields: { teleTipHive: 5 } }),
      entry({ id: "e2", total: 50, sessionId: "s1", teamNumber: 200 }),
    ];
    const libraryMatchesById = new Map([["USWABON1_Q1", libraryMatch()]]);
    const plan = buildSessionRescorePlan(sessions, entries, libraryMatchesById, new Map(), {});
    expect(plan).toHaveLength(1);
    expect(plan[0].kind).toBe("solo");
    expect(plan[0].after).toBeCloseTo(100, 5);
    expect(sessionRescorePatchChanges(plan[0])).toBe(true); // before:50, after:100
    expect(plan[0].entryWrites.find((w) => w.entryId === "e1")?.patch.score).toEqual({ auto: 0, teleop: 100, endgame: 0, total: 100 });
  });

  it("skips sessions missing a library match", () => {
    const sessions = [session({ id: "s1", libraryMatchId: "unknown" })];
    const entries = [entry({ id: "e1", total: 50, sessionId: "s1" }), entry({ id: "e2", total: 50, sessionId: "s1" })];
    const plan = buildSessionRescorePlan(sessions, entries, new Map(), new Map(), {});
    expect(plan).toHaveLength(0);
  });

  it("filters by seasonId/eventCode/date range", () => {
    const sessions = [session({ id: "s1", seasonId: "other-season" })];
    const entries = [entry({ id: "e1", total: 50, sessionId: "s1" }), entry({ id: "e2", total: 50, sessionId: "s1" })];
    const libraryMatchesById = new Map([["USWABON1_Q1", libraryMatch()]]);
    expect(buildSessionRescorePlan(sessions, entries, libraryMatchesById, new Map(), { seasonId: "biobuzz" })).toHaveLength(0);
    expect(buildSessionRescorePlan(sessions, entries, libraryMatchesById, new Map(), { seasonId: "other-season" })).toHaveLength(1);
  });
});

describe("buildSessionRescorePlan — lobby", () => {
  it("resolves a pair split across two sessions", () => {
    const sessions = [
      session({ id: "s1", kind: "lobby", lobbyId: "LB-1", pairId: "pair-1", robots: [100] }),
      session({ id: "s2", kind: "lobby", lobbyId: "LB-1", pairId: "pair-1", robots: [200] }),
    ];
    const entries = [
      entry({ id: "e1", total: 50, sessionId: "s1", teamNumber: 100 }),
      entry({ id: "e2", total: 50, sessionId: "s2", teamNumber: 200 }),
    ];
    const libraryMatchesById = new Map([["USWABON1_Q1", libraryMatch()]]);
    const plan = buildSessionRescorePlan(sessions, entries, libraryMatchesById, new Map(), {});
    expect(plan).toHaveLength(1);
    expect(plan[0].kind).toBe("lobby");
    expect(plan[0].sessionIds.sort()).toEqual(["s1", "s2"]);
    expect(plan[0].sessionWrites).toHaveLength(2);
  });

  it("skips an incomplete pair (only one session present)", () => {
    const sessions = [session({ id: "s1", kind: "lobby", lobbyId: "LB-1", pairId: "pair-1" })];
    const entries = [entry({ id: "e1", total: 50, sessionId: "s1" })];
    const libraryMatchesById = new Map([["USWABON1_Q1", libraryMatch()]]);
    const plan = buildSessionRescorePlan(sessions, entries, libraryMatchesById, new Map(), {});
    expect(plan).toHaveLength(0);
  });
});

describe("buildSessionRescorePlan — live", () => {
  function ftcMatch(overrides: Partial<EventMatch> = {}): EventMatch {
    return {
      id: "m1",
      matchNumber: 1,
      type: "Qualification",
      description: null,
      series: null,
      played: true,
      redTeams: [100, 200],
      blueTeams: [300, 400],
      redScore: 100,
      blueScore: 50,
      redPenaltyPoints: 0,
      bluePenaltyPoints: 0,
      startTime: null,
      ...overrides,
    };
  }

  it("resolves a live alliance pair against a fresh EventMatch", () => {
    const sessions = [
      session({ id: "s1", kind: "live", libraryMatchId: null, matchType: "Qualification", matchNumber: 1, lobbyId: null, pairId: null }),
      session({ id: "s2", kind: "live", libraryMatchId: null, matchType: "Qualification", matchNumber: 1, lobbyId: null, pairId: null }),
    ];
    const entries = [
      entry({ id: "e1", total: 50, sessionId: "s1", source: "live", teamNumber: 100, fields: { teleTipHive: 5 } }),
      entry({ id: "e2", total: 50, sessionId: "s2", source: "live", teamNumber: 200 }),
    ];
    const liveMatchesByKey = new Map([["USWABON1|Qualification|1", ftcMatch()]]);
    const plan = buildSessionRescorePlan(sessions, entries, new Map(), liveMatchesByKey, {});
    expect(plan).toHaveLength(1);
    expect(plan[0].kind).toBe("live");
    expect(plan[0].after).toBeCloseTo(100, 5);
  });

  it("skips when the official score hasn't posted", () => {
    const sessions = [
      session({ id: "s1", kind: "live", libraryMatchId: null, matchType: "Qualification", matchNumber: 1 }),
      session({ id: "s2", kind: "live", libraryMatchId: null, matchType: "Qualification", matchNumber: 1 }),
    ];
    const entries = [
      entry({ id: "e1", total: 50, sessionId: "s1", source: "live" }),
      entry({ id: "e2", total: 50, sessionId: "s2", source: "live" }),
    ];
    const liveMatchesByKey = new Map([["USWABON1|Qualification|1", ftcMatch({ redScore: null })]]);
    const plan = buildSessionRescorePlan(sessions, entries, new Map(), liveMatchesByKey, {});
    expect(plan).toHaveLength(0);
  });
});

describe("buildSessionRescorePlan — 3-robot alliances", () => {
  const match3 = (): LibraryMatch => {
    const base = libraryMatch({ teams: [100, 200, 300], score: 90 });
    return { ...base, alliances: { ...base.alliances, blue: { ...base.alliances.blue, teams: [400, 500, 600] } } };
  };
  const lib3 = new Map([["USWABON1_Q1", match3()]]);

  it("rescores a solo session once all three robots' entries exist, and skips one that has only two", () => {
    const solo = session({ id: "s1", robots: [100, 200, 300], accuracy: 12 });
    const three = [100, 200, 300].map((teamNumber, i) => entry({ id: `e${i + 1}`, total: 30, sessionId: "s1", teamNumber }));
    const plan = buildSessionRescorePlan([solo], three, lib3, new Map(), {});
    expect(plan).toHaveLength(1);
    expect(plan[0].sessionIds).toEqual(["s1"]);
    expect(plan[0].entryWrites.every((w) => ["e1", "e2", "e3"].includes(w.entryId))).toBe(true);
    expect(buildSessionRescorePlan([solo], three.slice(0, 2), lib3, new Map(), {})).toEqual([]);
  });

  it("rescores a lobby group only when all three players' sessions are there", () => {
    const group = [100, 200, 300].map((robot, i) => session({ id: `s${i + 1}`, kind: "lobby", lobbyId: "LB-1", pairId: "pair-1", robots: [robot] }));
    const entries = group.map((s, i) => entry({ id: `e${i + 1}`, total: 30, sessionId: s.id, teamNumber: s.robots[0] }));
    const plan = buildSessionRescorePlan(group, entries, lib3, new Map(), {});
    expect(plan).toHaveLength(1);
    expect(plan[0].sessionIds).toEqual(["s1", "s2", "s3"]);
    expect(plan[0].scoutNames).toHaveLength(3);
    expect(buildSessionRescorePlan(group.slice(0, 2), entries, lib3, new Map(), {})).toEqual([]);
  });
});
