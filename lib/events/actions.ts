"use server";

import * as frc from "@/lib/frc/provider";
import { getStatboticsTeam as frcGetStatboticsTeam, type StatboticsTeam } from "@/lib/frc/statbotics";
import { requireUserResult } from "@/lib/server/require-user";
import type { ActionResult, BracketStructure, EventInfo, EventMatch, EventRanking, EventTeam, MatchType } from "@/lib/events/types";

/**
 * The event-data Server Actions: the same function names and signatures as lib/frc/provider.ts, behind a session check.
 * Pages import from here and never name a data source (TBA, FIRST, Statbotics).
 *
 * Gate: every call needs a signed-in session. When the Admin SDK itself is not configured the error says so
 * (`missing_credentials`, naming FIREBASE_ADMIN_*) instead of a bare "sign in".
 *
 * The provider uses the single server TBA key (`NEXT_PUBLIC_TBA_API_KEY`, read on the server). A missing or
 * rejected key comes back as a typed error naming the variable; nothing is cached on failure.
 *
 * Only async functions may be exported from a "use server" module, so the season helpers live in
 * lib/events/config.ts and the session-less match fetch in lib/events/matches-internal.ts.
 */

export async function getEvents(params?: { season?: number; search?: string }): Promise<ActionResult<EventInfo[]>> {
  const gate = await requireUserResult();
  if (!gate.ok) return gate;
  return frc.getEvents(params);
}

export async function getEvent(eventCode: string, season?: number): Promise<ActionResult<EventInfo | null>> {
  const gate = await requireUserResult();
  if (!gate.ok) return gate;
  return frc.getEvent(eventCode, season);
}

export async function getTeamsForEvent(eventCode: string, season?: number): Promise<ActionResult<EventTeam[]>> {
  const gate = await requireUserResult();
  if (!gate.ok) return gate;
  return frc.getTeamsForEvent(eventCode, season);
}

export async function getTeamByNumber(teamNumber: number, season?: number): Promise<ActionResult<EventTeam | null>> {
  const gate = await requireUserResult();
  if (!gate.ok) return gate;
  return frc.getTeamByNumber(teamNumber, season);
}

export async function getRankingsForEvent(eventCode: string, season?: number): Promise<ActionResult<EventRanking[]>> {
  const gate = await requireUserResult();
  if (!gate.ok) return gate;
  return frc.getRankingsForEvent(eventCode, season);
}

export async function getMatchesForEvent(eventCode: string, matchType: MatchType, season?: number): Promise<ActionResult<EventMatch[]>> {
  const gate = await requireUserResult();
  if (!gate.ok) return gate;
  return frc.getMatchesForEvent(eventCode, matchType, season);
}

export async function getPlayoffBracket(eventCode: string, season?: number): Promise<ActionResult<BracketStructure>> {
  const gate = await requireUserResult();
  if (!gate.ok) return gate;
  return frc.getPlayoffBracket(eventCode, season);
}

/** Statbotics EPA for a team (season, plus the event when `eventKey` is given). No key needed. */
export async function getStatboticsTeam(teamNumber: number, year: number, eventKey?: string): Promise<ActionResult<StatboticsTeam>> {
  const gate = await requireUserResult();
  if (!gate.ok) return gate;
  return frcGetStatboticsTeam(teamNumber, year, eventKey);
}
