import type { PracticeSession } from "@/lib/practice-sessions";
import type { ScoutEntry } from "@/lib/scout-entries";

// The pure half of the Admin Panel's "Match Scout IDs" and "Practice Session IDs" tabs: CS's two admin pages (CS app/admin/match-scout-ids and
// app/admin/practice-session-ids) that list scouting document IDs for lookup. CS read every `scouting` doc and rebuilt each row from the raw
// document; here the rows come from the adapted entries and sessions (D1), so the same columns are derived from the in-app types.

const PREFIX: Record<ScoutEntry["matchType"], string> = { Practice: "P", Qualification: "Q", Playoff: "F" };

/** CS `formatMatchId`: "f3" -> "F3", "q12" -> "Q12", "p1" -> "P1"; anything else as stored (e.g. "qf2"); blank is "-". */
export function formatMatchId(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "-";
  const m = raw.match(/^([fqp])(\d+)$/i);
  return m ? `${m[1].toUpperCase()}${m[2]}` : raw;
}

/** CS `formatMatchType`: "finals" -> "Finals", "qualification" -> "Qualification", "practice" -> "Practice", anything else capitalised; blank is "-". */
export function formatMatchType(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "-";
  const lower = raw.toLowerCase();
  if (lower === "finals" || lower === "qualification" || lower === "practice") return lower.charAt(0).toUpperCase() + lower.slice(1);
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** CS `buildSummary`: up to `max` values joined, then "+N more"; none is "-". */
export function buildSummary(values: readonly string[], max = 3): string {
  if (values.length === 0) return "-";
  if (values.length <= max) return values.join(", ");
  return `${values.slice(0, max).join(", ")} +${values.length - max} more`;
}

const toMs = (iso: string | null | undefined): number => {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? ms : 0;
};

/** "Jan 5, 2026, 3:04 PM" in the viewer's locale; "-" when the time is unknown. */
export function formatSubmitted(ms: number): string {
  return ms > 0 ? new Date(ms).toLocaleString() : "-";
}

const uniq = (values: readonly string[]): string[] => Array.from(new Set(values));
const entryMatch = (e: ScoutEntry): string => formatMatchId(e.legacy?.matchId || `${PREFIX[e.matchType]}${e.matchNumber}`);
const entryAccuracyPercent = (e: ScoutEntry): number | null => (e.accuracy && e.accuracy.value !== null && e.accuracy.value > 0 ? e.accuracy.value * 100 : null);
const text = (v: string | number | null | undefined): string => (v === null || v === undefined ? "" : String(v));

/** Case-insensitive "contains" over the row's visible values, as CS did (the text box filters on every column joined). */
export function matchesSearch(values: readonly (string | number | null | undefined)[], search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return values.map(text).join(" ").toLowerCase().includes(q);
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Match Scout IDs
// ---------------------------------------------------------------------------------------------------------------------------------------

export type MatchScoutIdRow = {
  /** The `scouting` document ID: what the tool exists to find. */
  id: string;
  scoutName: string;
  scoutId: string;
  match: string;
  matchType: string;
  game: string;
  team: string;
  event: string;
  score: number;
  /** Percent, rounded; null when the entry has none (CS showed "-" for 0). */
  accuracy: number | null;
  notes: string;
  submittedAt: number;
};

/**
 * Official match-scouting entries, newest first. CS left out any row that belonged to practice scouting (`isPracticeScouting`, `practiceMode`
 * or a `practiceSessionId`): here that is every entry that is not `source: "event"` or that carries a session id.
 */
export function matchScoutIdRows(entries: readonly ScoutEntry[]): MatchScoutIdRow[] {
  return entries
    .filter((e) => e.source === "event" && !e.sessionId && e.legacy?.kind !== "practice")
    .map((e): MatchScoutIdRow => {
      const accuracy = entryAccuracyPercent(e);
      return {
        id: e.id,
        scoutName: e.scoutName,
        scoutId: e.uid,
        match: entryMatch(e),
        matchType: formatMatchType(e.legacy?.matchType || e.matchType),
        game: e.game ?? "",
        team: String(e.teamNumber),
        event: e.legacy?.eventKey || e.eventCode,
        score: e.score.total,
        accuracy: accuracy === null ? null : Math.round(accuracy),
        notes: e.comments,
        submittedAt: toMs(e.submittedAt),
      };
    })
    .sort((a, b) => b.submittedAt - a.submittedAt || (a.id < b.id ? -1 : 1));
}

/** CS's search box: ID, scout, scout id, match, type, team, game, event, score, accuracy, notes and the submitted time. */
export function filterMatchScoutIdRows(rows: readonly MatchScoutIdRow[], search: string): MatchScoutIdRow[] {
  return rows.filter((r) => matchesSearch([r.id, r.scoutName, r.scoutId, r.match, r.matchType, r.team, r.game, r.event, r.score, r.accuracy, r.notes, formatSubmitted(r.submittedAt)], search));
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Practice Session IDs
// ---------------------------------------------------------------------------------------------------------------------------------------

export type PracticeSessionIdRow = {
  /** The `practiceSessions` document ID (PS-, LV- or LB- plus six characters, or a CS-made id). */
  id: string;
  scoutSummary: string;
  scoutId: string;
  matchSummary: string;
  matchType: string;
  game: string;
  teamSummary: string;
  event: string;
  totalScore: number;
  /** Percent, rounded; null when neither the session's entries nor the session itself has one. */
  averageAccuracy: number | null;
  submittedAt: number;
};

/**
 * One row per practice session, newest first, summarised from the entries saved under it (CS joined `scouting` rows by `practiceSessionId`):
 * scouts, matches and teams are the distinct values (three, then "+N more"), the score is the session's own total or else the entries' sum,
 * accuracy is the entries' mean, and the time is the latest entry (or the session's own finish/start). A session with no entries yet falls
 * back to its own scout name, match and robots, which CS showed as "-".
 */
export function practiceSessionIdRows(sessions: readonly PracticeSession[], entries: readonly ScoutEntry[]): PracticeSessionIdRow[] {
  const bySession = new Map<string, ScoutEntry[]>();
  for (const e of entries) {
    if (!e.sessionId) continue;
    const list = bySession.get(e.sessionId);
    if (list) list.push(e);
    else bySession.set(e.sessionId, [e]);
  }

  return sessions
    .map((s): PracticeSessionIdRow => {
      const own = bySession.get(s.id) ?? [];
      const scouts = uniq(own.map((e) => e.scoutName.trim()).filter(Boolean));
      const matches = uniq(own.map(entryMatch).filter((m) => m !== "-"));
      const teams = uniq(own.map((e) => String(e.teamNumber)));
      const accuracies = own.map(entryAccuracyPercent).filter((v): v is number => v !== null);
      const sessionMatch = s.libraryMatchId || (s.matchType && s.matchNumber !== null ? `${PREFIX[s.matchType]}${s.matchNumber}` : "");
      const entriesTotal = own.reduce((sum, e) => sum + e.score.total, 0);
      const sessionTotal = s.scoutedTotal !== null && s.scoutedTotal > 0 ? s.scoutedTotal : entriesTotal;
      const accuracy = accuracies.length > 0 ? accuracies.reduce((a, b) => a + b, 0) / accuracies.length : s.accuracy !== null && s.accuracy > 0 ? s.accuracy : null;
      const firstWithGame = own.find((e) => e.game);
      return {
        id: s.id,
        scoutSummary: buildSummary(scouts.length ? scouts : [s.scoutName.trim()].filter(Boolean)),
        scoutId: s.uid,
        matchSummary: buildSummary(matches.length ? matches : [sessionMatch].filter(Boolean)),
        matchType: formatMatchType(s.matchType || own[0]?.legacy?.matchType || own[0]?.matchType || "practice"),
        game: firstWithGame?.game ?? s.seasonId,
        teamSummary: buildSummary(teams.length ? teams : s.robots.map(String)),
        event: s.eventCode ?? "",
        totalScore: Math.round(sessionTotal),
        averageAccuracy: accuracy === null ? null : Math.round(accuracy),
        submittedAt: own.reduce((latest, e) => Math.max(latest, toMs(e.submittedAt)), toMs(s.finishedAt ?? s.startedAt)),
      };
    })
    .sort((a, b) => b.submittedAt - a.submittedAt || (a.id < b.id ? -1 : 1));
}

/** CS's search box for sessions: ID, scout, scout id, match, type, game, team, event, score, accuracy and the time. */
export function filterPracticeSessionIdRows(rows: readonly PracticeSessionIdRow[], search: string): PracticeSessionIdRow[] {
  return rows.filter((r) => matchesSearch([r.id, r.scoutSummary, r.scoutId, r.matchSummary, r.matchType, r.game, r.teamSummary, r.event, r.totalScore, r.averageAccuracy, formatSubmitted(r.submittedAt)], search));
}
