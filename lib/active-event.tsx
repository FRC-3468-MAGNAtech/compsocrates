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
import { setActiveEvent as setTeamActiveEvent, useTeamDoc } from "@/lib/team";
import { readActiveEvents } from "@/lib/active-events";
import { getEventStatus } from "@/lib/events/event-status";
import type { EventNameState } from "@/lib/events/name-store";
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
function useEnrichedEvents(events: EventInfo[], stored: Record<string, string> | undefined): { events: EventInfo[]; names: Record<string, EventNameState> } {
  const keys = useMemo(() => events.map((e) => e.code), [events]);
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
 */
export function useActiveEvents() {
  const { profile } = useAuth();
  const teamId = profile?.teamId ?? null;
  const { team, loaded } = useTeamDoc(teamId);

  const state = useMemo(() => readActiveEvents(team), [team]);
  // Names the team doc stored beside selectedEvents (additive field): the second step of the name chain, shared app-wide.
  const stored = useMemo(() => collectStoredEventNames(team?.selectedEventNames), [team]);
  useRegisterStoredEventNames(stored);
  const { events, names: eventNames } = useEnrichedEvents(state.events, stored);
  const primary = useMemo(() => events.find((e) => e.code === state.primaryCode) ?? null, [events, state.primaryCode]);

  const isActive = useCallback((code: string) => state.events.some((e) => e.code === code), [state.events]);

  return { events, primary, primaryCode: state.primaryCode, isActive, loaded, eventNames };
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
