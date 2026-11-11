import "server-only";
import { tbaApiKey } from "@/lib/server/env";

/**
 * Problems with the event-data keys that the live-score routes cannot fix themselves, as plain messages naming the
 * variable. The poller skips a match whose schedule it cannot fetch (and logs why), so without this a missing key would
 * look like "no scores yet"; the routes return these as `warnings` so the caller (and the logs) can see it.
 */
export function liveDataWarnings(): string[] {
  return tbaApiKey() ? [] : ["TBA key is not configured: set NEXT_PUBLIC_TBA_API_KEY. Playoff scores cannot be fetched, and qualification scores use the FIRST FRC API only."];
}
