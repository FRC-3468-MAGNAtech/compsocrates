import { describe, expect, it } from "vitest";
import type { EventAttendance } from "@/lib/event-attendance";
import type { ScoutEntry } from "@/lib/scout-entries";
import type { TeamMember } from "@/lib/team-members";
import { computeProfileStats, type ProfileStatsInput } from "./stats";

// The owner's report: a member's profile listed 8 events (Arkansas 2 entries, Bayou 0, six others 0) when the team only went to
// Bayou and Arkansas in 2026. These fixtures reproduce the causes the code can explain (no season filter, raw entry codes
// against normalized attendance keys, practice and unlisted-event entries) for both programs. What the code cannot explain
// (why the person is on the lists of events the team did not attend) is a data question: scripts/audit-event-attendance.ts.

const FRC_2026 = { season: 2026, keyShape: "tba" } as const;
const FTC_2025 = { season: 2025, keyShape: "season-code" } as const;

const members: TeamMember[] = [{ uid: "me", name: "me", email: "me@x.com", primaryRole: "match-scout", secondaryRoles: [], isAdmin: false, isOwner: false }];

const att = (code: string, uids: string[] = ["me"]): EventAttendance => ({ id: `t_${code}`, teamId: "t", eventCode: code, uids, updatedAt: null });

function entry(id: string, eventCode: string, overrides: Partial<ScoutEntry> = {}): ScoutEntry {
  return {
    id,
    teamId: "t",
    uid: "me",
    source: "event",
    mode: null,
    formId: "f",
    formVersion: 1,
    scoutName: "me",
    eventCode,
    matchType: "Qualification",
    matchNumber: Number(id.replace(/\D/g, "")) || 1,
    teamNumber: 1,
    values: {},
    score: { auto: 0, teleop: 0, endgame: 0, total: 0 },
    comments: "",
    submittedAt: "2026-03-02T10:00:00.000Z",
    excluded: false,
    autoFlags: [],
    manualFlags: [],
    accuracy: null,
    sessionId: null,
    libraryMatchId: null,
    ...overrides,
  };
}

const run = (o: Partial<ProfileStatsInput>) =>
  computeProfileStats({ uid: "me", members, sessions: [], entries: [], libraryMatchesById: new Map(), attendance: [], now: new Date(2026, 9, 1), ...o });

describe("events attended: the owner's report (FRC, season 2026)", () => {
  // Eight events across seasons; the member is on every list. Only the 2026 ones belong on the 2026 card.
  const attendance = [att("2025lake"), att("2025arli"), att("2024lake"), att("2026arli"), att("2026lake"), att("2026a"), att("2026b"), att("2026c")];

  it("shows only the current season's events", () => {
    const s = run({ attendance, eventScope: FRC_2026 });
    expect(s.events.map((e) => e.eventCode).sort()).toEqual(["2026a", "2026arli", "2026b", "2026c", "2026lake"]);
  });

  it("matches entries to attendance across an alias and a case difference (2026labr is Bayou's mistyped key)", () => {
    const entries = [entry("a1", "2026labr"), entry("a2", "2026LAKE"), entry("a3", "2026arli")];
    const s = run({ attendance: [att("2026lake"), att("2026arli")], entries, eventScope: FRC_2026 });
    expect(s.events).toEqual([
      { eventCode: "2026lake", entries: 2 },
      { eventCode: "2026arli", entries: 1 },
    ]);
  });

  it("merges two attendance records that normalize to the same event", () => {
    const s = run({ attendance: [att("2026lake"), att("2026labr")], eventScope: FRC_2026 });
    expect(s.events).toEqual([{ eventCode: "2026lake", entries: 0 }]);
  });

  it("an entry from an event the member is not listed for creates no attended event", () => {
    const s = run({ attendance: [att("2026lake")], entries: [entry("a1", "2026arli"), entry("a2", "2026lake")], eventScope: FRC_2026 });
    expect(s.events).toEqual([{ eventCode: "2026lake", entries: 1 }]);
  });

  it("counts event and live entries only: practice and excluded entries are out", () => {
    const entries = [entry("a1", "2026lake"), entry("a2", "2026lake", { source: "live" }), entry("a3", "2026lake", { source: "practice" }), entry("a4", "2026lake", { excluded: true })];
    const s = run({ attendance: [att("2026lake")], entries, eventScope: FRC_2026 });
    expect(s.events).toEqual([{ eventCode: "2026lake", entries: 2 }]);
  });

  it("attendance without entries still shows the event with 0 entries", () => {
    expect(run({ attendance: [att("2026lake")], eventScope: FRC_2026 }).events).toEqual([{ eventCode: "2026lake", entries: 0 }]);
  });

  it("no attendance at all gives an empty list, even with entries", () => {
    expect(run({ attendance: [], entries: [entry("a1", "2026lake")], eventScope: FRC_2026 }).events).toEqual([]);
  });

  it("lists only events the member is on: other members' lists do not count", () => {
    expect(run({ attendance: [att("2026lake", ["peer"]), att("2026arli", ["me", "peer"])], eventScope: FRC_2026 }).events.map((e) => e.eventCode)).toEqual(["2026arli"]);
  });

  it("a key with no season (not a real event key) is left off the season card", () => {
    expect(run({ attendance: [att("app-testing"), att("2026lake")], eventScope: FRC_2026 }).events.map((e) => e.eventCode)).toEqual(["2026lake"]);
  });

  it("the Event Veteran badge still counts every season (a season card must not take back an earned achievement)", () => {
    const s = run({ attendance: [att("2024lake"), att("2025lake"), att("2026lake")], eventScope: FRC_2026 });
    expect(s.events).toHaveLength(1);
    expect(s.badges.find((b) => b.badge.id === "event-veteran")?.earned).toBe(true);
  });
});

describe("events attended: FTC (season-code keys, start-year season)", () => {
  it("filters by the key's start year and matches case-insensitively on the code", () => {
    const attendance = [att("2025-USCALAB"), att("2024-USCALAB"), att("2025-USTXHOU")];
    const entries = [entry("a1", "2025-uscalab"), entry("a2", "2025-USCALAB"), entry("a3", "2024-USCALAB")];
    const s = run({ attendance, entries, eventScope: FTC_2025 });
    expect(s.events).toEqual([
      { eventCode: "2025-USCALAB", entries: 2 },
      { eventCode: "2025-USTXHOU", entries: 0 },
    ]);
  });

  it("merges the same event stored with different letter case", () => {
    expect(run({ attendance: [att("2025-USCALAB"), att("2025-uscalab")], eventScope: FTC_2025 }).events).toEqual([{ eventCode: "2025-USCALAB", entries: 0 }]);
  });
});
