"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ClimbChips, Yes, dash, weightLabel } from "@/components/analytics/rebuilt-parts";
import { Fact } from "@/components/analytics/summary-parts";
import { GlassPanel } from "@/components/ui/glass-panel";
import { useAnalyticsData } from "@/lib/analytics/data-context";
import { useAnalyticsFilters, useAnalyticsHref } from "@/lib/analytics/filter-context";
import { eventCodesForScope } from "@/lib/analytics/form-analytics";
import { STRATEGY_REBUILT_ABILITIES, teamRebuiltProfile, titleCase, type PlanCapability, type TeamRebuiltProfile } from "@/lib/analytics/form-summaries-rebuilt";
import { useAuth } from "@/lib/auth";
import { useFormEntries } from "@/lib/form-entries";

// The Team Profile's "Pit and strategy" section on REBUILT data: what CS's team breakdown shows (the pit scales, and how the team's match strategy plans and drive
// reflections compare) plus the strategy form and the lead scouts' skill and notes. The BIOBUZZ section is pit-and-strategy.tsx; PitAndStrategySection picks between them.

const TYPES = new Set(["pit-scout", "team-strategy", "lead-scout", "match-strategy", "drive-reflection"]);

export function RebuiltPitAndStrategySection({ teamNumber }: { teamNumber: number }) {
  const { profile } = useAuth();
  const { filters } = useAnalyticsFilters();
  const data = useAnalyticsData();
  const { entries, loaded } = useFormEntries(profile?.teamId ?? null);
  const codes = useMemo(() => eventCodesForScope(filters.events, data.activeEventCodes), [filters.events, data.activeEventCodes]);
  const inScope = useMemo(() => entries.filter((e) => TYPES.has(e.formType) && !e.excluded && (codes === null || codes.includes(e.eventCode))), [entries, codes]);
  const info = useMemo(() => teamRebuiltProfile(teamNumber, inScope), [teamNumber, inScope]);
  if (!loaded || !info.any) return null;
  return <RebuiltPitAndStrategyView teamNumber={teamNumber} info={info} />;
}

const rate = (v: number | null): string => (v === null ? "—" : `${v}%`);

function CapabilityComparison({ info }: { info: TeamRebuiltProfile }) {
  const { plan, reflection, pit } = info;
  if (plan.entries === 0 && reflection.entries === 0) return null;
  const pitClimb = pit ? (pit.highestClimb === 0 ? "None" : `Level ${pit.highestClimb}`) : "—";
  const rows: { label: string; pit: string; plan: string; reflection: string }[] = [
    { label: "Starting position", pit: "—", plan: dash(titleCase(plan.startingPosition)), reflection: dash(titleCase(reflection.startingPosition)) },
    { label: "Role", pit: "—", plan: dash(titleCase(plan.role)), reflection: dash(titleCase(reflection.role)) },
    { label: "Auto climb", pit: "—", plan: rate(plan.autoClimbRate), reflection: rate(reflection.autoClimbRate) },
    { label: "Endgame climb", pit: pitClimb, plan: dash(titleCase(plan.endgameClimb)), reflection: dash(titleCase(reflection.endgameClimb)) },
  ];
  const count = (c: PlanCapability) => `${c.entries} robot${c.entries === 1 ? "" : "s"}`;
  return (
    <div className="overflow-x-auto" data-testid="capability-comparison">
      <table className="w-full min-w-[420px] text-sm">
        <caption className="mb-1 text-left text-xs font-medium text-[var(--muted-foreground)]">Capability comparison</caption>
        <thead className="text-left text-xs text-[var(--muted-foreground)]">
          <tr>
            <th className="py-1 pr-3 font-medium">Capability</th>
            <th className="py-1 pr-3 font-medium">Pit scout</th>
            <th className="py-1 pr-3 font-medium">Match strategy ({count(plan)})</th>
            <th className="py-1 font-medium">Drive reflection ({count(reflection)})</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-[var(--glass-border)]" data-testid={`capability-${r.label.toLowerCase().replace(/\s+/g, "-")}`}>
              <th className="py-1.5 pr-3 text-left font-medium">{r.label}</th>
              <td className="py-1.5 pr-3">{r.pit}</td>
              <td className="py-1.5 pr-3">{r.plan}</td>
              <td className="py-1.5">{r.reflection}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RebuiltPitAndStrategyView({ teamNumber, info }: { teamNumber: number; info: TeamRebuiltProfile }) {
  const withFilters = useAnalyticsHref();
  const { pit, strategy, lead } = info;
  const abilities = strategy ? STRATEGY_REBUILT_ABILITIES.filter((a) => strategy.abilities[a.key]).map((a) => a.label) : [];
  return (
    <GlassPanel className="flex flex-col gap-4" data-testid="pit-and-strategy">
      <h2 className="text-base font-semibold">Pit and strategy</h2>

      {pit?.pictureUrl && (
        <a href={pit.pictureUrl} target="_blank" rel="noreferrer noopener" className="block h-24 w-32 shrink-0 overflow-hidden rounded-xl border border-[var(--glass-border)]" data-testid="profile-photos" aria-label={`Open the robot picture of team ${teamNumber}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a URL the scout pasted, on a host we don't configure for next/image */}
          <img src={pit.pictureUrl} alt={`Team ${teamNumber} robot`} loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
        </a>
      )}

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-5">
        {pit && <Fact label="Weight" value={weightLabel(pit)} />}
        {pit && <Fact label="Preload" value={pit.preload.text || null} />}
        {pit && <Fact label="Balls per second" value={pit.ballsPerSecond.text || null} />}
        {pit && <Fact label="Carry" value={pit.carry.text || null} />}
        {pit && <Fact label="Fuel cycle" value={pit.fuelCycleText ? `${pit.fuelCycleText} s` : null} />}
        {pit && <Fact label="Climb time" value={pit.climbTimeText ? `${pit.climbTimeText} s` : null} />}
        {strategy && <Fact label="Preferred start" value={strategy.preferredStartingPosition ? titleCase(strategy.preferredStartingPosition) : null} />}
        {strategy && <Fact label="Best at" value={strategy.bestAt ? titleCase(strategy.bestAt) : null} />}
        {lead.skill !== null && <Fact label={`Lead scout skill (${lead.ratings} rating${lead.ratings === 1 ? "" : "s"})`} value={`${lead.skill.toFixed(1)} / 5`} />}
      </div>

      {pit && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div>
            <div className="mb-1 text-xs font-medium text-[var(--muted-foreground)]">Climb</div>
            <ClimbChips climb={pit.climb} />
          </div>
          <p className="text-xs text-[var(--muted-foreground)]" data-testid="profile-disposition">
            Friendly in the pit: <strong className="font-medium text-[var(--foreground)]">{pit.pitDisposition.text}</strong> · in drive: <strong className="font-medium text-[var(--foreground)]">{pit.driveDisposition.text}</strong>
          </p>
        </div>
      )}

      {strategy && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" data-testid="profile-abilities">
          <span className="text-[var(--muted-foreground)]">Can:</span>
          {abilities.length === 0 ? (
            <span className="text-[var(--muted-foreground)]">no abilities ticked</span>
          ) : (
            STRATEGY_REBUILT_ABILITIES.filter((a) => strategy.abilities[a.key]).map((a) => (
              <span key={a.key} className="inline-flex items-center gap-1">
                <Yes on label={a.label} /> {a.label}
              </span>
            ))
          )}
        </div>
      )}

      {pit?.autoCycle && (
        <div>
          <div className="text-xs font-medium text-[var(--muted-foreground)]">Auto cycle</div>
          <p className="text-sm">{pit.autoCycle}</p>
        </div>
      )}

      <CapabilityComparison info={info} />

      {lead.notes.length > 0 && (
        <div data-testid="profile-lead-notes">
          <div className="mb-1 text-xs font-medium text-[var(--muted-foreground)]">Lead scout notes</div>
          <ul className="flex flex-col gap-1">
            {lead.notes.slice(0, 3).map((n, i) => (
              <li key={i} className="text-xs">
                {n.matchKey && <span className="mr-1 font-mono text-[var(--muted-foreground)]">{n.matchKey}</span>}
                {n.text}
              </li>
            ))}
            {lead.notes.length > 3 && <li className="text-xs text-[var(--muted-foreground)]">+{lead.notes.length - 3} more in Lead Scout Analytics</li>}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-3 text-sm">
        {pit && (
          <Link href={withFilters("/analytics/pit-scout", { view: "summary" })} className="inline-flex min-h-11 items-center gap-1 text-[var(--color-primary)] hover:underline">
            Pit Scout Analytics <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        )}
        {strategy && (
          <Link href={withFilters("/analytics/team-strategy", { view: "summary" })} className="inline-flex min-h-11 items-center gap-1 text-[var(--color-primary)] hover:underline">
            Team Strategy Analytics <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        )}
        {lead.ratings > 0 && (
          <Link href={withFilters("/analytics/lead-scout", { view: "summary" })} className="inline-flex min-h-11 items-center gap-1 text-[var(--color-primary)] hover:underline">
            Lead Scout Analytics <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        )}
        {info.plan.entries > 0 && (
          <Link href={withFilters("/analytics/match-strategy", { view: "summary" })} className="inline-flex min-h-11 items-center gap-1 text-[var(--color-primary)] hover:underline">
            Match Strategy Analytics <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        )}
        {info.reflection.entries > 0 && (
          <Link href={withFilters("/analytics/drive-reflection", { view: "summary" })} className="inline-flex min-h-11 items-center gap-1 text-[var(--color-primary)] hover:underline">
            Drive Reflection Analytics <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        )}
      </div>
    </GlassPanel>
  );
}
