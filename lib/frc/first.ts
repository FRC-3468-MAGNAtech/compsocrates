import "server-only";
import { EVENT_CONFIG, getFirstEventCodeFromTbaKey, getSeasonFromEventKey } from "@/config/event";
import { FrcApiError, frcFetch } from "./http";
import { firstRankingsToEventRankings, firstScheduleToEventMatches, firstTeamsToEventTeams } from "./first-map";
import { tbaKeyFor } from "./tba";
import type { EventMatch, EventRanking, EventTeam, MatchType } from "@/lib/events/types";

/**
 * FIRST FRC API v3.0 client (server-only). Primary source for the PRACTICE schedule (TBA does not
 * carry it); fallback for teams, rankings and the qualification schedule when TBA fails. The FIRST
 * event code is the TBA key with its year stripped (config/event.ts, decision D12).
 */

function firstTarget(eventCode: string, season?: number): { year: number; code: string } | null {
  const key = tbaKeyFor(eventCode);
  if (!key) return null;
  return { year: getSeasonFromEventKey(key) ?? season ?? EVENT_CONFIG.season, code: getFirstEventCodeFromTbaKey(key) };
}

/** FIRST's name for each app match type in the `tournamentLevel` query. */
const TOURNAMENT_LEVEL: Record<MatchType, string> = {
  Practice: "Practice",
  Qualification: "Qualification",
  Playoff: "Playoff",
};

export async function fetchFirstSchedule(eventCode: string, matchType: MatchType, season?: number): Promise<EventMatch[]> {
  const target = firstTarget(eventCode, season);
  if (!target) return [];
  try {
    const payload = await frcFetch<unknown>("first", `/${target.year}/schedule/${encodeURIComponent(target.code)}`, {
      query: { tournamentLevel: TOURNAMENT_LEVEL[matchType] },
    });
    return firstScheduleToEventMatches(payload, matchType);
  } catch (error) {
    // FIRST answers an event whose schedule is not published yet with a 404: empty, not a failure.
    if (error instanceof FrcApiError && error.code === "not_found") return [];
    throw error;
  }
}

export async function fetchFirstTeams(eventCode: string, season?: number): Promise<EventTeam[]> {
  const target = firstTarget(eventCode, season);
  if (!target) return [];
  const payload = await frcFetch<unknown>("first", `/${target.year}/teams`, { query: { eventCode: target.code } });
  return firstTeamsToEventTeams(payload);
}

export async function fetchFirstRankings(eventCode: string, season?: number): Promise<EventRanking[]> {
  const target = firstTarget(eventCode, season);
  if (!target) return [];
  try {
    const payload = await frcFetch<unknown>("first", `/${target.year}/rankings/${encodeURIComponent(target.code)}`);
    return firstRankingsToEventRankings(payload);
  } catch (error) {
    if (error instanceof FrcApiError && error.code === "not_found") return [];
    throw error;
  }
}
