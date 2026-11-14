"use client";

// "Our team": the team this account scouts for. The single seam every page reads (dashboard "our next match", pick-list
// card, match-list highlights, scouting stats, header strip, ...), so none of them knows how it is derived.
//
// A program with one team per account (`ProgramConfig.multiTeam` off: the default program) has exactly the team on the team doc
// (`teamName`, `teamNumber`), as ever. A program that allows several (`multiTeam` on) lists them on the team doc (`accountTeams`)
// and the person picks which one they are "viewing as": `useOurTeam()` returns that team, `useIsOurTeam()` is true for ANY team
// of the account (a schedule highlights all of them), and `useAccountTeamChoice()` is what the switcher shows. The pick is kept in
// this browser per account; a member assigned to only some of the teams (`profile.assignedTeamIds`) can only pick those.
// Nothing outside this file knows how the choice is made or stored.
//
// `OurTeamProvider` is mounted once in app/(app)/[program]/layout.tsx so the whole app shares one subscription to the team doc. The
// hooks never throw outside it (they return "no team, loaded"), so isolated component tests keep working.

import { createContext, createElement, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { storageKey } from "@/config/brand";
import { useAuth } from "@/lib/auth";
import { useProgramConfig } from "@/lib/program/context";
import { useTeamDoc } from "@/lib/team";
import { readTeamIdentity, type AccountTeam, type TeamIdentitySource } from "@/lib/team-number";

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

// ---------------------------------------------------------------------------------------------------------------------
// Several teams per account
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Pure: of the account's teams, the ones this person may view as and the one selected. `assignedIds` (absent or empty = all of them) narrows the
 * list; an assignment that matches none of the teams never locks the person out (they get all). The selected team is the stored pick while it is
 * still available, else the first.
 */
export function chooseAccountTeam(teams: readonly AccountTeam[], storedId: string | null, assignedIds?: readonly string[] | null): { teams: AccountTeam[]; selected: AccountTeam | null } {
  const assigned = assignedIds && assignedIds.length > 0 ? new Set(assignedIds) : null;
  const narrowed = assigned ? teams.filter((t) => assigned.has(t.id)) : [...teams];
  const available = narrowed.length > 0 ? narrowed : [...teams];
  return { teams: available, selected: available.find((t) => t.id === storedId) ?? available[0] ?? null };
}

export type AccountTeamChoice = {
  /** The teams the person may view as, in the account's order. Empty in a program with one team per account. */
  teams: AccountTeam[];
  selectedId: string | null;
  select: (id: string) => void;
};

const NO_CHOICE: AccountTeamChoice = { teams: [], selectedId: null, select: () => {} };
const NO_TEAMS: AccountTeam[] = [];

export const AccountTeamContext = createContext<AccountTeamChoice | null>(null);

const STORAGE_KEY = storageKey("ourTeam");

/** `{ [team doc id]: selected account team id }` as kept in this browser. Storage that is blocked or holds junk reads as no picks. */
function readStoredPicks(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {};
  }
}

function writeStoredPicks(picks: Record<string, string>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(picks));
  } catch {
    /* storage blocked: the pick just is not remembered */
  }
}

export function OurTeamProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const { multiTeam } = useProgramConfig();
  const teamDocId = profile?.teamId ?? null;
  const { team, loaded } = useTeamDoc(teamDocId);
  const loadedAll = loaded && profile !== null;
  const [picks, setPicks] = useState<Record<string, string>>(() => (typeof window === "undefined" ? {} : readStoredPicks()));

  const accountTeams = multiTeam ? (team?.accountTeams ?? NO_TEAMS) : NO_TEAMS;
  const storedId = teamDocId ? (picks[teamDocId] ?? null) : null;
  const assignedIds = profile?.assignedTeamIds;
  const chosen = useMemo(() => chooseAccountTeam(accountTeams, storedId, assignedIds), [accountTeams, storedId, assignedIds]);

  const select = useCallback(
    (id: string) => {
      if (!teamDocId) return;
      const next = { ...picks, [teamDocId]: id };
      setPicks(next);
      writeStoredPicks(next);
    },
    [teamDocId, picks]
  );

  const ours = useMemo(() => (chosen.selected ? { number: chosen.selected.number, name: chosen.selected.name, loaded: loadedAll } : ourTeamFrom(team, loadedAll)), [chosen.selected, team, loadedAll]);
  const choice = useMemo(() => ({ teams: chosen.teams, selectedId: chosen.selected?.id ?? null, select }), [chosen, select]);

  return createElement(OurTeamContext.Provider, { value: ours }, createElement(AccountTeamContext.Provider, { value: choice }, children));
}

/** Our team's number and name (the team being viewed as, when the account has several). `{ number: null, name: null }` when the team doc has none. */
export function useOurTeam(): OurTeam {
  return useContext(OurTeamContext) ?? EMPTY;
}

/** The account's teams and which is selected, for the switcher. Empty (no choice to make) unless the program allows several teams per account. */
export function useAccountTeamChoice(): AccountTeamChoice {
  return useContext(AccountTeamContext) ?? NO_CHOICE;
}

/** `isOurTeam(number)`: true for our team's number, or for any team of the account when it has several. Stable between renders while those do not change. */
export function useIsOurTeam(): (number: number | null | undefined) => boolean {
  const { number: ours } = useOurTeam();
  const { teams } = useAccountTeamChoice();
  return useCallback(
    (number: number | null | undefined) => number !== null && number !== undefined && ((ours !== null && number === ours) || teams.some((t) => t.number === number)),
    [ours, teams]
  );
}
