"use client";

import { Lock } from "lucide-react";
import { getSubmissionLockout } from "@/data/cs/teams";
import type { SubmissionLockout } from "@/data/cs/types";
import { useTeamDoc } from "@/lib/team";

const OPEN: SubmissionLockout = { locked: false, reason: "" };

/**
 * CS `assertSubmissionsOpen`: `teams/{id}.submissionControls.globalLockout` blocks NEW submissions on every form page.
 * Realtime (CS read the doc on submit): an admin flipping the lockout shows up on a scout's open form straight away.
 * Unknown (no team, not loaded) counts as open, as in CS.
 */
export function useSubmissionLockout(teamId: string | null): SubmissionLockout {
  const { team } = useTeamDoc(teamId);
  return team ? getSubmissionLockout(team) : OPEN;
}

/** CS `SubmissionLockoutBanner`, app style. Edit mode still works while locked (the copy says so). */
export function SubmissionLockoutBanner({ lockout, editAllowed = true }: { lockout: SubmissionLockout; editAllowed?: boolean }) {
  if (!lockout.locked) return null;
  return (
    <div role="alert" data-testid="lockout-banner" className="glass-card flex items-start gap-3 border border-amber-400/40 bg-amber-500/10 p-4 text-sm">
      <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden />
      <p className="min-w-0">
        <span className="font-semibold text-amber-200">Submissions are currently disabled.</span> {lockout.reason}
        {editAllowed ? " You can still edit existing entries." : ""}
      </p>
    </div>
  );
}
