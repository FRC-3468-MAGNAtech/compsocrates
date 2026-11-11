import "server-only";
import { isTbaEventKey, normalizeEventKey } from "@/config/event";
import { FrcApiError, frcFetch, type FrcFetchOptions } from "./http";
import {
  toEventInfo,
  toEventMatches,
  toEventRanking,
  toEventTeam,
  type TbaEventRaw,
  type TbaMatchRaw,
  type TbaRankingsPayload,
  type TbaTeamRaw,
} from "./tba-map";
import type { EventInfo, EventMatch, EventRanking, EventTeam, MatchType } from "@/lib/events/types";

/**
 * The Blue Alliance v3 client (server-only). Every function throws `FrcApiError`; callers choose how
 * to present that. `tbaOptions.apiKey` is the seam for a per-team TBA key: a server caller that has
 * decrypted a team's own key can pass it, otherwise the single `TBA_API_KEY` is used.
 */

export type TbaOptions = Pick<FrcFetchOptions, "apiKey">;

/** A usable TBA key for `eventCode`, or null for the `app-testing` sentinel and other non-event ids. */
export function tbaKeyFor(eventCode: string): string | null {
  const key = normalizeEventKey(eventCode);
  return isTbaEventKey(key) ? key : null;
}

export async function fetchTbaEvents(season: number, options?: TbaOptions): Promise<EventInfo[]> {
  const raw = await frcFetch<TbaEventRaw[]>("tba", `/events/${season}`, options);
  return (Array.isArray(raw) ? raw : []).map((e) => toEventInfo(e, season));
}

export async function fetchTbaEvent(eventCode: string, options?: TbaOptions): Promise<EventInfo | null> {
  const key = tbaKeyFor(eventCode);
  if (!key) return null;
  try {
    return toEventInfo(await frcFetch<TbaEventRaw>("tba", `/event/${key}`, options));
  } catch (error) {
    if (error instanceof FrcApiError && error.code === "not_found") return null;
    throw error;
  }
}

export async function fetchTbaTeams(eventCode: string, options?: TbaOptions): Promise<EventTeam[]> {
  const key = tbaKeyFor(eventCode);
  if (!key) return [];
  const raw = await frcFetch<TbaTeamRaw[]>("tba", `/event/${key}/teams`, options);
  return (Array.isArray(raw) ? raw : []).map(toEventTeam).sort((a, b) => a.teamNumber - b.teamNumber);
}

/** One team by number, or null when TBA has no such team. */
export async function fetchTbaTeam(teamNumber: number, options?: TbaOptions): Promise<EventTeam | null> {
  try {
    return toEventTeam(await frcFetch<TbaTeamRaw>("tba", `/team/frc${teamNumber}`, options));
  } catch (error) {
    if (error instanceof FrcApiError && error.code === "not_found") return null;
    throw error;
  }
}

export async function fetchTbaRankings(eventCode: string, options?: TbaOptions): Promise<EventRanking[]> {
  const key = tbaKeyFor(eventCode);
  if (!key) return [];
  // TBA answers an event with no rankings yet with `null`.
  const payload = await frcFetch<TbaRankingsPayload>("tba", `/event/${key}/rankings`, options);
  return (payload?.rankings ?? []).map(toEventRanking).filter((r): r is EventRanking => r !== null);
}

export async function fetchTbaMatches(
  eventCode: string,
  matchType: Exclude<MatchType, "Practice">,
  options?: TbaOptions
): Promise<EventMatch[]> {
  const key = tbaKeyFor(eventCode);
  if (!key) return [];
  const raw = await frcFetch<TbaMatchRaw[]>("tba", `/event/${key}/matches`, options);
  return toEventMatches(Array.isArray(raw) ? raw : [], matchType);
}
