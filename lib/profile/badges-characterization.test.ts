import { describe, expect, it } from "vitest";
import type { EventAttendance } from "@/lib/event-attendance";
import type { PracticeSession } from "@/lib/practice-sessions";
import type { ScoutEntry } from "@/lib/scout-entries";
import type { TeamMember } from "@/lib/team-members";
import { BADGES } from "./badges";
import { computeProfileStats } from "./stats";

// Session 8: CHARACTERIZATION tests. They pin what the eight built-in achievements award TODAY, through the whole path
// (computeProfileStats -> badges), so the move to definitions and metrics cannot change what anyone has earned.
// They must pass unchanged before and after that refactor.

const member = (uid: string): TeamMember => ({ uid, name: uid, email: `${uid}@x.com`, primaryRole: "match-scout", secondaryRoles: [], isAdmin: false, isOwner: false });

function session(id: string, uid: string, o: Partial<PracticeSession> = {}): PracticeSession {
  return {
    id, teamId: "t", uid, scoutName: uid, kind: "solo", seasonId: "s", mode: "trial", difficulty: "medium", libraryMatchId: null, eventCode: null, alliance: "red",
    robots: [1, 2], status: "completed", completedRobots: [1, 2], entryIds: ["a", "b"], accuracy: 80, scoutedTotal: 80, penaltyPoints: 0, officialScore: 100, platform: "pc",
    flags: [], excluded: false, lobbyId: null, pairId: null, startedAt: "2026-03-01T10:00:00.000Z", finishedAt: "2026-03-01T10:10:00.000Z", matchType: null, matchNumber: null,
    allianceTeams: null, streamUrl: null, streamStartSec: null, streamEndSec: null, ...o,
  };
}

function entry(id: string, uid: string, o: Partial<ScoutEntry> = {}): ScoutEntry {
  return {
    id, teamId: "t", uid, source: "event", mode: null, formId: "f", formVersion: 1, scoutName: uid, eventCode: "EV1", matchType: "Qualification", matchNumber: 1, teamNumber: 1,
    values: {}, score: { auto: 0, teleop: 0, endgame: 0, total: 0 }, comments: "", submittedAt: "2026-03-02T10:00:00.000Z", excluded: false, autoFlags: [], manualFlags: [],
    accuracy: null, sessionId: null, libraryMatchId: null, ...o,
  };
}

const complete = (value: number) => ({ status: "complete" as const, value, scoutedTotal: 50, penaltyPoints: 0, officialScore: 50 });
const attended = (n: number): EventAttendance[] => Array.from({ length: n }, (_, i) => ({ id: `E${i}`, teamId: "t", eventCode: `E${i}`, uids: ["me"], updatedAt: null }));
/** n sessions on days two apart, so no streak forms. */
const spread = (n: number, o: Partial<PracticeSession> = {}) => Array.from({ length: n }, (_, i) => session(`s${i}`, "me", { finishedAt: new Date(2026, 0, 1 + 2 * i, 12).toISOString(), ...o }));
/** n sessions on consecutive days. */
const consecutive = (n: number) => Array.from({ length: n }, (_, i) => session(`c${i}`, "me", { finishedAt: new Date(2026, 1, 1 + i, 12).toISOString() }));

const earnedFor = (o: { sessions?: PracticeSession[]; entries?: ScoutEntry[]; attendance?: EventAttendance[] }): string[] =>
  computeProfileStats({ uid: "me", members: [member("me")], sessions: [], entries: [], libraryMatchesById: new Map(), attendance: [], now: new Date(2026, 5, 1, 12), ...o })
    .badges.filter((b) => b.earned)
    .map((b) => b.badge.id);

describe("built-in achievements: the list itself", () => {
  it("the eight ids, names, descriptions and icons stay as they are", () => {
    expect(BADGES.map((b) => [b.id, b.label, b.description, b.icon])).toEqual([
      ["first-session", "First Session", "Completed a first practice session.", "flag"],
      ["ten-sessions", "10 Sessions", "Completed 10 practice sessions.", "layers"],
      ["fifty-sessions", "50 Sessions", "Completed 50 practice sessions.", "medal"],
      ["perfect-session", "100% Session", "A practice session at 100% accuracy.", "target"],
      ["excellent", "Excellent status", "Excellent accuracy status in a category.", "sparkles"],
      ["streak", "5-Day Streak", "Practiced 5 days in a row.", "flame"],
      ["event-veteran", "Event Veteran", "Attended 3 or more events.", "calendar"],
      ["perfect-alliance", "Perfect Alliance", "A Real Event alliance scouted at 100% accuracy.", "trophy"],
    ]);
  });
});

describe("built-in achievements: earned states for fixed fixtures", () => {
  it("a new member has none", () => expect(earnedFor({})).toEqual([]));

  it("an active scout with many entries but no practice, attendance or accuracy has none", () => {
    expect(earnedFor({ entries: Array.from({ length: 40 }, (_, i) => entry(`e${i}`, "me", { matchNumber: i + 1 })) })).toEqual([]);
  });

  it("a veteran (3 events attended) earns only Event Veteran; 2 events earn nothing", () => {
    expect(earnedFor({ attendance: attended(3) })).toEqual(["event-veteran"]);
    expect(earnedFor({ attendance: attended(2) })).toEqual([]);
  });

  it("attendance only: attendance of other members does not count", () => {
    const others = attended(5).map((a) => ({ ...a, uids: ["peer"] }));
    expect(earnedFor({ attendance: others })).toEqual([]);
  });

  it("practice only: 1, 10 and 50 sessions at the boundaries (80% so no accuracy badge)", () => {
    expect(earnedFor({ sessions: spread(1) })).toEqual(["first-session"]);
    expect(earnedFor({ sessions: spread(9) })).toEqual(["first-session"]);
    expect(earnedFor({ sessions: spread(10) })).toEqual(["first-session", "ten-sessions"]);
    expect(earnedFor({ sessions: spread(49) })).toEqual(["first-session", "ten-sessions"]);
    expect(earnedFor({ sessions: spread(50) })).toEqual(["first-session", "ten-sessions", "fifty-sessions"]);
  });

  it("a 100% session: rounding applies (99.5 earns it, 99.4 does not) and it also makes the category Excellent", () => {
    expect(earnedFor({ sessions: [session("a", "me", { accuracy: 100 })] })).toEqual(["first-session", "perfect-session", "excellent"]);
    expect(earnedFor({ sessions: [session("a", "me", { accuracy: 99.5 })] })).toEqual(["first-session", "perfect-session", "excellent"]);
    expect(earnedFor({ sessions: [session("a", "me", { accuracy: 99.4 })] })).toEqual(["first-session", "excellent"]);
  });

  it("an excellent category (average 90+) without a 100% session", () => {
    expect(earnedFor({ sessions: [session("a", "me", { accuracy: 95 })] })).toEqual(["first-session", "excellent"]);
    expect(earnedFor({ sessions: [session("a", "me", { accuracy: 89 })] })).toEqual(["first-session"]);
  });

  it("an excluded 100% session counts as a session but not as accuracy", () => {
    expect(earnedFor({ sessions: [session("a", "me", { accuracy: 100, excluded: true })] })).toEqual(["first-session"]);
  });

  it("a session with no accuracy is never a 0 and never a 100", () => {
    expect(earnedFor({ sessions: [session("a", "me", { accuracy: null })] })).toEqual(["first-session"]);
  });

  it("a 5-day streak (4 days is not enough)", () => {
    expect(earnedFor({ sessions: consecutive(5) })).toEqual(["first-session", "streak"]);
    expect(earnedFor({ sessions: consecutive(4) })).toEqual(["first-session"]);
  });

  it("a perfect entry: a real or live, non-excluded, complete entry at 100% (rounded)", () => {
    expect(earnedFor({ entries: [entry("a", "me", { accuracy: complete(1) })] })).toEqual(["excellent", "perfect-alliance"]);
    expect(earnedFor({ entries: [entry("a", "me", { accuracy: complete(0.995), source: "live" })] })).toEqual(["excellent", "perfect-alliance"]);
    // the Real Event category is Excellent too (average 90+): today's behavior, pinned here
    expect(earnedFor({ entries: [entry("a", "me", { accuracy: complete(0.994) })] })).toEqual(["excellent"]);
    expect(earnedFor({ entries: [entry("a", "me", { accuracy: complete(1), excluded: true })] })).toEqual([]);
    expect(earnedFor({ entries: [entry("a", "me", { accuracy: complete(1), source: "practice" })] })).toEqual([]);
    expect(earnedFor({ entries: [entry("a", "peer", { accuracy: complete(1) })] })).toEqual([]);
    expect(earnedFor({ entries: [entry("a", "me", { accuracy: { status: "partial", value: 1, scoutedTotal: 50, penaltyPoints: 0, officialScore: 50 } as never })] })).toEqual([]);
  });

  it("a person with everything earns all eight", () => {
    const sessions = [...consecutive(5), ...spread(50, { accuracy: 100 })].map((s, i) => ({ ...s, id: `x${i}` }));
    expect(earnedFor({ sessions, entries: [entry("a", "me", { accuracy: complete(1) })], attendance: attended(3) })).toEqual(BADGES.map((b) => b.id));
  });

  it("other members' sessions never count for this person", () => {
    expect(earnedFor({ sessions: [session("a", "peer", { accuracy: 100 })] })).toEqual([]);
  });
});
