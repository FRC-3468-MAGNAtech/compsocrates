import type { ActiveEventsState } from "@/lib/active-events";
import type { EventInfo } from "@/lib/events/types";

// Event archiving (Session D): a per-team list of event codes (`archivedEvents`, ADDITIVE, written beside `selectedEvents`)
// that the event PICKERS skip. Archiving never deletes anything and never removes a code from `selectedEvents`: it changes
// which events are offered, not which data is read. Pure (no React, no Firebase), so it is unit tested.

/** Clean list of archived codes: strings only, trimmed, de-duplicated, first-seen order. Anything else reads as none. */
export function readArchivedEvents(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const v of value) if (typeof v === "string" && v.trim() !== "") seen.add(v.trim());
  return [...seen];
}

/** The list after archiving `codes` (already-archived codes are kept once). */
export function archiveCodes(archived: readonly string[], codes: readonly string[]): string[] {
  return readArchivedEvents([...archived, ...codes]);
}

/** The list after restoring `code`. */
export function restoreCode(archived: readonly string[], code: string): string[] {
  return archived.filter((c) => c !== code);
}

export type ArchiveSplit<T extends { code: string }> = { current: T[]; archived: T[] };

/** Events split into current and archived, each keeping its order. */
export function splitArchived<T extends { code: string }>(events: readonly T[], archived: readonly string[]): ArchiveSplit<T> {
  const set = new Set(archived);
  return { current: events.filter((e) => !set.has(e.code)), archived: events.filter((e) => set.has(e.code)) };
}

/**
 * The active-events state with archived events left out: what every picker sees. The primary stays the stored primary while
 * it is current; when it was archived the first current event takes over, and with none left the state is empty (the empty
 * state), never a stale selection.
 */
export function visibleEventsState(state: ActiveEventsState, archived: readonly string[]): ActiveEventsState {
  const { current } = splitArchived(state.events, archived);
  const primaryCode = current.some((e) => e.code === state.primaryCode) ? state.primaryCode : (current[0]?.code ?? null);
  return { events: current, primaryCode };
}

/** The events "Archive all previous seasons" would archive: current (not archived) events from a season before `currentSeason`. */
export function previousSeasonEvents<T extends Pick<EventInfo, "code" | "season">>(events: readonly T[], archived: readonly string[], currentSeason: number): T[] {
  const set = new Set(archived);
  return events.filter((e) => !set.has(e.code) && typeof e.season === "number" && e.season < currentSeason);
}
