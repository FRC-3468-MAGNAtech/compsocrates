/**
 * Sub-in requests (docs/ROUTES.md D7). A scout who has to leave asks the team to cover an assigned match; another scout takes it.
 *
 * CS kept these as rows in `scouting` (`entryType` "sub-in-request" / "sub-in-claim"), polled every 20 s by the dashboards, hidden after 6 h
 * (TeamRoleDashboard.visibleSubInRequests). Here each request is ONE doc in the `subInRequests` collection and a claim is an update of that doc,
 * delivered by a realtime listener. Pure: no React, no Firebase. Times are epoch milliseconds, like CS.
 *
 * CS rules kept:
 *   - a request is for a match the requester is ASSIGNED to; the requested team is the team they were assigned;
 *   - one open request per (event, match, team): asking again is refused, taking an assigned one is refused;
 *   - an open request is visible for 6 hours (`SUB_IN_TTL_MS`);
 *   - the requester cannot take their own request, they delete (cancel) it instead;
 *   - a claimed request shows as "Sub Assigned", and the claimer is treated as assigned to that match and team (scout form auto-pick, picker highlight);
 *   - admins can clear every request of the team.
 * A claimed request does not expire (a CS claim row never did): the assignment lasts until the match is scouted.
 */
import { MATCH_TYPE_PREFIX } from "@/lib/analytics/game-schema";
import type { MatchType } from "@/lib/events/types";
import type { ScheduleSlot } from "@/lib/scheduler/types";

export const SUB_IN_COLLECTION = "subInRequests";
/** 6 hours: how long an open request stays on the dashboards (CS `ttlMs`). */
export const SUB_IN_TTL_MS = 6 * 60 * 60 * 1000;

export type SubInStatus = "open" | "claimed" | "expired" | "cancelled";

/** A `subInRequests/{id}` doc. `status` is what was stored; ask `effectiveStatus` for what it means right now (an open request past `expiresAt` is "expired"). */
export type SubInRequest = {
  id: string;
  teamId: string;
  /** The event as a TBA key / event code (alias-resolved, `2026arli`). */
  eventKey: string;
  /** CE match key: P3, Q12, F7 (`formMatchKey`). */
  matchKey: string;
  /** "Qualification 12": what the dashboards show. */
  matchLabel: string;
  /** The robot to cover: the team the requester was assigned. */
  teamNumber: number;
  requestedById: string;
  requestedByName: string;
  requestedAt: number;
  status: SubInStatus;
  claimedById: string | null;
  claimedByName: string | null;
  claimedAt: number | null;
  /** `requestedAt + SUB_IN_TTL_MS`. Stored so the rules and other clients need no constant. */
  expiresAt: number;
};

/** What a create writes (no id; `status` is always "open" and the claim fields are null). */
export type NewSubInRequest = Omit<SubInRequest, "id">;

export type SubInTarget = { matchType: MatchType; matchNumber: number; teamNumber: number };
export type SubInActor = { uid: string; name: string };

export const subInMatchKey = (matchType: MatchType, matchNumber: number): string => `${MATCH_TYPE_PREFIX[matchType]}${matchNumber}`;

const LABELS: Record<MatchType, string> = { Practice: "Practice", Qualification: "Qualification", Playoff: "Finals" };
export const subInMatchLabel = (matchType: MatchType, matchNumber: number): string => `${LABELS[matchType]} ${matchNumber}`;

const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const text = (v: unknown): string => (typeof v === "string" ? v : "");
const STATUSES: readonly SubInStatus[] = ["open", "claimed", "expired", "cancelled"];

/** A stored doc as `SubInRequest`. Tolerant: a missing `expiresAt` is `requestedAt + TTL`; an unknown status reads as "open"; unknown fields are ignored. */
export function parseSubInRequest(id: string, data: Record<string, unknown>): SubInRequest {
  const requestedAt = num(data.requestedAt);
  const status = STATUSES.find((s) => s === data.status) ?? "open";
  return {
    id,
    teamId: text(data.teamId),
    eventKey: text(data.eventKey),
    matchKey: text(data.matchKey),
    matchLabel: text(data.matchLabel),
    teamNumber: num(data.teamNumber),
    requestedById: text(data.requestedById),
    requestedByName: text(data.requestedByName),
    requestedAt,
    status,
    claimedById: text(data.claimedById) || null,
    claimedByName: text(data.claimedByName) || null,
    claimedAt: typeof data.claimedAt === "number" ? data.claimedAt : null,
    expiresAt: num(data.expiresAt, requestedAt + SUB_IN_TTL_MS),
  };
}

/** The doc a request for one match writes. */
export function buildSubInRequest(input: { teamId: string; eventKey: string; actor: SubInActor; target: SubInTarget; now: number }): NewSubInRequest {
  const { target, actor, now } = input;
  return {
    teamId: input.teamId,
    eventKey: input.eventKey,
    matchKey: subInMatchKey(target.matchType, target.matchNumber),
    matchLabel: subInMatchLabel(target.matchType, target.matchNumber),
    teamNumber: target.teamNumber,
    requestedById: actor.uid,
    requestedByName: actor.name || "Scout",
    requestedAt: now,
    status: "open",
    claimedById: null,
    claimedByName: null,
    claimedAt: null,
    expiresAt: now + SUB_IN_TTL_MS,
  };
}

/** Open past its `expiresAt` is expired (nothing writes that: it is read, so a stale open doc is harmless). Claimed and cancelled never change. */
export function effectiveStatus(request: Pick<SubInRequest, "status" | "expiresAt">, now: number): SubInStatus {
  if (request.status === "open" && now >= request.expiresAt) return "expired";
  return request.status;
}

/** Same request: one robot in one match of one event. */
const sameSlot = (r: Pick<SubInRequest, "eventKey" | "matchKey" | "teamNumber">, eventKey: string, matchKey: string, teamNumber: number): boolean => r.eventKey === eventKey && r.matchKey === matchKey && r.teamNumber === teamNumber;

/** The request still standing for this slot (open and not expired, or claimed), if any. */
export function activeRequestFor(requests: readonly SubInRequest[], eventKey: string, matchKey: string, teamNumber: number, now: number): SubInRequest | null {
  return requests.find((r) => sameSlot(r, eventKey, matchKey, teamNumber) && ["open", "claimed"].includes(effectiveStatus(r, now))) ?? null;
}

export type RequestCheck = { ok: true } | { ok: false; reason: string };

/** CS: "A sub-in has already been requested / assigned for this team." */
export function checkCanRequest(requests: readonly SubInRequest[], eventKey: string, target: SubInTarget, now: number): RequestCheck {
  const existing = activeRequestFor(requests, eventKey, subInMatchKey(target.matchType, target.matchNumber), target.teamNumber, now);
  if (!existing) return { ok: true };
  return { ok: false, reason: existing.status === "claimed" ? "A sub-in has already been assigned for this team." : "A sub-in has already been requested for this team." };
}

/** Which assigned slots fall in `start..end` (inclusive, either order) of one match type: CS "Multiple Matches". Sorted by match number, one slot per match. */
export function slotsInRange(slots: readonly ScheduleSlot[], uid: string, matchType: MatchType, start: number, end: number): ScheduleSlot[] {
  const min = Math.min(start, end);
  const max = Math.max(start, end);
  const seen = new Set<number>();
  return slots
    .filter((s) => s.scoutUid === uid && s.matchType === matchType && s.matchNumber >= min && s.matchNumber <= max)
    .sort((a, b) => a.matchNumber - b.matchNumber)
    .filter((s) => (seen.has(s.matchNumber) ? false : (seen.add(s.matchNumber), true)));
}

/** "45-65" typed as two digit strings -> numbers, or null when either is missing or 0 (CS "Enter a valid match range"). */
export function parseRange(startText: string, endText: string): { start: number; end: number } | null {
  const start = Number(startText.replace(/\D/g, ""));
  const end = Number(endText.replace(/\D/g, ""));
  return start > 0 && end > 0 ? { start, end } : null;
}

/** Whether `actor` can take this request now: it is open, not expired, and not their own (they cancel their own). */
export function checkCanClaim(request: SubInRequest, actor: SubInActor, now: number): RequestCheck {
  const status = effectiveStatus(request, now);
  if (status === "claimed") return { ok: false, reason: "Someone already took this sub-in." };
  if (status !== "open") return { ok: false, reason: status === "expired" ? "This request has expired." : "This request was cancelled." };
  if (request.requestedById === actor.uid) return { ok: false, reason: "You can't take your own request." };
  return { ok: true };
}

/** The update a claim writes (a transaction re-checks `checkCanClaim` on the fresh doc first). */
export function claimPatch(actor: SubInActor, now: number): Pick<SubInRequest, "status" | "claimedById" | "claimedByName" | "claimedAt"> {
  return { status: "claimed", claimedById: actor.uid, claimedByName: actor.name || "Scout", claimedAt: now };
}

export const cancelPatch = (): Pick<SubInRequest, "status"> => ({ status: "cancelled" });

/** The requester may cancel while it is open (CS "Delete Request" was hidden once claimed). */
export function canCancel(request: SubInRequest, uid: string, now: number): boolean {
  return request.requestedById === uid && effectiveStatus(request, now) === "open";
}

/**
 * The dashboard list for one event, newest first: open requests within the 6 h window, and claimed ones within it too (shown as "Sub Assigned - name").
 * Cancelled and expired ones are hidden.
 */
export function visibleRequests(requests: readonly SubInRequest[], eventKey: string, now: number): SubInRequest[] {
  return requests
    .filter((r) => r.eventKey === eventKey)
    .filter((r) => {
      const status = effectiveStatus(r, now);
      return status === "open" || (status === "claimed" && now - r.requestedAt <= SUB_IN_TTL_MS);
    })
    .sort((a, b) => b.requestedAt - a.requestedAt);
}

/** Open requests a scout could take: visible, open, and not their own. */
export function claimableFor(requests: readonly SubInRequest[], eventKey: string, uid: string, now: number): SubInRequest[] {
  return visibleRequests(requests, eventKey, now).filter((r) => r.status === "open" && r.requestedById !== uid);
}

export type SubInMark = "requested" | "assigned";

/** For the team picker of one match: team number -> "Sub Req" (open) or "Sub Assigned" (claimed). Assigned wins, as in CS. */
export function marksForMatch(requests: readonly SubInRequest[], eventKey: string, matchKey: string, now: number): Map<number, SubInMark> {
  const out = new Map<number, SubInMark>();
  for (const r of requests) {
    if (r.eventKey !== eventKey || r.matchKey !== matchKey) continue;
    const status = effectiveStatus(r, now);
    if (status === "claimed") out.set(r.teamNumber, "assigned");
    else if (status === "open" && out.get(r.teamNumber) !== "assigned") out.set(r.teamNumber, "requested");
  }
  return out;
}

export type SubInAssignment = { matchType: MatchType; matchNumber: number; teamNumber: number; requestId: string };

/** The matches this scout took over (claimed by them) at the event: CS `userClaims`, used as extra assignments by the scout form. Parsed from the CE match key. */
export function claimedAssignments(requests: readonly SubInRequest[], eventKey: string, uid: string): SubInAssignment[] {
  const out: SubInAssignment[] = [];
  for (const r of requests) {
    if (r.eventKey !== eventKey || r.status !== "claimed" || r.claimedById !== uid) continue;
    const parsed = parseMatchKey(r.matchKey);
    if (parsed) out.push({ ...parsed, teamNumber: r.teamNumber, requestId: r.id });
  }
  return out.sort((a, b) => (a.matchType === b.matchType ? a.matchNumber - b.matchNumber : TYPE_ORDER[a.matchType] - TYPE_ORDER[b.matchType]));
}

const TYPE_ORDER: Record<MatchType, number> = { Practice: 0, Qualification: 1, Playoff: 2 };
const PREFIX_TYPE: Record<string, MatchType> = { P: "Practice", Q: "Qualification", F: "Playoff" };

function parseMatchKey(key: string): { matchType: MatchType; matchNumber: number } | null {
  const m = /^([PQF])(\d+)$/.exec(key);
  return m ? { matchType: PREFIX_TYPE[m[1]], matchNumber: Number(m[2]) } : null;
}
