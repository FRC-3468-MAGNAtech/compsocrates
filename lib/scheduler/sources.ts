import { isValidAllianceTeams } from "@/config/alliance";
import type { EventMatch } from "@/lib/events/types";
import type { LibraryMatch } from "@/lib/match-library";
import type { Difficulty } from "@/lib/difficulty";
import type { MatchInput } from "./types";

/** An "Event schedule"/"Live" match source — skips matches whose alliances don't have a plausible team count (2 up to the configured alliance size), same convention as `lib/match-library.ts`'s import. */
export function ftcMatchesToInputs(matches: EventMatch[]): MatchInput[] {
  return matches
    .filter((m) => isValidAllianceTeams(m.redTeams) && isValidAllianceTeams(m.blueTeams))
    .map((m) => ({
      matchType: m.type,
      matchNumber: m.matchNumber,
      red: [...m.redTeams],
      blue: [...m.blueTeams],
    }));
}

/** A "Practice library" match source, scoped to one difficulty — only the alliance(s) actually matching `difficulty` get slots; the other alliance (if it doesn't match) is left out entirely, not generated as unassignable slots. */
export function libraryMatchesToInputs(matches: LibraryMatch[], difficulty: Difficulty): MatchInput[] {
  return matches
    .map((m) => ({
      matchType: m.matchType,
      matchNumber: m.matchNumber,
      red: m.alliances.red.difficulty === difficulty && m.alliances.red.teams.length > 0 ? [...m.alliances.red.teams] : null,
      blue: m.alliances.blue.difficulty === difficulty && m.alliances.blue.teams.length > 0 ? [...m.alliances.blue.teams] : null,
    }))
    .filter((m) => m.red !== null || m.blue !== null);
}
