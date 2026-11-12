"use client";

import Link from "@/components/program/link";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { OurTeamTag } from "@/components/analytics/team-bits";
import { useAnalyticsHref } from "@/lib/analytics/filter-context";
import { useIsOurTeam } from "@/lib/our-team";

// Small pieces the summary views share (the form pages in form-summaries-rebuilt-view.tsx, the Team Profile section in pit-and-strategy-rebuilt.tsx).

/** A team number as a chip that links to the Team Profile (with the "us" tag for our own teams). */
export function TeamChip({ team, names }: { team: number; names: ReadonlyMap<number, string> }) {
  const ours = useIsOurTeam()(team);
  const href = useAnalyticsHref();
  return (
    <Link href={href(`/analytics/teams/${team}`)} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--glass-border)] px-2.5 py-1 text-xs font-semibold tabular-nums hover:bg-white/10" title={names.get(team)}>
      {team}
      {ours && <OurTeamTag />}
    </Link>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <GlassPanel className="py-10 text-center text-sm text-[var(--muted-foreground)]">{children}</GlassPanel>;
}

/** "Showing the latest entry per team. See all" toggle line. */
export function LatestToggle({ showAll, onChange, what }: { showAll: boolean; onChange: (v: boolean) => void; what: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted-foreground)]">
      <span>{showAll ? `Showing every entry for each ${what}.` : `Showing the latest entry for each ${what}.`}</span>
      <Button type="button" variant="glass" size="sm" onClick={() => onChange(!showAll)} data-testid="see-all-toggle">
        {showAll ? "Latest only" : "See all entries"}
      </Button>
    </div>
  );
}

/** A 1-5 skill as a number with a thin bar; a dash when there is none. */
export function Skill({ value }: { value: number | null }) {
  if (value === null) return <span className="text-[var(--muted-foreground)]">—</span>;
  return (
    <span className="inline-flex items-center gap-2 tabular-nums">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-white/10" aria-hidden>
        <span className="block h-full rounded-full" style={{ width: `${(value / 5) * 100}%`, background: "var(--theme-gradient)" }} />
      </span>
      {value.toFixed(1)}
    </span>
  );
}

export function Fact({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">{label}</div>
      <div className="tabular-nums">{value === null || value === "" ? "—" : value}</div>
    </div>
  );
}
