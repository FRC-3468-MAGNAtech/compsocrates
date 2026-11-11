import "server-only";
import { EVENT_CONFIG } from "@/config/event";
import { fetchFirstSchedule } from "./first";
import { FrcApiError } from "./http";
import { fetchTbaMatches, type TbaOptions } from "./tba";
import type { EventMatch, MatchType } from "@/lib/events/types";

/**
 * FRC counterpart of lib/ftc/matches-internal.ts: the fetch and merge logic with no auth gate, for
 * trusted server contexts (the poll-live-scores cron, /api/live/check-scores) and for the gated
 * action in lib/events/actions.ts. Throws `FrcApiError`; callers decide how to present it.
 *
 * Sources (decision D4):
 *  - Qualification and Playoff: TBA. Playoff `matchNumber` follows D11 (bracket slots 1..13,
 *    finals 14..16).
 *  - Practice: the FIRST FRC API (TBA does not carry practice).
 *  - Fallback: if TBA fails for Qualification (no key, outage, rate limit), the FIRST qualification
 *    schedule is used and the TBA error is rethrown only if FIRST fails too. Playoff has no FIRST
 *    fallback: FIRST's playoff numbering is not verified to match D11.
 */

const FALLBACK_ON: ReadonlySet<string> = new Set(["missing_credentials", "unauthorized", "rate_limited", "upstream_error", "network_error"]);

export async function fetchMatchesForEventInternal(
  eventCode: string,
  matchType: MatchType,
  season?: number,
  options?: TbaOptions
): Promise<EventMatch[]> {
  const resolvedSeason = season ?? EVENT_CONFIG.season;
  if (matchType === "Practice") return fetchFirstSchedule(eventCode, "Practice", resolvedSeason);

  try {
    return await fetchTbaMatches(eventCode, matchType, options);
  } catch (error) {
    if (matchType !== "Qualification" || !(error instanceof FrcApiError) || !FALLBACK_ON.has(error.code)) throw error;
    try {
      return await fetchFirstSchedule(eventCode, "Qualification", resolvedSeason);
    } catch {
      throw error;
    }
  }
}
