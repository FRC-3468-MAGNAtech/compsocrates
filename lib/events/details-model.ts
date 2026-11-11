import { getEventStatus } from "@/lib/ftc/event-status";
import type { EventInfo, EventMatch, EventRanking, EventTeam } from "@/lib/events/types";

// Pure helpers for the Event Details page (/events/[eventKey]). No React, no network.

export type EventDetailsTab = "overview" | "teams" | "schedule" | "rankings";

export const EVENT_DETAILS_TABS: { id: EventDetailsTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "teams", label: "Teams" },
  { id: "schedule", label: "Schedule" },
  { id: "rankings", label: "Rankings" },
];

/** CS reads `?tab=overview|teams|schedule`; anything else is Overview. Rankings is the extra tab this page adds. */
export function parseEventTab(value: string | null | undefined): EventDetailsTab {
  const tab = String(value ?? "").toLowerCase();
  return EVENT_DETAILS_TABS.some((t) => t.id === tab) ? (tab as EventDetailsTab) : "overview";
}

/** The season from a TBA-style event key (`2026arli` is 2026), or null when the key doesn't start with a four-digit year and a code (`app-testing`, ``). */
export function eventKeyYear(eventKey: string): number | null {
  const match = /^(\d{4})[a-z0-9]+$/i.exec(String(eventKey ?? "").trim());
  return match ? Number(match[1]) : null;
}

/** `?team=` highlights one row; only a positive whole number counts. */
export function parseHighlightedTeam(value: string | null | undefined): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** CS's "N days away": whole days from `now` until noon on the start date, rounded up. */
export function daysUntilStart(dateStart: string, now: number): number {
  const start = new Date(`${dateStart.slice(0, 10)}T12:00:00`).getTime();
  return Math.ceil((start - now) / DAY_MS);
}

export type EventBadge = { label: string; tone: "live" | "upcoming" | "done" };

/** The status chip in the page header: Live now, N days away, or Completed (CS's three states). */
export function eventBadge(event: Pick<EventInfo, "dateStart" | "dateEnd" | "timezone">, now: number): EventBadge {
  const status = getEventStatus(event, now);
  if (status === "in-progress") return { label: "Live now", tone: "live" };
  if (status === "upcoming") {
    const days = Math.max(1, daysUntilStart(event.dateStart, now));
    return { label: `${days} day${days === 1 ? "" : "s"} away`, tone: "upcoming" };
  }
  return { label: "Completed", tone: "done" };
}

/** "Qualification 12", or the provider's own description (for playoffs, "Match 3 (R2)"). */
export function matchLabel(match: Pick<EventMatch, "type" | "matchNumber" | "description">): string {
  return match.description?.trim() || `${match.type} ${match.matchNumber}`;
}

/** Schedule order: by match number, then series. Never mutates its input. */
export function sortSchedule(matches: readonly EventMatch[]): EventMatch[] {
  return [...matches].sort((a, b) => a.matchNumber - b.matchNumber || (a.series ?? 0) - (b.series ?? 0));
}

export function matchWinner(match: Pick<EventMatch, "played" | "redScore" | "blueScore">): "red" | "blue" | "tie" | null {
  if (!match.played || match.redScore === null || match.blueScore === null) return null;
  if (match.redScore === match.blueScore) return "tie";
  return match.redScore > match.blueScore ? "red" : "blue";
}

/** Teams by number. */
export function sortTeams(teams: readonly EventTeam[]): EventTeam[] {
  return [...teams].sort((a, b) => a.teamNumber - b.teamNumber);
}

/** Rankings by rank (ties by team number). */
export function sortRankings(rankings: readonly EventRanking[]): EventRanking[] {
  return [...rankings].sort((a, b) => a.rank - b.rank || a.teamNumber - b.teamNumber);
}

/** "5-2-0" */
export const recordLabel = (r: Pick<EventRanking, "wins" | "losses" | "ties">) => `${r.wins}-${r.losses}-${r.ties}`;

/** Team number to display name, for joining the rankings and schedule to the team list. */
export function teamNameMap(teams: readonly EventTeam[]): Map<number, string> {
  return new Map(teams.map((t) => [t.teamNumber, t.nameShort || t.nameFull || `Team ${t.teamNumber}`]));
}

/** "City, ST, Country" without the blanks, or null if the event has none. */
export function locationLabel(event: Pick<EventInfo, "city" | "stateProv" | "country">): string | null {
  const parts = [event.city, event.stateProv, event.country].filter((p): p is string => Boolean(p && p.trim()));
  return parts.length > 0 ? parts.join(", ") : null;
}

/** Only an http(s) website is linked (the value comes from an external API). */
export function safeWebsite(url: string | null | undefined): string | null {
  const trimmed = String(url ?? "").trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}
