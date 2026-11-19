"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter as useAppRouter } from "next/navigation";
import { db } from "@/lib/firebase/client";
import { getDoc } from "@/lib/firebase/metered";
import { programDoc } from "@/lib/firebase/paths";
import { pointerOf, type ProgramId } from "@/lib/memberships/model";
import { useAuth } from "@/lib/auth";
import { useProgram } from "@/lib/program/context";
import { refreshAccountState } from "@/lib/account-state";
import { invalidateRoster } from "@/lib/team-roster";
import { clearLegacyCache } from "@/lib/legacy-cache";
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
 *  4. A switch to a team in the OTHER program: the same server route (with that program), then the hold lasts until that program's profile document shows the target team
 *     (`confirmPointer`: one `getDoc` through the metered door, at most `CONFIRM_TRIES`, and none for a same-program switch), THEN the app goes to `/<program>/dashboard`, where the
 *     other program's shell loads on that team. A 409 `no_profile` never navigates: it ends the hold and says the team's profile is not set up.
 */
export const CONFIRM_TRIES = 3;
export const CONFIRM_DELAY_MS = 700;

/** Pure-ish: asks `readPointer` (the other program's user document `teamId`) up to `tries` times until it shows `teamId`. True once seen. */
export async function confirmPointer(readPointer: () => Promise<string>, teamId: string, tries = CONFIRM_TRIES, delayMs = CONFIRM_DELAY_MS, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await readPointer()) === teamId) return true;
    } catch {
      /* a failed read is a no, not an error: the next try, or the timeout, decides */
    }
    if (i < tries - 1) await sleep(delayMs);
  }
  return false;
}

export const SWITCH_TIMEOUT_MS = 15_000;

type SwitchValue = {
  /** The team id being switched to, or null. */
  target: string | null;
  /** The last switch failure, in words, or null. */
  error: string | null;
  /** Make `teamId` the active team of `targetProgram` (default: the current program). */
  switchTo: (teamId: string, targetProgram?: ProgramId) => Promise<void>;
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
  const appRouter = useAppRouter();
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
      clearLegacyCache(); // another team: the remembered legacy rows belong to the old one
      refreshAccountState(uid);
      // Deliberate: ends the hold in the same pass that clears the caches.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTarget(null);
    }
  }, [target, currentTeam, uid]);

  useEffect(() => stopTimer, []);

  // The route moved to the other program's shell (the switch completed): this hold is over, whatever team the other program now shows.
  const seenProgram = useRef(program);
  useEffect(() => {
    if (seenProgram.current === program) return;
    seenProgram.current = program;
    stopTimer();
    // Deliberate: the target belonged to the program we left.
    setTarget(null);
  }, [program]);

  const switchTo = useCallback(
    async (teamId: string, targetProgram: ProgramId = program) => {
      const crossProgram = targetProgram !== program;
      if (target !== null || (!crossProgram && teamId === currentTeam)) return;
      setError(null);
      setTarget(teamId);
      stopTimer();
      timer.current = setTimeout(() => {
        setTarget(null);
        setError(MEMBERSHIP_TEXT.switcher.slow);
      }, SWITCH_TIMEOUT_MS);
      try {
        await membershipApi.switchTeam(targetProgram, teamId);
        if (crossProgram) {
          // Hold until the other program's profile shows the team, then go there (one metered read, only on this kind of switch).
          const seen = uid ? await confirmPointer(async () => pointerOf((await getDoc(programDoc(db, targetProgram, "users", uid))).data()), teamId) : false;
          if (!seen) {
            stopTimer();
            setTarget(null);
            setError(MEMBERSHIP_TEXT.switcher.slow);
            return;
          }
          invalidateRoster();
          clearLegacyCache();
          refreshAccountState(uid);
          appRouter.push(`/${targetProgram}/dashboard`);
        }
      } catch (err) {
        stopTimer();
        setTarget(null);
        const code = typeof (err as { code?: unknown } | null)?.code === "string" ? (err as { code: string }).code : "";
        setError(code === "no_profile" ? MEMBERSHIP_TEXT.switcher.noProfile : friendlyMembershipError(err, MEMBERSHIP_TEXT.switcher.failed));
      }
    },
    [target, currentTeam, program, uid, appRouter]
  );

  const clearError = useCallback(() => setError(null), []);
  const value = useMemo<SwitchValue>(() => ({ target, error, switchTo, clearError }), [target, error, switchTo, clearError]);
  return <SwitchContext.Provider value={value}>{children}</SwitchContext.Provider>;
}

export function useTeamSwitch(): SwitchValue {
  return useContext(SwitchContext);
}
