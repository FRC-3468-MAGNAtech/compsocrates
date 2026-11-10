"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { LowSampleBadge } from "@/components/analytics/team-bits";
import { ReliabilityScatter } from "@/components/analytics/reliability-scatter";
import { ScoreChart } from "@/components/analytics/score-chart";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Input } from "@/components/ui/input";
import { Shimmer } from "@/components/ui/shimmer";
import { useAnalyticsEntries, useTeamStats } from "@/lib/analytics/data-context";
import { SAMPLE_WARNING_THRESHOLD, buildTeamReliability, isLowSample, teamFromSearch } from "@/lib/analytics/performance-reliability";
import { cn } from "@/lib/utils";

/**
 * Performance Reliability: every team's power (mean score) against its consistency (standard deviation), and a match-by-match trend for
 * the team picked from the chart or the table. Uses the shared filters, including the Accuracy threshold.
 */
export function PerformanceReliabilityView() {
  const { entries, loaded, filters } = useAnalyticsEntries();
  const { teamStats } = useTeamStats();
  const [picked, setPicked] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  const teams = useMemo(() => buildTeamReliability(entries), [entries]);
  const highlighted = useMemo(() => teamFromSearch(search, teams), [search, teams]);
  // A team that left the filtered list stops being selected; the first team stands in until one is picked (CS's behavior).
  const activeTeam = highlighted ?? (picked !== null && teams.some((t) => t.teamNumber === picked) ? picked : (teams[0]?.teamNumber ?? null));
  const active = teams.find((t) => t.teamNumber === activeTeam) ?? null;
  const matches = useMemo(() => teamStats.find((t) => t.teamNumber === activeTeam)?.matchesScouted ?? [], [teamStats, activeTeam]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Performance Reliability</h2>
          <p className="max-w-2xl text-sm text-[var(--muted-foreground)]">
            Power is a team&apos;s average match score. Consistency is the standard deviation of those scores (lower is steadier). Pick a team to see every match.
          </p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a team number..." className="pl-10" inputMode="numeric" aria-label="Find a team number" />
        </div>
      </div>

      {!loaded ? (
        <div aria-busy="true" aria-label="Loading performance reliability" className="flex flex-col gap-3">
          <Shimmer className="h-72" />
          <Shimmer className="h-40" />
        </div>
      ) : teams.length === 0 ? (
        <GlassPanel className="py-12 text-center text-sm text-[var(--muted-foreground)]">
          No scouted data with the current filters.{" "}
          {filters.accuracy !== null ? "Try lowering the Accuracy threshold, or confirm accuracy has been recalculated." : "Try widening the Event or Practice settings above."}
        </GlassPanel>
      ) : (
        <>
          <GlassPanel className="p-4">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold">Power vs Consistency</h3>
                <p className="text-sm text-[var(--muted-foreground)]">Each dot is a team. Select one to load its match-by-match trend.</p>
              </div>
              <span className="text-xs text-[var(--muted-foreground)]">{teams.length} teams</span>
            </div>
            <ReliabilityScatter teams={teams} activeTeam={activeTeam} highlightedTeam={highlighted} onSelect={setPicked} />
          </GlassPanel>

          {active && (
            <GlassPanel className="p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold">Match trend</h3>
                  <p className="text-sm text-[var(--muted-foreground)]">Raw scores across every match for the selected team.</p>
                </div>
                <span className="text-sm font-semibold tabular-nums">Team {active.teamNumber}</span>
              </div>
              <dl className="mb-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <Stat label="Avg score" value={active.avgScore.toFixed(1)} />
                <Stat label="Std dev" value={active.stdDev.toFixed(1)} />
                <Stat label="Matches" value={String(active.entriesCount)} />
                <Stat label="Accuracy filter" value={filters.accuracy === null ? "ALL" : `${filters.accuracy}%`} />
              </dl>
              {isLowSample(active.entriesCount) && (
                <p className="mb-3 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200" role="status">
                  Low sample size{filters.accuracy !== null ? " at this accuracy level" : ""}: fewer than {SAMPLE_WARNING_THRESHOLD} matches.
                </p>
              )}
              <ScoreChart matches={matches} average={active.avgScore} />
            </GlassPanel>
          )}

          <GlassPanel className="p-0">
            <h3 className="px-4 pt-4 text-base font-semibold">All teams</h3>
            <p className="px-4 pb-2 text-sm text-[var(--muted-foreground)]">The numbers behind the chart. Select a row to show that team&apos;s trend.</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[28rem] text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                    <th scope="col" className="px-4 py-2 font-medium">
                      Team
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">
                      Matches
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">
                      Avg score
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">
                      Std dev
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {teams.map((t) => (
                    <tr key={t.teamNumber} className={cn("border-t border-[var(--glass-border)]", t.teamNumber === activeTeam && "bg-[rgba(var(--glow),0.12)]")}>
                      <th scope="row" className="px-1 py-0 text-left font-normal">
                        <Button variant="ghost" size="md" className="min-h-11 w-full justify-start rounded-xl px-3 font-semibold tabular-nums" aria-pressed={t.teamNumber === activeTeam} onClick={() => setPicked(t.teamNumber)}>
                          {t.teamNumber}
                          {isLowSample(t.entriesCount) && <LowSampleBadge entryCount={t.entriesCount} min={SAMPLE_WARNING_THRESHOLD} />}
                        </Button>
                      </th>
                      <td className="px-4 py-2 text-right tabular-nums">{t.entriesCount}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{t.avgScore.toFixed(1)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{t.stdDev.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </GlassPanel>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-[var(--muted-foreground)]">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
