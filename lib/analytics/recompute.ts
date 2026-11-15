import { getMatchesForEvent } from "@/lib/events/actions";
import type { EventMatch, MatchType } from "@/lib/events/types";
import { formatMatch } from "@/lib/analytics/game-schema";
import { getEventEntries, notApplicableAccuracy, updateEntry, type AccuracyResult, type AutoFlag } from "@/lib/scout-entries";
import { allianceForTeam, computeAllianceAccuracy } from "@/lib/analytics/accuracy";
import { evaluateAutoFlagRuleIds, type FlagContext } from "@/lib/analytics/flags";
import { builtinFormResolver, type FormResolver } from "@/lib/forms/resolver";
import { DEFAULT_PROGRAM, type ProgramId } from "@/config/programs/types";
import { recomputeQuietly, shouldRecomputeAfterSave } from "@/lib/analytics/recompute-policy";

function matchKey(type: MatchType, number: number) {
  return `${type}-${number}`;
}

async function buildMatchLookup(eventCode: string, season: number, program: ProgramId): Promise<Map<string, EventMatch>> {
  const lookup = new Map<string, EventMatch>();
  const [qual, playoff] = await Promise.all([
    getMatchesForEvent(eventCode, "Qualification", season, program),
    getMatchesForEvent(eventCode, "Playoff", season, program),
  ]);
  for (const res of [qual, playoff]) {
    if (res.ok) {
      for (const m of res.data) lookup.set(matchKey(m.type, m.matchNumber), m);
    }
  }
  return lookup;
}

export type EventRescorePatch = {
  entryId: string;
  matchLabel: string;
  teamNumber: number;
  before: AccuracyResult;
  after: AccuracyResult;
  autoFlags: AutoFlag[];
};

/** True when applying a patch would actually change anything a reader would notice. */
export function eventRescorePatchChanges(patch: EventRescorePatch): boolean {
  return patch.before.value !== patch.after.value || patch.before.status !== patch.after.status;
}

/**
 * Computes (without writing) what `recomputeForEvent` would write for every
 * entry in an event — the shared core behind both the real recompute and
 * the Admin Panel's Rescore tab dry-run preview (P9), so the two can never
 * drift apart. Pure aside from the one FIRST API fetch.
 */
/**
 * P21: `resolveForm` says which form each entry was scouted with (default: the built-in with its `formId`), because accuracy needs scoring: an
 * entry whose form has `scoringEnabled: false` is simply "n/a" (never an error), and its automatic flags are evaluated against its own form.
 */
export async function computeEventRescorePlan(teamId: string, eventCode: string, season: number, resolveForm: FormResolver = builtinFormResolver, program: ProgramId = DEFAULT_PROGRAM): Promise<EventRescorePatch[]> {
  const matchLookup = await buildMatchLookup(eventCode, season, program);
  const entries = await getEventEntries(teamId, eventCode, program);

  const patches: EventRescorePatch[] = [];
  for (const entry of entries) {
    const match = matchLookup.get(matchKey(entry.matchType, entry.matchNumber)) ?? null;
    const allianceColor = match ? allianceForTeam(match, entry.teamNumber) : null;
    const allianceTeams = match && allianceColor ? (allianceColor === "red" ? match.redTeams : match.blueTeams) : [];
    const officialAllianceScore = match && allianceColor ? (allianceColor === "red" ? match.redScore : match.blueScore) : null;
    const penaltyPoints =
      match && allianceColor ? (allianceColor === "red" ? match.redPenaltyPoints : match.bluePenaltyPoints) : null;

    const sameMatchEntries = entries.filter(
      (o) => o.id !== entry.id && !o.excluded && o.matchType === entry.matchType && o.matchNumber === entry.matchNumber
    );
    const sameTeamEntries = entries.filter((o) => o.id !== entry.id && !o.excluded && o.teamNumber === entry.teamNumber);

    const form = resolveForm(entry);
    const accuracy = match && form?.scoringEnabled !== false && entry.scored !== false
      ? computeAllianceAccuracy(allianceTeams, officialAllianceScore, penaltyPoints, [
          entry,
          ...sameMatchEntries.filter((o) => !o.excluded),
        ])
      : notApplicableAccuracy;

    const ctx: FlagContext = {
      match,
      allianceTeams,
      officialAllianceScore,
      allianceAccuracy: accuracy,
      sameMatchEntries,
      sameTeamEntries,
      form,
    };
    const triggeredIds = evaluateAutoFlagRuleIds(entry, ctx);
    const previouslyDismissed = new Set(entry.autoFlags.filter((f) => f.dismissed).map((f) => f.ruleId));
    const autoFlags = triggeredIds.map((ruleId) => ({ ruleId, dismissed: previouslyDismissed.has(ruleId) }));

    patches.push({
      entryId: entry.id,
      matchLabel: formatMatch(entry),
      teamNumber: entry.teamNumber,
      before: entry.accuracy ?? notApplicableAccuracy,
      after: accuracy,
      autoFlags,
    });
  }
  return patches;
}

export async function applyEventRescorePlan(patches: EventRescorePatch[], program: ProgramId = DEFAULT_PROGRAM): Promise<void> {
  await Promise.all(patches.map((p) => updateEntry(p.entryId, { accuracy: p.after, autoFlags: p.autoFlags }, {}, program)));
}

/**
 * Recomputes accuracy + automatic flags for every entry in an event, against
 * live official match data. Run after every Scout Form submission and from
 * the Recalculate Accuracy button — recomputing the whole event (rather than
 * just the new entry) is what lets a *different* robot's entry flip from
 * "Needs Robots" to "Complete" once its alliance partner gets scouted too.
 */
export async function recomputeForEvent(teamId: string, eventCode: string, season: number, resolveForm: FormResolver = builtinFormResolver, program: ProgramId = DEFAULT_PROGRAM): Promise<void> {
  const patches = await computeEventRescorePlan(teamId, eventCode, season, resolveForm, program);
  await applyEventRescorePlan(patches, program);
}

/**
 * The recompute that follows a save, import or exclusion on a scout page. Fire-and-forget: it returns at once and never throws.
 * - The default program: exactly as before (`recomputeForEvent`, not awaited).
 * - A program with its own entry store: only an admin writes the derived fields (the rules allow no one else to update an entry), so everyone else skips it
 *   and the next admin recompute covers it. A failure is reported quietly and retried; it never reaches the scout.
 */
export function recomputeAfterSave(args: { teamId: string; eventCode: string; season: number; resolveForm: FormResolver; program: ProgramId; ownEntryStore: boolean; isAdmin: boolean }): void {
  const { teamId, eventCode, season, resolveForm, program, ownEntryStore, isAdmin } = args;
  if (!shouldRecomputeAfterSave({ ownEntryStore, isAdmin })) return;
  if (!ownEntryStore) {
    void recomputeForEvent(teamId, eventCode, season, resolveForm, program);
    return;
  }
  void recomputeQuietly(() => recomputeForEvent(teamId, eventCode, season, resolveForm, program));
}
