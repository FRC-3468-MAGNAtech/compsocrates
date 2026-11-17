import "server-only";
import { normalizeEventKey } from "@/config/event";
import { FrcApiError, frcFetch } from "./http";
import type { ActionResult } from "@/lib/events/types";

/**
 * Statbotics v3 (server-only, no credentials). Ported from CS app/api/statbotics/team. The shapes
 * below are the fields CS's pick list and team-breakdown page read: `epa.total_points.mean`, the
 * per-category `epa.breakdown`, `epa.ranks.total`, the win/loss record and the event qual rank.
 */

export type StatboticsEpa = {
  total_points?: { mean?: number };
  breakdown?: Record<string, number>;
  ranks?: { total?: { rank?: number; percentile?: number; team_count?: number } };
};

export type StatboticsRecord = { wins?: number; losses?: number; ties?: number; count?: number; winrate?: number };

export type StatboticsTeamYear = { name?: string; epa?: StatboticsEpa; record?: StatboticsRecord };

export type StatboticsTeamEvent = {
  event_name?: string;
  epa?: StatboticsEpa;
  record?: { qual?: { rank?: number; num_teams?: number }; total?: StatboticsRecord };
};

export type StatboticsTeam = {
  teamYear: StatboticsTeamYear | null;
  teamEvent: StatboticsTeamEvent | null;
  /** True when Statbotics has no season row for the team (CS: `unavailable`). */
  unavailable: boolean;
  /** Event EPA when an event was asked for and has one, else the season EPA, else null (the pick list's rule). */
  epa: number | null;
};

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function fetchOrNull<T>(path: string): Promise<T | null> {
  try {
    return await frcFetch<T>("statbotics", path);
  } catch (error) {
    // A missing row or a Statbotics outage means "no data", never a failed page (CS does the same).
    if (error instanceof FrcApiError) return null;
    throw error;
  }
}

export async function getStatboticsTeam(teamNumber: number, year: number, eventKey?: string): Promise<ActionResult<StatboticsTeam>> {
  if (!Number.isInteger(teamNumber) || teamNumber <= 0 || !Number.isInteger(year) || year < 1992) {
    return { ok: false, error: { code: "upstream_error", message: "Missing or invalid teamNumber/year." } };
  }
  const key = eventKey ? normalizeEventKey(eventKey) : "";
  const [teamYear, teamEvent] = await Promise.all([
    fetchOrNull<StatboticsTeamYear>(`/team_year/${teamNumber}/${year}`),
    key ? fetchOrNull<StatboticsTeamEvent>(`/team_event/${teamNumber}/${encodeURIComponent(key)}`) : Promise.resolve(null),
  ]);
  const epa = finite(teamEvent?.epa?.total_points?.mean) ?? finite(teamYear?.epa?.total_points?.mean);
  return { ok: true, data: { teamYear, teamEvent, unavailable: teamYear === null, epa } };
}
