"use client";

import { Suspense } from "react";
import { AnalyticsTabs } from "@/components/layout/analytics-tabs";
import { AnalyticsFilterBar } from "@/components/analytics/filter-bar";
import { RefreshOldDataButton } from "@/components/analytics/refresh-old-data-button";
import { AnalyticsFilterProvider } from "@/lib/analytics/filter-context";
import { AnalyticsDataProvider, useAnalyticsData } from "@/lib/analytics/data-context";
import { upcomingGameFor, upcomingGameNote } from "@/lib/analytics/event-defaults";
import { useAnalyticsFilters } from "@/lib/analytics/filter-context";

/**
 * Everything the Analytics layout shares across subpages (P10): the filter
 * state (URL-backed), the single realtime data layer, the tabs, and the one
 * filter bar. Next keeps the layout mounted while the user moves between
 * subpages, so none of this re-subscribes or resets on navigation.
 *
 * `useSearchParams()` (the filter state) has to sit inside a Suspense
 * boundary; the fallback reserves roughly the filter bar's height so nothing
 * below it shifts when it resolves.
 */
export function AnalyticsShell({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<ShellFallback />}>
      <AnalyticsFilterProvider>
        <AnalyticsDataProvider>
          <AnalyticsTabs />
          <div className="mb-4">
            <AnalyticsFilterBar />
            <div className="mt-1 flex justify-end">
              <RefreshOldDataButton />
            </div>
          </div>
          <AnalyticsBody>{children}</AnalyticsBody>
        </AnalyticsDataProvider>
      </AnalyticsFilterProvider>
    </Suspense>
  );
}

/** The page, or - while a not-yet-announced game is selected - one line where its stats would be (it has no entries, and never borrows another game's). */
function AnalyticsBody({ children }: { children: React.ReactNode }) {
  const { filters } = useAnalyticsFilters();
  const data = useAnalyticsData();
  const upcoming = upcomingGameFor(data.upcomingGames, filters.gameId);
  if (upcoming) {
    return (
      <div className="glass-card p-12 text-center text-sm text-[var(--muted-foreground)]" role="status">
        {upcomingGameNote(upcoming.name)}
      </div>
    );
  }
  return <div>{children}</div>;
}

function ShellFallback() {
  return (
    <>
      <div className="glass-pill mb-6 h-[52px] w-full animate-pulse" />
      <div className="glass-card mb-4 h-[120px] animate-pulse" />
    </>
  );
}
