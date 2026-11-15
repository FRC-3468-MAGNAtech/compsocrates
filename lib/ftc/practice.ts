import type { MatchType } from "@/lib/events/types";
import type { Difficulty } from "@/lib/difficulty";
import type { AllianceColor, PracticeSession, SessionFlag, SessionKind, SessionMode, SessionStatus } from "@/lib/practice-sessions";
import { finiteNumber, isRecord, isoFromMs, nonEmptyString, str, toEpochMs } from "@/data/ftc/util";

// Pure rules for the FTC practice sessions under `programs/ftc/practiceSessions` (docs/FTC_COMPLETION_PLAN.md, batch 3). No React, no Firebase.
//
// The stored doc is the sister app's native session: the app's own fields only (no CS-named twins such as `scoutId` or epoch-ms times), written by the
// client as the scout moves through the flow. Practice flags (`flags[].dismissed`, `excluded`) live ON the session: there is no flag-state collection.
// A doc that cannot be read as a session is NEVER dropped: it comes back flagged (`malformed`) so an admin can see it.

const KINDS: readonly SessionKind[] = ["solo", "live", "lobby"];
const STATUSES: readonly SessionStatus[] = ["in-progress", "paused", "completed"];
const MODES: readonly Exclude<SessionMode, null>[] = ["trial", "competitive"];
const DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard"];
const MATCH_TYPES: readonly MatchType[] = ["Practice", "Qualification", "Playoff"];

const numbers = (value: unknown): number[] => (Array.isArray(value) ? value.filter((n): n is number => typeof n === "number" && Number.isFinite(n)) : []);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((s): s is string => typeof s === "string") : []);

function readFlags(value: unknown): SessionFlag[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((f) => ({ type: str(f.type), title: str(f.title), detail: str(f.detail), dismissed: f.dismissed === true }));
}

/** A time stored as an ISO string, or as a number / timestamp (read tolerantly), as an ISO string; "" when there is none. */
const isoTime = (value: unknown): string => (typeof value === "string" ? value : isoFromMs(toEpochMs(value)));

/**
 * A stored FTC session as the app's `PracticeSession`. Tolerant: every field has a neutral value, and what could not be read is named in `malformed`
 * (a missing `teamId` or `uid`, an unknown `kind` or `status`, a completed session with no match or alliance). Never returns null and never throws.
 */
export function ftcDocToPracticeSession(id: string, data: Record<string, unknown>): PracticeSession {
  const problems: string[] = [];
  const teamId = nonEmptyString(data.teamId) ?? "";
  if (!teamId) problems.push("no team id");
  const uid = nonEmptyString(data.uid) ?? "";
  if (!uid) problems.push("no scout id");
  const kind = KINDS.find((k) => k === data.kind);
  if (!kind) problems.push("unknown kind");
  const status = STATUSES.find((s) => s === data.status);
  if (!status) problems.push("unknown status");
  const alliance: AllianceColor | null = data.alliance === "red" || data.alliance === "blue" ? data.alliance : null;
  const libraryMatchId = nonEmptyString(data.libraryMatchId);
  if (status === "completed" && (!libraryMatchId || !alliance)) problems.push("completed with no match or alliance");
  const mode = MODES.find((m) => m === data.mode) ?? null;
  const difficulty = DIFFICULTIES.find((d) => d === data.difficulty) ?? null;
  const platform = data.platform === "mobile" ? "mobile" : "pc";
  const allianceTeams = numbers(data.allianceTeams);

  return {
    id,
    teamId,
    uid,
    scoutName: str(data.scoutName),
    kind: kind ?? "solo",
    seasonId: str(data.seasonId),
    mode,
    difficulty,
    libraryMatchId,
    eventCode: nonEmptyString(data.eventCode),
    alliance,
    robots: numbers(data.robots),
    // An unreadable status must not look like a finished or open attempt: it is treated as in-progress and flagged.
    status: status ?? "in-progress",
    completedRobots: numbers(data.completedRobots),
    entryIds: strings(data.entryIds),
    accuracy: finiteNumber(data.accuracy),
    scoutedTotal: finiteNumber(data.scoutedTotal),
    penaltyPoints: finiteNumber(data.penaltyPoints),
    officialScore: finiteNumber(data.officialScore),
    platform,
    flags: readFlags(data.flags),
    excluded: data.excluded === true,
    lobbyId: nonEmptyString(data.lobbyId),
    pairId: nonEmptyString(data.pairId),
    startedAt: isoTime(data.startedAt),
    finishedAt: isoTime(data.finishedAt) || null,
    matchType: MATCH_TYPES.find((t) => t === data.matchType) ?? null,
    matchNumber: finiteNumber(data.matchNumber),
    allianceTeams: allianceTeams.length > 0 ? allianceTeams : null,
    streamUrl: nonEmptyString(data.streamUrl),
    streamStartSec: finiteNumber(data.streamStartSec),
    streamEndSec: finiteNumber(data.streamEndSec),
    ...(problems.length > 0 ? { malformed: problems.join(", ") } : {}),
  };
}

/** The sessions of the rows, in order. A malformed one is kept (flagged), not dropped. */
export const ftcDocsToPracticeSessions = (rows: readonly { id: string; data: Record<string, unknown> }[]): PracticeSession[] => rows.map((r) => ftcDocToPracticeSession(r.id, r.data));

/** The sessions an admin has to look at: stored docs that could not be read as a whole session. */
export const malformedSessions = (sessions: readonly PracticeSession[]): PracticeSession[] => sessions.filter((s) => s.malformed !== undefined);

/**
 * The stub a scout reserves the moment a match is picked (the id is unique: see `claimDoc`). The rest is filled in by `updateSession`. The start time is
 * a client ISO string, so it is usable offline; `createdAt` is the server's.
 */
export function ftcSessionStub(teamId: string, uid: string, kind: SessionKind, now: () => unknown, startedAt: string = new Date().toISOString()): Record<string, unknown> {
  return { teamId, uid, kind, status: "in-progress" satisfies SessionStatus, startedAt, createdAt: now() };
}

/** The fields of an app-shaped patch that are written (`undefined` is never written: Firestore refuses it). Identity fields (`id`, `teamId`, `uid`, `kind`) are never part of a patch. */
export function ftcSessionPatch(patch: Partial<PracticeSession>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (key === "id" || key === "teamId" || key === "uid" || key === "kind" || key === "malformed" || key === "csLive") continue;
    out[key] = value;
  }
  return out;
}

// --- ids ----------------------------------------------------------------------------------------

const ID_PREFIXES: Record<SessionKind, string> = { solo: "PS-", live: "LV-", lobby: "LB-" };
// No 0/O/1/I: unambiguous when read off a screen or written down (the same alphabet as every program's session ids).
const ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A readable, random candidate session id (`PS-` + 6 characters). It is only a candidate: `claimSession` reserves it atomically and retries on a clash. */
export function newSessionId(kind: SessionKind, random: () => number = Math.random): string {
  return `${ID_PREFIXES[kind]}${Array.from({ length: 6 }, () => ID_ALPHABET[Math.floor(random() * ID_ALPHABET.length)]).join("")}`;
}
