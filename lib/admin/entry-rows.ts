// Session E: the Admin Panel's Entries tab lists every entry of the team (Match Scout and the other forms) in one table so an admin can find one and edit it.
// This is the pure part: unified rows, the filters and the form choices. No React, no Firebase.

import { formatMatch } from "@/lib/analytics/game-schema";
import type { FormEntry } from "@/lib/form-entries-model";
import type { ScoutEntry } from "@/lib/scout-entries";

export const MATCH_SCOUT_KEY = "match-scout";

export type EntryRow =
  | { key: string; kind: "scout"; id: string; formKey: typeof MATCH_SCOUT_KEY; eventCode: string; match: string; teamNumber: number | null; scoutName: string; whenMs: number; practice: boolean; entry: ScoutEntry }
  | { key: string; kind: "form"; id: string; formKey: string; eventCode: string; match: string; teamNumber: number | null; scoutName: string; whenMs: number; practice: false; entry: FormEntry };

const scoutWhen = (e: ScoutEntry): number => {
  const ms = Date.parse(e.submittedAt);
  return Number.isFinite(ms) ? ms : 0;
};

/** One row per entry, newest first. Practice and live-practice match entries are left out unless `includePractice` (they belong to Admin > Sessions). */
export function buildEntryRows(scout: readonly ScoutEntry[], forms: readonly FormEntry[], options: { includePractice?: boolean } = {}): EntryRow[] {
  const rows: EntryRow[] = [];
  for (const e of scout) {
    const practice = e.source === "practice" || e.source === "live";
    if (practice && !options.includePractice) continue;
    rows.push({ key: `scout:${e.id}`, kind: "scout", id: e.id, formKey: MATCH_SCOUT_KEY, eventCode: e.eventCode, match: formatMatch(e), teamNumber: e.teamNumber ?? null, scoutName: e.scoutName, whenMs: scoutWhen(e), practice, entry: e });
  }
  for (const e of forms) {
    rows.push({ key: `form:${e.id}`, kind: "form", id: e.id, formKey: e.formType, eventCode: e.eventCode, match: e.matchKey ?? "", teamNumber: e.teamNumber ?? null, scoutName: e.scoutName, whenMs: e.createdAtMs, practice: false, entry: e });
  }
  return rows.sort((a, b) => b.whenMs - a.whenMs);
}

/** The form choices present in the rows, Match Scout first and the rest in the order the forms are listed. */
export function entryFormKeys(rows: readonly EntryRow[], order: readonly string[]): string[] {
  const present = new Set(rows.map((r) => r.formKey));
  return [MATCH_SCOUT_KEY, ...order.filter((k) => k !== MATCH_SCOUT_KEY), "custom"].filter((k, i, all) => present.has(k) && all.indexOf(k) === i);
}

/** The distinct events of the rows. */
export const entryEvents = (rows: readonly EntryRow[]): string[] => [...new Set(rows.map((r) => r.eventCode).filter(Boolean))].sort();

export type EntryRowFilter = { formKey: string | null; eventCode: string | null; query: string };

/** Rows of one form and one event (null: all), whose team number or scout name contains the search text. */
export function filterEntryRows(rows: readonly EntryRow[], filter: EntryRowFilter): EntryRow[] {
  const q = filter.query.trim().toLowerCase();
  return rows.filter((r) => {
    if (filter.formKey && r.formKey !== filter.formKey) return false;
    if (filter.eventCode && r.eventCode !== filter.eventCode) return false;
    if (!q) return true;
    return String(r.teamNumber ?? "").includes(q) || r.scoutName.toLowerCase().includes(q);
  });
}
