"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import { useActiveEvents } from "@/lib/active-event";
import { useAuth } from "@/lib/auth";
import { orderPrimaryFirst } from "@/lib/active-events";
import { eventsOfGameSeason } from "@/lib/analytics/event-options";
import { hasGameConfig, librarySeasons, offeredUnderGame, pickDefaultEvent, upcomingGameFor, upcomingGamesOf, type UpcomingGame } from "@/lib/analytics/event-defaults";
import { isInScope, joinEntries, selectAnalyticsEntries, type AnalyticsEntry, type EntrySelection, type SelectOptions } from "@/lib/analytics/entries";
import { useAnalyticsFilters } from "@/lib/analytics/filter-context";
import { resolveSingleEventCode, sameEventCode, type AnalyticsFilters } from "@/lib/analytics/filters";
import { normalizeEventKey } from "@/config/event";
import { buildAllTeamStats, type TeamStats } from "@/lib/analytics/team-stats";
import { useTeamNames } from "@/lib/analytics/use-event-data";
import { getEvents } from "@/lib/events/actions";
import { collectStoredEventNames } from "@/lib/events/stored-names";
import { resolveEventName, usableEventName } from "@/lib/events/names";
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
  /** The events API season of the event when known: the year shown beside a name whose key carries none. */
  season?: number;
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
  /** The team's archived event codes (never the default event). */
  archivedCodes: ReadonlySet<string>;
  /** Every entry joined to its session's accuracy (once per data change): what the pages' own selections filter. */
  joined: AnalyticsEntry[];
  /** The team has archived at least one event (the "Show archived events" switch only appears then). */
  hasArchived: boolean;
  /** The program's not-yet-announced games: a Game filter value that names one has no entries and shows a notice instead of stats. */
  upcomingGames: readonly UpcomingGame[];
  /** The program's games (season id plus events API year, upcoming ones included): the one season-to-game map. */
  seasons: readonly { id: string; apiSeason: number }[];
  teamStats: TeamStats[];
  teamNames: ReadonlyMap<number, string>;
};

const DataContext = createContext<AnalyticsDataValue | null>(null);

const NO_KEYS: string[] = [];
const NO_FORM_IDS: ReadonlySet<string> = new Set();

export function AnalyticsDataProvider({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  const teamId = profile?.teamId ?? null;
  const { filters } = useAnalyticsFilters();
  // Analytics reads every selected event, archived ones included: archiving only declutters the scouting pickers.
  const { allEvents: activeEventsRaw, storedPrimaryCode: primaryCode, archivedCodes } = useActiveEvents();
  // Everything below reads only what the active program has connected: practice sessions, the match library and event-name lookups are the default
  // program's collections and API, so a program without them asks for nothing (the filters already turn Practice off there).
  const program = useProgram();
  const programConfig = useProgramConfig();
  const { practice: practiceConnected, library: libraryConnected, eventLookup } = programConfig.connection.features;
  // The program's not-yet-announced games (its config lists them): each is a place in the Game list for that season's registered events, with no stats.
  const otherGames = programConfig.event.otherGames;
  const upcomingGames = useMemo(() => upcomingGamesOf(otherGames), [otherGames]);

  const { entries: allEntries, loaded: entriesLoaded } = useTeamScoutEntries(teamId);
  const { sessions, loaded: sessionsLoaded } = useAllTeamPracticeSessions(filters.practice && practiceConnected ? teamId : null);
  const { matches: libraryMatches } = useAllLibraryMatches(libraryConnected);

  const { seasons, seasonFor } = useForms();
  const game = seasonFor(filters.gameId);
  const realGameFormIds = useGameFormIds(filters.gameId);
  const upcoming = upcomingGameFor(upcomingGames, filters.gameId);
  // An upcoming game has no form: nothing is in its scope (never the default game's entries under another name).
  const gameFormIds = upcoming ? NO_FORM_IDS : realGameFormIds;
  const gameSeason = upcoming?.apiSeason ?? game.apiSeason;
  // The program's games for default-event picking: the scouted ones and the upcoming ones.
  const allSeasons = useMemo(() => [...seasons.map((s) => ({ id: s.id, apiSeason: s.apiSeason })), ...upcomingGames.map((g) => ({ id: g.id, apiSeason: g.apiSeason }))], [seasons, upcomingGames]);
  // A season is unclaimed when no game config and no upcoming game takes it: only those events are labelled "No game config yet".
  const unclaimed = useCallback((season: number) => !hasGameConfig(seasons, season) && !upcomingGames.some((g) => g.apiSeason === season), [seasons, upcomingGames]);

  const activeEvents = useMemo(() => orderPrimaryFirst({ events: activeEventsRaw, primaryCode }), [activeEventsRaw, primaryCode]);
  const activeEventCodes = useMemo(() => activeEvents.map((e) => e.code), [activeEvents]);

  // Active events carry their own season; everything else is looked up in the
  // game's season list (shared, cached, with Event Selection's own query).
  const seasonEvents = useEventQuery(scopedKey(program, `events:${gameSeason}`), () => getEvents({ season: gameSeason }, program));
  const eventDirectory = useMemo(() => {
    const map = new Map<string, EventInfo>();
    for (const e of seasonEvents.data ?? []) map.set(e.code, e);
    // A team event stored as a bare key (no real name yet) must not hide the season list's full record of the same event.
    for (const e of activeEvents) {
      const known = map.get(e.code);
      map.set(e.code, known && usableEventName(e.name, e.code) === null ? known : e);
    }
    return map;
  }, [seasonEvents.data, activeEvents]);

  // The season of every event the practice library knows: library matches carry their game, which places an event the season list does not hold
  // (a 2023 regional is not in the 2026 list), so practice events are filtered by season exactly like real-event ones.
  const librarySeasonOf = useMemo(() => librarySeasons(libraryMatches, seasons), [libraryMatches, seasons]);
  const seasonOfEvent = useMemo(
    () => (code: string): number | undefined => eventDirectory.get(code)?.season ?? librarySeasonOf.get(code.toLowerCase()),
    [eventDirectory, librarySeasonOf]
  );

  const sessionsById = useMemo(() => new Map<string, PracticeSession>(sessions.map((s) => [s.id, s])), [sessions]);

  const archivedSet = useMemo(() => new Set(archivedCodes), [archivedCodes]);

  // Joined to the sessions once per DATA change; a filter change (event, game, accuracy) then only filters instead of rebuilding every entry.
  const joined = useMemo(() => joinEntries(allEntries, sessionsById), [allEntries, sessionsById]);

  const selection = useMemo(
    () => selectAnalyticsEntries({ entries: allEntries, joined, sessionsById, filters, activeEventCodes, gameFormIds }),
    [allEntries, joined, sessionsById, filters, activeEventCodes, gameFormIds]
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
    () => (code: string) => {
      // A name the shared store really found wins; one that is only the key (a program whose keys carry no season cannot be looked up by key) falls through
      // to the season list's name for the event, then the stored names.
      const found = resolvedNames[code];
      if (found && found.source !== "key") return found.name;
      return resolveEventName({ key: code, api: eventDirectory.get(code)?.name, stored: storedNames[code] }).name;
    },
    [resolvedNames, eventDirectory, storedNames]
  );

  const eventOptions = useMemo(() => {
    const options = new Map<string, EventOption>();
    const nameOf = eventNameOf;
    // Events are keyed by the app's own event key (`normalizeEventKey`): a legacy key and the key it is stored under are one event, listed once.
    const archivedKeys = new Set([...archivedSet].map((c) => normalizeEventKey(c)));
    const explicit = new Set(filters.events.kind === "custom" ? filters.events.codes.map((c) => normalizeEventKey(c)) : []);
    // An archived event is listed only while "Show archived events" is on, or when it is the explicit pick (so the select can still show it checked).
    const hidden = (code: string) => !filters.archived && archivedKeys.has(normalizeEventKey(code)) && !explicit.has(normalizeEventKey(code));
    const add = (code: string, name: string, active: boolean, noGameConfig = false, hasData = false) => {
      const key = normalizeEventKey(code);
      if (hidden(code) || options.has(key)) return;
      // An event of another game's season is not offered under this game, practice or not (an event nobody picked and whose season is not known stays).
      // An event WITH entries under this game always is: the entries carry the game's form, whatever season its key says.
      const season = seasonOfEvent(code);
      if (!noGameConfig && !hasData && !explicit.has(key) && !offeredUnderGame(season, gameSeason)) return;
      const event = eventDirectory.get(code) ?? null;
      options.set(key, { code, name, event, season: event?.season ?? season, active, count: 0, noGameConfig, archived: archivedKeys.has(key) });
    };

    if (filters.practice) {
      for (const m of libraryMatches) if (m.seasonId === filters.gameId) add(m.eventCode, nameOf(m.eventCode), false);
    } else {
      // Only the selected events of this game's season: a 2027 event has no entries under a 2025 game. Events with data are added below.
      for (const e of eventsOfGameSeason(activeEvents, gameSeason)) add(e.code, nameOf(e.code), !archivedKeys.has(normalizeEventKey(e.code)));
      // A team event whose season has no game config yet (the next, unannounced game) stays listed so it is not mysteriously missing, marked and never active.
      for (const e of activeEvents) if (unclaimed(e.season)) add(e.code, nameOf(e.code), false, true);
    }
    // Events with data under the current Game/Practice settings, whatever the Event filter says.
    const scopeAnyEvent = allEntries.filter((e) => isInScope(e, { ...filters, events: { kind: "all" } }, null, gameFormIds));
    for (const e of scopeAnyEvent) {
      add(e.eventCode, nameOf(e.eventCode), activeEventCodes.some((c) => sameEventCode(c, e.eventCode)) && !filters.practice && !archivedKeys.has(normalizeEventKey(e.eventCode)), false, true);
      const option = options.get(normalizeEventKey(e.eventCode));
      if (option) option.count += 1;
    }
    // Whatever was picked by hand is always an option, so the select can show it checked (a code the lists above do not know included).
    if (filters.events.kind === "custom") for (const code of filters.events.codes) add(code, nameOf(code), false, eventDirectory.get(code) ? unclaimed(eventDirectory.get(code)!.season) : false);

    return [...options.values()].sort(
      (a, b) =>
        Number(!!a.noGameConfig) - Number(!!b.noGameConfig) ||
        Number(b.active) - Number(a.active) ||
        (a.active && b.active ? activeEventCodes.indexOf(a.code) - activeEventCodes.indexOf(b.code) : 0) ||
        b.count - a.count ||
        a.name.localeCompare(b.name)
    );
  }, [allEntries, filters, libraryMatches, activeEvents, activeEventCodes, eventDirectory, gameFormIds, eventNameOf, gameSeason, archivedSet, seasonOfEvent, unclaimed]);

  // Names for every event that has data in scope (not just the ones passing the accuracy filter), so they don't flicker as the threshold changes.
  const nameRequests = useMemo(() => {
    const codes = [...new Set(selection.scope.map((e) => e.eventCode))];
    return codes.map((code) => ({ code, season: eventDirectory.get(code)?.season ?? gameSeason }));
  }, [selection.scope, eventDirectory, gameSeason]);
  const teamNames = useTeamNames(nameRequests);

  const teamStats = useMemo(() => buildAllTeamStats(selection.used, schema, teamNames), [selection.used, schema, teamNames]);

  const value = useMemo<AnalyticsDataValue>(
    () => ({
      loaded: entriesLoaded && (!filters.practice || sessionsLoaded),
      allEntries,
      sessionsById,
      schema,
      season: gameSeason,
      activeEventCodes,
      activeEvents,
      primaryCode,
      eventDirectory,
      eventNameOf,
      libraryMatches,
      eventOptions,
      selection,
      archivedCodes: archivedSet,
      joined,
      hasArchived: archivedCodes.length > 0,
      seasons: allSeasons,
      upcomingGames,
      teamStats,
      teamNames,
    }),
    [entriesLoaded, sessionsLoaded, filters.practice, allEntries, sessionsById, schema, activeEventCodes, activeEvents, primaryCode, eventDirectory, eventNameOf, libraryMatches, eventOptions, selection, archivedSet, joined, archivedCodes, allSeasons, upcomingGames, gameSeason, teamStats, teamNames]
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
  const realGameFormIds = useGameFormIds(filters.gameId);
  const gameFormIds = upcomingGameFor(data.upcomingGames, filters.gameId) ? NO_FORM_IDS : realGameFormIds;
  const applyAccuracy = options?.applyAccuracy ?? true;
  const includeExcluded = options?.includeExcluded ?? false;
  const isStandard = filtersOverride === undefined && applyAccuracy && !includeExcluded;

  const custom = useMemo(
    () =>
      isStandard
        ? null
        : selectAnalyticsEntries(
            { entries: data.allEntries, joined: data.joined, sessionsById: data.sessionsById, filters, activeEventCodes: data.activeEventCodes, gameFormIds },
            { applyAccuracy, includeExcluded }
          ),
    [isStandard, data.allEntries, data.joined, data.sessionsById, filters, data.activeEventCodes, applyAccuracy, includeExcluded, gameFormIds]
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
    pickDefaultEvent({ events: data.activeEvents.filter((e) => !data.archivedCodes.has(e.code)), seasons: data.seasons, seasonId: filters.gameId }) ??
    data.eventOptions.find((o) => !o.noGameConfig)?.code ??
    null;
  const code = resolveSingleEventCode(filters, fallback);
  // A picked code comes back from the URL upper-cased, so fall back to the option (matched without case) when the directory has it under another case.
  const option = code ? data.eventOptions.find((o) => sameEventCode(o.code, code)) : undefined;
  const event = code ? (data.eventDirectory.get(code) ?? option?.event ?? null) : null;
  return { code, event, noGameConfig: option?.noGameConfig ?? (event !== null && !hasGameConfig(data.seasons, event.season)) };
}

/** Per-team stats for the standard selection — memoized once in the provider and shared by Team Averages, Rankings, and Team Profile. */
export function useTeamStats(): { teamStats: TeamStats[]; teamNames: ReadonlyMap<number, string>; loaded: boolean; schema: Form; entries: AnalyticsEntry[] } {
  const data = useAnalyticsData();
  return { teamStats: data.teamStats, teamNames: data.teamNames, loaded: data.loaded, schema: data.schema, entries: data.selection.used };
}
