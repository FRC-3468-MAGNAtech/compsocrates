"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { normalizeEventKey } from "@/config/event";
import { eventNameStore } from "@/lib/events/event-names";
import { isAdminFixableEventError, lookupSeasonForKey, type EventNameState } from "@/lib/events/name-store";
import { collectStoredEventNames } from "@/lib/events/stored-names";
import type { ActionError } from "@/lib/events/types";
import { useProgramConfig } from "@/lib/program/context";

/**
 * React hooks over the event-name store (`lib/events/name-store.ts`). Every component that shows an event reads its name
 * here (or through `<EventName>`), so the same chain applies everywhere: API name, then a name stored in the team's data,
 * then the static table, then the raw key. A key's season is requested once per tab however many components ask.
 *
 * Rendering is synchronous: the first render already shows the best known name (stored, then static), and the API answer
 * swaps in when it arrives. Nothing here throws.
 */

const store = eventNameStore;

function useStoreVersion(): number {
  return useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
}

/** Asks the store for every season the keys belong to, and asks again after a cooldown while a transient failure lasts. */
function useEnsureSeasons(keySignature: string): void {
  useEffect(() => {
    const seasons = new Set<number>();
    for (const key of keySignature ? keySignature.split("|") : []) {
      const season = lookupSeasonForKey(key);
      if (season !== null) seasons.add(season);
    }
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const run = (season: number) => {
      void store.ensureSeason(season).then(() => {
        if (cancelled || !store.canAutoRetry(season)) return;
        timers.push(setTimeout(() => run(season), store.cooldownMs + 250));
      });
    };
    for (const season of seasons) run(season);
    return () => {
      cancelled = true;
      for (const timer of timers) clearTimeout(timer);
    };
  }, [keySignature]);
}

/**
 * The resolved name and lookup state for each key, by key as given. `stored` is a `{ eventKey: name }` record of names the
 * caller already holds (the team doc's `selectedEventNames`, rows' `eventName`; see `collectStoredEventNames`): it is checked
 * before names registered app-wide. Keep it referentially stable (memoize it).
 */
export function useEventNames(keys: readonly string[], opts?: { stored?: Readonly<Record<string, string>> }): Record<string, EventNameState> {
  const version = useStoreVersion();
  const keySignature = useMemo(() => [...new Set(keys.filter(Boolean))].join("|"), [keys]);
  // Names are looked up from the events API only in a program that has it connected for this purpose; otherwise a name comes from the team's own data,
  // the static table, or the key (the resolution below still runs, it just never asks the API).
  const { eventLookup } = useProgramConfig().connection.features;
  useEnsureSeasons(eventLookup ? keySignature : "");
  const stored = opts?.stored;
  return useMemo(() => {
    void version; // a store change (an answer, a failure, new stored names) re-resolves
    const out: Record<string, EventNameState> = {};
    for (const key of keySignature ? keySignature.split("|") : []) out[key] = store.resolve(key, stored);
    return out;
  }, [keySignature, stored, version]);
}

/** One key. An empty key resolves to the "Unknown event" placeholder without any request. */
export function useEventName(key: string, opts?: { stored?: Readonly<Record<string, string>>; name?: string | null }): EventNameState {
  const hint = opts?.name;
  const stored = useMemo(() => {
    const normalized = normalizeEventKey(key);
    return hint && normalized ? { ...opts?.stored, [normalized]: opts?.stored?.[normalized] ?? hint } : opts?.stored;
  }, [key, hint, opts?.stored]);
  const keys = useMemo(() => [key], [key]);
  const names = useEventNames(keys, { stored });
  return names[key] ?? store.resolve(key, stored);
}

/** Registers names the caller found in loaded data (library matches, practice sessions) for every other component. */
export function useRegisterStoredEventNames(names: Readonly<Record<string, string>> | null | undefined): void {
  useEffect(() => {
    store.addStored(names);
  }, [names]);
}

export type EventNameFailure = { error: ActionError; season: number; retry: () => void };

/** The first lookup failure an admin can fix (missing TBA key, server sign-in not configured, key rejected), or null. */
export function useEventNameFailure(): EventNameFailure | null {
  const version = useStoreVersion();
  const retry = useCallback((season: number) => void store.ensureSeason(season, { force: true }), []);
  return useMemo(() => {
    void version;
    const failure = store.failures().find((f) => isAdminFixableEventError(f.error));
    return failure ? { error: failure.error, season: failure.season, retry: () => retry(failure.season) } : null;
  }, [version, retry]);
}

/**
 * `events` with each `name` replaced by the resolved one (API, then stored, then static, then the key). A name the event
 * already carries counts as a stored name, so a placeholder whose name is its key is improved and a real name is kept.
 * The list is returned as is (same array) when nothing changed.
 */
export function useNamedEvents<T extends { code: string; name: string }>(events: readonly T[]): T[] {
  const keys = useMemo(() => events.map((e) => e.code), [events]);
  const hints = useMemo(() => collectStoredEventNames(events.map((e) => ({ eventKey: e.code, eventName: e.name }))), [events]);
  const names = useEventNames(keys, { stored: hints });
  return useMemo(() => {
    let changed = false;
    const out = events.map((e) => {
      const name = names[e.code]?.name;
      if (!name || name === e.name) return e;
      changed = true;
      return { ...e, name };
    });
    return changed ? out : (events as T[]);
  }, [events, names]);
}
