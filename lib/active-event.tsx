"use client";

// Thin shims over lib/team.ts + lib/active-events.ts. The team's active
// events live on the team doc (realtime, team-wide), not localStorage.
// Resolves `teamId` from the signed-in user's own profile (lib/team.ts no
// longer assumes a single fixed team doc — see docs/ASSUMPTIONS.md, P1b) so
// no call site needs to pass one in.
//
// D1: the team doc is CS's, where the only event field is `selectedEvents` (TBA keys). `useTeamDoc` derives placeholder
// events (name = key, no dates) from it; this hook enriches them with the real event (name, dates, status) through the
// event layer, once per event per tab. No write ever happens from here: there is no migration, `selectedEvents` is the
// single source of truth.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { getEvent } from "@/lib/events/actions";
import { setActiveEvent as setTeamActiveEvent, useTeamDoc } from "@/lib/team";
import { readActiveEvents } from "@/lib/active-events";
import { getEventStatus } from "@/lib/ftc/event-status";
import type { FtcEvent } from "@/lib/ftc/types";

/** Session cache of enriched events by code, shared by every component calling the hooks below. */
const enriched = new Map<string, FtcEvent>();
const inFlight = new Set<string>();

/** True for the placeholder `data/cs/teams.ts` builds from a bare key (no dates yet). */
const isPlaceholder = (event: FtcEvent) => event.dateStart === "" && event.dateEnd === "";

function useEnrichedEvents(events: FtcEvent[]): FtcEvent[] {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    for (const event of events) {
      if (!isPlaceholder(event) || enriched.has(event.code) || inFlight.has(event.code)) continue;
      inFlight.add(event.code);
      getEvent(event.code, event.season)
        .then((result) => {
          if (result.ok && result.data) {
            enriched.set(event.code, { ...result.data, status: getEventStatus(result.data) });
            setVersion((v) => v + 1);
          }
        })
        .catch(() => {
          // Best-effort: the placeholder (name = TBA key) keeps working.
        })
        .finally(() => inFlight.delete(event.code));
    }
  }, [events]);

  // `version` is read so a finished lookup re-renders the memo below.
  return useMemo(() => events.map((e) => (isPlaceholder(e) ? (enriched.get(e.code) ?? e) : e)), [events, version]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const events = useEnrichedEvents(state.events);
  const primary = useMemo(() => events.find((e) => e.code === state.primaryCode) ?? null, [events, state.primaryCode]);

  const isActive = useCallback((code: string) => state.events.some((e) => e.code === code), [state.events]);

  return { events, primary, primaryCode: state.primaryCode, isActive, loaded };
}

/** The primary active event only — kept for callers that genuinely only need one. Anything that picks or filters by event should use `useActiveEvents()`. */
export function useActiveEvent() {
  const { profile } = useAuth();
  const teamId = profile?.teamId ?? null;
  const { primary, isActive } = useActiveEvents();

  const setActiveEvent = (event: FtcEvent | null) => {
    if (!teamId) return Promise.resolve();
    return setTeamActiveEvent(teamId, event);
  };

  return { activeEvent: primary, setActiveEvent, isActive };
}
