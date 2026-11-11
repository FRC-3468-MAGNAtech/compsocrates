"use client";

// "Our team": the one FRC team this account scouts for. The single seam every page reads (dashboard "our next match", pick-list
// card, match-list highlights, scouting stats, header strip, ...), so none of them knows how it is derived.
//
// CompSocrates keeps ONE team per team document (`teams/{CODE}`: `teamName`, `teamNumber` as a string). A multi-team switcher
// (sister teams on one account) would plug in HERE and nowhere else: `useOurTeam()` would return the team being "viewed as",
// `useIsOurTeam()` would test against every team on the account, and `OurTeamProvider` would hold the switch.
//
// `OurTeamProvider` is mounted once in app/(app)/layout.tsx so the whole app shares one subscription to the team doc. The
// hooks never throw outside it (they return "no team, loaded"), so isolated component tests keep working.

import { createContext, createElement, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { useTeamDoc } from "@/lib/team";
import { readTeamIdentity, type TeamIdentitySource } from "@/lib/team-number";

export type OurTeam = {
  /** The team number, or null when the team doc has none (or none parseable). */
  number: number | null;
  /** The team's name, or null when it has none. */
  name: string | null;
  /** False until the team doc (and the user's profile) have loaded, so "no team" never flashes. */
  loaded: boolean;
};

/** The fields of a team doc this module reads: CS's raw `teamNumber` (string) / `teamName`, or the adapter's `number` / `name`. */
export type OurTeamSource = TeamIdentitySource;

/** Pure: a team doc (raw CS or the adapter's `TeamDoc`) -> our team. `teamNumber` is a STRING in CS; it is parsed to an integer. */
export function ourTeamFrom(teamDoc: OurTeamSource, loaded = true): OurTeam {
  return { ...readTeamIdentity(teamDoc), loaded };
}

const EMPTY: OurTeam = ourTeamFrom(null, true);

export const OurTeamContext = createContext<OurTeam | null>(null);

export function OurTeamProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const { team, loaded } = useTeamDoc(profile?.teamId ?? null);
  const loadedAll = loaded && profile !== null;
  const value = useMemo(() => ourTeamFrom(team, loadedAll), [team, loadedAll]);
  return createElement(OurTeamContext.Provider, { value }, children);
}

/** Our team's number and name. `{ number: null, name: null }` when the team doc has none. */
export function useOurTeam(): OurTeam {
  return useContext(OurTeamContext) ?? EMPTY;
}

/** `isOurTeam(number)`: true for our team's number. Stable between renders while the number does not change. */
export function useIsOurTeam(): (number: number | null | undefined) => boolean {
  const { number: ours } = useOurTeam();
  return useCallback((number: number | null | undefined) => ours !== null && number !== null && number !== undefined && number === ours, [ours]);
}
