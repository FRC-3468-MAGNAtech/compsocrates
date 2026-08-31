"use client";

import { useEffect, useState } from "react";
import { getSubmissionLockout } from "@/app/utils/submissionControls";

export default function SubmissionLockoutBanner({ teamId }: { teamId: string | null | undefined }) {
  const [state, setState] = useState<{ locked: boolean; reason: string }>({ locked: false, reason: "" });

  useEffect(() => {
    let isActive = true;
    async function load() {
      const result = await getSubmissionLockout(teamId);
      if (isActive) setState(result);
    }
    void load();
    return () => {
      isActive = false;
    };
  }, [teamId]);

  if (!state.locked) return null;

  return (
    <div className="mb-4 rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">
      <span className="font-semibold">Submissions are currently disabled.</span> {state.reason} You can still open
      existing entries in edit mode.
    </div>
  );
}
