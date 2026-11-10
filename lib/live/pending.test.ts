import { describe, expect, it } from "vitest";
import type { PracticeSession } from "@/lib/practice-sessions";
import { computePendingLiveRobots } from "./pending";

function liveSession(overrides: Partial<PracticeSession> & { id: string; uid: string }): PracticeSession {
  return {
    teamId: "team1",
    scoutName: overrides.uid,
    kind: "live",
    seasonId: "biobuzz",
    mode: null,
    difficulty: null,
    libraryMatchId: null,
    eventCode: "USWABON1",
    alliance: "red",
    robots: [100],
    allianceTeams: [100, 200],
    status: "completed",
    completedRobots: [100],
    entryIds: ["e1"],
    accuracy: null,
    scoutedTotal: null,
    penaltyPoints: null,
    officialScore: null,
    platform: "pc",
    flags: [],
    excluded: false,
    lobbyId: null,
    pairId: null,
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:10:00.000Z",
    matchType: "Qualification",
    matchNumber: 12,
    streamUrl: "https://youtu.be/abc12345678",
    streamStartSec: 120,
    streamEndSec: 300,
    ...overrides,
  };
}

describe("computePendingLiveRobots", () => {
  it("lists the sibling robot when nobody has covered it", () => {
    const sessions = [liveSession({ id: "s1", uid: "scout-a" })];
    const pending = computePendingLiveRobots(sessions, "scout-a");
    expect(pending).toHaveLength(1);
    expect(pending[0].teamNumber).toBe(200);
    expect(pending[0].sessionId).toBe("s1");
  });

  it("excludes it once another session covers the sibling robot", () => {
    const sessions = [
      liveSession({ id: "s1", uid: "scout-a" }),
      liveSession({ id: "s2", uid: "scout-b", robots: [200], completedRobots: [200] }),
    ];
    expect(computePendingLiveRobots(sessions, "scout-a")).toHaveLength(0);
  });

  it("still counts as covered while someone else is actively scouting it (not just completed)", () => {
    const sessions = [
      liveSession({ id: "s1", uid: "scout-a" }),
      liveSession({ id: "s2", uid: "scout-b", robots: [200], status: "in-progress", completedRobots: [] }),
    ];
    expect(computePendingLiveRobots(sessions, "scout-a")).toHaveLength(0);
  });

  it("ignores sessions belonging to other scouts", () => {
    const sessions = [liveSession({ id: "s1", uid: "scout-a" })];
    expect(computePendingLiveRobots(sessions, "scout-b")).toHaveLength(0);
  });
});

describe("computePendingLiveRobots — 3-robot alliances", () => {
  const trio = { allianceTeams: [100, 200, 300] };

  it("lists both uncovered robots when a scout covered only one of three", () => {
    const pending = computePendingLiveRobots([liveSession({ id: "s1", uid: "scout-a", ...trio })], "scout-a");
    expect(pending.map((p) => p.teamNumber)).toEqual([200, 300]);
    expect(pending.every((p) => p.sessionId === "s1" && p.allianceTeams.length === 3)).toBe(true);
  });

  it("drops a robot once someone else covers it, keeping the other", () => {
    const sessions = [
      liveSession({ id: "s1", uid: "scout-a", ...trio }),
      liveSession({ id: "s2", uid: "scout-b", robots: [300], completedRobots: [300], ...trio }),
    ];
    expect(computePendingLiveRobots(sessions, "scout-a").map((p) => p.teamNumber)).toEqual([200]);
  });

  it("does not list a robot twice when the scout scouted two robots of the alliance themselves", () => {
    const sessions = [
      liveSession({ id: "s1", uid: "scout-a", ...trio }),
      liveSession({ id: "s2", uid: "scout-a", robots: [200], completedRobots: [200], ...trio }),
    ];
    const pending = computePendingLiveRobots(sessions, "scout-a");
    expect(pending.map((p) => p.teamNumber)).toEqual([300]);
  });

  it("has nothing pending once all three are covered", () => {
    const sessions = [
      liveSession({ id: "s1", uid: "scout-a", ...trio }),
      liveSession({ id: "s2", uid: "scout-b", robots: [200], ...trio }),
      liveSession({ id: "s3", uid: "scout-c", robots: [300], status: "in-progress", ...trio }),
    ];
    expect(computePendingLiveRobots(sessions, "scout-a")).toHaveLength(0);
  });
});
