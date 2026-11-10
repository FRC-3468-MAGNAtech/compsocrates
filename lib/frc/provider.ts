import "server-only";
import { EVENT_CONFIG, normalizeEventKey } from "@/config/event";
import { buildFrcPlayoffBracket } from "./bracket";
import { fetchFirstRankings, fetchFirstTeams } from "./first";
import { FrcApiError } from "./http";
import { fetchMatchesForEventInternal } from "./matches-internal";
import { fetchTbaEvent, fetchTbaEvents, fetchTbaRankings, fetchTbaTeam, fetchTbaTeams, type TbaOptions } from "./tba";
import type { ActionResult, BracketStructure, FtcEvent, FtcMatch, FtcRanking, FtcTeam, MatchType } from "@/lib/ftc/types";

/**
 * The FRC provider: the same function names and signatures as lib/ftc/actions.ts, minus the
 * `requireUser()` gate (lib/events/actions.ts adds it). Everything returns an `ActionResult`; an
 * unexpected throw becomes an `upstream_error`, a `FrcApiError` keeps its code.
 *
 * `event` codes are TBA keys (`2026arli`); legacy aliases are resolved here. A per-team TBA key can
 * be supplied through the optional trailing `options` by a server caller; the Server Action facade
 * does not pass one (one server key, `TBA_API_KEY`).
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

export function getEvents(params?: { season?: number; search?: string }, options?: TbaOptions): Promise<ActionResult<FtcEvent[]>> {
  const season = params?.season ?? EVENT_CONFIG.season;
  return run(async () => {
    let events = await fetchTbaEvents(season, options);
    const search = params?.search?.trim().toLowerCase();
    if (search) events = events.filter((e) => e.name.toLowerCase().includes(search) || e.code.toLowerCase().includes(search));
    return events.sort((a, b) => a.dateStart.localeCompare(b.dateStart) || a.name.localeCompare(b.name));
  });
}

export function getEvent(eventCode: string, _season?: number, options?: TbaOptions): Promise<ActionResult<FtcEvent | null>> {
  // The season is part of a TBA key, so the argument only exists to match the FTC signature.
  void _season;
  return run(() => fetchTbaEvent(normalizeEventKey(eventCode), options));
}

export function getTeamsForEvent(eventCode: string, season?: number, options?: TbaOptions): Promise<ActionResult<FtcTeam[]>> {
  return run(() => withFirstFallback(() => fetchTbaTeams(eventCode, options), () => fetchFirstTeams(eventCode, season)));
}

/** One team by number; `data` is null when TBA has no such team. Same validation message as the FTC provider. */
export function getTeamByNumber(teamNumber: number, _season?: number, options?: TbaOptions): Promise<ActionResult<FtcTeam | null>> {
  void _season;
  if (!Number.isInteger(teamNumber) || teamNumber <= 0 || teamNumber > 99999) {
    return Promise.resolve({ ok: false, error: { code: "upstream_error", message: "Enter a team number with 1 to 5 digits." } });
  }
  return run(() => fetchTbaTeam(teamNumber, options));
}

export function getRankingsForEvent(eventCode: string, season?: number, options?: TbaOptions): Promise<ActionResult<FtcRanking[]>> {
  return run(() => withFirstFallback(() => fetchTbaRankings(eventCode, options), () => fetchFirstRankings(eventCode, season)));
}

export function getMatchesForEvent(
  eventCode: string,
  matchType: MatchType,
  season?: number,
  options?: TbaOptions
): Promise<ActionResult<FtcMatch[]>> {
  return run(() => fetchMatchesForEventInternal(eventCode, matchType, season, options));
}

export async function getPlayoffBracket(eventCode: string, season?: number, options?: TbaOptions): Promise<ActionResult<BracketStructure>> {
  const matches = await getMatchesForEvent(eventCode, "Playoff", season, options);
  if (!matches.ok) return matches;
  return { ok: true, data: buildFrcPlayoffBracket(matches.data) };
}
