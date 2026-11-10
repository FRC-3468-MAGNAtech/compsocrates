/**
 * What the Match Scout Form's team picker marks next to a robot (CS `TeamPickerModal`): Scouted, Sub Assigned, Sub Req, Assigned, in that order of
 * priority. Pure; the page feeds it the team's entries, the published assignments and the sub-in requests.
 */
import { eventCodesMatch } from "@/data/cs/forms";
import type { MatchType } from "@/lib/ftc/types";
import type { ScheduleSlot } from "@/lib/scheduler/types";

export type TeamMark = "scouted" | "subAssigned" | "subRequested" | "assigned";

export const TEAM_MARK_LABEL: Record<TeamMark, string> = { scouted: "Scouted", subAssigned: "Sub Assigned", subRequested: "Sub Req", assigned: "Assigned" };

type EntryLike = { source?: string; eventCode: string; matchType: MatchType; matchNumber: number; teamNumber: number };

/**
 * The robots already scouted for this match at this event: CS `scoutedTeamsByMatch` (any non-sub-in `scouting` row of the match). Practice-session
 * entries are not event scouting, so they do not count.
 */
export function scoutedTeamsFor(entries: readonly EntryLike[], eventCode: string, matchType: MatchType, matchNumber: number): Set<number> {
  const out = new Set<number>();
  for (const e of entries) {
    if (e.source !== undefined && e.source !== "event") continue;
    if (e.matchType === matchType && e.matchNumber === matchNumber && eventCodesMatch(e.eventCode, eventCode)) out.add(e.teamNumber);
  }
  return out;
}

/** CS `assignedTeamsByMatch`: the robots somebody is assigned to scout in this match (the "Assigned" mark). */
export function assignedTeamsFor(slots: readonly ScheduleSlot[], matchType: MatchType, matchNumber: number): Set<number> {
  const out = new Set<number>();
  for (const s of slots) if (s.scoutUid && s.matchType === matchType && s.matchNumber === matchNumber) out.add(s.teamNumber);
  return out;
}

/** The one mark a robot shows: Scouted beats Sub Assigned beats Sub Req beats Assigned (CS label order). */
export function teamMark(team: number, parts: { scouted: ReadonlySet<number>; sub: ReadonlyMap<number, "requested" | "assigned">; assigned: ReadonlySet<number> }): TeamMark | null {
  if (parts.scouted.has(team)) return "scouted";
  const sub = parts.sub.get(team);
  if (sub === "assigned") return "subAssigned";
  if (sub === "requested") return "subRequested";
  return parts.assigned.has(team) ? "assigned" : null;
}

/** Marks for every robot that has one. */
export function teamMarks(parts: { scouted: ReadonlySet<number>; sub: ReadonlyMap<number, "requested" | "assigned">; assigned: ReadonlySet<number> }): Map<number, TeamMark> {
  const out = new Map<number, TeamMark>();
  for (const team of new Set([...parts.scouted, ...parts.sub.keys(), ...parts.assigned])) {
    const mark = teamMark(team, parts);
    if (mark) out.set(team, mark);
  }
  return out;
}

/** The scout's own robot in a match: a slot assigned to them, else a sub-in they took (CS `effectiveAssignedTeams`: claims override). */
export function myTeamFor(slots: readonly ScheduleSlot[], claims: ReadonlyArray<{ matchType: MatchType; matchNumber: number; teamNumber: number }>, uid: string, matchType: MatchType, matchNumber: number): number | null {
  const claim = claims.find((c) => c.matchType === matchType && c.matchNumber === matchNumber);
  if (claim) return claim.teamNumber;
  return slots.find((s) => s.scoutUid === uid && s.matchType === matchType && s.matchNumber === matchNumber)?.teamNumber ?? null;
}
