// Pure rules of FTC live practice (Batch 6). No Firebase here, so each rule has a plain test.
//
// FTC presence lives at `programs/ftc/liveMatches/{matchKey}/scouts/{uid}`. The default program lists "who is live on my team" with a collection-group query
// across every match's `scouts` subcollection; FTC never does (docs/SECURITY-NOTES.md 3a: the rules cannot guard a collection-group list). Instead the match
// keys are DERIVED from the team's own live sessions, and each match's `scouts` is read by path with `teamId ==`.
import { libraryMatchId } from "@/lib/library/ids";
import { finiteNumber, isRecord, nonEmptyString } from "@/data/ftc/util";
import { ftcScoutEntryPatch } from "@/data/ftc/scouting";
import type { AccuracyResult, AutoFlag } from "@/lib/scout-entries";
import type { PracticeSession } from "@/lib/practice-sessions";
import type { LiveMatchScoutPresence } from "@/lib/live-presence";

/** A live session that can still have a scout present on its match (a finished one has removed its presence). */
const OPEN_STATUSES: readonly string[] = ["in-progress", "paused"];

/** The match keys (the library id of the real match) the team's open live sessions are on, each once, in a stable order. */
export function openLiveMatchKeys(sessions: readonly Pick<PracticeSession, "kind" | "status" | "eventCode" | "matchType" | "matchNumber">[]): string[] {
  const keys = new Set<string>();
  for (const s of sessions) {
    if (s.kind !== "live" || !OPEN_STATUSES.includes(s.status)) continue;
    if (!s.eventCode || !s.matchType || s.matchNumber === null || s.matchNumber === undefined) continue;
    keys.add(libraryMatchId(s.eventCode, s.matchType, s.matchNumber));
  }
  return [...keys].sort();
}

/** What changes when the set of keys changes: the keys to start reading and the keys to stop reading. */
export function diffKeys(current: ReadonlySet<string>, next: readonly string[]): { add: string[]; remove: string[] } {
  const wanted = new Set(next);
  return { add: next.filter((k) => !current.has(k)), remove: [...current].filter((k) => !wanted.has(k)) };
}

/** A stored presence doc as the app's type; null for a doc that is not one (no uid or team). `lastSeen` stays as stored (a timestamp or null). */
export function readPresence(data: unknown): LiveMatchScoutPresence | null {
  if (!isRecord(data)) return null;
  const uid = nonEmptyString(data.uid);
  const teamId = nonEmptyString(data.teamId);
  if (!uid || !teamId) return null;
  return {
    uid,
    teamId,
    name: typeof data.name === "string" ? data.name : "",
    robot: finiteNumber(data.robot) ?? 0,
    alliance: data.alliance === "blue" ? "blue" : "red",
    sessionId: typeof data.sessionId === "string" ? data.sessionId : "",
    lastSeen: data.lastSeen ?? null,
  };
}

/**
 * The fields the poller writes on a scout's entry once its alliance is scored: the accuracy and the recomputed automatic flags, as the stored document
 * shape (identity and everything else on the entry is never part of it). The default program writes its own fields; this is the FTC counterpart.
 */
export function ftcLiveEntryPatch(accuracy: AccuracyResult, autoFlags: readonly AutoFlag[]): Record<string, unknown> {
  return ftcScoutEntryPatch({ accuracy, autoFlags: [...autoFlags] });
}
