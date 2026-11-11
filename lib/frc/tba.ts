import "server-only";
import { isTbaEventKey, normalizeEventKey } from "@/config/event";
import { FrcApiError, frcFetch } from "./http";
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
 * to present that. The key is the single server key `NEXT_PUBLIC_TBA_API_KEY` (read on the server only, through
 * lib/server/env.ts); there are no per-team keys.
 */

/** A usable TBA key for `eventCode`, or null for the `app-testing` sentinel and other non-event ids. */
export function tbaKeyFor(eventCode: string): string | null {
  const key = normalizeEventKey(eventCode);
  return isTbaEventKey(key) ? key : null;
}

export async function fetchTbaEvents(season: number): Promise<EventInfo[]> {
  const raw = await frcFetch<TbaEventRaw[]>("tba", `/events/${season}`);
  return (Array.isArray(raw) ? raw : []).map((e) => toEventInfo(e, season));
}

export async function fetchTbaEvent(eventCode: string): Promise<EventInfo | null> {
  const key = tbaKeyFor(eventCode);
  if (!key) return null;
  try {
    return toEventInfo(await frcFetch<TbaEventRaw>("tba", `/event/${key}`));
  } catch (error) {
    if (error instanceof FrcApiError && error.code === "not_found") return null;
    throw error;
  }
}

export async function fetchTbaTeams(eventCode: string): Promise<EventTeam[]> {
  const key = tbaKeyFor(eventCode);
  if (!key) return [];
  const raw = await frcFetch<TbaTeamRaw[]>("tba", `/event/${key}/teams`);
  return (Array.isArray(raw) ? raw : []).map(toEventTeam).sort((a, b) => a.teamNumber - b.teamNumber);
}

/** One team by number, or null when TBA has no such team. */
export async function fetchTbaTeam(teamNumber: number): Promise<EventTeam | null> {
  try {
    return toEventTeam(await frcFetch<TbaTeamRaw>("tba", `/team/frc${teamNumber}`));
  } catch (error) {
    if (error instanceof FrcApiError && error.code === "not_found") return null;
    throw error;
  }
}

export async function fetchTbaRankings(eventCode: string): Promise<EventRanking[]> {
  const key = tbaKeyFor(eventCode);
  if (!key) return [];
  // TBA answers an event with no rankings yet with `null`.
  const payload = await frcFetch<TbaRankingsPayload>("tba", `/event/${key}/rankings`);
  return (payload?.rankings ?? []).map(toEventRanking).filter((r): r is EventRanking => r !== null);
}

export async function fetchTbaMatches(
  eventCode: string,
  matchType: Exclude<MatchType, "Practice">
): Promise<EventMatch[]> {
  const key = tbaKeyFor(eventCode);
  if (!key) return [];
  const raw = await frcFetch<TbaMatchRaw[]>("tba", `/event/${key}/matches`);
  return toEventMatches(Array.isArray(raw) ? raw : [], matchType);
}
