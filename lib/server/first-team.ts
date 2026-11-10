import "server-only";
import { EVENT_CONFIG } from "@/config/event";
import { getDefaultSeason } from "@/lib/events/config";
import { getTeamByNumber as getFrcTeamByNumber } from "@/lib/frc/provider";
import { ftcFetch, FtcApiError } from "@/lib/ftc/http";
import { nameMatches, type ApplicationSignals } from "@/lib/applications";

type RawTeam = { teamNumber: number; nameShort?: string; nameFull?: string };
type TeamSignal = ApplicationSignals["firstApi"] & { enteredName: string };

function signalFor(season: number, enteredName: string, found: { nameShort?: string | null; nameFull?: string | null } | null): TeamSignal {
  if (!found) return { season, status: "not-found", officialName: null, nameMatches: null, enteredName };
  const official = found.nameShort ?? found.nameFull ?? null;
  const matches = enteredName ? nameMatches(enteredName, found.nameShort ?? undefined) || nameMatches(enteredName, found.nameFull ?? undefined) : null;
  return { season, status: "found", officialName: official, nameMatches: matches, enteredName };
}

/**
 * P20: looks the applied-for team up on the event program's API (FRC: TBA with a FIRST fallback; FTC: the FIRST FTC
 * API) for the application's verification signals. "Not found" and "the API is down" are different answers (a rookie
 * team may not be listed yet; an outage proves nothing), and neither blocks the application: they are signals for
 * the platform owner. Uses the ungated providers because this runs in an API route with a Bearer token, not a session.
 */
export async function lookupTeamForApplication(teamNumber: number, enteredName: string): Promise<TeamSignal> {
  const season = getDefaultSeason();

  if (EVENT_CONFIG.program === "frc") {
    const res = await getFrcTeamByNumber(teamNumber, season);
    if (!res.ok) return { season, status: "error", officialName: null, nameMatches: null, enteredName };
    return signalFor(season, enteredName, res.data);
  }

  try {
    const res = await ftcFetch<{ teams?: RawTeam[] }>(`/${season}/teams`, { teamNumber });
    return signalFor(season, enteredName, res.teams?.find((t) => t.teamNumber === teamNumber) ?? null);
  } catch (error) {
    if (error instanceof FtcApiError && error.code === "not_found") return signalFor(season, enteredName, null);
    return { season, status: "error", officialName: null, nameMatches: null, enteredName };
  }
}
