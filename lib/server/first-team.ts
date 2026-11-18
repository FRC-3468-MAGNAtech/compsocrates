import "server-only";
import type { ProgramId } from "@/config/programs/types";
import { getDefaultSeason as rootSeason } from "@/lib/events/config";
import { getTeamByNumber as rootTeam } from "@/lib/frc/provider";
import { getDefaultSeason as namespacedSeason } from "@/lib/ftc/config";
import { getTeamByNumber as namespacedTeam } from "@/lib/ftc/provider";
import { nameMatches, type ApplicationSignals } from "@/lib/applications";

type TeamSignal = ApplicationSignals["firstApi"] & { enteredName: string };

/** Each program's own team directory (its provider and default season), looked up by program id. */
const DIRECTORIES: Record<ProgramId, { season: () => number; find: typeof rootTeam }> = {
  frc: { season: rootSeason, find: rootTeam },
  ftc: { season: namespacedSeason, find: namespacedTeam },
};

function signalFor(season: number, enteredName: string, found: { nameShort?: string | null; nameFull?: string | null } | null): TeamSignal {
  if (!found) return { season, status: "not-found", officialName: null, nameMatches: null, enteredName };
  const official = found.nameShort ?? found.nameFull ?? null;
  const matches = enteredName ? nameMatches(enteredName, found.nameShort ?? undefined) || nameMatches(enteredName, found.nameFull ?? undefined) : null;
  return { season, status: "found", officialName: official, nameMatches: matches, enteredName };
}

/**
 * P20: looks the applied-for team up in the PROGRAM's own directory (the program's provider and season) for the application's verification signals.
 * "Not found" and "the API is down or the key is wrong" are different answers (a rookie team may not be listed yet; an outage or a missing key proves nothing),
 * and neither blocks the application: they are signals for the platform owner. Uses the ungated provider because this runs in an API route with a Bearer token,
 * not a session.
 */
export async function lookupTeamForApplication(program: ProgramId, teamNumber: number, enteredName: string): Promise<TeamSignal> {
  const directory = DIRECTORIES[program];
  const season = directory.season();
  const res = await directory.find(teamNumber, season);
  if (!res.ok) return { season, status: "error", officialName: null, nameMatches: null, enteredName };
  return signalFor(season, enteredName, res.data);
}
