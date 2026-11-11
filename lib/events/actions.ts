"use server";

import { EVENT_CONFIG } from "@/config/event";
import * as frc from "@/lib/frc/provider";
import { getStatboticsTeam as frcGetStatboticsTeam, type StatboticsTeam } from "@/lib/frc/statbotics";
import * as ftc from "@/lib/ftc/actions";
import { requireUser } from "@/lib/server/require-user";
import type { ActionResult, BracketStructure, EventInfo, EventMatch, EventRanking, EventTeam, MatchType } from "@/lib/events/types";

/**
 * The event-provider facade: the same function names and signatures as lib/ftc/actions.ts, routed
 * to lib/frc or lib/ftc by `EVENT_CONFIG.program` (config/event.ts). Pages import from here and
 * never name a provider.
 *
 * Gate: every call needs a signed-in session (`requireUser()`), exactly like CE. The FTC actions
 * already check that themselves, so FTC calls are forwarded as-is (no second session check, and
 * FTC behavior is untouched); the FRC provider has no gate of its own, so it is checked here.
 *
 * The FRC provider uses the single server TBA key. A per-team key is only available to server code
 * that calls lib/frc/provider.ts directly with its trailing `options` argument.
 *
 * Only async functions may be exported from a "use server" module, so the season helpers live in
 * lib/events/config.ts and the session-less match fetch in lib/events/matches-internal.ts.
 */

const UNAUTHORIZED_RESULT = {
  ok: false as const,
  error: { code: "unauthorized" as const, message: "Sign in to view event data." },
};

const isFtc = () => EVENT_CONFIG.program === "ftc";

export async function getEvents(params?: { season?: number; search?: string }): Promise<ActionResult<EventInfo[]>> {
  if (isFtc()) return ftc.getEvents(params);
  if (!(await requireUser())) return UNAUTHORIZED_RESULT;
  return frc.getEvents(params);
}

export async function getEvent(eventCode: string, season?: number): Promise<ActionResult<EventInfo | null>> {
  if (isFtc()) return ftc.getEvent(eventCode, season);
  if (!(await requireUser())) return UNAUTHORIZED_RESULT;
  return frc.getEvent(eventCode, season);
}

export async function getTeamsForEvent(eventCode: string, season?: number): Promise<ActionResult<EventTeam[]>> {
  if (isFtc()) return ftc.getTeamsForEvent(eventCode, season);
  if (!(await requireUser())) return UNAUTHORIZED_RESULT;
  return frc.getTeamsForEvent(eventCode, season);
}

export async function getTeamByNumber(teamNumber: number, season?: number): Promise<ActionResult<EventTeam | null>> {
  if (isFtc()) return ftc.getTeamByNumber(teamNumber, season);
  if (!(await requireUser())) return UNAUTHORIZED_RESULT;
  return frc.getTeamByNumber(teamNumber, season);
}

export async function getRankingsForEvent(eventCode: string, season?: number): Promise<ActionResult<EventRanking[]>> {
  if (isFtc()) return ftc.getRankingsForEvent(eventCode, season);
  if (!(await requireUser())) return UNAUTHORIZED_RESULT;
  return frc.getRankingsForEvent(eventCode, season);
}

export async function getMatchesForEvent(eventCode: string, matchType: MatchType, season?: number): Promise<ActionResult<EventMatch[]>> {
  if (isFtc()) return ftc.getMatchesForEvent(eventCode, matchType, season);
  if (!(await requireUser())) return UNAUTHORIZED_RESULT;
  return frc.getMatchesForEvent(eventCode, matchType, season);
}

export async function getPlayoffBracket(eventCode: string, season?: number): Promise<ActionResult<BracketStructure>> {
  if (isFtc()) return ftc.getPlayoffBracket(eventCode, season);
  if (!(await requireUser())) return UNAUTHORIZED_RESULT;
  return frc.getPlayoffBracket(eventCode, season);
}

/** FRC only: Statbotics EPA for a team (season, plus the event when `eventKey` is given). FTC has no equivalent. */
export async function getStatboticsTeam(teamNumber: number, year: number, eventKey?: string): Promise<ActionResult<StatboticsTeam>> {
  if (isFtc()) return { ok: false, error: { code: "not_found", message: "Statbotics covers FRC only." } };
  if (!(await requireUser())) return UNAUTHORIZED_RESULT;
  return frcGetStatboticsTeam(teamNumber, year, eventKey);
}
