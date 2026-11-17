import { describe, expect, it } from "vitest";
import { FTC_GAME_DEFINITIONS } from "@/config/games/ftc";
import { allianceRoleFor, applyAllianceRole } from "@/lib/forms/alliance-role";
import { calculateScore } from "@/lib/forms/scoring";
import { defaultValues } from "@/lib/forms/values";
import type { FormValues } from "@/lib/forms/types";
import { buildFtcGameForm } from "@/lib/ftc/games";
import { ftcDocToPracticeSession, ftcDocsToPracticeSessions, ftcSessionPatch, ftcSessionStub, malformedSessions, newSessionId } from "@/lib/ftc/practice";
import { allianceSlots } from "@/config/alliance";
import { PROGRAMS } from "@/config/programs";
import { practiceOutcome } from "@/lib/practice-outcome";
import { computeAllianceAccuracy } from "@/lib/accuracy/engine";

const full = {
  teamId: "T1",
  uid: "u1",
  scoutName: "Ada",
  kind: "solo",
  status: "completed",
  seasonId: "biobuzz",
  mode: "competitive",
  difficulty: "medium",
  libraryMatchId: "EV_Q1",
  eventCode: "EV",
  alliance: "red",
  robots: [111, 222],
  completedRobots: [111, 222],
  entryIds: ["a", "b"],
  accuracy: 91.5,
  scoutedTotal: 61,
  penaltyPoints: 4,
  officialScore: 66,
  platform: "mobile",
  flags: [{ type: "zero-entries", title: "Zero", detail: "d", dismissed: true }],
  excluded: true,
  startedAt: "2026-02-01T10:00:00.000Z",
  finishedAt: "2026-02-01T10:10:00.000Z",
};

describe("ftcDocToPracticeSession", () => {
  it("reads a whole session, flags and exclusion included (they live on the session)", () => {
    const s = ftcDocToPracticeSession("PS-AAAAAA", full);
    expect(s).toMatchObject({ id: "PS-AAAAAA", teamId: "T1", uid: "u1", kind: "solo", status: "completed", robots: [111, 222], accuracy: 91.5, officialScore: 66, excluded: true, platform: "mobile", difficulty: "medium", mode: "competitive" });
    expect(s.flags).toEqual([{ type: "zero-entries", title: "Zero", detail: "d", dismissed: true }]);
    expect(s.malformed).toBeUndefined();
  });

  it("keeps a missing accuracy as null, never 0 (a session on a match with no official score)", () => {
    const s = ftcDocToPracticeSession("PS-B", { ...full, accuracy: null, officialScore: null, penaltyPoints: null });
    expect(s.accuracy).toBeNull();
    expect(s.officialScore).toBeNull();
    expect(ftcDocToPracticeSession("PS-C", { ...full, accuracy: "90" }).accuracy).toBeNull();
    const without: Record<string, unknown> = { ...full };
    delete without.accuracy;
    expect(ftcDocToPracticeSession("PS-D", without).accuracy).toBeNull();
  });

  it("never drops a malformed session: it comes back flagged with the reasons, so an admin can see it", () => {
    const rows = [
      { id: "PS-OK", data: full },
      { id: "PS-NOTEAM", data: { ...full, teamId: "" } },
      { id: "PS-NOUID", data: { ...full, uid: undefined } },
      { id: "PS-STATUS", data: { ...full, status: "weird" } },
      { id: "PS-NOMATCH", data: { ...full, libraryMatchId: null, alliance: null } },
      { id: "PS-EMPTY", data: {} },
    ];
    const sessions = ftcDocsToPracticeSessions(rows);
    expect(sessions).toHaveLength(rows.length);
    const bad = malformedSessions(sessions);
    expect(bad.map((s) => s.id)).toEqual(["PS-NOTEAM", "PS-NOUID", "PS-STATUS", "PS-NOMATCH", "PS-EMPTY"]);
    expect(bad.find((s) => s.id === "PS-NOTEAM")?.malformed).toContain("no team id");
    expect(bad.find((s) => s.id === "PS-STATUS")?.malformed).toContain("unknown status");
    expect(bad.find((s) => s.id === "PS-NOMATCH")?.malformed).toContain("no match or alliance");
    // an unreadable status is treated as open, not as a finished attempt
    expect(bad.find((s) => s.id === "PS-STATUS")?.status).toBe("in-progress");
  });

  it("reads a start time stored as a number or an ISO string", () => {
    expect(ftcDocToPracticeSession("a", { ...full, startedAt: 1_770_000_000_000 }).startedAt).toMatch(/^2026-/);
    expect(ftcDocToPracticeSession("a", full).startedAt).toBe("2026-02-01T10:00:00.000Z");
  });
});

describe("what is written", () => {
  it("the stub that reserves an id carries the team, the scout, the kind, the status and a client start time", () => {
    const stub = ftcSessionStub("T1", "u1", "solo", () => "SERVER_TIME", "2026-02-01T10:00:00.000Z");
    expect(stub).toEqual({ teamId: "T1", uid: "u1", kind: "solo", status: "in-progress", startedAt: "2026-02-01T10:00:00.000Z", createdAt: "SERVER_TIME" });
  });

  it("a patch never carries identity fields or undefined, and writes no CS-named twins", () => {
    const patch = ftcSessionPatch({ id: "x", teamId: "other", uid: "other", kind: "live", status: "paused", completedRobots: [111], accuracy: undefined, malformed: "x" });
    expect(patch).toEqual({ status: "paused", completedRobots: [111] });
    expect(Object.keys(patch)).not.toContain("scoutId");
  });

  it("new ids are PS- plus six unambiguous characters", () => {
    for (let i = 0; i < 50; i++) expect(newSessionId("solo")).toMatch(/^PS-[A-HJ-NP-Z2-9]{6}$/);
    expect(newSessionId("live")).toMatch(/^LV-/);
    expect(newSessionId("solo", () => 0)).toBe("PS-AAAAAA");
  });
});

describe("accuracy with and without an official score", () => {
  const official = { score: 100, penaltyPoints: 10 };

  it("uses the shared formula when the official score is known (the same numbers as before)", () => {
    const out = practiceOutcome({ robotScores: [40, 45], official, scoringEnabled: true });
    const ref = computeAllianceAccuracy({ robotScores: [40, 45], penaltyPoints: 10, officialScore: 100 });
    expect(out).toEqual({ accuracy: ref.accuracy, scoutedTotal: 95, officialScore: 100, penaltyPoints: 10, difference: -5 });
    expect(out.accuracy).toBeCloseTo(95);
    expect(practiceOutcome({ robotScores: [40, 45], official: { ...official, scoreKnown: true }, scoringEnabled: true })).toEqual(out);
  });

  it("with no official score keeps the total and has NO accuracy (never a 0)", () => {
    const out = practiceOutcome({ robotScores: [40, 45], official: { score: 0, penaltyPoints: 0, scoreKnown: false }, scoringEnabled: true });
    expect(out).toEqual({ accuracy: null, scoutedTotal: 85, officialScore: null, penaltyPoints: null, difference: null });
    expect(out.accuracy).not.toBe(0);
  });

  it("an official score of 0 is a score: 0 total is 100 percent, anything else is 0 percent", () => {
    expect(practiceOutcome({ robotScores: [0, 0], official: { score: 0, penaltyPoints: 0, scoreKnown: true }, scoringEnabled: true }).accuracy).toBe(100);
    expect(practiceOutcome({ robotScores: [5, 0], official: { score: 0, penaltyPoints: 0, scoreKnown: true }, scoringEnabled: true }).accuracy).toBe(0);
  });

  it("a form with scoring off has nothing to total or compare", () => {
    expect(practiceOutcome({ robotScores: [1, 2], official, scoringEnabled: false })).toEqual({ accuracy: null, scoutedTotal: null, officialScore: null, penaltyPoints: null, difference: null });
  });
});

describe("two robots, one session: the alliance roles", () => {
  const form = buildFtcGameForm(FTC_GAME_DEFINITIONS.BIOBUZZ);
  const session = { eventKey: "EV_Q1", matchType: "", matchNumber: 0, alliance: "red" as const, sessionId: "PS-ABCDEF", teams: [222, 111] };
  const roleOf = (teamNumber: number, over: Partial<typeof session> = {}) => allianceRoleFor(form, { ...session, ...over, teamNumber });

  it("an FTC alliance has two teams, so a session has two robots", () => {
    expect(allianceSlots(PROGRAMS.ftc.event.allianceSize)).toEqual(["red1", "red2", "blue1", "blue2"]); // both alliances: two slots each
    expect(allianceSlots(PROGRAMS.frc.event.allianceSize)).toHaveLength(6);
  });

  it("the two robots get opposite roles, whichever is scouted first, and the same on every render", () => {
    const a = roleOf(111);
    const b = roleOf(222);
    expect([a, b].sort()).toEqual(["garden", "hive"]);
    expect(roleOf(111)).toBe(a);
    expect(roleOf(222)).toBe(b);
    expect(roleOf(111, { teams: [111, 222] })).toBe(a);
  });

  it("another session on the same alliance may split the roles differently, but always one each", () => {
    const seen = new Set<string>();
    for (const id of ["PS-AAAAAA", "PS-BBBBBB", "PS-CCCCCC", "PS-DDDDDD", "PS-EEEEEE", "PS-FFFFFF", "PS-GGGGGG", "PS-HHHHHH"]) {
      const x = roleOf(111, { sessionId: id });
      const y = roleOf(222, { sessionId: id });
      expect([x, y].sort()).toEqual(["garden", "hive"]);
      seen.add(`${x}`);
    }
    expect(seen.size).toBe(2);
  });

  it("with no roster there is no role (every field is shown)", () => {
    expect(roleOf(111, { teams: [] as number[] })).toBeNull();
    expect(allianceRoleFor(form, { ...session, teams: null, teamNumber: 111 })).toBeNull();
  });

  it("the other role's fields are ABSENT and count as 0 in the score; the two robots add up to the alliance total", () => {
    const counts: Record<string, number> = { autoTipHive: 2, teleTipHive: 1, flowerBottomNectar: 3, gardenPollenNectar: 2 };
    const base = { ...defaultValues(form), ...counts } as FormValues;
    const hive = applyAllianceRole(form, base, "hive");
    const garden = applyAllianceRole(form, base, "garden");
    expect(hive.flowerBottomNectar).toBeUndefined();
    expect(hive.gardenPollenNectar).toBeUndefined();
    expect(garden.autoTipHive).toBeUndefined();
    expect(garden.teleTipHive).toBeUndefined();
    const hiveScore = calculateScore(form, hive).total;
    const gardenScore = calculateScore(form, garden).total;
    // each robot scores only its own role's objectives; nothing is NaN, and absent adds nothing
    expect(Number.isFinite(hiveScore)).toBe(true);
    expect(Number.isFinite(gardenScore)).toBe(true);
    const all = calculateScore(form, applyAllianceRole(form, base, null)).total;
    expect(hiveScore + gardenScore).toBe(all);
    const robots = [hiveScore, gardenScore];
    expect(practiceOutcome({ robotScores: robots, official: { score: all, penaltyPoints: 0, scoreKnown: true }, scoringEnabled: true }).accuracy).toBe(100);
  });
});
