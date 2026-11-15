// Session E: the ONE enforcement point of the team's submission switches (`lib/forms/submission-settings.ts`), shared by every writer of a new entry
// (`saveEntry` in lib/scout-entries.ts, `saveFormEntry` in lib/form-entries.ts, both programs). It reads the settings the app already holds from the team
// doc's realtime subscription (`FormsProvider` hands each change to `rememberSubmissionSettings`), so there is no extra read and it works offline from the
// cached team doc. Unknown (the team doc has not loaded, no cache yet) counts as OPEN: a scout never loses an entry because a setting could not be read.
//
// Client-side control only, like other team scoping: the rules are not tightened (the app relies on open scouting writes, docs/SECURITY-NOTES.md), so a
// modified client could still write. Edits (updateEntry, adminUpdateFormEntry, editOwnFormEntry) are never gated here.

import type { ProgramId } from "@/config/programs/types";
import { SubmissionClosedError, submissionBlock, type FormSubmissionSettings, type SubmissionBlock } from "@/lib/forms/submission-settings";

/** Rides on a new entry's input (never written to the document): which season the entry belongs to, and whether this writer is exempt. */
export type SubmissionGateInput = {
  /** The season id of the entry (`rebuilt`, `reefscape`, `charged_up`, `biobuzz`). Omitted: only the master switch applies. */
  seasonId?: string | null;
  /** An admin tool that bulk-creates entries on purpose (the CSV import) skips the check. Not for scouts' submit paths. */
  bypass?: boolean;
};

const known = new Map<string, FormSubmissionSettings | null>();
const keyOf = (program: ProgramId, teamId: string) => `${program}:${teamId}`;

/** Records the team's latest settings (null: the team doc has none or is gone). Called on every team doc snapshot. */
export function rememberSubmissionSettings(program: ProgramId, teamId: string, settings: FormSubmissionSettings | null | undefined): void {
  known.set(keyOf(program, teamId), settings ?? null);
}

/** For tests. */
export function clearRememberedSubmissionSettings(): void {
  known.clear();
}

/** The game's label from a season id when the caller has no better one (`charged_up` -> `CHARGED UP`; every game's label is its id, upper-cased). */
export const gameNameOfSeason = (seasonId: string): string => seasonId.replace(/_/g, " ").toUpperCase();

/** Why a new submission for this season is closed right now, or null. */
export function currentSubmissionBlock(program: ProgramId, teamId: string, seasonId?: string | null, gameName?: string): SubmissionBlock | null {
  const settings = known.get(keyOf(program, teamId));
  return submissionBlock(settings, seasonId, gameName ?? (seasonId ? gameNameOfSeason(seasonId) : undefined));
}

/** Throws `SubmissionClosedError` when a new submission is closed. Call at the top of every writer of a NEW entry. */
export function assertSubmissionOpen(program: ProgramId, teamId: string, gate?: SubmissionGateInput): void {
  if (gate?.bypass) return;
  const block = currentSubmissionBlock(program, teamId, gate?.seasonId);
  if (block) throw new SubmissionClosedError(block);
}
