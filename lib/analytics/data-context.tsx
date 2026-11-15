"use client";

import { createContext, useContext, useMemo } from "react";
import { useActiveEvents } from "@/lib/active-event";
import { useAuth } from "@/lib/auth";
import { orderPrimaryFirst } from "@/lib/active-events";
import { eventsOfGameSeason } from "@/lib/analytics/event-options";
import { hasGameConfig, pickDefaultEvent, type AllEventsScope } from "@/lib/analytics/event-defaults";
import { isInScope, joinEntries, selectAnalyticsEntries, type AnalyticsEntry, type EntrySelection, type SelectOptions } from "@/lib/analytics/entries";
import { useAnalyticsFilters } from "@/lib/analytics/filter-context";
import { resolveSingleEventCode, type AnalyticsFilters } from "@/lib/analytics/filters";
import { buildAllTeamStats, type TeamStats } from "@/lib/analytics/team-stats";
import { useTeamNames } from "@/lib/analytics/use-event-data";
import { getEvents } from "@/lib/events/actions";
import { collectStoredEventNames } from "@/lib/events/stored-names";
import { resolveEventName } from "@/lib/events/names";
import { useEventNames, useRegisterStoredEventNames } from "@/lib/events/use-event-names";
import { useEventQuery } from "@/lib/events/use-event-query";
import type { EventInfo } from "@/lib/events/types";
import { useAllLibraryMatches, type LibraryMatch } from "@/lib/match-library";
import { useAllTeamPracticeSessions, type PracticeSession } from "@/lib/practice-sessions";
import { useProgram, useProgramConfig } from "@/lib/program/context";
import { scopedKey } from "@/lib/program/paths";
import { useTeamScoutEntries, type ScoutEntry } from "@/lib/scout-entries";
import type { Form } from "@/lib/forms/types";
import { useForms, useGameFormIds, useSchemaForEntries } from "@/lib/forms/forms-context";

// The one realtime data layer every Analytics subpage reads (P10). It is
// mounted once in the Analytics layout, so there is exactly one team-wide
// scoutEntries subscription (and one practice-sessions subscription, only
// while Practice is on) no matter how many subpages the user visits — pages
// read from here via the hooks at the bottom instead of subscribing
// themselves.

export type EventOption = {
  code: string;
  name: string;
  /** The FIRST API event, when we know it (an active event, or one in the season's event list) — drives the status chip. */
  event: EventInfo | null;
  active: boolean;
  /** Entries for this event under the current Game and Practice settings. */
  count: number;
  /** The event's season has no game config in this program yet (the next, unannounced game): listed, marked, never the default, and it has nothing to show. */
  noGameConfig?: boolean;
  /** The team archived this event (Session D); listed only while "Show archived events" is on, or when it is the explicit pick. */
  archived?: boolean;
};

type AnalyticsDataValue = {
  loaded: boolean;
  allEntries: ScoutEntry[];
  /** Practice sessions by id (only loaded while Practice is on). Full sessions, so Match Scout Analytics can toggle their exclusion. */
  sessionsById: Map<string, PracticeSession>;
  /** P21: the form the Game's entries were scouted with (every version of every form in scope, unioned), what the tables and stats are derived from. */
  schema: Form;
  /** The game's FIRST API season year, the fallback when an event's own season isn't known. */
  season: number;
  activeEventCodes: string[];
  /** Active events, primary first. */
  activeEvents: EventInfo[];
  primaryCode: string | null;
  eventDirectory: ReadonlyMap<string, EventInfo>;
  /** The display name of any event code through the shared chain (API, stored, static, key): never a bare key when a name is known. */
  eventNameOf: (code: string) => string;
  /** Every imported library match — Practice mode's official matches (Match Breakdown). */
  libraryMatches: LibraryMatch[];
  eventOptions: EventOption[];
  /** The standard selection (accuracy filter applied, excluded dropped) for the current URL filters — computed once and shared. */
  selection: EntrySelection;
  /** Where "All Events" stops (selected game's season, archived left out unless shown): shared with every page that re-selects entries. */
  allScope: AllEventsScope;
  /** Every entry joined to its session's accuracy (once per data change): what the pages' own selections filter. */
  joined: AnalyticsEntry[];
  /** The team has archived at least one event (the "Show archived events" switch only appears then). */
  hasArchived: boolean;
  /** The program's games (season id plus events API year): the one season-to-game map. */
  seasons: readonly { id: string; apiSeason: number }[];
  teamStats: TeamStats[];
  teamNames: ReadonlyMap<number, string>;
};

const DataContext = createContext<AnalyticsDataValue | null>(null);

const NO_KEYS: string[] = [];

export function AnalyticsDataProvider({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  const teamId = profile?.teamId ?? null;
  const { filters } = useAnalyticsFilters();
  // Analytics reads every selected event, archived ones included: archiving only declutters the scouting pickers.
  const { allEvents: activeEventsRaw, storedPrimaryCode: primaryCode, archivedCodes } = useActiveEvents();
  // Everything below reads only what the active program has connected: practice sessions, the match library and event-name lookups are the default
  // program's collections and API, so a program without them asks for nothing (the filters already turn Practice off there).
  const program = useProgram();
  const { practice: practiceConnected, library: libraryConnected, eventLookup } = useProgramConfig().connection.features;

  const { entries: allEntries, loaded: entriesLoaded } = useTeamScoutEntries(teamId);
  const { sessions, loaded: sessionsLoaded } = useAllTeamPracticeSessions(filters.practice && practiceConnected ? teamId : null);
  const { matches: libraryMatches } = useAllLibraryMatches(libraryConnected);

  const { seasons, seasonFor } = useForms();
  const game = seasonFor(filters.gameId);
  const gameFormIds = useGameFormIds(filters.gameId);

  const activeEvents = useMemo(() => orderPrimaryFirst({ events: activeEventsRaw, primaryCode }), [activeEventsRaw, primaryCode]);
  const activeEventCodes = useMemo(() => activeEvents.map((e) => e.code), [activeEvents]);

  // Active events carry their own season; everything else is looked up in the
  // game's season list (shared, cached, with Event Selection's own query).
  const seasonEvents = useEventQuery(scopedKey(program, `events:${game.apiSeason}`), () => getEvents({ season: game.apiSeason }, program));
  const eventDirectory = useMemo(() => {
    const map = new Map<string, EventInfo>();
    for (const e of seasonEvents.data ?? []) map.set(e.code, e);
    for (const e of activeEvents) map.set(e.code, e);
    return map;
  }, [seasonEvents.data, activeEvents]);

  const sessionsById = useMemo(() => new Map<string, PracticeSession>(sessions.map((s) => [s.id, s])), [sessions]);

  // "All Events" = every event of the selected game's season (archived ones only while "Show archived events" is on), cut from the data already loaded.
  const allScope = useMemo<AllEventsScope>(
    () => ({
      gameSeason: game.apiSeason,
      seasonOf: (code) => eventDirectory.get(code)?.season,
      excluded: filters.archived ? new Set<string>() : new Set(archivedCodes),
    }),
    [game.apiSeason, eventDirectory, filters.archived, archivedCodes]
  );

  // Joined to the sessions once per DATA change; a filter change (event, game, accuracy) then only filters instead of rebuilding every entry.
  const joined = useMemo(() => joinEntries(allEntries, sessionsById), [allEntries, sessionsById]);

  const selection = useMemo(
    () => selectAnalyticsEntries({ entries: allEntries, joined, sessionsById, filters, activeEventCodes, gameFormIds, allScope }),
    [allEntries, joined, sessionsById, filters, activeEventCodes, gameFormIds, allScope]
  );
  const { schema } = useSchemaForEntries(selection.scope, filters.gameId);

  // Names for every event the pickers can list, through the shared chain (API, then the names stored on library matches and the
  // team doc, then the static table, then the key), so a data-only event never shows as a bare key.
  const storedNames = useMemo(() => collectStoredEventNames(libraryMatches), [libraryMatches]);
  useRegisterStoredEventNames(storedNames);
  const nameKeys = useMemo(
    () => [...new Set([...activeEventCodes, ...libraryMatches.map((m) => m.eventCode), ...allEntries.map((e) => e.eventCode)].filter(Boolean))],
    [activeEventCodes, libraryMatches, allEntries]
  );
  const resolvedNames = useEventNames(eventLookup ? nameKeys : NO_KEYS, { stored: storedNames });

  const eventNameOf = useMemo(
    () => (code: string) => resolvedNames[code]?.name ?? resolveEventName({ key: code, api: eventDirectory.get(code)?.name, stored: storedNames[code] }).name,
    [resolvedNames, eventDirectory, storedNames]
  );

  const eventOptions = useMemo(() => {
    const options = new Map<string, EventOption>();
    const nameOf = eventNameOf;
    const archivedSet = new Set(archivedCodes.map((c) => c.toUpperCase()));
    const explicit = new Set(filters.events.kind === "custom" ? filters.events.codes.map((c) => c.toUpperCase()) : []);
    // An archived event is listed only while "Show archived events" is on, or when it is the explicit pick (so the select can still show it checked).
    const hidden = (code: string) => !filters.archived && archivedSet.has(code.toUpperCase()) && !explicit.has(code.toUpperCase());
    const add = (code: string, name: string, active: boolean, noGameConfig = false) => {
      // Keyed by the upper-cased code: the URL upper-cases picked codes, so the same event must not be listed twice.
      if (hidden(code) || options.has(code.toUpperCase())) return;
      options.set(code.toUpperCase(), { code, name, event: eventDirectory.get(code) ?? null, active, count: 0, noGameConfig, archived: archivedSet.has(code.toUpperCase()) });
    };

    if (filters.practice) {
      for (const m of libraryMatches) add(m.eventCode, nameOf(m.eventCode), false);
    } else {
      // Only the selected events of this game's season: a 2027 event has no entries under a 2025 game. Events with data are added below.
      for (const e of eventsOfGameSeason(activeEvents, game.apiSeason)) add(e.code, nameOf(e.code), !archivedSet.has(e.code.toUpperCase()));
      // A team event whose season has no game config yet (the next, unannounced game) stays listed so it is not mysteriously missing, marked and never active.
      for (const e of activeEvents) if (!hasGameConfig(seasons, e.season)) add(e.code, nameOf(e.code), false, true);
    }
    // Events with data under the current Game/Practice settings, whatever the Event filter says.
    const scopeAnyEvent = allEntries.filter((e) => isInScope(e, { ...filters, events: { kind: "all" } }, null, gameFormIds));
    for (const e of scopeAnyEvent) {
      add(e.eventCode, nameOf(e.eventCode), activeEventCodes.includes(e.eventCode) && !filters.practice && !archivedSet.has(e.eventCode.toUpperCase()));
      const option = options.get(e.eventCode.toUpperCase());
      if (option) option.count += 1;
    }
    // Whatever was picked by hand is always an option, so the select can show it checked (a code the lists above do not know included).
    if (filters.events.kind === "custom") for (const code of filters.events.codes) add(code, nameOf(code), false, eventDirectory.get(code) ? !hasGameConfig(seasons, eventDirectory.get(code)!.season) : false);

    return [...options.values()].sort(
      (a, b) =>
        Number(!!a.noGameConfig) - Number(!!b.noGameConfig) ||
        Number(b.active) - Number(a.active) ||
        (a.active && b.active ? activeEventCodes.indexOf(a.code) - activeEventCodes.indexOf(b.code) : 0) ||
        b.count - a.count ||
        a.name.localeCompare(b.name)
    );
  }, [allEntries, filters, libraryMatches, activeEvents, activeEventCodes, eventDirectory, gameFormIds, eventNameOf, game.apiSeason, archivedCodes, seasons]);

  // Names for every event that has data in scope (not just the ones passing the accuracy filter), so they don't flicker as the threshold changes.
  const nameRequests = useMemo(() => {
    const codes = [...new Set(selection.scope.map((e) => e.eventCode))];
    return codes.map((code) => ({ code, season: eventDirectory.get(code)?.season ?? game.apiSeason }));
  }, [selection.scope, eventDirectory, game.apiSeason]);
  const teamNames = useTeamNames(nameRequests);

  const teamStats = useMemo(() => buildAllTeamStats(selection.used, schema, teamNames), [selection.used, schema, teamNames]);

  const value = useMemo<AnalyticsDataValue>(
    () => ({
      loaded: entriesLoaded && (!filters.practice || sessionsLoaded),
      allEntries,
      sessionsById,
      schema,
      season: game.apiSeason,
      activeEventCodes,
      activeEvents,
      primaryCode,
      eventDirectory,
      eventNameOf,
      libraryMatches,
      eventOptions,
      selection,
      allScope,
      joined,
      hasArchived: archivedCodes.length > 0,
      seasons,
      teamStats,
      teamNames,
    }),
    [entriesLoaded, sessionsLoaded, filters.practice, allEntries, sessionsById, schema, game.apiSeason, activeEventCodes, activeEvents, primaryCode, eventDirectory, eventNameOf, libraryMatches, eventOptions, selection, allScope, joined, archivedCodes, seasons, teamStats, teamNames]
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

/** Everything the provider holds. Prefer the narrower hooks below; the filter bar and Match Scout Analytics need the extras. */
export function useAnalyticsData(): AnalyticsDataValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useAnalyticsData must be used inside <AnalyticsDataProvider> (the Analytics layout mounts it).");
  return ctx;
}

export type AnalyticsEntriesResult = {
  /** What a page may use: Game/Event/Practice scoped, excluded dropped, accuracy threshold applied (unless `options` say otherwise). */
  entries: AnalyticsEntry[];
  /** Everything matching Game/Event/Practice — "M" in "N of M entries shown". */
  scope: AnalyticsEntry[];
  usedCount: number;
  scopeCount: number;
  loaded: boolean;
  filters: AnalyticsFilters;
  schema: Form;
};

/**
 * The filtered entries for the current Analytics filters, each joined to its
 * alliance-match accuracy. With no arguments this is the shared, already
 * computed selection. Pass `filters` to evaluate a different filter state
 * (e.g. a page that pins one event), or `options` for the raw view (Match
 * Scout Analytics: `{ applyAccuracy: false, includeExcluded: true }`).
 */
export function useAnalyticsEntries(filtersOverride?: AnalyticsFilters, options?: SelectOptions): AnalyticsEntriesResult {
  const data = useAnalyticsData();
  const { filters: urlFilters } = useAnalyticsFilters();
  const filters = filtersOverride ?? urlFilters;
  const gameFormIds = useGameFormIds(filters.gameId);
  const applyAccuracy = options?.applyAccuracy ?? true;
  const includeExcluded = options?.includeExcluded ?? false;
  const isStandard = filtersOverride === undefined && applyAccuracy && !includeExcluded;

  const custom = useMemo(
    () =>
      isStandard
        ? null
        : selectAnalyticsEntries(
            { entries: data.allEntries, joined: data.joined, sessionsById: data.sessionsById, filters, activeEventCodes: data.activeEventCodes, gameFormIds, allScope: data.allScope },
            { applyAccuracy, includeExcluded }
          ),
    [isStandard, data.allEntries, data.joined, data.sessionsById, filters, data.activeEventCodes, data.allScope, applyAccuracy, includeExcluded, gameFormIds]
  );
  const selection = custom ?? data.selection;

  return {
    entries: selection.used,
    scope: selection.scope,
    usedCount: selection.used.length,
    scopeCount: selection.scope.length,
    loaded: data.loaded,
    filters,
    schema: data.schema,
  };
}

/**
 * The one event a single-event page shows: the viewer's explicit pick (even an event whose game is not configured yet), else the FIRST event of the
 * selected game's season in the team's event list (earliest start date, list order as the fallback; `pickDefaultEvent`), else the first listed event
 * with a game config and data. An event whose season has no game config is never the default. `event` is the FIRST API event when known (its
 * season is needed for FIRST API calls like recompute).
 */
export function useSingleEvent(): { code: string | null; event: EventInfo | null; noGameConfig: boolean } {
  const data = useAnalyticsData();
  const { filters } = useAnalyticsFilters();
  const fallback =
    pickDefaultEvent({ events: data.activeEvents.filter((e) => !data.allScope.excluded.has(e.code)), seasons: data.seasons, seasonId: filters.gameId }) ??
    data.eventOptions.find((o) => !o.noGameConfig)?.code ??
    null;
  const code = resolveSingleEventCode(filters, fallback);
  // A picked code comes back from the URL upper-cased, so fall back to the option (matched without case) when the directory has it under another case.
  const option = code ? data.eventOptions.find((o) => o.code.toUpperCase() === code.toUpperCase()) : undefined;
  const event = code ? (data.eventDirectory.get(code) ?? option?.event ?? null) : null;
  return { code, event, noGameConfig: option?.noGameConfig ?? (event !== null && !hasGameConfig(data.seasons, event.season)) };
}

/** Per-team stats for the standard selection — memoized once in the provider and shared by Team Averages, Rankings, and Team Profile. */
export function useTeamStats(): { teamStats: TeamStats[]; teamNames: ReadonlyMap<number, string>; loaded: boolean; schema: Form; entries: AnalyticsEntry[] } {
  const data = useAnalyticsData();
  return { teamStats: data.teamStats, teamNames: data.teamNames, loaded: data.loaded, schema: data.schema, entries: data.selection.used };
}
