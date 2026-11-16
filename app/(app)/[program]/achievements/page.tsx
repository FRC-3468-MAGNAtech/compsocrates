"use client";

import { AchievementsError, AchievementsSkeleton, AchievementsView } from "@/components/achievements/achievements-view";
import { useAuth } from "@/lib/auth";
import { useMyAchievements } from "@/lib/achievements/use-achievements";

/**
 * Your achievements, with progress. Open to everyone and needs no team: with none, every achievement shows at zero and the page says what unlocks them.
 * One page for both programs; the program only supplies the data (and which measures exist).
 */
export default function AchievementsPage() {
  const { user, profile } = useAuth();
  const state = useMyAchievements(user?.uid ?? null, profile?.teamId || null);
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold tracking-tight">Achievements</h1>
      {state.status === "loading" && <AchievementsSkeleton />}
      {state.status === "error" && <AchievementsError message={state.message} />}
      {state.status === "ready" && (
        <>
          {state.settingsError && (
            <p role="status" className="text-xs text-[var(--muted-foreground)]" data-testid="achievements-settings-error">
              Your team&apos;s custom achievements couldn&apos;t be loaded, so only the built-in ones are shown.
            </p>
          )}
          <AchievementsView items={state.items} noTeam={state.noTeam} />
        </>
      )}
    </div>
  );
}
