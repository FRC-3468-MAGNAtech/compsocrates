import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS, type AnalyticsFilters } from "@/lib/analytics/filters";
import { joinEntries, selectAnalyticsEntries, type AnalyticsEntry } from "@/lib/analytics/entries";
import { rebuiltEntry } from "@/lib/analytics/cs-test-fixtures";
import { GAMES, DEFAULT_GAME_ID } from "@/lib/analytics/game-schema";
import { buildAllTeamStats } from "@/lib/analytics/team-stats";
import { GAME_FORMS } from "@/lib/forms/builtin";
import { DEFAULT_FORM_ID } from "@/lib/forms/builtin";
import type { ScoutEntry } from "@/lib/scout-entries";

// A benchmark-style test for the Analytics stats pipeline on a synthetic dataset: 5,000 entries across 40 events (about the size of a big team's
// multi-season history). It prints timings so they can be compared before and after a change (see docs/SESSION2_RESULTS.md) and asserts only a
// generous ceiling, so it is not flaky on a slow machine. It measures the pure pipeline, NOT React rendering, layout or paint: those need the
// browser performance panel (steps in the results file).
const ENTRY_COUNT = 5000;
const EVENT_COUNT = 40;
const TEAM_COUNT = 200;

function synthetic(): ScoutEntry[] {
  const out: ScoutEntry[] = [];
  for (let i = 0; i < ENTRY_COUNT; i++) {
    const event = `2026ev${String(i % EVENT_COUNT).padStart(2, "0")}`;
    out.push(rebuiltEntry(`e${i}`, { event, team: String(100 + (i % TEAM_COUNT)), match: `q${1 + (i % 80)}`, autoFuel: i % 17, teleFuel: i % 41, endFuel: i % 9, status: ["", "parked", "level-1", "level-2", "level-3"][i % 5] }));
  }
  return out;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
function time(fn: () => unknown, runs = 7): number {
  fn(); // warm up
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    fn();
    samples.push(performance.now() - t);
  }
  return median(samples);
}

describe("stats pipeline benchmark (5,000 entries, 40 events)", () => {
  const entries = synthetic();
  const sessionsById = new Map();
  const base = { ...DEFAULT_FILTERS, gameId: DEFAULT_GAME_ID };
  const oneEvent: AnalyticsFilters = { ...base, events: { kind: "custom", codes: ["2026ev07"] } };
  const allEvents: AnalyticsFilters = { ...base, events: { kind: "all" } };
  const form = GAME_FORMS[DEFAULT_FORM_ID];
  const gameFormIds = new Set([DEFAULT_FORM_ID]);

  it("reports timings and stays within a generous ceiling", () => {
    const rows: Record<string, number> = {};

    // BEFORE a filter change: every selection re-joins every entry to its session (a new object per entry).
    rows["select, one event (join + filter, per filter change)"] = time(() => selectAnalyticsEntries({ entries, sessionsById, filters: oneEvent, activeEventCodes: [], gameFormIds }));
    rows["select, All events (join + filter, per filter change)"] = time(() => selectAnalyticsEntries({ entries, sessionsById, filters: allEvents, activeEventCodes: [], gameFormIds }));

    // AFTER: the join is done once per data change; a filter change only filters.
    const joined = joinEntries(entries, sessionsById);
    rows["join once (per data change)"] = time(() => joinEntries(entries, sessionsById));
    rows["select, one event, pre-joined (per filter change)"] = time(() => selectAnalyticsEntries({ entries, joined, sessionsById, filters: oneEvent, activeEventCodes: [], gameFormIds }));
    rows["select, All events, pre-joined (per filter change)"] = time(() => selectAnalyticsEntries({ entries, joined, sessionsById, filters: allEvents, activeEventCodes: [], gameFormIds }));

    const used = selectAnalyticsEntries({ entries, joined, sessionsById, filters: allEvents, activeEventCodes: [], gameFormIds }).used;
    rows["team stats, All events (per selection change)"] = time(() => buildAllTeamStats(used, form), 3);
    const usedOne = selectAnalyticsEntries({ entries, joined, sessionsById, filters: oneEvent, activeEventCodes: [], gameFormIds }).used;
    rows["team stats, one event (per selection change)"] = time(() => buildAllTeamStats(usedOne, form), 5);

    console.info(`\nAnalytics pipeline, ${ENTRY_COUNT} entries / ${EVENT_COUNT} events / ${TEAM_COUNT} teams (median ms):\n${Object.entries(rows).map(([k, v]) => `  ${v.toFixed(2).padStart(8)}  ${k}`).join("\n")}\n`);

    for (const [name, ms] of Object.entries(rows)) expect(ms, name).toBeLessThan(2000);
  });

  it("the pre-joined path returns exactly what the one-step path returns", () => {
    const joined = joinEntries(entries, sessionsById);
    const strip = (xs: AnalyticsEntry[]) => xs.map((e) => e.id);
    for (const filters of [oneEvent, allEvents]) {
      const a = selectAnalyticsEntries({ entries, sessionsById, filters, activeEventCodes: [], gameFormIds });
      const b = selectAnalyticsEntries({ entries, joined, sessionsById, filters, activeEventCodes: [], gameFormIds });
      expect(strip(b.scope)).toEqual(strip(a.scope));
      expect(strip(b.used)).toEqual(strip(a.used));
    }
    expect(selectAnalyticsEntries({ entries, joined, sessionsById, filters: oneEvent, activeEventCodes: [], gameFormIds }).scope.length).toBe(ENTRY_COUNT / EVENT_COUNT);
    expect(GAMES[DEFAULT_GAME_ID]).toBeDefined();
  });
});
