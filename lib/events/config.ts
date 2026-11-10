import { EVENT_CONFIG } from "@/config/event";
import { getDefaultSeason as getFtcDefaultSeason, getSelectableSeasons as getFtcSelectableSeasons } from "@/lib/ftc/config";

// Client-safe (no server-only): the season helpers the event pages call. They follow
// EVENT_CONFIG.program, so FRC uses the configured season year and FTC keeps its date-derived one.
// In the browser the program is only known when NEXT_PUBLIC_EVENT_PROGRAM is set (see config/event.ts).

export function getDefaultSeason(now: Date = new Date()): number {
  return EVENT_CONFIG.program === "ftc" ? getFtcDefaultSeason(now) : EVENT_CONFIG.season;
}

export function getSelectableSeasons(now: Date = new Date()): number[] {
  if (EVENT_CONFIG.program === "ftc") return getFtcSelectableSeasons(now);
  const current = EVENT_CONFIG.season;
  return [current + 1, current, current - 1, current - 2];
}
