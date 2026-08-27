"use client";

import { doc, getDoc } from "firebase/firestore";
import { db } from "@/app/firebase";

export type SubmissionLockoutState = {
  locked: boolean;
  reason: string;
};

export async function getSubmissionLockout(teamId: string | null | undefined): Promise<SubmissionLockoutState> {
  const safeTeamId = String(teamId || "").trim();
  if (!safeTeamId) return { locked: false, reason: "" };

  const snap = await getDoc(doc(db, "teams", safeTeamId));
  const data = snap.exists() ? snap.data() : {};
  const controls = data.submissionControls as Record<string, unknown> | undefined;
  return {
    locked: Boolean(controls?.globalLockout),
    reason: String(controls?.lockoutReason || "Submissions are temporarily disabled by your team admins."),
  };
}

export async function assertSubmissionsOpen(teamId: string | null | undefined): Promise<boolean> {
  const state = await getSubmissionLockout(teamId);
  if (!state.locked) return true;
  alert(state.reason);
  return false;
}
