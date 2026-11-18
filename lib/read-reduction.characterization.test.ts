// CHARACTERIZATION (read-reduction session, step A): pins what the app DISPLAYS from the reads the reductions touch, on fixed fixtures and a mocked
// Firestore. These tests must pass UNCHANGED after every reduction; only the document COUNTS (read-counts.test.ts) are allowed to move.
// Hooks run through test-stubs/hook-runtime.ts (no jsdom here).
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => (await import("@/test-stubs/hook-runtime")).hookMock(await vi.importActual<typeof import("react")>("react")));
vi.mock("firebase/firestore", async () => (await import("@/test-stubs/fake-firestore")).fakeFirestoreModule);
vi.mock("@/lib/firebase/client", () => ({ db: { fake: true }, auth: { currentUser: { uid: "u1" } }, isFirebaseConfigured: () => true }));
vi.mock("@/lib/program/data", () => ({ useProgramData: () => null, programData: () => null }));
vi.mock("@/lib/program/context", () => ({ useProgram: () => "frc", useProgramConfig: () => ({ connection: { features: { live: true, practice: true } } }) }));
vi.mock("@/lib/team-roster", () => ({ loadRosterExtras: async () => ({ members: [], denied: false }) }));
vi.mock("@/lib/personal/scope", () => ({ personalScopeUid: () => null }));

import * as fake from "@/test-stubs/fake-firestore";
import * as rt from "@/test-stubs/hook-runtime";
import * as fx from "@/test-stubs/read-fixtures";
import * as se from "@/lib/scout-entries";
import * as ps from "@/lib/practice-sessions";
import { rebuiltDoc, rebuiltEntry } from "@/lib/analytics/cs-test-fixtures";
import type { ScoutEntry } from "@/lib/scout-entries";
import { scoutedTeamsFor, teamMarks } from "@/components/scout/team-status";
import { DEFAULT_FILTERS } from "@/lib/analytics/filters";
import { joinEntries, selectAnalyticsEntries } from "@/lib/analytics/entries";
import { DEFAULT_GAME_ID } from "@/lib/analytics/game-schema";
import { buildAllTeamStats, rankTeams } from "@/lib/analytics/team-stats";
import { DEFAULT_FORM_ID, GAME_FORMS } from "@/lib/forms/builtin";
import { eventsOfGameSeason } from "@/lib/analytics/event-options";
import { computeScoutStats } from "@/lib/scout-stats/engine";
import { computeCoverage, computeTeamCoverage, flaggedEntries, practiceActivity, countFlaggedSessions } from "@/lib/dashboard/insights";
import type { TeamMember } from "@/lib/team-members";
import type { PracticeSession } from "@/lib/practice-sessions";

const project = (e: ScoutEntry) => ({ id: e.id, uid: e.uid, scout: e.scoutName, event: e.eventCode, source: e.source, type: e.matchType, match: e.matchNumber, team: e.teamNumber, total: e.score.total, flags: e.manualFlags });
const byId = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id));

let counter = 0;
/** A team id nobody used before: the data layer keeps per-team module caches (legacy rows, practice extras), so each test gets its own team. */
async function freshEnv() {
  counter += 1;
  fake.resetFake();
  return { fake, rt, fx: { ...fx, TEAM: `T-${counter}`, seedDataset: (s: fx.Scale) => fx.seedDataset(s, `T-${counter}`) }, se, ps };
}
type Env = Awaited<ReturnType<typeof freshEnv>>;

/** A small team: 2 members, 4 stamped rows, legacy rows (empty teamId) found by scoutId and by name only, a row of another team, a flag state. */
function seedLegacyMix(e: Env) {
  const { seed } = e.fake;
  const { EVENT, TEAM } = e.fx;
  e.fx.seedDataset({ members: 2, entries: 0 });
  const doc = (match: string, team: string, over: Record<string, unknown>) => ({ ...rebuiltDoc({ match, team, scout: "Scout 0", event: EVENT, autoFuel: 4, teleFuel: 6 }), scoutId: "u0", ...over });
  seed("scouting/a1", doc("q1", "254", { teamId: TEAM }));
  seed("scouting/a2", doc("q2", "254", { teamId: TEAM, scoutName: "Scout 1", scoutId: "u1" }));
  seed("scouting/a3", doc("q3", "971", { teamId: TEAM }));
  seed("scouting/a4", doc("q4", "118", { teamId: TEAM, endFuel: 9 }));
  seed("scouting/old-id", doc("q5", "971", { teamId: "" })); // legacy, reached by scoutId
  seed("scouting/old-name", doc("q6", "118", { teamId: "", scoutId: "", scoutName: "Scout 1" })); // legacy, reached by name only
  seed("scouting/foreign", doc("q7", "254", { teamId: "OTHER" })); // another team: read by the `in` queries, kept by nobody
  seed("scoutingFlagStates/scoutingEntry:a1", { teamId: TEAM, entityType: "scoutingEntry", entityId: "a1", manualFlagged: true, manualReason: "odd" });
}

async function loadFeed(e: Env): Promise<ScoutEntry[]> {
  const h = e.rt.renderHook(() => e.se.useTeamScoutEntries(e.fx.TEAM));
  await e.rt.settle();
  const out = h.result.current.entries;
  expect(h.result.current.loaded).toBe(true);
  h.unmount();
  return out;
}

describe("useTeamScoutEntries: what the team feed delivers (legacy merge included)", () => {
  it("merges the team's rows with legacy rows (by scoutId and by name), drops other teams' rows, applies flag states", async () => {
    const e = await freshEnv();
    seedLegacyMix(e);
    const entries = byId(await loadFeed(e));
    expect(entries.map((x) => x.id)).toEqual(["a1", "a2", "a3", "a4", "old-id", "old-name"]);
    expect(entries.map(project)).toMatchSnapshot();
  });

  it("a second subscriber to the same team shares the first one's data", async () => {
    const e = await freshEnv();
    seedLegacyMix(e);
    const a = e.rt.renderHook(() => e.se.useTeamScoutEntries(e.fx.TEAM));
    const b = e.rt.renderHook(() => e.se.useTeamScoutEntries(e.fx.TEAM));
    await e.rt.settle();
    expect(byId(a.result.current.entries).map((x) => x.id)).toEqual(byId(b.result.current.entries).map((x) => x.id));
    a.unmount();
    b.unmount();
  });
});

describe("the entries every stats page is built from (Analytics, dashboards, Scout Accuracy)", () => {
  it("Analytics team stats and the ranking", async () => {
    const e = await freshEnv();
    seedLegacyMix(e);
    const entries = await loadFeed(e);
    const form = GAME_FORMS[DEFAULT_FORM_ID];
    const filters = { ...DEFAULT_FILTERS, gameId: DEFAULT_GAME_ID, events: { kind: "all" as const } };
    const joined = joinEntries(entries, new Map());
    const used = selectAnalyticsEntries({ entries, joined, sessionsById: new Map(), filters, activeEventCodes: [], gameFormIds: new Set([DEFAULT_FORM_ID]) }).used;
    const stats = buildAllTeamStats(used, form, new Map([[254, "Cheesy"]]));
    expect(stats.map((t) => ({ team: t.teamNumber, name: t.teamName, n: t.entryCount }))).toMatchSnapshot();
    expect(rankTeams(stats, "avgTotal").map((r) => [r.stats.teamNumber, r.rank])).toMatchSnapshot();
  });

  it("Analytics event options for a season", () => {
    const events = [
      { code: "2026arli", season: 2026 },
      { code: "2026lake", season: 2026 },
      { code: "2025lake", season: 2025 },
    ];
    expect(eventsOfGameSeason(events, 2026).map((x) => x.code)).toMatchSnapshot();
  });

  it("Scout Accuracy / My Scouting numbers", async () => {
    const e = await freshEnv();
    seedLegacyMix(e);
    const entries = await loadFeed(e);
    const member = (uid: string, name: string): TeamMember => ({ uid, name, email: "", primaryRole: "match-scout", secondaryRoles: [], isAdmin: false, isOwner: false });
    const result = computeScoutStats({
      category: "real-event",
      members: [member("u0", "Scout 0"), member("u1", "Scout 1")],
      sessions: [],
      entries,
      libraryMatchesById: new Map(),
      attendance: [],
      roleFilter: [],
      eventFilter: [],
      rankingBasis: "preserve",
      realEventScope: { eventCode: null, variant: "plain" },
    });
    expect(result.rows.map((r) => ({ uid: r.uid, accuracy: r.accuracy, rank: r.rank }))).toMatchSnapshot();
    const solo = (id: string, uid: string, accuracy: number) =>
      ({ id, teamId: "t", uid, scoutName: uid, kind: "solo", seasonId: "rebuilt", mode: "trial", status: "completed", accuracy, flags: [], excluded: false, entryIds: [], startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:10:00.000Z" }) as unknown as PracticeSession;
    const trial = computeScoutStats({
      category: "trial", members: [member("u0", "Scout 0"), member("u1", "Scout 1")], sessions: [solo("s1", "u0", 80), solo("s2", "u0", 90), solo("s3", "u1", 70)],
      entries, libraryMatchesById: new Map(), attendance: [], roleFilter: [], eventFilter: [], rankingBasis: "preserve", realEventScope: { eventCode: null, variant: "plain" },
    });
    expect(trial.rows.map((r) => ({ uid: r.uid, accuracy: r.accuracy, rank: r.rank }))).toMatchSnapshot();
  });

  it("role dashboard widgets (coverage, flagged, practice activity)", async () => {
    const e = await freshEnv();
    seedLegacyMix(e);
    const entries = await loadFeed(e);
    expect(computeTeamCoverage([254, 971, 118, 1678], entries)).toMatchSnapshot();
    expect(computeCoverage([], entries)).toMatchSnapshot();
    expect(flaggedEntries(entries).map((x) => x.id)).toMatchSnapshot();
    const sessions = [{ id: "s1", uid: "u0", kind: "solo", startedAt: "2026-01-02T00:00:00.000Z", flags: ["x"], excluded: false } as unknown as PracticeSession];
    expect(practiceActivity(sessions, Date.parse("2026-01-03T00:00:00.000Z"))).toMatchSnapshot();
    expect(countFlaggedSessions(sessions)).toMatchSnapshot();
  });
});

describe("the Scout page's scouted marks (team picker)", () => {
  it("marks every robot already scouted for a match, from the full team feed", async () => {
    const e = await freshEnv();
    seedLegacyMix(e);
    const entries = await loadFeed(e);
    const marks = (n: number) => [...teamMarks({ scouted: scoutedTeamsFor(entries, e.fx.EVENT, "Qualification", n), sub: new Map(), assigned: new Set() })];
    expect([1, 2, 3, 4, 5, 6, 7].map(marks)).toMatchSnapshot();
  });

  it("a legacy event alias and a different case still count as the same event", () => {
    const rows = [rebuiltEntry("l1", { event: "2026labr", match: "q1", team: "254" }), rebuiltEntry("l2", { event: "2026LAKE", match: "q1", team: "971" }), rebuiltEntry("l3", { event: "2026lake", match: "q1", team: "118" })];
    expect([...scoutedTeamsFor(rows, "2026lake", "Qualification", 1)].sort()).toEqual([118, 254, 971]);
  });
});

describe("event-narrowed reads vs the full feed (evidence for deferring the Scout and Event page narrowing)", () => {
  const stored = (e: Env, key: string, id: string, team: string) => e.fake.seed(`scouting/${id}`, { ...rebuiltDoc({ event: key, match: "q1", team }), teamId: e.fx.TEAM, scoutId: "u0" });
  const narrowed = (e: Env, eventCode: string): Promise<ScoutEntry[]> =>
    new Promise((resolve) => {
      const stop = e.se.subscribeEntries(e.fx.TEAM, eventCode, (entries) => {
        stop();
        resolve(entries);
      });
    });

  it("equals the full feed for the canonical key and for a legacy alias spelling", async () => {
    const e = await freshEnv();
    e.fx.seedDataset({ members: 1, entries: 0 });
    stored(e, "2026lake", "c1", "254");
    stored(e, "2026labr", "c2", "971"); // the configured legacy alias of 2026lake
    stored(e, "2026arli", "other", "118");
    const fromFull = [...scoutedTeamsFor(await loadFeed(e), "2026lake", "Qualification", 1)].sort();
    const fromNarrow = [...scoutedTeamsFor(await narrowed(e, "2026lake"), "2026lake", "Qualification", 1)].sort();
    expect(fromNarrow).toEqual(fromFull);
    expect(fromFull).toEqual([254, 971]);
  });

  it("MISSES a row stored with a differently-cased key that the full feed still marks (so the narrowing is not provably identical)", async () => {
    const e = await freshEnv();
    e.fx.seedDataset({ members: 1, entries: 0 });
    stored(e, "2026lake", "c1", "254");
    stored(e, "2026LAKE", "c3", "118");
    const fromFull = [...scoutedTeamsFor(await loadFeed(e), "2026lake", "Qualification", 1)].sort();
    const fromNarrow = [...scoutedTeamsFor(await narrowed(e, "2026lake"), "2026lake", "Qualification", 1)].sort();
    expect(fromFull).toEqual([118, 254]);
    expect(fromNarrow).toEqual([254]);
  });
});

describe("useTeamLiveSessions: what the shell's ScoresReadyWatcher is given", () => {
  it("delivers the team's live sessions; the watcher keeps only the signed-in person's own", async () => {
    const e = await freshEnv();
    e.fx.seedDataset({ members: 3, entries: 0, liveSessions: 9, soloSessions: 4 });
    const h = e.rt.renderHook(() => e.ps.useTeamLiveSessions(e.fx.TEAM));
    await e.rt.settle();
    const all = byId(h.result.current.sessions);
    expect(all.every((s) => s.kind === "live")).toBe(true);
    expect(all).toHaveLength(9);
    const mine = all.filter((s) => s.uid === "u1" && s.status === "completed");
    expect(mine.map((s) => [s.id, s.accuracy])).toMatchSnapshot();
    expect(mine.filter((s) => s.accuracy === null).map((s) => s.id)).toMatchSnapshot();
    h.unmount();
  });
});
