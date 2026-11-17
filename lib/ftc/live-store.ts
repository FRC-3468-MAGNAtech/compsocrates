import "server-only";
import { ftcDocToScoutEntry } from "@/data/ftc/scouting";
import { programPath } from "@/lib/firebase/paths";
import { fetchMatchesForEventInternal } from "@/lib/events/matches-internal";
import { ftcDocToLibraryMatch } from "@/lib/ftc/library";
import { ftcLiveEntryPatch } from "@/lib/ftc/live";
import type { LiveProgramStore } from "@/lib/live/program-store";
import { ftcApiMissingNames } from "@/lib/server/env";
import { PROGRAMS } from "@/config/programs";

/**
 * The FTC program's live and lobby data for the server resolvers (`lib/live/program-store.ts`): everything under `programs/ftc/` (its session, entry,
 * notification, user and library collections), its own readers, and the entries patched with accuracy and automatic flags ON the entry (there is no
 * flag-state collection). The FTC Events API is the match source. Admin SDK: the callers do their own team check.
 */
export const ftcLiveStore: LiveProgramStore = {
  program: "ftc",
  allianceSize: PROGRAMS.ftc.event.allianceSize,
  paths: {
    sessions: programPath("ftc", "practiceSessions"),
    entries: programPath("ftc", "scoutEntries"),
    notifications: programPath("ftc", "notifications"),
    users: programPath("ftc", "users"),
    libraryMatches: programPath("ftc", "libraryMatches"),
    lobbies: programPath("ftc", "lobbies"),
  },
  practiceUrl: "/ftc/practice-scouting",
  readEntry: (id, data) => ftcDocToScoutEntry(id, data),
  entryPatch: ({ entry, result }) => ftcLiveEntryPatch(result.entryAccuracy, result.entryAutoFlags[entry.id] ?? []),
  readLibraryMatch: (id, data) => ftcDocToLibraryMatch(id, data),
  fetchMatches: (eventCode, matchType, season) => fetchMatchesForEventInternal(eventCode, matchType, season, "ftc"),
  // Names only, never values (docs/ENVIRONMENT.md section D).
  dataWarnings: () => {
    const missing = ftcApiMissingNames();
    return missing.length === 0 ? [] : [`FTC API credentials are not configured: set FTC_API_USERNAME and FTC_API_KEY (missing: ${missing.join(", ")}). Live scores cannot be fetched for this program.`];
  },
};
