import "server-only";
import { getDefaultSeason } from "@/lib/events/config";
import { getTeamByNumber } from "@/lib/frc/provider";
import { nameMatches, type ApplicationSignals } from "@/lib/applications";

type TeamSignal = ApplicationSignals["firstApi"] & { enteredName: string };

function signalFor(season: number, enteredName: string, found: { nameShort?: string | null; nameFull?: string | null } | null): TeamSignal {
  if (!found) return { season, status: "not-found", officialName: null, nameMatches: null, enteredName };
  const official = found.nameShort ?? found.nameFull ?? null;
  const matches = enteredName ? nameMatches(enteredName, found.nameShort ?? undefined) || nameMatches(enteredName, found.nameFull ?? undefined) : null;
  return { season, status: "found", officialName: official, nameMatches: matches, enteredName };
}

/**
 * P20: looks the applied-for team up on The Blue Alliance (the FRC provider; the key is `NEXT_PUBLIC_TBA_API_KEY`, read on
 * the server) for the application's verification signals. "Not found" and "the API is down or the key is wrong" are
 * different answers (a rookie team may not be listed yet; an outage or a missing key proves nothing), and neither blocks the
 * application: they are signals for the platform owner. Uses the ungated provider because this runs in an API route with a
 * Bearer token, not a session.
 */
export async function lookupTeamForApplication(teamNumber: number, enteredName: string): Promise<TeamSignal> {
  const season = getDefaultSeason();
  const res = await getTeamByNumber(teamNumber, season);
  if (!res.ok) return { season, status: "error", officialName: null, nameMatches: null, enteredName };
  return signalFor(season, enteredName, res.data);
}
