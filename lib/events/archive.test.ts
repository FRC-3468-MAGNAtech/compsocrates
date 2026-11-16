import { describe, expect, it } from "vitest";
import { csTeamToTeamDoc } from "@/data/cs/teams";
import { DEFAULT_FILTERS, type AnalyticsFilters } from "@/lib/analytics/filters";
import { selectAnalyticsEntries } from "@/lib/analytics/entries";
import type { ScoutEntry } from "@/lib/scout-entries";
import type { EventInfo } from "@/lib/events/types";
import { archiveCodes, assignmentEventGroups, previousSeasonEvents, readArchivedEvents, restoreCode, splitArchived, visibleEventsState } from "./archive";

const ev = (code: string, season = 2026): EventInfo => ({ code, season, name: code, dateStart: "", dateEnd: "", city: null, stateProv: null, country: null, venue: null, website: null, timezone: null, status: "upcoming" });
const state = (codes: string[], primaryCode: string | null = codes[0] ?? null) => ({ events: codes.map((c) => ev(c)), primaryCode });

describe("archive and restore", () => {
  it("archives once, keeps order, and restores one code", () => {
    const a = archiveCodes(["a"], ["b", "a", "c"]);
    expect(a).toEqual(["a", "b", "c"]);
    expect(restoreCode(a, "b")).toEqual(["a", "c"]);
    expect(restoreCode(a, "zzz")).toEqual(a);
  });

  it("reads junk as none and drops non-strings and blanks", () => {
    expect(readArchivedEvents(undefined)).toEqual([]);
    expect(readArchivedEvents("x")).toEqual([]);
    expect(readArchivedEvents(["a", 3, " ", null, "a", " b "])).toEqual(["a", "b"]);
  });

  it("round-trips through the team reader; absent reads as none", () => {
    expect(csTeamToTeamDoc("T", { selectedEvents: ["2025arli", "2026lake"], archivedEvents: ["2025arli"] }).archivedEvents).toEqual(["2025arli"]);
    expect(csTeamToTeamDoc("T", { selectedEvents: ["2026lake"] }).archivedEvents).toBeUndefined();
  });
});

describe("archived events are hidden from pickers", () => {
  it("splits current from archived and leaves the selection itself whole", () => {
    const s = state(["old", "new"]);
    const { current, archived } = splitArchived(s.events, ["old"]);
    expect(current.map((e) => e.code)).toEqual(["new"]);
    expect(archived.map((e) => e.code)).toEqual(["old"]);
    expect(s.events).toHaveLength(2);
  });

  it("previous-season archiving counts only current events from earlier seasons", () => {
    const events = [ev("a", 2024), ev("b", 2025), ev("c", 2026), ev("d", 2024)];
    expect(previousSeasonEvents(events, ["d"], 2026).map((e) => e.code)).toEqual(["a", "b"]);
    expect(previousSeasonEvents(events, [], 2024)).toEqual([]);
  });
});

describe("the active event falls back when it is archived", () => {
  it("keeps the primary while it is current", () => {
    expect(visibleEventsState(state(["a", "b"]), ["b"])).toEqual({ events: [expect.objectContaining({ code: "a" })], primaryCode: "a" });
  });

  it("an archived primary hands over to the first current event", () => {
    const v = visibleEventsState(state(["old", "x", "y"]), ["old"]);
    expect(v.primaryCode).toBe("x");
    expect(v.events.map((e) => e.code)).toEqual(["x", "y"]);
  });

  it("with everything archived the state is empty: no stale selection", () => {
    expect(visibleEventsState(state(["a", "b"]), ["a", "b"])).toEqual({ events: [], primaryCode: null });
    expect(visibleEventsState({ events: [], primaryCode: null }, [])).toEqual({ events: [], primaryCode: null });
  });
});

describe("archived events in Analytics", () => {
  it("their data is still read: the entry selection never consults the archive", () => {
    const entry = (id: string, eventCode: string) =>
      ({
        id,
        teamId: "t",
        uid: "u",
        source: "event",
        mode: null,
        formId: "sample",
        formVersion: 1,
        scoutName: "S",
        eventCode,
        matchType: "Qualification",
        matchNumber: 1,
        teamNumber: 100,
        values: {},
        score: { auto: 1, teleop: 1, endgame: 1, total: 3 },
        comments: "",
        submittedAt: "2025-01-01T00:00:00.000Z",
        excluded: false,
        autoFlags: [],
        manualFlags: [],
        accuracy: null,
        sessionId: null,
        libraryMatchId: null,
      }) as ScoutEntry;
    const entries = [entry("1", "cur"), entry("2", "old")];
    const filters = (over: Partial<AnalyticsFilters>): AnalyticsFilters => ({ ...DEFAULT_FILTERS, gameId: "sample", ...over });
    const pick = (f: AnalyticsFilters) => selectAnalyticsEntries({ entries, sessionsById: new Map(), filters: f, activeEventCodes: ["cur"] }).scope.map((e) => e.id);
    expect(pick(filters({}))).toEqual(["1"]); // default scope: the (non-archived) active events
    expect(pick(filters({ events: { kind: "custom", codes: ["old"] } }))).toEqual(["2"]); // explicitly opened
    expect(pick(filters({ events: { kind: "all" } })).sort()).toEqual(["1", "2"]);
  });
});

describe("assignmentEventGroups (the Assignments picker with 'Show archived events')", () => {
  const ev = (code: string) => ({ code });
  const input = { current: [ev("2026arli")], archived: [ev("2025lake"), ev("2026old")], other: [ev("2026arli"), ev("2026old"), ev("2026new")] };

  it("off (default): archived events are not offered, not even under Other events", () => {
    const g = assignmentEventGroups({ ...input, showArchived: false });
    expect(g.archived).toEqual([]);
    expect(g.other.map((e) => e.code)).toEqual(["2026new"]);
    expect(g.current.map((e) => e.code)).toEqual(["2026arli"]);
  });

  it("on: archived events get their own group, in order, and appear once", () => {
    const g = assignmentEventGroups({ ...input, showArchived: true });
    expect(g.archived.map((e) => e.code)).toEqual(["2025lake", "2026old"]);
    expect(g.other.map((e) => e.code)).toEqual(["2026new"]);
  });

  it("an event that is both current and archived is listed once, as current", () => {
    const g = assignmentEventGroups({ current: [ev("a")], archived: [ev("a"), ev("b")], other: [], showArchived: true });
    expect(g.current.map((e) => e.code)).toEqual(["a"]);
    expect(g.archived.map((e) => e.code)).toEqual(["b"]);
  });
});
