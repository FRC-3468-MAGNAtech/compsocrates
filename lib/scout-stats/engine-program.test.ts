import { describe, expect, it } from "vitest";
import { FTC_GAME_DEFINITIONS } from "@/config/games/ftc";
import { computeAllianceAccuracy } from "@/lib/analytics/accuracy";
import { buildFtcGameForm } from "@/lib/ftc/games";
import { applyAllianceRole } from "@/lib/forms/alliance-role";
import { calculateScore } from "@/lib/forms/scoring";
import { defaultValues } from "@/lib/forms/values";
import type { FormValues } from "@/lib/forms/types";
import type { PracticeSession } from "@/lib/practice-sessions";
import type { ScoutEntry } from "@/lib/scout-entries";
import type { TeamMember } from "@/lib/team-members";
import { computeScoutStats, practiceEntryCount, type ScoutStatsInput } from "./engine";
import { seasonOfEntryFor } from "./use-scout-stats";

// The stats engine for both programs: the default program's inputs give what they always gave; a program with its own store (FTC) counts entries from the
// entries, never from a list on the session, tells an entry's game by its form, and can show an "unassigned" row.

function member(uid: string, over: Partial<TeamMember> = {}): TeamMember {
  return { uid, name: uid, email: `${uid}@example.com`, primaryRole: "match-scout", secondaryRoles: [], isAdmin: false, isOwner: false, ...over };
}

function session(id: string, uid: string, over: Partial<PracticeSession> = {}): PracticeSession {
  return {
    id,
    teamId: "t1",
    uid,
    scoutName: uid,
    kind: "solo",
    seasonId: "biobuzz",
    mode: "trial",
    difficulty: "medium",
    libraryMatchId: null,
    eventCode: null,
    alliance: "red",
    robots: [1, 2],
    status: "completed",
    completedRobots: [1, 2],
    entryIds: [],
    accuracy: 90,
    scoutedTotal: 90,
    penaltyPoints: 0,
    officialScore: 100,
    platform: "pc",
    flags: [],
    excluded: false,
    lobbyId: null,
    pairId: null,
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:10:00.000Z",
    matchType: null,
    matchNumber: null,
    allianceTeams: null,
    streamUrl: null,
    streamStartSec: null,
    streamEndSec: null,
    ...over,
  };
}

function entry(id: string, uid: string, over: Partial<ScoutEntry> = {}): ScoutEntry {
  return {
    id,
    teamId: "t1",
    uid,
    source: "practice",
    mode: "trial",
    formId: "biobuzz",
    formVersion: 1,
    scoutName: uid,
    eventCode: "EVT",
    matchType: "Qualification",
    matchNumber: 1,
    teamNumber: 100,
    values: {},
    score: { auto: 0, teleop: 0, endgame: 0, total: 0 },
    comments: "",
    submittedAt: "2026-01-01T00:00:00.000Z",
    excluded: false,
    autoFlags: [],
    manualFlags: [],
    accuracy: null,
    sessionId: null,
    libraryMatchId: null,
    ...over,
  };
}

const input = (over: Partial<ScoutStatsInput>): ScoutStatsInput => ({
  category: "trial",
  members: [],
  sessions: [],
  entries: [],
  libraryMatchesById: new Map(),
  attendance: [],
  roleFilter: [],
  eventFilter: [],
  rankingBasis: "preserve",
  realEventScope: { eventCode: null, variant: "plain" },
  ...over,
});

const FTC_SEASONS = [{ id: "biobuzz", formId: "biobuzz" }];

describe("a program with its own store (FTC)", () => {
  const ftc = { entriesOnlyCount: true, seasonOfEntry: seasonOfEntryFor(FTC_SEASONS), includeUnassigned: true } as const;

  it("averages per game: an excluded session and a session with no accuracy are not averaged, and a null is never a 0", () => {
    const members = [member("a"), member("b")];
    const sessions = [
      session("s1", "a", { accuracy: 80 }),
      session("s2", "a", { accuracy: 100 }),
      session("s3", "a", { accuracy: null }), // no official score: skipped, not 0
      session("s4", "a", { accuracy: 0, excluded: true }), // excluded: skipped
      session("s5", "b", { accuracy: null }),
    ];
    const result = computeScoutStats(input({ members, sessions, ...ftc }));
    expect(result.rows.find((r) => r.uid === "a")!.accuracy).toBe(90);
    // a scout whose only session has no accuracy has none: "?", not 0
    expect(result.rows.find((r) => r.uid === "b")!.accuracy).toBeNull();
    // excluding another counted session changes the average
    const excluded = sessions.map((s) => (s.id === "s2" ? { ...s, excluded: true } : s));
    expect(computeScoutStats(input({ members, sessions: excluded, ...ftc })).rows.find((r) => r.uid === "a")!.accuracy).toBe(80);
  });

  it("skips live sessions", () => {
    const result = computeScoutStats(input({ members: [member("a")], sessions: [session("s1", "a", { accuracy: 50 }), session("s2", "a", { accuracy: 100, csLive: true })], ...ftc }));
    expect(result.rows[0].accuracy).toBe(50);
  });

  it("counts total entries from the scout's practice entries, not from a list on the session", () => {
    const sessions = [session("s1", "a", { entryIds: ["x", "y", "z"] })];
    const entries = [entry("e1", "a"), entry("e2", "a"), entry("e3", "a", { source: "event", mode: null }), entry("e4", "a", { mode: "competitive" })];
    const ftcRow = computeScoutStats(input({ members: [member("a")], sessions, entries, ...ftc })).rows[0];
    expect(ftcRow.totalEntries).toBe(2); // two trial practice entries; the event entry and the competitive one do not count
    // the default program keeps its rule (the larger of the two sources)
    const rootRow = computeScoutStats(input({ members: [member("a")], sessions, entries })).rows[0];
    expect(rootRow.totalEntries).toBe(3);
  });

  it("filters entries by game through the entry's form, and keeps an entry whose game cannot be told", () => {
    const entries = [entry("e1", "a"), entry("e2", "a", { formId: "mystery-form" })];
    const of = seasonOfEntryFor(FTC_SEASONS);
    expect(practiceEntryCount(entries, "a", "a", "trial", "biobuzz", of)).toBe(2);
    expect(practiceEntryCount(entries, "a", "a", "trial", null, of)).toBe(2);
    expect(practiceEntryCount([entry("e3", "a", { formId: "other" })], "a", "a", "trial", "biobuzz", () => "other-game")).toBe(0);
  });

  it("counts sessions and entries with no scout on the roster in an unassigned row instead of dropping them", () => {
    const members = [member("a")];
    const sessions = [
      session("s1", "a", { accuracy: 100 }),
      session("s2", "", { scoutName: "", accuracy: 60 }), // no scout id
      session("s3", "gone", { scoutName: "Gone", accuracy: 80 }), // a scout who left
      session("s4", "gone", { accuracy: null }),
      session("s5", "gone", { accuracy: 10, excluded: true }),
    ];
    const entries = [entry("e1", "a"), entry("e2", "", { scoutName: "" }), entry("e3", "gone"), entry("e4", "", { scoutName: "A" })]; // e4 is matched to member "a" by name
    const result = computeScoutStats(input({ members, sessions, entries, ...ftc }));
    expect(result.unassigned).toEqual({ sessions: 4, entries: 2, averageAccuracy: 70 }); // mean(60, 80); null and excluded are not averaged
    // nobody's own numbers include them
    expect(result.rows[0].accuracy).toBe(100);
    expect(result.rows[0].sessionsOrForms).toBe(1);
    expect(result.rows[0].totalEntries).toBe(2); // e1 and e4 (by name)
  });

  it("has an unassigned row of zeros when nothing is orphaned, and none unless asked for", () => {
    const only = computeScoutStats(input({ members: [member("a")], sessions: [session("s1", "a")], ...ftc }));
    expect(only.unassigned).toEqual({ sessions: 0, entries: 0, averageAccuracy: null });
    expect(computeScoutStats(input({ members: [member("a")], sessions: [session("s1", "", { accuracy: 50 })] })).unassigned).toBeNull();
  });
});

describe("the default program is unchanged", () => {
  it("gives the same rows with and without the new options absent", () => {
    const base = input({ members: [member("a")], sessions: [session("s1", "a", { seasonId: "rebuilt", entryIds: ["x", "y"] })], entries: [] });
    const result = computeScoutStats(base);
    expect(result.rows[0]).toMatchObject({ accuracy: 90, sessionsOrForms: 1, totalEntries: 2 });
    expect(result.unassigned).toBeNull();
  });
});

describe("alliance accuracy with BIOBUZZ roles (the existing functions)", () => {
  const form = buildFtcGameForm(FTC_GAME_DEFINITIONS.BIOBUZZ);
  const scouted = (role: string, counts: Record<string, number>): ScoutEntry => {
    const values = applyAllianceRole(form, { ...defaultValues(form), ...counts } as FormValues, role);
    const s = calculateScore(form, values);
    return entry(`r-${role}`, role, { source: "event", mode: null, teamNumber: role === "hive" ? 100 : 200, values, score: { auto: s.auto, teleop: s.teleop, endgame: s.endgame, total: s.total } });
  };

  it("sums two role-split robots once: absent role fields count as 0, so the alliance total equals the official score", () => {
    const hive = scouted("hive", { teleTipHive: 2 });
    const garden = scouted("garden", { gardenPollenNectar: 10 });
    const total = hive.score.total + garden.score.total;
    expect(total).toBeGreaterThan(0);
    expect(computeAllianceAccuracy([100, 200], total, 0, [hive, garden])).toMatchObject({ status: "complete", value: 1 });
    // one robot scouted: not enough to produce a number
    expect(computeAllianceAccuracy([100, 200], total, 0, [hive])).toMatchObject({ status: "needs-robots", value: null });
  });
});
