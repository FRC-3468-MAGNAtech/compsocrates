"use client";

import { useCallback, useMemo } from "react";
import type { EventInfo } from "@/lib/events/types";
import { useForms } from "@/lib/forms/forms-context";
import { defaultFormSeasonId, readFormSeasonParam, withSeasonParam, type SeasonLike } from "@/lib/forms/form-season";
import { useSearchParams } from "@/lib/program/navigation";

/**
 * The season a form page is open on, kept in the URL's `game` query (so a link opens that season and a reload keeps it). With no query it is the season of
 * the active event (`defaultEvent`) when there is one, else the program's current season. The page that calls this renders inside a Suspense boundary
 * (`useSearchParams`).
 */
export function useFormSeason(
  defaultEvent: Pick<EventInfo, "season"> | null | undefined,
  /** The seasons this page offers (default: all of the program's). A form that exists for one season offers just that one. */
  offered?: readonly SeasonLike[]
): { seasonId: string; setSeasonId: (seasonId: string) => void; defaultSeasonId: string } {
  const forms = useForms();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const seasons = offered ?? forms.seasons;
  const current = seasons.some((s) => s.id === forms.defaultSeasonId) ? forms.defaultSeasonId : (seasons[0]?.id ?? forms.defaultSeasonId);
  const defaultSeasonId = useMemo(() => defaultFormSeasonId(seasons, defaultEvent, current), [seasons, defaultEvent, current]);
  const seasonId = readFormSeasonParam(searchParams.get("game"), seasons, defaultSeasonId);
  const setSeasonId = useCallback(
    (next: string) => {
      // like Analytics' filters and My Scouting: the URL is rewritten in place (no navigation, no remount of the page)
      window.history.replaceState(null, "", `${window.location.pathname}?${withSeasonParam(queryString, next)}`);
    },
    [queryString]
  );
  return { seasonId, setSeasonId, defaultSeasonId };
}
