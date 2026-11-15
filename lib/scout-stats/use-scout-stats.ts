"use client";

import { useMemo } from "react";
import { useProgramConfig } from "@/lib/program/context";
import { useProgramData } from "@/lib/program/data";
import type { FirestoreFailure } from "@/lib/firestore-errors";
import { useTeamEventAttendance } from "@/lib/event-attendance";
import { useAllLibraryMatches } from "@/lib/match-library";
import { useTeamPracticeSessions } from "@/lib/practice-sessions";
import type { RoleId } from "@/lib/roles";
import { useTeamScoutEntries, type ScoutEntry } from "@/lib/scout-entries";
import { useTeamMembers } from "@/lib/team-members";
import { eventLabel } from "@/lib/events/names";
import type { EventInfo } from "@/lib/events/types";
import { useEventNames } from "@/lib/events/use-event-names";
import { computeScoutStats } from "./engine";
import type { RankingBasisId, RealEventCalculationScope, ScoutCategory, ScoutStatsResult } from "./types";

/** Every realtime source Scout Accuracy / My Scouting need, wired together — kept separate from the pure `computeScoutStats` so that function stays unit-testable with plain fixtures. */
/** One data source that failed: `title` names it in the user's words ("Could not load practice sessions"), `failure` carries the code and path. */
export type SourceError = { source: "members" | "sessions" | "entries" | "library" | "attendance"; title: string; failure: FirestoreFailure };

/**
 * The sources that answered with an error, each named. Pure: the page shows one message per entry while the rest of it still renders what it has.
 * A source that failed has already flipped its own `loaded`, so a failure never leaves the page on "loading".
 */
export function collectSourceErrors(errors: { members: FirestoreFailure | null; sessions: FirestoreFailure | null; entries: FirestoreFailure | null; library: FirestoreFailure | null; attendance: FirestoreFailure | null }): SourceError[] {
  const titles: Record<SourceError["source"], string> = {
    members: "Could not load team members",
    sessions: "Could not load practice sessions",
    entries: "Could not load scout entries",
    library: "Could not load library matches",
    attendance: "Could not load event attendance",
  };
  return (Object.keys(titles) as SourceError["source"][]).flatMap((source) => (errors[source] ? [{ source, title: titles[source], failure: errors[source]! }] : []));
}

export function useScoutStatsSources(teamId: string | null) {
  // Practice sessions and the match library are the default program's collections: a program without them connected asks for neither (a null team reads nothing).
  const { practice, library } = useProgramConfig().connection.features;
  const { members, loaded: membersLoaded, error: membersError } = useTeamMembers(teamId);
  const { sessions, loaded: sessionsLoaded, error: sessionsError } = useTeamPracticeSessions(practice ? teamId : null);
  const { entries, loaded: entriesLoaded, error: entriesError } = useTeamScoutEntries(teamId);
  const { matches, loaded: matchesLoaded, error: libraryError } = useAllLibraryMatches(library);
  const { attendance, loaded: attendanceLoaded, error: attendanceError } = useTeamEventAttendance(teamId);

  const libraryMatchesById = useMemo(() => new Map(matches.map((m) => [m.id, m])), [matches]);
  const loaded = membersLoaded && sessionsLoaded && entriesLoaded && matchesLoaded && attendanceLoaded;
  const sourceErrors = useMemo(
    () => collectSourceErrors({ members: membersError, sessions: sessionsError ?? null, entries: entriesError, library: libraryError ?? null, attendance: attendanceError }),
    [membersError, sessionsError, entriesError, libraryError, attendanceError]
  );

  return { members, sessions, entries, libraryMatchesById, attendance, loaded, sessionsError, sourceErrors };
}

/**
 * Distinct real-event event codes the team has data for, most-recently-scouted first — what the Real Event Calculation dropdown's per-event options come from (it reads `scoutEntries` rather than the Assignments page).
 *
 * FIX1: pass the team's active events (primary first) and they lead the list —
 * named, and present even before anything has been scouted for them — ahead
 * of the data-only events. With no active events this is unchanged.
 */
export function useRealEventOptions(entries: ScoutEntry[], activeEvents: EventInfo[] = []): { eventCode: string; eventName: string }[] {
  // Data-only events are named through the shared chain (API, stored, static, key) instead of showing as a bare key.
  const dataCodes = useMemo(() => [...new Set(entries.filter((e) => e.source === "event" || e.source === "live").map((e) => e.eventCode))], [entries]);
  const names = useEventNames(dataCodes);
  return useMemo(() => {
    const latestByCode = new Map<string, string>();
    for (const e of entries) {
      if (e.source !== "event" && e.source !== "live") continue;
      const existing = latestByCode.get(e.eventCode);
      if (!existing || e.submittedAt > existing) latestByCode.set(e.eventCode, e.submittedAt);
    }
    const active = activeEvents.map((e) => ({ eventCode: e.code, eventName: e.name }));
    const activeCodes = new Set(active.map((e) => e.eventCode));
    const dataOnly = [...latestByCode.entries()]
      .filter(([eventCode]) => !activeCodes.has(eventCode))
      .sort((a, b) => b[1].localeCompare(a[1]))
      .map(([eventCode]) => ({ eventCode, eventName: names[eventCode]?.name ?? eventLabel({ key: eventCode }) }));
    return [...active, ...dataOnly];
  }, [entries, activeEvents, names]);
}

export type UseScoutStatsOptions = {
  teamId: string | null;
  category: ScoutCategory;
  roleFilter: RoleId[];
  eventFilter: string[];
  rankingBasis: RankingBasisId;
  realEventScope: RealEventCalculationScope;
  /** Count only practice sessions of this game (a season id, e.g. "rebuilt"), as old CS averaged one game at a time. Null counts every game. */
  seasonId?: string | null;
  /** The admin sees the "unassigned" row (data that belongs to no member). */
  includeUnassigned?: boolean;
};

/** A program's entry-to-game rule: the season whose built-in form the entry was scouted with (null when the form is not one of the program's). */
export function seasonOfEntryFor(seasons: readonly { id: string; formId: string }[]): (entry: ScoutEntry) => string | null {
  return (e) => seasons.find((s) => s.formId === e.formId)?.id ?? null;
}

/** Combines `useScoutStatsSources` with `computeScoutStats`, memoized on every input that actually changes the result. */
export function useScoutStats({ teamId, category, roleFilter, eventFilter, rankingBasis, realEventScope, seasonId = null, includeUnassigned = false }: UseScoutStatsOptions): {
  result: ScoutStatsResult | null;
  loaded: boolean;
  sources: ReturnType<typeof useScoutStatsSources>;
} {
  const sources = useScoutStatsSources(teamId);
  const { members, entries, libraryMatchesById, attendance, loaded } = sources;
  const sessions = useMemo(() => (seasonId ? sources.sessions.filter((s) => s.seasonId === seasonId) : sources.sessions), [sources.sessions, seasonId]);
  // A program with its own data port counts "total entries" from the entries alone and tells an entry's game by its form; the default program keeps its rules.
  const port = useProgramData();
  const seasonOfEntry = useMemo(() => (port ? seasonOfEntryFor(port.games.seasons) : undefined), [port]);

  const result = useMemo(() => {
    if (!loaded) return null;
    return computeScoutStats({
      category,
      members,
      sessions,
      entries,
      libraryMatchesById,
      attendance,
      roleFilter,
      eventFilter,
      rankingBasis,
      realEventScope,
      seasonId,
      seasonOfEntry,
      entriesOnlyCount: port != null,
      includeUnassigned: includeUnassigned && port != null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    loaded,
    category,
    members,
    sessions,
    entries,
    libraryMatchesById,
    attendance,
    roleFilter,
    eventFilter,
    rankingBasis,
    realEventScope.eventCode,
    realEventScope.variant,
    seasonId,
    seasonOfEntry,
    port,
    includeUnassigned,
  ]);

  return { result, loaded, sources };
}
