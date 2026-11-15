import type { ProgramId } from "@/config/programs/types";
import { getEvent, getMatchesForEvent, getRankingsForEvent, getTeamsForEvent } from "@/lib/events/actions";
import { scopedKey } from "@/lib/program/paths";
import type { ActionResult, EventInfo, EventMatch, EventRanking, EventTeam, MatchType } from "@/lib/events/types";

/**
 * The cache key and fetcher for every read the event page makes, in ONE place so a tab can never forget the program (the Teams, Schedule and
 * Rankings tabs once called the actions without it and would have read the default provider for the other program's event). A key is scoped by program (the
 * default program's keys are unchanged), so the page, its tabs and the Active Events cards share one cached result per event.
 */
export type EventQuery<T> = { key: string; fetch: () => Promise<ActionResult<T>> };

type EventRef = { code: string; season: number };

export function eventQueries(program: ProgramId, ref: EventRef) {
  const { code, season } = ref;
  return {
    teams: { key: scopedKey(program, `teams:${code}:${season}`), fetch: () => getTeamsForEvent(code, season, program) } satisfies EventQuery<EventTeam[]>,
    rankings: { key: scopedKey(program, `rankings:${code}:${season}`), fetch: () => getRankingsForEvent(code, season, program) } satisfies EventQuery<EventRanking[]>,
    matches: (type: MatchType): EventQuery<EventMatch[]> => ({ key: scopedKey(program, `matches:${code}:${season}:${type}`), fetch: () => getMatchesForEvent(code, type, season, program) }),
  };
}

/** The event header query. The key already carries the program (and was `event:${program}:${eventKey}` before, so it keeps its value). */
export function eventDetailQuery(program: ProgramId, eventKey: string, ref: EventRef): EventQuery<EventInfo | null> {
  return { key: `event:${program}:${eventKey}`, fetch: () => getEvent(ref.code, ref.season, program) };
}
