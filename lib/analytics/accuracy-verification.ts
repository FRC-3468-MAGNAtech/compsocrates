import { ALLIANCE_SIZE } from "@/config/alliance";
import { CURRENT_GAME_ID } from "@/config/games";
import { appMatchToCs, normalizeCsMatchId } from "@/data/cs/match-id";
import { normalizeEventKey } from "@/config/event";
import { entryMatchId, formatMatchIdLong, matchGroupKey, normalizeAlliance, parseTeamNumber, pluginForDoc } from "@/lib/analytics/cs-docs";
import type { AnalyticsEntry } from "@/lib/analytics/entries";
import type { OfficialMatch } from "@/lib/analytics/match-breakdown";
import { HIGH_ACCURACY_MIN, type RescoutAlliance } from "@/lib/analytics/rescouts";
import type { CsDoc, VerificationResult } from "@/lib/games/types";
import type { ScoutEntry } from "@/lib/scout-entries";

// Pure model behind Accuracy Verification (CS app/analytics/accuracy-verification + scoutVerification.ts): the lead-versus-junior
// verification list and the high-accuracy matches offered for a re-scout. The re-scout groups and their accuracy are in rescouts.ts.

/** Verified lead/junior pairs listed (the best by accuracy). */
export const LEAD_ROWS_SHOWN = 8;
/** Rows each list shows before "View all". */
export const SECTION_PREVIEW = 6;

// --- lead match logs -----------------------------------------------------------------------------------------------------

/** A lead scout's match log: a `scouting` row with `entryType: "lead"` (it carries the same game fields as a junior's entry). */
export type LeadLog = {
  id: string;
  doc: CsDoc;
  eventKey: string;
  matchId: string;
  /** Epoch milliseconds; the latest log of a match wins. */
  time: number;
};

const ms = (v: unknown): number => {
  if (v && typeof v === "object" && "toMillis" in v && typeof (v as { toMillis: unknown }).toMillis === "function") return (v as { toMillis: () => number }).toMillis();
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** A stored lead row as a `LeadLog`; null when it names no event or match. */
export function toLeadLog(id: string, doc: CsDoc): LeadLog | null {
  const eventKey = normalizeEventKey(String(doc.eventKey ?? "").trim());
  const raw = String(doc.matchId || doc.matchKey || doc.matchLabel || "").trim();
  const matchId = normalizeCsMatchId(raw);
  if (!eventKey || !matchId) return null;
  return { id, doc, eventKey, matchId, time: ms(doc.submittedAt) || ms(doc.timestamp) || ms(doc.createdAt) };
}

export type VerificationRow = { entry: ScoutEntry; result: VerificationResult };

/**
 * Each junior entry that has a lead log for the same event and match, compared by its game's plugin (`verify`: 85% of the metrics within
 * tolerance is Verified). Best accuracy first, `limit` rows.
 */
export function leadVerificationRows(juniors: ReadonlyArray<{ entry: ScoutEntry; doc: CsDoc }>, leads: readonly LeadLog[], limit: number = LEAD_ROWS_SHOWN): VerificationRow[] {
  const byMatch = new Map<string, LeadLog>();
  for (const lead of [...leads].sort((a, b) => a.time - b.time)) byMatch.set(matchGroupKey(lead.eventKey, lead.matchId), lead);

  const rows: VerificationRow[] = [];
  for (const { entry, doc } of juniors) {
    const lead = byMatch.get(matchGroupKey(entry.eventCode, entryMatchId(entry)));
    const plugin = lead ? pluginForDoc(doc) : null;
    if (!lead || !plugin) continue;
    rows.push({ entry, result: plugin.verify(doc, lead.doc) });
  }
  return rows.sort((a, b) => b.result.accuracy - a.result.accuracy).slice(0, limit);
}

// --- high-accuracy matches -----------------------------------------------------------------------------------------------

export type ScheduleAlliances = ReadonlyMap<string, { red: readonly number[]; blue: readonly number[] }>;

/** The schedule as `event::matchId` to each alliance's teams, to place entries that carry no alliance of their own. */
export function scheduleAlliances(matches: readonly OfficialMatch[]): ScheduleAlliances {
  const map = new Map<string, { red: readonly number[]; blue: readonly number[] }>();
  for (const m of matches) {
    if (m.red.teams.length === 0 && m.blue.teams.length === 0) continue;
    map.set(matchGroupKey(m.eventCode, appMatchToCs(m.matchType, m.matchNumber).matchId), { red: m.red.teams, blue: m.blue.teams });
  }
  return map;
}

export type AllianceGroup = {
  alliance: RescoutAlliance;
  teams: number[];
  scouts: string[];
  /** The best alliance accuracy (percent) among its entries. */
  accuracy: number | null;
};

export type HighAccuracyMatch = {
  key: string;
  eventKey: string;
  eventName: string;
  matchKey: string;
  matchLabel: string;
  sortOrder: number;
  matchAccuracy: number | null;
  alliances: AllianceGroup[];
};

const LEVEL_ORDER: Record<string, number> = { p: 0, q: 1, qf: 2, sf: 3, f: 4 };

function matchOrder(matchId: string): number {
  const m = /^(p|q|qf|sf|f)(\d+)$/.exec(matchId);
  return m ? (LEVEL_ORDER[m[1]] ?? 5) * 10000 + Number(m[2]) : 5 * 10000;
}

/**
 * Matches with at least one alliance that has a full set of robots scouted and at least `HIGH_ACCURACY_MIN`% alliance accuracy. An
 * entry is placed on its own alliance, else on the alliance the schedule puts its team on. Best accuracy first, then event name, then
 * later matches first.
 */
export function highAccuracyMatches(entries: readonly AnalyticsEntry[], schedule: ScheduleAlliances, eventName: (eventCode: string) => string, allianceSize: number = ALLIANCE_SIZE): HighAccuracyMatch[] {
  const byMatch = new Map<string, HighAccuracyMatch>();

  for (const entry of entries) {
    if (entry.source !== "event") continue;
    const matchKey = entryMatchId(entry);
    const eventKey = normalizeEventKey(entry.eventCode);
    if (!matchKey || !eventKey) continue;
    const key = matchGroupKey(eventKey, matchKey);
    let alliance = normalizeAlliance(entry.alliance);
    if (!alliance) {
      const sides = schedule.get(key);
      const team = parseTeamNumber(entry.teamNumber);
      alliance = sides && team ? (sides.red.includes(team) ? "red" : sides.blue.includes(team) ? "blue" : null) : null;
    }
    if (!alliance) continue;

    let match = byMatch.get(key);
    if (!match) {
      match = { key, eventKey, eventName: eventName(eventKey) || eventKey || "Event", matchKey, matchLabel: formatMatchIdLong(matchKey), sortOrder: matchOrder(matchKey), matchAccuracy: null, alliances: [] };
      byMatch.set(key, match);
    }
    let group = match.alliances.find((a) => a.alliance === alliance);
    if (!group) {
      group = { alliance, teams: [], scouts: [], accuracy: null };
      match.alliances.push(group);
    }
    if (entry.teamNumber > 0 && !group.teams.includes(entry.teamNumber)) group.teams.push(entry.teamNumber);
    const scout = entry.scoutName.trim();
    if (scout && !group.scouts.includes(scout)) group.scouts.push(scout);
    if (entry.allianceAccuracy !== null && Number.isFinite(entry.allianceAccuracy)) group.accuracy = Math.max(group.accuracy ?? 0, entry.allianceAccuracy);
  }

  return [...byMatch.values()]
    .map((match) => {
      const alliances = match.alliances.filter((a) => a.teams.length === allianceSize && (a.accuracy ?? 0) >= HIGH_ACCURACY_MIN).sort((a, b) => a.alliance.localeCompare(b.alliance));
      const best = alliances.reduce((max, a) => Math.max(max, a.accuracy ?? 0), 0);
      return { ...match, alliances, matchAccuracy: best || null };
    })
    .filter((match) => match.alliances.length > 0)
    .sort((a, b) => (b.matchAccuracy ?? -1) - (a.matchAccuracy ?? -1) || a.eventName.localeCompare(b.eventName) || b.sortOrder - a.sortOrder);
}

/** The game a re-scout request is filed under: the alliance's entries' game. */
export function rescoutGame(entries: readonly Pick<ScoutEntry, "game">[]): string {
  return entries.find((e) => e.game)?.game ?? CURRENT_GAME_ID;
}
