import "server-only";
import { isTbaEventKey, normalizeEventKey } from "@/config/event";
import { FrcApiError, frcFetch, type FrcFetchOptions } from "./http";
import {
  toFtcEvent,
  toFtcMatches,
  toFtcRanking,
  toFtcTeam,
  type TbaEventRaw,
  type TbaMatchRaw,
  type TbaRankingsPayload,
  type TbaTeamRaw,
} from "./tba-map";
import type { FtcEvent, FtcMatch, FtcRanking, FtcTeam, MatchType } from "@/lib/ftc/types";

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

export async function fetchTbaEvents(season: number, options?: TbaOptions): Promise<FtcEvent[]> {
  const raw = await frcFetch<TbaEventRaw[]>("tba", `/events/${season}`, options);
  return (Array.isArray(raw) ? raw : []).map((e) => toFtcEvent(e, season));
}

export async function fetchTbaEvent(eventCode: string, options?: TbaOptions): Promise<FtcEvent | null> {
  const key = tbaKeyFor(eventCode);
  if (!key) return null;
  try {
    return toFtcEvent(await frcFetch<TbaEventRaw>("tba", `/event/${key}`, options));
  } catch (error) {
    if (error instanceof FrcApiError && error.code === "not_found") return null;
    throw error;
  }
}

export async function fetchTbaTeams(eventCode: string, options?: TbaOptions): Promise<FtcTeam[]> {
  const key = tbaKeyFor(eventCode);
  if (!key) return [];
  const raw = await frcFetch<TbaTeamRaw[]>("tba", `/event/${key}/teams`, options);
  return (Array.isArray(raw) ? raw : []).map(toFtcTeam).sort((a, b) => a.teamNumber - b.teamNumber);
}

/** One team by number, or null when TBA has no such team. */
export async function fetchTbaTeam(teamNumber: number, options?: TbaOptions): Promise<FtcTeam | null> {
  try {
    return toFtcTeam(await frcFetch<TbaTeamRaw>("tba", `/team/frc${teamNumber}`, options));
  } catch (error) {
    if (error instanceof FrcApiError && error.code === "not_found") return null;
    throw error;
  }
}

export async function fetchTbaRankings(eventCode: string, options?: TbaOptions): Promise<FtcRanking[]> {
  const key = tbaKeyFor(eventCode);
  if (!key) return [];
  // TBA answers an event with no rankings yet with `null`.
  const payload = await frcFetch<TbaRankingsPayload>("tba", `/event/${key}/rankings`, options);
  return (payload?.rankings ?? []).map(toFtcRanking).filter((r): r is FtcRanking => r !== null);
}

export async function fetchTbaMatches(
  eventCode: string,
  matchType: Exclude<MatchType, "Practice">,
  options?: TbaOptions
): Promise<FtcMatch[]> {
  const key = tbaKeyFor(eventCode);
  if (!key) return [];
  const raw = await frcFetch<TbaMatchRaw[]>("tba", `/event/${key}/matches`, options);
  return toFtcMatches(Array.isArray(raw) ? raw : [], matchType);
}
