import { describe, expect, it } from "vitest";
import { SEASONS, DEFAULT_SEASON_ID } from "@/lib/seasons";
import { CURRENT_FTC_GAME_ID, FTC_GAME_DEFINITIONS, FTC_GAME_ID_LIST } from "@/config/games/ftc";
import { normalizeEventKey } from "@/config/event";
import { DEFAULT_FILTERS, eventCodeIn, parseFilters, resolveSingleEventCode, type AnalyticsFilters } from "@/lib/analytics/filters";
import { selectAnalyticsEntries } from "@/lib/analytics/entries";
import { matchKey } from "@/lib/analytics/match-breakdown";
import type { ScoutEntry } from "@/lib/scout-entries";
import { gameOfSeason, hasGameConfig, librarySeasons, offeredUnderGame, pickDefaultEvent, pickedWithoutGameConfig, upcomingGameFor, upcomingGameNote, upcomingGamesOf } from "./event-defaults";

// Every season below comes from the program's own game list: no year or game name is written here.
const frcSeasons = SEASONS.map((s) => ({ id: s.id, apiSeason: s.apiSeason }));
const ftcSeasons = FTC_GAME_ID_LIST.map((id) => ({ id: id.toLowerCase(), apiSeason: FTC_GAME_DEFINITIONS[id].year }));
const frcCurrent = SEASONS.find((s) => s.id === DEFAULT_SEASON_ID)!;
const frcOlder = SEASONS.find((s) => s.id !== DEFAULT_SEASON_ID)!;
const ftcCurrent = ftcSeasons.find((s) => s.id === CURRENT_FTC_GAME_ID.toLowerCase())!;
const unconfiguredYear = Math.max(...frcSeasons.map((s) => s.apiSeason)) + 1; // the next, not-yet-announced game

const ev = (code: string, season: number, dateStart: string) => ({ code, season, dateStart });

describe("default event", () => {
  const events = [
    ev("2027arli", unconfiguredYear, "2027-03-01"),
    ev("lateCurrent", frcCurrent.apiSeason, "2026-04-10"),
    ev("firstCurrent", frcCurrent.apiSeason, "2026-03-01"),
    ev("older", frcOlder.apiSeason, "2025-01-01"),
  ];

  it("FRC: the earliest event of the current game's season, never the 2027 one listed first", () => {
    expect(pickDefaultEvent({ events, seasons: frcSeasons, seasonId: DEFAULT_SEASON_ID })).toBe("firstCurrent");
    expect(pickDefaultEvent({ events: [events[0], ...events.slice(1)], seasons: frcSeasons, seasonId: DEFAULT_SEASON_ID })).not.toBe("2027arli");
  });

  it("per season: another game's season picks from its own events", () => {
    expect(pickDefaultEvent({ events, seasons: frcSeasons, seasonId: frcOlder.id })).toBe("older");
  });

  it("FTC: the same rule over the FTC game list", () => {
    const list = [ev("later", ftcCurrent.apiSeason, "2026-02-01"), ev("sooner", ftcCurrent.apiSeason, "2025-11-20")];
    expect(pickDefaultEvent({ events: list, seasons: ftcSeasons, seasonId: ftcCurrent.id })).toBe("sooner");
  });

  it("falls back to list order when dates are missing or equal", () => {
    const noDates = [ev("a", frcCurrent.apiSeason, ""), ev("b", frcCurrent.apiSeason, "")];
    expect(pickDefaultEvent({ events: noDates, seasons: frcSeasons, seasonId: DEFAULT_SEASON_ID })).toBe("a");
    const tie = [ev("x", frcCurrent.apiSeason, "2026-03-01"), ev("y", frcCurrent.apiSeason, "2026-03-01")];
    expect(pickDefaultEvent({ events: tie, seasons: frcSeasons, seasonId: DEFAULT_SEASON_ID })).toBe("x");
    // a dated event beats an undated one even when the undated one is listed first
    expect(pickDefaultEvent({ events: [ev("undated", frcCurrent.apiSeason, ""), ev("dated", frcCurrent.apiSeason, "2026-05-01")], seasons: frcSeasons, seasonId: DEFAULT_SEASON_ID })).toBe("dated");
  });

  it("an event list that only has an unconfigured season has no default", () => {
    expect(pickDefaultEvent({ events: [events[0]], seasons: frcSeasons, seasonId: DEFAULT_SEASON_ID })).toBeNull();
  });

  it("a team with no events has no default, and an unknown game id has none either", () => {
    expect(pickDefaultEvent({ events: [], seasons: frcSeasons, seasonId: DEFAULT_SEASON_ID })).toBeNull();
    expect(pickDefaultEvent({ events, seasons: frcSeasons, seasonId: "not-a-game" })).toBeNull();
  });

  it("a picked event's code survives the URL as written, and still selects entries whatever the case (the empty-tables bug)", () => {
    const parsed = parseFilters(new URLSearchParams("events=2026ev07"));
    expect(parsed.events).toEqual({ kind: "custom", codes: ["2026ev07"] });
    expect(parseFilters(new URLSearchParams("events=2026ev07,2026EV07")).events).toEqual({ kind: "custom", codes: ["2026ev07"] });
    // a stored lower-case key is found by an upper-case link too
    const e = entry("1", "2026ev07");
    const upper = { ...DEFAULT_FILTERS, events: { kind: "custom" as const, codes: ["2026EV07"] } };
    expect(selectAnalyticsEntries({ entries: [e], sessionsById: new Map(), filters: upper, activeEventCodes: [] }).scope).toHaveLength(1);
    expect(eventCodeIn(["2026EV07"], "2026ev07")).toBe(true);
    expect(eventCodeIn(["2026ev08"], "2026ev07")).toBe(false);
  });

  it("an explicit choice always wins, even an event with no game config", () => {
    const picked = { ...DEFAULT_FILTERS, events: { kind: "custom" as const, codes: ["2027arli"] } };
    expect(resolveSingleEventCode(picked, "firstCurrent")).toBe("2027arli");
    expect(resolveSingleEventCode(DEFAULT_FILTERS, "firstCurrent")).toBe("firstCurrent");
  });

  it("knows which seasons have a game config", () => {
    expect(hasGameConfig(frcSeasons, frcCurrent.apiSeason)).toBe(true);
    expect(hasGameConfig(frcSeasons, unconfiguredYear)).toBe(false);
    expect(hasGameConfig(frcSeasons, undefined)).toBe(false);
    expect(gameOfSeason(frcSeasons, unconfiguredYear)).toBeNull();
  });

  it("an unconfigured event picked by hand yields the empty-state note, not an empty form list", () => {
    const options = [{ code: "2027arli", noGameConfig: true }, { code: "firstCurrent" }];
    expect(pickedWithoutGameConfig(options, ["2027ARLI"])).toEqual(["2027ARLI"]);
    expect(pickedWithoutGameConfig(options, ["FIRSTCURRENT"])).toEqual([]);
    expect(pickedWithoutGameConfig(options, [])).toEqual([]);
  });
});

describe("practice events follow the same season rule", () => {
  const matches = [
    { eventCode: "2023bayou", seasonId: frcOlder.id },
    { eventCode: "2023magnolia", seasonId: frcOlder.id },
    { eventCode: "2026lake", seasonId: frcCurrent.id },
    { eventCode: "weird", seasonId: "no-such-game" },
  ];
  const seasonOf = librarySeasons(matches, frcSeasons);

  it("places a library event by its match's game", () => {
    expect(seasonOf.get("2023bayou")).toBe(frcOlder.apiSeason);
    expect(seasonOf.get("2026lake")).toBe(frcCurrent.apiSeason);
    expect(seasonOf.has("weird")).toBe(false);
  });
  it("an older game's regional is not offered under the current game, a current one is, an unplaced one stays", () => {
    expect(offeredUnderGame(seasonOf.get("2023bayou"), frcCurrent.apiSeason)).toBe(false);
    expect(offeredUnderGame(seasonOf.get("2023magnolia"), frcCurrent.apiSeason)).toBe(false);
    expect(offeredUnderGame(seasonOf.get("2026lake"), frcCurrent.apiSeason)).toBe(true);
    expect(offeredUnderGame(undefined, frcCurrent.apiSeason)).toBe(true);
  });
});

describe("an upcoming game (a place for registered events, no stats)", () => {
  const other = [{ apiSeason: unconfiguredYear, name: "Next Game", upcoming: true }, { apiSeason: 2001, name: "Old Game" }];
  const upcoming = upcomingGamesOf(other);

  it("lists only the upcoming entries, with a URL-safe id from the name", () => {
    expect(upcoming).toEqual([{ id: "next_game", name: "Next Game", apiSeason: unconfiguredYear }]);
    expect(upcomingGamesOf(undefined)).toEqual([]);
  });
  it("a Game filter value names it, a real game does not", () => {
    expect(upcomingGameFor(upcoming, "next_game")?.name).toBe("Next Game");
    expect(upcomingGameFor(upcoming, DEFAULT_SEASON_ID)).toBeNull();
  });
  it("its events are the default pick when it is the selected game, and the current game is untouched by it", () => {
    const seasons = [...frcSeasons, ...upcoming.map((g) => ({ id: g.id, apiSeason: g.apiSeason }))];
    const events = [ev("future", unconfiguredYear, "2027-03-01"), ev("now", frcCurrent.apiSeason, "2026-03-01")];
    expect(pickDefaultEvent({ events, seasons, seasonId: "next_game" })).toBe("future");
    expect(pickDefaultEvent({ events, seasons, seasonId: DEFAULT_SEASON_ID })).toBe("now");
  });
  it("says it is not announced where the stats would be", () => {
    expect(upcomingGameNote("Next Game")).toBe("Next Game has not been announced yet, so there are no stats to show.");
  });
});

// ---- All Events ----

function entry(id: string, eventCode: string, over: Partial<ScoutEntry> = {}): ScoutEntry {
  return {
    id,
    teamId: "t",
    uid: "u",
    source: "event",
    mode: null,
    formId: DEFAULT_SEASON_ID,
    formVersion: 1,
    scoutName: "Scout",
    eventCode,
    matchType: "Qualification",
    matchNumber: 1,
    teamNumber: 100,
    values: {},
    score: { auto: 1, teleop: 2, endgame: 3, total: 6 },
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

const allFilters: AnalyticsFilters = { ...DEFAULT_FILTERS, events: { kind: "all" } };
const run = (entries: ScoutEntry[], filters: AnalyticsFilters = allFilters) =>
  selectAnalyticsEntries({ entries, sessionsById: new Map(), filters, activeEventCodes: [] }).scope.map((e) => e.id);

// "All Events" has no scope of its own beyond the game: the entry's form ties it to one game, and archived events are part of it.
describe("All Events", () => {
  it("combines 2 events", () => {
    expect(run([entry("1", "A"), entry("2", "B")])).toEqual(["1", "2"]);
  });

  it("combines 3 events", () => {
    expect(run([entry("1", "A"), entry("2", "B"), entry("3", "C")])).toEqual(["1", "2", "3"]);
  });

  it("never mixes games: another game's form is left out", () => {
    expect(run([entry("1", "A"), entry("2", "B", { formId: frcOlder.id })])).toEqual(["1"]);
    const older: AnalyticsFilters = { ...DEFAULT_FILTERS, gameId: frcOlder.id, events: { kind: "all" } };
    expect(run([entry("1", "A"), entry("2", "B", { formId: frcOlder.id })], older)).toEqual(["2"]);
  });

  it("works for every game, including one whose events are all archived (nothing is left out)", () => {
    for (const season of SEASONS) {
      const filters: AnalyticsFilters = { ...DEFAULT_FILTERS, gameId: season.id, events: { kind: "all" } };
      const entries = [entry("1", "archived-1", { formId: season.id }), entry("2", "archived-2", { formId: season.id })];
      expect(run(entries, filters), season.id).toEqual(["1", "2"]);
    }
  });

  it("includes an event stored under a legacy key the same as any other", () => {
    expect(run([entry("1", "2026lake"), entry("2", "2025arli")])).toEqual(["1", "2"]);
  });

  it("keeps match numbers apart: the same match number at two events never joins", () => {
    const a = entry("1", "A", { matchNumber: 5 });
    const b = entry("2", "B", { matchNumber: 5 });
    expect(run([a, b])).toEqual(["1", "2"]);
    expect(matchKey(a.eventCode, a.matchType, a.matchNumber)).not.toBe(matchKey(b.eventCode, b.matchType, b.matchNumber));
  });

  it("an empty game is an empty selection, not a crash", () => {
    expect(run([entry("2", "OLD", { formId: frcOlder.id })])).toEqual([]);
    expect(run([])).toEqual([]);
  });
});

describe("a picked event whose key has a legacy alias", () => {
  // A mistyped key is stored and read as the real one, so entries stored under it sit under the real key; the two are one event.
  it("finds the entries stored under the key it resolves to, from either spelling", () => {
    const stored = entry("1", normalizeEventKey("2026labr"), { formId: frcOlder.id });
    const picked = (code: string): AnalyticsFilters => ({ ...DEFAULT_FILTERS, gameId: frcOlder.id, events: { kind: "custom", codes: [code] } });
    expect(run([stored], picked("2026labr"))).toEqual(["1"]);
    expect(run([stored], picked("2026lake"))).toEqual(["1"]);
    expect(run([stored], picked("2026arli"))).toEqual([]);
    expect(eventCodeIn(["2026labr"], stored.eventCode)).toBe(true);
  });

  it("the 2025 Bayou Regional is its own event: picking it does not select the 2026 one's entries, and vice versa", () => {
    const e2025 = entry("1", "2025lake", { formId: frcOlder.id });
    const e2026 = entry("2", "2026lake", { formId: frcOlder.id });
    const picked = (code: string): AnalyticsFilters => ({ ...DEFAULT_FILTERS, gameId: frcOlder.id, events: { kind: "custom", codes: [code] } });
    expect(run([e2025, e2026], picked("2025lake"))).toEqual(["1"]);
    expect(run([e2025, e2026], picked("2026lake"))).toEqual(["2"]);
  });
});
