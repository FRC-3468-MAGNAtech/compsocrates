import { describe, expect, it } from "vitest";
import type { PracticeSession } from "@/lib/practice-sessions";
import type { ScoutEntry } from "@/lib/scout-entries";
import type { TeamMember } from "@/lib/team-members";
import { computeProfileStats } from "@/lib/profile/stats";
import { computeScoutStats, type ScoutStatsInput } from "./engine";

// Characterization (Build 4): kept rows of a deleted account carry an opaque uid and the name "Deleted Account". Scout stats, the profile's event list
// and attendance must neither crash nor skew the numbers of the people who are still on the team.
const OPAQUE = "deleted-0123456789abcdef0123456789abcdef";
const GONE = "someone-who-left-the-roster";

const member = (uid: string, name = uid): TeamMember => ({ uid, name, email: "", primaryRole: "match-scout", secondaryRoles: [], isAdmin: false, isOwner: false });
const session = (id: string, uid: string, scoutName: string, accuracy: number): PracticeSession =>
  ({
    id, teamId: "t1", uid, scoutName, kind: "solo", seasonId: "rebuilt", mode: "trial", difficulty: "medium", libraryMatchId: null, eventCode: null, alliance: "red", robots: [1, 2],
    status: "completed", completedRobots: [1, 2], entryIds: ["a", "b"], accuracy, scoutedTotal: 90, penaltyPoints: 0, officialScore: 100, platform: "pc", flags: [], excluded: false,
    lobbyId: null, pairId: null, startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:10:00.000Z", matchType: null, matchNumber: null, allianceTeams: null,
    streamUrl: null, streamStartSec: null, streamEndSec: null,
  }) as PracticeSession;
const entry = (id: string, uid: string, scoutName: string, eventCode = "2026wabon"): ScoutEntry =>
  ({
    id, teamId: "t1", uid, source: "event", mode: null, formId: "f", formVersion: 1, scoutName, eventCode, matchType: "Qualification", matchNumber: 1, teamNumber: 1, values: {},
    score: { auto: 0, teleop: 0, endgame: 0, total: 0 }, comments: "", submittedAt: "2026-01-02T00:00:00.000Z", excluded: false, autoFlags: [], manualFlags: [], accuracy: null,
    sessionId: null, libraryMatchId: null,
  }) as ScoutEntry;

const input = (over: Partial<ScoutStatsInput>): ScoutStatsInput => ({
  category: "trial", members: [], sessions: [], entries: [], libraryMatchesById: new Map(), attendance: [], roleFilter: [], eventFilter: [], rankingBasis: "preserve",
  realEventScope: { eventCode: null, variant: "plain" }, ...over,
});

describe("scout stats with a Deleted Account and an unresolved uid", () => {
  const base = { members: [member("a"), member("b")], sessions: [session("s1", "a", "a", 80), session("s2", "b", "b", 90)], entries: [entry("e1", "a", "a")] };
  const withGone = {
    members: base.members,
    sessions: [...base.sessions, session("s3", OPAQUE, "Deleted Account", 100), session("s4", GONE, "Gone", 10)],
    entries: [...base.entries, entry("e2", OPAQUE, "Deleted Account"), entry("e3", GONE, "Gone")],
  };

  it("does not throw and leaves the other scouts' rows (accuracy, count, rank) exactly as without those rows", () => {
    const plain = computeScoutStats(input(base));
    const extra = computeScoutStats(input(withGone));
    const pick = (r: ReturnType<typeof computeScoutStats>) => r.rows.map((x) => ({ uid: x.uid, accuracy: x.accuracy, rank: x.rank }));
    expect(pick(extra)).toEqual(pick(plain));
  });

  it("an admin's unassigned row computes with kept rows present", () => {
    expect(() => computeScoutStats(input({ ...withGone, includeUnassigned: true }))).not.toThrow();
  });

  it("a roster that carries a Deleted Account member gets its own row under that name", () => {
    const r = computeScoutStats(input({ ...withGone, members: [...base.members, member(OPAQUE, "Deleted Account")] }));
    const row = r.rows.find((x) => x.uid === OPAQUE);
    expect(row).toBeDefined();
    expect(row?.accuracy).toBe(100);
  });

  it("the real-event category tolerates entries of an unresolved uid", () => {
    expect(() => computeScoutStats(input({ ...withGone, category: "real-event", realEventScope: { eventCode: "2026wabon", variant: "plain" } }))).not.toThrow();
  });
});

describe("profile events and attendance with a deleted uid in the lists", () => {
  it("only the person's own attended events and entries count, whoever else is on the list", () => {
    const attendance = [{ id: "t1_2026wabon", teamId: "t1", eventCode: "2026wabon", uids: ["a", OPAQUE, GONE] }];
    const stats = computeProfileStats({
      uid: "a", members: [member("a")], sessions: [], entries: [entry("e1", "a", "a"), entry("e2", OPAQUE, "Deleted Account")], libraryMatchesById: new Map(), attendance,
    } as never);
    expect(stats.events).toEqual([{ eventCode: "2026wabon", entries: 1 }]);
  });
});
