import { describe, expect, it } from "vitest";
import type { EventMatch } from "@/lib/events/types";
import { ftcAllianceSize, ftcDocToLibraryMatch, ftcDocsToLibraryMatches, ftcMatchId, createMergedFeed, generateFtcManualEventCode, importErrorMessage, normalizeApiEventCode, planScheduleImport } from "@/lib/ftc/library";
import { LIBRARY_BATCH_SIZE, buildManualMatchDoc, chunk } from "@/lib/library/schedule";
import { emptyRawMatch, validateRawMatch } from "@/lib/library/manual-match";

const NOW = "2026-11-15T10:00:00.000Z";
const EVENT = { eventCode: "USWASEAQ", eventName: "Seattle Qualifier", seasonId: "biobuzz" };

const sched = (type: EventMatch["type"], n: number, red: number[], blue: number[], startTime: string | null = null): EventMatch => ({
  id: `${type}-${n}`, matchNumber: n, type, description: null, series: null, played: false, redTeams: red, blueTeams: blue, redScore: null, blueScore: null, redPenaltyPoints: null, bluePenaltyPoints: null, startTime,
});

describe("FTC alliance size and ids", () => {
  it("FTC alliances have two teams", () => expect(ftcAllianceSize()).toBe(2));
  it("match ids are stable: ${eventCode}_${Q|P|F}${n}", () => {
    expect(ftcMatchId("USWASEAQ", "Qualification", 7)).toBe("USWASEAQ_Q7");
    expect(ftcMatchId("USWASEAQ", "Practice", 1)).toBe("USWASEAQ_P1");
    expect(ftcMatchId("USWASEAQ", "Playoff", 3)).toBe("USWASEAQ_F3");
  });
  it("normalizes event codes", () => {
    expect(normalizeApiEventCode(" uswaseaq ")).toBe("USWASEAQ");
    expect(normalizeApiEventCode("")).toBeNull();
    expect(normalizeApiEventCode("bad code!")).toBeNull();
  });
  it("a generated manual code is MAN-slug-xxxx and avoids taken codes", () => {
    const code = generateFtcManualEventCode("Shop scrimmage!", new Set(), () => 0);
    expect(code).toBe("MAN-SHOPSCRI-AAAA");
    expect(generateFtcManualEventCode("Shop scrimmage!", new Set([code]), (() => { let i = 0; return () => (i++ < 4 ? 0 : 0.5); })())).not.toBe(code);
    expect(code).toMatch(/^[A-Z0-9-]{3,24}$/);
  });
});

describe("manual match validation (the shared form, two robots, scores optional)", () => {
  const good = { ...emptyRawMatch(), matchType: "Q", matchNumber: "12", red1: "111", red2: "222", blue1: "333", blue2: "444" };
  const opts = { allianceSize: 2, scoresRequired: false };
  it("accepts two teams per alliance, blank scores (no official score) and an empty time", () => {
    const r = validateRawMatch({ ...good, scheduledTime: "" }, opts);
    expect(r.ok).toBe(true);
    expect(r.match).toMatchObject({ matchNumber: 12, red: { teams: [111, 222], scoreKnown: false }, blue: { teams: [333, 444], scoreKnown: false }, scheduledTime: null });
  });
  it("a typed score is known; a time becomes ISO; a blank score with penalty points is refused", () => {
    expect(validateRawMatch({ ...good, redScore: "40", redPenalty: "5" }, opts).match?.red).toEqual({ teams: [111, 222], score: 40, penaltyPoints: 5 });
    expect(validateRawMatch({ ...good, matchType: "F", scheduledTime: "2026-11-15T09:30" }, opts).match?.scheduledTime).toMatch(/^2026-11-15T/);
    expect(validateRawMatch({ ...good, redPenalty: "3" }, opts).errors.redPenalty).toBeTruthy();
  });
  it("rejects a bad type, number, missing slot, non-digits, a repeated team and a bad time", () => {
    expect(validateRawMatch({ ...good, matchType: "X" }, opts).errors.matchType).toBeTruthy();
    expect(validateRawMatch({ ...good, matchNumber: "0" }, opts).errors.matchNumber).toBeTruthy();
    expect(validateRawMatch({ ...good, red2: "" }, opts).errors.red2).toBeTruthy();
    expect(validateRawMatch({ ...good, blue1: "abc" }, opts).errors.blue1).toBeTruthy();
    expect(validateRawMatch({ ...good, blue1: "111" }, opts).ok).toBe(false);
    expect(validateRawMatch({ ...good, scheduledTime: "soonish" }, opts).errors.scheduledTime).toBeTruthy();
  });
  it("a program that requires scores still refuses a blank one (the default)", () => {
    expect(validateRawMatch({ ...good }, { allianceSize: 2 }).errors.redScore).toBeTruthy();
  });
});

describe("hand-made match docs", () => {
  const m = { matchType: "Qualification" as const, matchNumber: 3, red: [1, 2], blue: [3, 4], scheduledTime: null };
  it("a new match is an unpublished draft owned by the team, with no score", () => {
    const doc = buildManualMatchDoc(m, EVENT, null, "TEAM1", "uid1", NOW);
    expect(doc).toMatchObject({ origin: "manual", published: false, teamId: "TEAM1", createdBy: "uid1", createdAt: NOW, updatedAt: NOW, scheduledTime: null });
    expect(doc.alliances).toEqual({ red: { teams: [1, 2] }, blue: { teams: [3, 4] } });
  });
  it("an edit keeps published, createdBy and createdAt", () => {
    const doc = buildManualMatchDoc(m, EVENT, { published: true, createdBy: "first", createdAt: "2026-01-01T00:00:00.000Z" }, "TEAM1", "uid2", NOW);
    expect(doc).toMatchObject({ published: true, createdBy: "first", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: NOW });
  });
});

describe("schedule import plan", () => {
  const matches = [sched("Qualification", 1, [1, 2], [3, 4], "2026-11-15T09:00:00Z"), sched("Qualification", 2, [5, 6], [7, 8]), sched("Playoff", 1, [1, 2], [3, 4])];
  const plan = (existing = new Map<string, Record<string, unknown>>(), list = matches) => planScheduleImport({ event: EVENT, matches: list, existing, uid: "u1", now: NOW });

  it("creates published API matches under stable ids with 2-team alliances", () => {
    const p = plan();
    expect(p.created).toBe(3);
    expect(p.writes.map((w) => w.id)).toEqual(["USWASEAQ_Q1", "USWASEAQ_Q2", "USWASEAQ_F1"]);
    expect(p.writes[0].data).toMatchObject({ origin: "api", published: true, scheduledTime: "2026-11-15T09:00:00Z", alliances: { red: { teams: [1, 2] }, blue: { teams: [3, 4] } } });
    expect(p.writes[0].data).not.toHaveProperty("teamId");
  });
  it("importing twice updates in place: same ids, nothing new, published choice kept", () => {
    const first = plan();
    const stored = new Map(first.writes.map((w) => [w.id, { ...w.data, published: w.id === "USWASEAQ_Q2" ? false : true }]));
    const second = plan(stored);
    expect(second.created).toBe(0);
    expect(second.updated).toBe(3);
    expect(second.writes.map((w) => w.id)).toEqual(first.writes.map((w) => w.id));
    expect(second.writes.every((w) => w.merge && !("published" in w.data))).toBe(true);
  });
  it("a partial schedule: no teams posted is skipped and counted, a missing slot is stored with the teams there", () => {
    const p = plan(new Map(), [sched("Qualification", 1, [1], [3, 4]), sched("Qualification", 2, [], []), sched("Qualification", 3, [9, 10, 11], [12, 13])]);
    expect(p.skippedNoTeams).toBe(1);
    expect(p.created).toBe(2);
    expect(p.writes[0].data.alliances).toEqual({ red: { teams: [1] }, blue: { teams: [3, 4] } });
    expect(p.writes[1].data.alliances).toEqual({ red: { teams: [9, 10] }, blue: { teams: [12, 13] } });
  });
  it("never touches a hand-made match with the same id, drops duplicates and invalid numbers", () => {
    const p = plan(new Map([["USWASEAQ_Q1", { origin: "manual" }]]), [...matches, sched("Qualification", 2, [5, 6], [7, 8]), sched("Qualification", 0, [1, 2], [3, 4])]);
    expect(p.skippedManual).toEqual(["USWASEAQ_Q1"]);
    expect(p.writes.map((w) => w.id)).toEqual(["USWASEAQ_Q2", "USWASEAQ_F1"]);
  });
  it("a pre-existing doc with no published field gets published: true", () => {
    const p = plan(new Map([["USWASEAQ_Q1", { origin: "api" }]]));
    expect(p.writes[0].data.published).toBe(true);
  });
});

describe("reading stored docs", () => {
  it("a complete doc maps to the app's match, flagged schedule-only", () => {
    const m = ftcDocToLibraryMatch("EV_Q4", { matchType: "Qualification", matchNumber: 4, eventCode: "EV", eventName: "E", seasonId: "biobuzz", alliances: { red: { teams: [1, 2] }, blue: { teams: [3, 4] } }, scheduledTime: "2026-11-15T09:00:00Z", origin: "manual", published: true, teamId: "T" });
    expect(m).toMatchObject({ id: "EV_Q4", matchType: "Qualification", scheduleOnly: true, scheduledTime: "2026-11-15T09:00:00Z", origin: "manual", published: true, teamId: "T" });
    expect(m?.alliances.red.teams).toEqual([1, 2]);
  });
  it("partial data never throws: no alliances, a missing slot, junk teams, no time", () => {
    const m = ftcDocToLibraryMatch("EV_Q5", { matchType: "Qualification", matchNumber: 5, alliances: { red: { teams: [7, "x", null] } } });
    expect(m?.alliances.red.teams).toEqual([7]);
    expect(m?.alliances.blue.teams).toEqual([]);
    expect(m?.scheduledTime).toBeNull();
    expect(m?.origin).toBe("api");
    expect(m?.published).toBeUndefined();
  });
  it("a doc that cannot be identified is dropped and counted", () => {
    const { matches, unreadable } = ftcDocsToLibraryMatches([
      { id: "a", data: { matchType: "Playoff", matchNumber: 2 } },
      { id: "b", data: { matchType: "Nonsense", matchNumber: 2 } },
      { id: "c", data: { matchType: "Qualification" } },
      { id: "d", data: { matchType: "Qualification", matchNumber: 1 } },
    ]);
    expect(matches.map((x) => x.id)).toEqual(["d", "a"]);
    expect(unreadable).toBe(2);
  });
});

describe("batching and merging", () => {
  it("splits writes 400 per batch", () => {
    expect(LIBRARY_BATCH_SIZE).toBe(400);
    const sizes = chunk(Array.from({ length: 1000 }, (_, i) => i)).map((g) => g.length);
    expect(sizes).toEqual([400, 400, 200]);
    expect(chunk(Array.from({ length: 400 }, (_, i) => i))).toHaveLength(1);
    expect(chunk(Array.from({ length: 401 }, (_, i) => i))).toHaveLength(2);
    expect(chunk([])).toEqual([]);
  });
  it("a merged feed waits for every query, merges by id, and reports a failure once with no half answer", () => {
    const got: unknown[] = [];
    const errors: unknown[] = [];
    const feed = createMergedFeed(2, (rows) => got.push(rows.map((r) => r.id).sort()), (e) => errors.push(e));
    feed.update(0, [{ id: "a", data: {} }, { id: "b", data: {} }]);
    expect(got).toEqual([]);
    feed.update(1, [{ id: "b", data: {} }, { id: "c", data: {} }]);
    expect(got).toEqual([["a", "b", "c"]]);
    feed.fail("boom");
    feed.fail("again");
    feed.update(0, []);
    expect(errors).toEqual(["boom"]);
    expect(got).toHaveLength(1);
  });
  it("a failure before the second query answers delivers nothing", () => {
    const got: unknown[] = [];
    const errors: unknown[] = [];
    const feed = createMergedFeed(2, (r) => got.push(r), (e) => errors.push(e));
    feed.update(0, [{ id: "a", data: {} }]);
    feed.fail("denied");
    feed.update(1, []);
    expect(got).toEqual([]);
    expect(errors).toEqual(["denied"]);
  });
});

describe("import error messages", () => {
  it("names the variables for missing and rejected keys", () => {
    expect(importErrorMessage({ code: "missing_credentials", message: "FTC API credentials are not configured: set FTC_API_USERNAME and FTC_API_KEY." })).toMatch(/FTC_API_USERNAME and FTC_API_KEY.*Manual entry still works/);
    expect(importErrorMessage({ code: "unauthorized", message: "x" })).toMatch(/FTC_API_USERNAME.*FTC_API_KEY.*Manual entry/);
    expect(importErrorMessage({ code: "rate_limited", message: "FIRST API rate limit was hit. Try again shortly." })).toMatch(/rate limit.*Nothing was changed/);
  });
});
