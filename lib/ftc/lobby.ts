// Pure rules of FTC practice lobbies (Batch 6). No Firebase here.
//
// FTC lobbies live at `programs/ftc/lobbies/{LB-code}` with a `players/{uid}` subcollection. The default program finds "the lobby I am in" with a
// collection-group query on `players` (uid ==); FTC never does (docs/SECURITY-NOTES.md 3a). It lists the team's lobbies (`teamId ==`, which the rules
// allow) and asks each OPEN one for the caller's own player doc, by path with `teamId ==` and `uid ==`.
import { nonEmptyString } from "@/data/ftc/util";
import type { LobbyDoc, LobbySettings, LobbyStatus } from "@/lib/lobby";
import type { SessionMode } from "@/lib/practice-sessions";

const STATUSES: readonly LobbyStatus[] = ["waiting", "scouting", "results", "closed"];

/** A lobby nobody may rejoin any more. Only open lobbies are asked for the caller's player doc, which bounds the reads to the team's live lobbies. */
export const isClosedLobby = (status: unknown): boolean => status === "closed";

/** A stored lobby doc as the app's type (unknown fields pass through, as the default program's reader does). A doc with no team or host is not a lobby. */
export function readLobby(id: string, data: Record<string, unknown>): LobbyDoc | null {
  if (!nonEmptyString(data.teamId) || !nonEmptyString(data.hostUid)) return null;
  const status = STATUSES.find((s) => s === data.status) ?? "waiting";
  return { id, ...data, status } as LobbyDoc;
}

/** The document a new lobby is reserved as: waiting, nothing chosen, the host scouting, the host's own screen not the displayer. */
export function lobbyStub(
  input: { teamId: string; hostUid: string; hostName: string; seasonId: string; mode: Exclude<SessionMode, null> },
  now: () => unknown
): Record<string, unknown> {
  const settings: LobbySettings = { hostScouts: true, hostIsDisplayer: false };
  return {
    teamId: input.teamId,
    hostUid: input.hostUid,
    hostName: input.hostName,
    seasonId: input.seasonId,
    mode: input.mode,
    status: "waiting" satisfies LobbyStatus,
    libraryMatchId: null,
    settings,
    pairing: null,
    startsAt: null,
    hostLastSeen: now(),
    createdAt: now(),
    resolvedAt: null,
  };
}

/** One lobby the caller has a player doc in, and when they joined (ms; 0 while the server time has not arrived). */
export type MyLobbyEntry = { lobbyId: string; joinedAtMs: number };

/** The lobby to offer for "rejoin": the one joined most recently. Null when the caller is in none. */
export function pickMyLobby(entries: readonly MyLobbyEntry[]): string | null {
  let best: MyLobbyEntry | null = null;
  for (const e of entries) if (!best || e.joinedAtMs > best.joinedAtMs) best = e;
  return best?.lobbyId ?? null;
}

/** The time a player doc was joined, in ms (a Firestore timestamp or a number); 0 when it has none yet. */
export function joinedAtMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "toMillis" in value && typeof (value as { toMillis: unknown }).toMillis === "function") return (value as { toMillis: () => number }).toMillis();
  return 0;
}
