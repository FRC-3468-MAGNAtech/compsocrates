import "server-only";
import { fetchMatchesForEventInternal as fetchFrcMatches } from "@/lib/frc/matches-internal";
import type { EventMatch, MatchType } from "@/lib/events/types";

/**
 * The match fetch for server contexts with no user session (app/api/cron/poll-live-scores, app/api/live/check-scores,
 * lib/live/resolve-pending). No auth gate, so only call it from a route that has its own (a CRON_SECRET bearer token or
 * a verified session). Throws `FrcApiError`, which carries an `ActionErrorCode` `code`.
 */
export function fetchMatchesForEventInternal(eventCode: string, matchType: MatchType, season?: number): Promise<EventMatch[]> {
  return fetchFrcMatches(eventCode, matchType, season);
}
