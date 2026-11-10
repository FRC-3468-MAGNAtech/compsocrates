import "server-only";
import { EVENT_CONFIG } from "@/config/event";
import { fetchMatchesForEventInternal as fetchFrcMatches } from "@/lib/frc/matches-internal";
import { fetchMatchesForEventInternal as fetchFtcMatches } from "@/lib/ftc/matches-internal";
import type { FtcMatch, MatchType } from "@/lib/ftc/types";

/**
 * Provider-neutral twin of lib/ftc/matches-internal.ts for server contexts with no user session
 * (app/api/cron/poll-live-scores, app/api/live/check-scores, lib/live/resolve-pending). No auth
 * gate, so only call it from a route that has its own (a CRON_SECRET bearer token or a verified
 * session). Throws `FrcApiError` or `FtcApiError`, both of which carry an `ActionErrorCode` `code`.
 */
export function fetchMatchesForEventInternal(eventCode: string, matchType: MatchType, season?: number): Promise<FtcMatch[]> {
  return EVENT_CONFIG.program === "ftc"
    ? fetchFtcMatches(eventCode, matchType, season)
    : fetchFrcMatches(eventCode, matchType, season);
}
