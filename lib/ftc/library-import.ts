import type { ActionError, ActionResult, EventInfo, EventMatch, MatchType } from "@/lib/events/types";
import { importErrorMessage, normalizeApiEventCode } from "@/lib/ftc/library";

// Fetches an FTC event's schedule through the server-side event actions (the FIRST API keys never reach the browser) for the library import.
// The two fetchers are injected: the panel passes `lib/events/actions` (server actions, program "ftc"), the tests pass the provider over a mocked fetch.

export type ScheduleDeps = {
  getEvent(eventCode: string, season: number): Promise<ActionResult<EventInfo | null>>;
  getMatches(eventCode: string, matchType: MatchType, season: number): Promise<ActionResult<EventMatch[]>>;
};

export type ScheduleResult = { ok: true; eventCode: string; eventName: string; matches: EventMatch[] } | { ok: false; code: ActionError["code"] | "invalid_code" | "no_event"; message: string };

/** Qualification and playoff schedules. FIRST publishes no practice schedule, so practice matches are manual only. Any failure aborts before anything is written. */
export async function fetchFtcSchedule(deps: ScheduleDeps, args: { eventCode: string; apiSeason: number }): Promise<ScheduleResult> {
  const eventCode = normalizeApiEventCode(args.eventCode);
  if (!eventCode) return { ok: false, code: "invalid_code", message: "Enter the event code (letters and digits), like USWASEAQ." };
  const event = await deps.getEvent(eventCode, args.apiSeason);
  if (!event.ok) return { ok: false, code: event.error.code, message: importErrorMessage(event.error) };
  if (!event.data) return { ok: false, code: "no_event", message: `No event found with code ${eventCode} for the ${args.apiSeason} season. Manual entry still works.` };

  const matches: EventMatch[] = [];
  for (const type of ["Qualification", "Playoff"] as const) {
    const res = await deps.getMatches(eventCode, type, args.apiSeason);
    if (!res.ok) {
      // A level that has no schedule yet (playoffs before the event reaches them) is empty, not a failure.
      if (res.error.code === "not_found" && type === "Playoff") continue;
      return { ok: false, code: res.error.code, message: importErrorMessage(res.error) };
    }
    matches.push(...res.data);
  }
  return { ok: true, eventCode, eventName: event.data.name, matches };
}
