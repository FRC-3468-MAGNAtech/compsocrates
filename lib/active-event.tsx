"use client";

// Thin shims over lib/team.ts + lib/active-events.ts. The team's active
// events live on the team doc (realtime, team-wide), not localStorage.
// Resolves `teamId` from the signed-in user's own profile (lib/team.ts no
// longer assumes a single fixed team doc) so
// no call site needs to pass one in.
//
// D1: the team doc is CS's, where the only event field is `selectedEvents` (TBA keys). `useTeamDoc` derives placeholder
// events (name = key, no dates) from it; this hook enriches them with the real event (name, dates, status) through the
// event layer, ONE season-wide request per season (lib/events/name-store.ts). No write ever happens from here: there is no
// migration, `selectedEvents` is the single source of truth (the Event Select page writes the additive `selectedEventNames`).
import { useCallback, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useProgramConfig } from "@/lib/program/context";
import { setActiveEvent as setTeamActiveEvent, useTeamDoc } from "@/lib/team";
import { readActiveEvents } from "@/lib/active-events";
import { getEventStatus } from "@/lib/events/event-status";
import type { EventNameState } from "@/lib/events/name-store";
import { readArchivedEvents, splitArchived, visibleEventsState } from "@/lib/events/archive";
import { collectStoredEventNames } from "@/lib/events/stored-names";
import type { EventInfo } from "@/lib/events/types";
import { useEventNames, useRegisterStoredEventNames } from "@/lib/events/use-event-names";

/** True for the placeholder `data/cs/teams.ts` builds from a bare key (no dates yet). */
const isPlaceholder = (event: EventInfo) => event.dateStart === "" && event.dateEnd === "";

/**
 * Names and enriches the placeholder events. One season-wide request names every event of that season and carries its
 * dates (it replaces the old getEvent() call per placeholder, whose failures were swallowed and never retried). The name
 * chain is: API, then the team doc's stored `selectedEventNames`, then the static table (config/event-names.ts), then the
 * raw key. A failure is never hidden: each event reports `{ name, source, status: "loading" | "ready" | "fallback", error? }`
 * (returned as `eventNames`) and the Event Select page tells admins why.
 */
function useEnrichedEvents(events: EventInfo[], stored: Record<string, string> | undefined, lookup: boolean): { events: EventInfo[]; names: Record<string, EventNameState> } {
  // A program whose team doc holds complete event records (`eventLookup` off) asks the events API for nothing: there is nothing to enrich.
  const keys = useMemo(() => (lookup ? events.map((e) => e.code) : []), [events, lookup]);
  const names = useEventNames(keys, { stored });
  const enriched = useMemo(
    () =>
      events.map((e) => {
        const state = names[e.code];
        if (!state || !isPlaceholder(e)) return e;
        const base = state.info ? { ...state.info, status: getEventStatus(state.info) } : e;
        return { ...base, name: state.name };
      }),
    [events, names]
  );
  return { events: enriched, names };
}

/**
 * FIX1: every active event, the primary one, and an `isActive(code)` check —
 * realtime, shared by every page that used to assume exactly one active event.
 * `events` is in selection order; `primary` is the first one (the team doc's
 * `selectedEvents[0]`; null when nothing is active).
 *
 * Session D: `events` / `primary` / `primaryCode` are what a PICKER offers, so archived events (`archivedEvents` on the
 * team doc) are left out, and an archived primary falls back to the first current event (or null: the empty state).
 * Pages that read across events keep everything: `allEvents` (archived included, selection order), `archivedEvents`,
 * `archivedCodes`, `storedPrimaryCode`, and `isActive` (still true for an archived selected event). Archiving never removes a code from
 * `selectedEvents` and never filters a data read.
 */
export function useActiveEvents() {
  const { profile } = useAuth();
  const teamId = profile?.teamId ?? null;
  const { team, loaded } = useTeamDoc(teamId);

  const state = useMemo(() => readActiveEvents(team), [team]);
  // Names the team doc stored beside selectedEvents (additive field): the second step of the name chain, shared app-wide.
  const stored = useMemo(() => collectStoredEventNames(team?.selectedEventNames), [team]);
  useRegisterStoredEventNames(stored);
  const { eventLookup } = useProgramConfig().connection.features;
  const { events, names: eventNames } = useEnrichedEvents(state.events, stored, eventLookup);
  const archivedCodes = useMemo(() => readArchivedEvents(team?.archivedEvents), [team]);
  const visible = useMemo(() => visibleEventsState({ events, primaryCode: state.primaryCode }, archivedCodes), [events, archivedCodes, state.primaryCode]);
  const archivedEvents = useMemo(() => splitArchived(events, archivedCodes).archived, [events, archivedCodes]);
  const primary = useMemo(() => visible.events.find((e) => e.code === visible.primaryCode) ?? null, [visible]);

  const isActive = useCallback((code: string) => state.events.some((e) => e.code === code), [state.events]);

  return { events: visible.events, primary, primaryCode: visible.primaryCode, isActive, loaded, eventNames, allEvents: events, archivedEvents, archivedCodes, storedPrimaryCode: state.primaryCode };
}

/** The primary active event only — kept for callers that genuinely only need one. Anything that picks or filters by event should use `useActiveEvents()`. */
export function useActiveEvent() {
  const { profile } = useAuth();
  const teamId = profile?.teamId ?? null;
  const { primary, isActive } = useActiveEvents();

  const setActiveEvent = (event: EventInfo | null) => {
    if (!teamId) return Promise.resolve();
    return setTeamActiveEvent(teamId, event);
  };

  return { activeEvent: primary, setActiveEvent, isActive };
}
