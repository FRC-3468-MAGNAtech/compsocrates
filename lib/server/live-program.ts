import "server-only";
import { csDocToScoutEntry, entryAccuracyToCsPatch } from "@/data/cs/scouting";
import type { CsRecord } from "@/data/cs/types";
import { str } from "@/data/cs/util";
import { fetchMatchesForEventInternal } from "@/lib/events/matches-internal";
import { ftcLiveStore } from "@/lib/ftc/live-store";
import type { LiveProgramStore } from "@/lib/live/program-store";
import type { LibraryMatch } from "@/lib/match-library";
import { tbaApiKey } from "@/lib/server/env";
import { PROGRAMS } from "@/config/programs";
import { DEFAULT_PROGRAM, isProgramId, type ProgramId } from "@/config/programs/types";

export type { LiveProgramStore } from "@/lib/live/program-store";

/**
 * The default program's live and lobby data for the server resolvers, exactly as they always read it: CS's own collections (`scouting` holds official, live
 * and practice rows alike; D1), `csDocToScoutEntry`, and `entryAccuracyToCsPatch` (CS keeps the accuracy percent and `accuracyDetails` on the doc and computes
 * automatic flags at read time, so nothing is stored for them).
 */
const defaultProgramStore: LiveProgramStore = {
  program: DEFAULT_PROGRAM,
  allianceSize: PROGRAMS[DEFAULT_PROGRAM].event.allianceSize,
  paths: {
    sessions: "practiceSessions",
    entries: "scouting",
    notifications: "notifications",
    users: "users",
    libraryMatches: "libraryMatches",
    lobbies: "lobbies",
  },
  practiceUrl: "/practice-scouting",
  readEntry: (id, data) => csDocToScoutEntry(id, data as CsRecord),
  entryPatch: ({ raw, result }) => entryAccuracyToCsPatch(result.entryAccuracy, raw as CsRecord, str(raw.matchLabel) || str(raw.matchId), str(raw.eventKey), Date.now()),
  readLibraryMatch: (id, data) => ({ id, ...data }) as LibraryMatch,
  fetchMatches: (eventCode, matchType, season) => fetchMatchesForEventInternal(eventCode, matchType, season, DEFAULT_PROGRAM),
  dataWarnings: () => (tbaApiKey() ? [] : ["TBA key is not configured: set NEXT_PUBLIC_TBA_API_KEY. Playoff scores cannot be fetched, and qualification scores use the FIRST FRC API only."]),
};

export type ProgramParam =
  | { ok: true; program: ProgramId }
  | { ok: false; code: "program_required" | "unknown_program" | "program_not_supported"; error: string };

/**
 * The program a live or lobby route acts for, taken from the request BODY (never a cookie or a default): missing or not a program id is a 400, a program
 * whose `feature` is off is a 400 `program_not_supported`. `featuresOf` is for tests.
 */
export function programFromBody(
  value: unknown,
  feature: "live" | "lobby",
  featuresOf: (program: ProgramId) => { live?: boolean; lobby?: boolean } = (p) => PROGRAMS[p].connection.features
): ProgramParam {
  if (value === undefined || value === null || value === "") return { ok: false, code: "program_required", error: "Missing program." };
  if (!isProgramId(value)) return { ok: false, code: "unknown_program", error: "Unknown program." };
  if (!featuresOf(value)[feature]) return { ok: false, code: "program_not_supported", error: `This program does not support ${feature} practice.` };
  return { ok: true, program: value };
}

/** The store of a program's live and lobby data. The one place the server maps a program id to its collections and readers. */
export function liveProgramStore(program: ProgramId = DEFAULT_PROGRAM): LiveProgramStore {
  return program === DEFAULT_PROGRAM ? defaultProgramStore : ftcLiveStore;
}
