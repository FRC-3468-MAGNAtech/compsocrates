"use client";

import { Button } from "@/components/ui/button";
import { Shimmer } from "@/components/ui/shimmer";
import { CreditsBoard } from "@/components/credits/credits-board";
import { BRAND } from "@/config/brand";
import { usePublicCredits } from "@/lib/credits/client";
import type { CreditSection } from "@/lib/credits/ops";

/**
 * The ONE Credits view: rendered at the public `/credits` route and inside each program's app shell (`/<program>/credits`). Same component, same data
 * (the platform's one set of credits), same states, for a signed-out visitor and a signed-in one, with or without a team. It reads no team and no program.
 * Until the owner saves a set it shows the built-in list; a failed read keeps that list on screen and says so, with a retry.
 */
export function CreditsView() {
  const { sections, loaded, error, retry } = usePublicCredits();
  return <CreditsContent sections={sections} loaded={loaded} error={error} onRetry={retry} />;
}

/** The markup of the view, from plain props (the part a test renders): no sign-in, team or program is involved. */
export function CreditsContent({ sections, loaded, error, onRetry }: { sections: CreditSection[]; loaded: boolean; error: boolean; onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Credits</h1>
        <p className="text-sm text-[var(--muted-foreground)]">The people, tools, and data behind {BRAND.name}.</p>
      </div>
      {loaded && error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-red-300">
          <span>Couldn&apos;t load the latest credits, so this is the built-in list.</span>
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
      {loaded ? (
        <CreditsBoard sections={sections} admin={false} onOp={() => {}} />
      ) : (
        <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading credits">
          {[0, 1, 2].map((i) => (
            <div key={i} className="glass-card flex h-[112px] flex-col gap-3 p-5">
              <Shimmer className="h-5 w-1/4" />
              <Shimmer className="h-4 w-2/3" />
              <Shimmer className="h-4 w-1/2" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
