"use server";

import * as frc from "@/lib/frc/provider";
import * as ftc from "@/lib/ftc/provider";
import type { ProgramId } from "@/config/programs/types";
import { getStatboticsTeam as frcGetStatboticsTeam, type StatboticsTeam } from "@/lib/frc/statbotics";
import { requireUserResult } from "@/lib/server/require-user";
import type { ActionResult, BracketStructure, EventInfo, EventMatch, EventRanking, EventTeam, MatchType } from "@/lib/events/types";

/**
 * The event-data Server Actions: the same function names and signatures as lib/frc/provider.ts, behind a session check.
 * Pages import from here and never name a data source. The optional last argument picks the program (default FRC, so
 * every existing call is unchanged); each program has its own provider.
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

export async function getEvents(params?: { season?: number; search?: string }, program: ProgramId = "frc"): Promise<ActionResult<EventInfo[]>> {
  const gate = await requireUserResult();
  if (!gate.ok) return gate;
  return (program === "ftc" ? ftc : frc).getEvents(params);
}

export async function getEvent(eventCode: string, season?: number, program: ProgramId = "frc"): Promise<ActionResult<EventInfo | null>> {
  const gate = await requireUserResult();
  if (!gate.ok) return gate;
  return (program === "ftc" ? ftc : frc).getEvent(eventCode, season);
}

export async function getTeamsForEvent(eventCode: string, season?: number, program: ProgramId = "frc"): Promise<ActionResult<EventTeam[]>> {
  const gate = await requireUserResult();
  if (!gate.ok) return gate;
  return (program === "ftc" ? ftc : frc).getTeamsForEvent(eventCode, season);
}

export async function getTeamByNumber(teamNumber: number, season?: number, program: ProgramId = "frc"): Promise<ActionResult<EventTeam | null>> {
  const gate = await requireUserResult();
  if (!gate.ok) return gate;
  return (program === "ftc" ? ftc : frc).getTeamByNumber(teamNumber, season);
}

export async function getRankingsForEvent(eventCode: string, season?: number, program: ProgramId = "frc"): Promise<ActionResult<EventRanking[]>> {
  const gate = await requireUserResult();
  if (!gate.ok) return gate;
  return (program === "ftc" ? ftc : frc).getRankingsForEvent(eventCode, season);
}

export async function getMatchesForEvent(eventCode: string, matchType: MatchType, season?: number, program: ProgramId = "frc"): Promise<ActionResult<EventMatch[]>> {
  const gate = await requireUserResult();
  if (!gate.ok) return gate;
  return (program === "ftc" ? ftc : frc).getMatchesForEvent(eventCode, matchType, season);
}

export async function getPlayoffBracket(eventCode: string, season?: number, program: ProgramId = "frc"): Promise<ActionResult<BracketStructure>> {
  const gate = await requireUserResult();
  if (!gate.ok) return gate;
  return (program === "ftc" ? ftc : frc).getPlayoffBracket(eventCode, season);
}

/** Statbotics EPA for a team (season, plus the event when `eventKey` is given). No key needed. */
export async function getStatboticsTeam(teamNumber: number, year: number, eventKey?: string): Promise<ActionResult<StatboticsTeam>> {
  const gate = await requireUserResult();
  if (!gate.ok) return gate;
  return frcGetStatboticsTeam(teamNumber, year, eventKey);
}
