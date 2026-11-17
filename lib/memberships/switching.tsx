"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { useProgram } from "@/lib/program/context";
import { refreshAccountState } from "@/lib/account-state";
import { invalidateRoster } from "@/lib/team-roster";
import { membershipApi } from "@/lib/memberships/client";
import { friendlyMembershipError, MEMBERSHIP_TEXT } from "@/lib/memberships/strings";

/**
 * The team switch, as the browser lives it. A switch is ONE server transaction that rewrites the user document (the active-team pointer and that team's role
 * fields, together), but the rest of the app learns about it through realtime snapshots at slightly different moments. So:
 *
 *  1. `switchTo(teamId)` marks the switch as in progress. The shell (`app/(app)/[program]/layout.tsx`) answers that by replacing everything with "Switching…",
 *     so no page, sidebar or form is on screen while the old team's permissions and the new team id could meet.
 *  2. The hold ends only when the profile snapshot SHOWS the target team (the pointer and the new team's roles arrive in that one snapshot). Then the account
 *     state and the roster cache are cleared, and the shell remounts with `key={teamId}` so every page starts clean on the new team.
 *  3. A refused switch, or one that has not shown up after `SWITCH_TIMEOUT_MS`, releases the hold with a message.
 */
export const SWITCH_TIMEOUT_MS = 15_000;

type SwitchValue = {
  /** The team id being switched to, or null. */
  target: string | null;
  /** The last switch failure, in words, or null. */
  error: string | null;
  switchTo: (teamId: string) => Promise<void>;
  clearError: () => void;
};

const NO_SWITCH: SwitchValue = { target: null, error: null, switchTo: async () => {}, clearError: () => {} };
const SwitchContext = createContext<SwitchValue>(NO_SWITCH);

/** Pure: is the shell holding? (a switch is in progress and the profile does not show the target team yet). */
export function isHolding(target: string | null, profileTeamId: string | null | undefined): boolean {
  return target !== null && (profileTeamId ?? "") !== target;
}

export function TeamSwitchProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth();
  const program = useProgram();
  const [target, setTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentTeam = profile?.teamId ?? "";
  const uid = user?.uid;

  const stopTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  // The switch is done once the snapshot shows the target team: forget what was cached for the old team.
  useEffect(() => {
    if (target !== null && currentTeam === target) {
      stopTimer();
      invalidateRoster();
      refreshAccountState(uid);
      // Deliberate: ends the hold in the same pass that clears the caches.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTarget(null);
    }
  }, [target, currentTeam, uid]);

  useEffect(() => stopTimer, []);

  const switchTo = useCallback(
    async (teamId: string) => {
      if (target !== null || teamId === currentTeam) return;
      setError(null);
      setTarget(teamId);
      stopTimer();
      timer.current = setTimeout(() => {
        setTarget(null);
        setError(MEMBERSHIP_TEXT.switcher.slow);
      }, SWITCH_TIMEOUT_MS);
      try {
        await membershipApi.switchTeam(program, teamId);
      } catch (err) {
        stopTimer();
        setTarget(null);
        setError(friendlyMembershipError(err, MEMBERSHIP_TEXT.switcher.failed));
      }
    },
    [target, currentTeam, program]
  );

  const clearError = useCallback(() => setError(null), []);
  const value = useMemo<SwitchValue>(() => ({ target, error, switchTo, clearError }), [target, error, switchTo, clearError]);
  return <SwitchContext.Provider value={value}>{children}</SwitchContext.Provider>;
}

export function useTeamSwitch(): SwitchValue {
  return useContext(SwitchContext);
}
