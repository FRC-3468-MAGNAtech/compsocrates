import "server-only";
import { EVENT_CONFIG, normalizeEventKey } from "@/config/event";
import { buildFrcPlayoffBracket } from "./bracket";
import { fetchFirstRankings, fetchFirstTeams } from "./first";
import { FrcApiError } from "./http";
import { fetchMatchesForEventInternal } from "./matches-internal";
import { fetchTbaEvent, fetchTbaEvents, fetchTbaRankings, fetchTbaTeam, fetchTbaTeams } from "./tba";
import type { ActionResult, BracketStructure, EventInfo, EventMatch, EventRanking, EventTeam, MatchType } from "@/lib/events/types";

/**
 * The FRC provider (TBA, with the FIRST FRC API as fallback), without the `requireUser()` gate that
 * lib/events/actions.ts adds. Everything returns an `ActionResult`; an unexpected throw becomes an
 * `upstream_error`, a `FrcApiError` keeps its code and its message (which names the env variable to fix).
 *
 * `event` codes are TBA keys (`2026arli`); legacy aliases are resolved here. One server key,
 * `NEXT_PUBLIC_TBA_API_KEY`; failures are never cached.
 */

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof FrcApiError) return { ok: false, error: { code: error.code, message: error.message } };
    return { ok: false, error: { code: "upstream_error", message: "Unexpected error talking to the FRC data APIs." } };
  }
}

/** TBA first; if it fails (no key, outage, rate limit) fall back to the FIRST FRC API, rethrowing TBA's error if both fail. */
async function withFirstFallback<T>(primary: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  try {
    return await primary();
  } catch (error) {
    if (!(error instanceof FrcApiError) || error.code === "not_found") throw error;
    try {
      return await fallback();
    } catch {
      throw error;
    }
  }
}

export function getEvents(params?: { season?: number; search?: string }): Promise<ActionResult<EventInfo[]>> {
  const season = params?.season ?? EVENT_CONFIG.season;
  return run(async () => {
    let events = await fetchTbaEvents(season);
    const search = params?.search?.trim().toLowerCase();
    if (search) events = events.filter((e) => e.name.toLowerCase().includes(search) || e.code.toLowerCase().includes(search));
    return events.sort((a, b) => a.dateStart.localeCompare(b.dateStart) || a.name.localeCompare(b.name));
  });
}

export function getEvent(eventCode: string, _season?: number): Promise<ActionResult<EventInfo | null>> {
  // The season is part of a TBA key, so the argument only exists to keep the signature uniform.
  void _season;
  return run(() => fetchTbaEvent(normalizeEventKey(eventCode)));
}

export function getTeamsForEvent(eventCode: string, season?: number): Promise<ActionResult<EventTeam[]>> {
  return run(() => withFirstFallback(() => fetchTbaTeams(eventCode), () => fetchFirstTeams(eventCode, season)));
}

/** One team by number; `data` is null when TBA has no such team. */
export function getTeamByNumber(teamNumber: number, _season?: number): Promise<ActionResult<EventTeam | null>> {
  void _season;
  if (!Number.isInteger(teamNumber) || teamNumber <= 0 || teamNumber > 99999) {
    return Promise.resolve({ ok: false, error: { code: "upstream_error", message: "Enter a team number with 1 to 5 digits." } });
  }
  return run(() => fetchTbaTeam(teamNumber));
}

export function getRankingsForEvent(eventCode: string, season?: number): Promise<ActionResult<EventRanking[]>> {
  return run(() => withFirstFallback(() => fetchTbaRankings(eventCode), () => fetchFirstRankings(eventCode, season)));
}

export function getMatchesForEvent(
  eventCode: string,
  matchType: MatchType,
  season?: number
): Promise<ActionResult<EventMatch[]>> {
  return run(() => fetchMatchesForEventInternal(eventCode, matchType, season));
}

export async function getPlayoffBracket(eventCode: string, season?: number): Promise<ActionResult<BracketStructure>> {
  const matches = await getMatchesForEvent(eventCode, "Playoff", season);
  if (!matches.ok) return matches;
  return { ok: true, data: buildFrcPlayoffBracket(matches.data) };
}
