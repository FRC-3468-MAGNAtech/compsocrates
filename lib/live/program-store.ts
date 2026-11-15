import type { EventMatch, MatchType } from "@/lib/events/types";
import type { LiveScoringPatch } from "@/lib/live/scoring";
import type { LibraryMatch } from "@/lib/match-library";
import type { ScoutEntry } from "@/lib/scout-entries";
import type { ProgramId } from "@/config/programs/types";

/**
 * What the live-score poller (`resolve-pending.ts`) and the lobby resolver (`lib/lobby/resolve-results.ts`) need to know about a program's stored data, so
 * neither names a program: where its collections are, how a stored entry or library match becomes the app's type, which fields a resolved entry is patched
 * with, and where its match schedule comes from. Both run on the Admin SDK (the rules do not apply), so the callers do their own team check.
 * The implementations are `lib/server/live-program.ts` (the dispatcher and the default program's) and the other program's own file.
 */
export type LiveProgramStore = {
  program: ProgramId;
  /** Robots per alliance: how many completed sessions cover an alliance when a session does not record its own roster. */
  allianceSize: number;
  /** Collection paths (the Admin SDK takes them whole). */
  paths: { sessions: string; entries: string; notifications: string; users: string; libraryMatches: string; lobbies: string };
  /** Where a push notification takes the scout (a path the app routes). */
  practiceUrl: string;
  /** A stored entry as the app's type; null when it cannot be read (the alliance is then skipped until it can). */
  readEntry(id: string, data: Record<string, unknown>): ScoutEntry | null;
  /** The fields to write on a scout's entry once its alliance is scored (empty: nothing to write). */
  entryPatch(args: { entry: ScoutEntry; raw: Record<string, unknown>; result: LiveScoringPatch }): Record<string, unknown>;
  /** A stored library match as the app's type; null when it cannot be read. */
  readLibraryMatch(id: string, data: Record<string, unknown>): LibraryMatch | null;
  /** The event's official matches of one type (this program's events API; throws when keys are missing or the call fails). */
  fetchMatches(eventCode: string, matchType: MatchType, season?: number): Promise<EventMatch[]>;
  /** Problems with the program's events-API keys, as messages that name the variables (never a value); empty when the keys are set. */
  dataWarnings(): string[];
};
