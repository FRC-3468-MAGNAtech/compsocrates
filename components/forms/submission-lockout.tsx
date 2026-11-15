"use client";

import { useEffect, useMemo } from "react";
import { Lock } from "lucide-react";
import { getSubmissionLockout } from "@/data/cs/teams";
import type { SubmissionLockout } from "@/data/cs/types";
import { useForms } from "@/lib/forms/forms-context";
import { rememberSubmissionSettings } from "@/lib/forms/submission-guard";
import { submissionBlock } from "@/lib/forms/submission-settings";
import { useProgram } from "@/lib/program/context";
import { useTeamDoc } from "@/lib/team";

const OPEN: SubmissionLockout = { locked: false, reason: "" };

/**
 * Is a NEW submission closed, and why. Two team switches feed it, both realtime (an admin flipping one shows up on a scout's open form straight away):
 *  - CS `assertSubmissionsOpen`: `teams/{id}.submissionControls.globalLockout` blocks new submissions on every form page (set from the CS app).
 *  - Session E: `teams/{id}.formSubmissionSettings` (Admin Panel > Form submissions): a master switch and one per season. Pass `seasonId` (the season the form
 *    is open on) so a closed season blocks only its own forms.
 * Unknown (no team, not loaded) counts as open, so a scout is never locked out by a read that has not finished. The same settings are handed to the shared
 * write path (`lib/forms/submission-guard.ts`), which enforces them when an entry is saved.
 */
export function useSubmissionLockout(teamId: string | null, seasonId?: string | null): SubmissionLockout {
  const program = useProgram();
  const forms = useForms();
  const { team } = useTeamDoc(teamId);
  const settings = team?.formSubmissionSettings;
  useEffect(() => {
    if (teamId && team) rememberSubmissionSettings(program, teamId, settings);
  }, [program, teamId, team, settings]);
  const gameName = seasonId ? forms.seasonFor(seasonId).name : undefined;
  return useMemo(() => {
    if (!team) return OPEN;
    const cs = getSubmissionLockout(team);
    if (cs.locked) return cs;
    const block = submissionBlock(settings, seasonId, gameName);
    return block ? { locked: true, reason: block.message } : OPEN;
  }, [team, settings, seasonId, gameName]);
}

/** CS `SubmissionLockoutBanner`, app style. Edit mode still works while locked (the copy says so). */
export function SubmissionLockoutBanner({ lockout, editAllowed = true }: { lockout: SubmissionLockout; editAllowed?: boolean }) {
  if (!lockout.locked) return null;
  const reason = /[.!?]$/.test(lockout.reason.trim()) ? lockout.reason.trim() : `${lockout.reason.trim()}.`;
  return (
    <div role="alert" data-testid="lockout-banner" className="glass-card flex items-start gap-3 border border-amber-400/40 bg-amber-500/10 p-4 text-sm">
      <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden />
      <p className="min-w-0">
        <span className="font-semibold text-amber-200">Submissions are currently disabled.</span> {reason}
        {editAllowed ? " You can still edit existing entries." : ""} What you typed stays on this page.
      </p>
    </div>
  );
}
