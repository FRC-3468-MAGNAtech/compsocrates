"use client";

import { useState } from "react";
import { AlertTriangle, Award } from "lucide-react";
import Link from "@/components/program/link";
import { AchievementCard } from "@/components/achievements/achievement-card";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { GlassSkeletonGrid } from "@/components/ui/glass-skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { AchievementIcon } from "@/components/achievements/achievement-icon";
import { earnedOnly, filterAndSort, groupByCategory, summarize, type AchievementFilter, type AchievementItem } from "@/lib/achievements/view";
import { progressText } from "@/components/achievements/achievement-card";

const FILTERS: { id: AchievementFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "earned", label: "Earned" },
  { id: "in-progress", label: "In progress" },
];

/**
 * The Achievements page body, as plain props (the connected page fetches; the browser-test fixture can render this). Grouped by category, a filter, "Next up"
 * order (the closest unearned first). `noTeam` adds the note that explains what unlocks them.
 */
export function AchievementsView({ items, noTeam }: { items: AchievementItem[]; noTeam: boolean }) {
  const [filter, setFilter] = useState<AchievementFilter>("all");
  const shown = filterAndSort(items, filter);
  const { earned, total } = summarize(items);
  const groups = groupByCategory(shown);

  return (
    <div className="flex flex-col gap-5" data-testid="achievements-view">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--muted-foreground)]" data-testid="achievements-count" aria-live="polite">
          {earned} of {total} earned
        </p>
        <Tabs value={filter} onValueChange={(v) => setFilter(v as AchievementFilter)}>
          <TabsList aria-label="Filter achievements">
            {FILTERS.map((f) => (
              <TabsTrigger key={f.id} value={f.id} className="min-h-11 px-4">
                {f.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {noTeam && (
        <GlassPanel data-testid="achievements-no-team" className="flex items-start gap-3 text-sm">
          <Award className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-primary)]" aria-hidden />
          <p className="text-[var(--muted-foreground)]">
            Achievements are earned by practicing and scouting with a team: practice sessions, accuracy, streaks, events attended and matches scouted. Join a team and your progress shows up here.
          </p>
        </GlassPanel>
      )}

      {shown.length === 0 && (
        <GlassPanel data-testid="achievements-empty" className="py-10 text-center text-sm text-[var(--muted-foreground)]">
          {filter === "earned" ? "Nothing earned yet. Pick one from In progress and get started." : filter === "in-progress" ? "Everything here is earned." : "There are no achievements to show."}
        </GlassPanel>
      )}

      {groups.map((g) => (
        <section key={g.category} aria-label={g.category} className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{g.category}</h2>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {g.items.map((i) => (
              <AchievementCard key={i.id} def={i.def} progress={i.progress} earned={i.progress.earned} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function AchievementsSkeleton() {
  return (
    <div aria-busy="true" data-testid="achievements-skeleton">
      <GlassSkeletonGrid count={6} />
    </div>
  );
}

export function AchievementsError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <GlassPanel data-testid="achievements-error" role="alert" className="flex flex-col items-center gap-3 py-10 text-center text-sm">
      <AlertTriangle className="h-5 w-5 text-red-400" aria-hidden />
      <p className="text-[var(--muted-foreground)]">{message}</p>
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          Try again
        </Button>
      )}
    </GlassPanel>
  );
}

/**
 * The profile's compact section. The person it belongs to sees how many they earned, the closest next one with its bar, and "See all". Anyone else
 * sees only what is EARNED (no counts of the rest, no bars). The caller decides whether the viewer may see the profile at all.
 */
export function AchievementsCompact({ items, isSelf }: { items: AchievementItem[]; isSelf: boolean }) {
  if (!isSelf) {
    const earned = earnedOnly(items);
    return (
      <section aria-label="Achievements" className="flex flex-col gap-3" data-testid="profile-achievements">
        <h2 className="text-sm font-semibold">Achievements</h2>
        <GlassPanel>
          {earned.length === 0 ? (
            <p data-testid="profile-no-badges" className="text-sm text-[var(--muted-foreground)]">
              No achievements earned yet.
            </p>
          ) : (
            <ul data-testid="profile-badges" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {earned.map((i) => (
                <AchievementTile key={i.id} item={i} />
              ))}
            </ul>
          )}
        </GlassPanel>
      </section>
    );
  }
  const { earned, total, next } = summarize(items);
  const done = earnedOnly(items);
  return (
    <section aria-label="Achievements" className="flex flex-col gap-3" data-testid="profile-achievements">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Achievements</h2>
        <span className="text-xs text-[var(--muted-foreground)]">
          {earned} of {total}
        </span>
      </div>
      <GlassPanel className="flex flex-col gap-4">
        {done.length === 0 ? (
          <p data-testid="profile-no-badges" className="text-sm text-[var(--muted-foreground)]">
            No achievements yet. They appear as practice and events add up.
          </p>
        ) : (
          <ul data-testid="profile-badges" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {done.map((i) => (
              <AchievementTile key={i.id} item={i} />
            ))}
          </ul>
        )}
        {next && (
          <div className="flex flex-col gap-1.5" data-testid="profile-next-achievement">
            <span className="text-xs font-medium">Next up: {next.def.name}</span>
            <Progress value={next.progress.current} max={next.progress.target} label={`Next achievement: ${next.def.name}`} valueText={progressText(next.def, next.progress)} />
            <span className="text-xs text-[var(--muted-foreground)]">{progressText(next.def, next.progress)}</span>
          </div>
        )}
        <Link href="/achievements" className="glass-pill inline-flex min-h-11 items-center self-start px-4 text-sm font-medium">
          See all
        </Link>
      </GlassPanel>
    </section>
  );
}

function AchievementTile({ item }: { item: AchievementItem }) {
  return (
    <li data-testid={`badge-${item.id}`} data-earned title={item.def.description} className="glass-card flex flex-col items-center gap-1.5 p-3 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full text-[var(--color-primary-foreground)]" style={{ background: "var(--theme-gradient)" }}>
        <AchievementIcon name={item.def.icon} className="h-5 w-5" />
      </span>
      <span className="text-xs font-medium">{item.def.name}</span>
      <span className="sr-only">Earned. {item.def.description}</span>
    </li>
  );
}
