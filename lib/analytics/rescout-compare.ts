import { normalizeEventKey } from "@/config/event";
import { entryMatchId, entryToDoc, normalizeAlliance, pluginForDoc } from "@/lib/analytics/cs-docs";
import { groupRescouts, isSubmittedRescout, type GroupComparison, type Rescout, type RescoutAlliance, type RescoutGroup } from "@/lib/analytics/rescouts";
import { normalizeCsMatchId } from "@/data/cs/match-id";
import type { CsDoc, PhaseScore, RescoutDiff } from "@/lib/games/types";
import type { ScoutEntry } from "@/lib/scout-entries";

// Scouted-versus-exemplar comparison (CS app/analytics/accuracy-compare, app/utils/rescoutComparison.ts). The "original" is the live
// scout's entry for a robot in a match; the "exemplar" is the re-scout's practice-session entry. The field-by-field difference is the
// game plugin's `compareToExemplar`. Pure.

const isPracticeSession = (e: Pick<ScoutEntry, "source">): boolean => e.source !== "event";
const entryAlliance = (e: Pick<ScoutEntry, "alliance">) => normalizeAlliance(e.alliance);
const submittedMs = (e: Pick<ScoutEntry, "submittedAt">): number => {
  const ms = Date.parse(e.submittedAt);
  return Number.isFinite(ms) ? ms : 0;
};
const eventKeyOf = (e: Pick<ScoutEntry, "eventCode">): string => normalizeEventKey(e.eventCode);

/** The earliest real-event entry for each robot of one match; entries with no alliance count for either (`includeUnknown`), as in CS's compare page. */
export function originalEntriesForMatch(entries: readonly ScoutEntry[], eventKey: string, matchKey: string, alliance: RescoutAlliance): Map<number, ScoutEntry> {
  const event = normalizeEventKey(eventKey);
  const match = normalizeCsMatchId(matchKey);
  const out = new Map<number, ScoutEntry>();
  for (const entry of entries) {
    if (isPracticeSession(entry) || eventKeyOf(entry) !== event || entryMatchId(entry) !== match) continue;
    const a = entryAlliance(entry);
    if (a !== alliance && a !== null) continue;
    if (entry.teamNumber <= 0) continue;
    const existing = out.get(entry.teamNumber);
    if (!existing || submittedMs(entry) < submittedMs(existing)) out.set(entry.teamNumber, entry);
  }
  return out;
}

/** Real-event entries by `event::match::alliance::team`, earliest wins; only entries that know their alliance (the verification page's lookup). */
export function originalEntriesByKey(entries: readonly ScoutEntry[]): Map<string, ScoutEntry> {
  const out = new Map<string, ScoutEntry>();
  for (const entry of entries) {
    if (isPracticeSession(entry)) continue;
    const alliance = entryAlliance(entry);
    if (!alliance || entry.teamNumber <= 0) continue;
    const eventKey = eventKeyOf(entry);
    const matchKey = entryMatchId(entry);
    if (!eventKey || !matchKey) continue;
    const key = `${eventKey}::${matchKey}::${alliance}::${entry.teamNumber}`;
    const existing = out.get(key);
    if (!existing || submittedMs(entry) < submittedMs(existing)) out.set(key, entry);
  }
  return out;
}

/** Practice-session entries by session id. */
export function practiceEntriesBySession(entries: readonly ScoutEntry[]): Map<string, ScoutEntry[]> {
  const out = new Map<string, ScoutEntry[]>();
  for (const entry of entries) {
    if (!isPracticeSession(entry) || !entry.sessionId) continue;
    out.set(entry.sessionId, [...(out.get(entry.sessionId) ?? []), entry]);
  }
  return out;
}

/** The re-scout's exemplar entry: its session's entry for the same robot. */
export function exemplarFor(rescout: Pick<Rescout, "practiceSessionId" | "teamNumber">, sessions: ReadonlyMap<string, ScoutEntry[]>): ScoutEntry | null {
  if (!rescout.practiceSessionId) return null;
  return (sessions.get(rescout.practiceSessionId) ?? []).find((e) => e.teamNumber === rescout.teamNumber) ?? null;
}

/** The plugin's field-by-field diff of two entries; null when their game cannot be compared (no rebuildable document). */
export function compareEntries(original: ScoutEntry, exemplar: ScoutEntry): RescoutDiff | null {
  const a = entryToDoc(original);
  const b = entryToDoc(exemplar);
  if (!a || !b) return null;
  const plugin = pluginForDoc(a) ?? pluginForDoc(b);
  return plugin ? plugin.compareToExemplar(a, b) : null;
}

/** Mean of the robots' weighted differences, one decimal; null when no robot has both entries. */
export function meanDiff(diffs: readonly number[]): number | null {
  if (diffs.length === 0) return null;
  return Math.round((diffs.reduce((s, d) => s + d, 0) / diffs.length) * 10) / 10;
}

export type TeamComparison = {
  teamNumber: number;
  robotLabel: string;
  original: ScoutEntry | null;
  exemplar: ScoutEntry | null;
  diff: RescoutDiff | null;
  originalScore: PhaseScore | null;
  exemplarScore: PhaseScore | null;
};

export type MatchComparison = {
  teams: TeamComparison[];
  /** Mean line-by-line difference over the robots with both entries; null when there is none. */
  summaryPercent: number | null;
};

function scoreOf(entry: ScoutEntry | null, doc: CsDoc | null): PhaseScore | null {
  if (!entry || !doc) return null;
  return pluginForDoc(doc)?.scoreDoc(doc) ?? null;
}

/** Everything the Accuracy Compare page shows for one event, match and alliance. */
export function buildMatchComparison(input: { entries: readonly ScoutEntry[]; rescouts: readonly Rescout[]; eventKey: string; matchKey: string; alliance: RescoutAlliance }): MatchComparison {
  const { entries, rescouts, eventKey, matchKey, alliance } = input;
  const event = normalizeEventKey(eventKey);
  const match = normalizeCsMatchId(matchKey);

  const submitted = rescouts.filter(
    (r) => r.matchKey !== "" && r.eventKey !== "" && normalizeEventKey(r.eventKey) === event && normalizeCsMatchId(r.matchKey) === match && (r.alliance ?? "red") === alliance && isSubmittedRescout(r)
  );
  // One re-scout per team (the earliest), as the verification page groups them.
  const group = [...groupRescouts(submitted, 1).values()].find((g) => g.alliance === alliance)?.rescouts ?? [];

  const originals = originalEntriesForMatch(entries, eventKey, matchKey, alliance);
  const sessions = practiceEntriesBySession(entries);
  const teamNumbers = group.length > 0 ? group.map((r) => r.teamNumber).sort((a, b) => a - b) : [...originals.keys()].sort((a, b) => a - b);

  const teams = teamNumbers.map((teamNumber, index): TeamComparison => {
    const original = originals.get(teamNumber) ?? null;
    const rescout = group.find((r) => r.teamNumber === teamNumber);
    const exemplar = rescout ? exemplarFor(rescout, sessions) : null;
    const originalDoc = original ? entryToDoc(original) : null;
    const exemplarDoc = exemplar ? entryToDoc(exemplar) : null;
    return {
      teamNumber,
      robotLabel: `Robot ${index + 1}`,
      original,
      exemplar,
      diff: original && exemplar ? compareEntries(original, exemplar) : null,
      originalScore: scoreOf(original, originalDoc),
      exemplarScore: scoreOf(exemplar, exemplarDoc),
    };
  });
  return { teams, summaryPercent: meanDiff(teams.flatMap((t) => (t.diff ? [t.diff.diffPercent] : []))) };
}

/** Per complete high-accuracy group: its mean difference between each re-scouted robot and the live scouting of the same robot. */
export function groupComparisons(groups: Iterable<RescoutGroup>, originals: ReadonlyMap<string, ScoutEntry>, sessions: ReadonlyMap<string, ScoutEntry[]>, minAccuracy: number): Map<string, GroupComparison> {
  const out = new Map<string, GroupComparison>();
  for (const group of groups) {
    if (!group.complete || (group.accuracy ?? 0) < minAccuracy) continue;
    const diffs: number[] = [];
    for (const row of group.rescouts) {
      const exemplar = exemplarFor(row, sessions);
      const original = originals.get(`${group.eventKey}::${group.matchKey}::${group.alliance}::${row.teamNumber}`);
      if (!exemplar || !original) continue;
      const diff = compareEntries(original, exemplar);
      if (diff) diffs.push(diff.diffPercent);
    }
    const mean = meanDiff(diffs);
    if (mean !== null) out.set(group.key, { diffPercent: mean });
  }
  return out;
}
