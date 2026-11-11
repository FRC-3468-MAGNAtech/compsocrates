"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { ClimbChips, RobotChips, Stat, Yes, dash, weightLabel } from "@/components/analytics/rebuilt-parts";
import { Empty, Fact, LatestToggle, Skill, TeamChip } from "@/components/analytics/summary-parts";
import type { FormAnalyticsPage } from "@/lib/analytics/form-analytics";
import {
  CLIMB_LEVEL_LABELS,
  STRATEGY_REBUILT_ABILITIES,
  helperIssue,
  helperRebuiltAnalytics,
  helperWasSuccessful,
  leadRebuiltSummary,
  pitRebuiltOverview,
  pitRebuiltRows,
  planRebuiltRows,
  reflectionRebuiltRows,
  strategyRebuiltSummary,
  titleCase,
  wentToPlanRebuilt,
  type FuelScale,
  type PitRebuiltRow,
} from "@/lib/analytics/form-summaries-rebuilt";
import { BEST_AT_OPTIONS, STARTING_POSITIONS } from "@/data/cs/form-field-keys";
import type { FormEntry } from "@/lib/form-entries-model";
import type { Form } from "@/lib/forms/types";
import { cn } from "@/lib/utils";

// The REBUILT summary view of the six form Analytics pages: what CS's pages show for the same data, boiled down per team or per match. Reads the entries' stored values
// through lib/analytics/form-summaries-rebuilt.ts. The BIOBUZZ view is form-summaries-view.tsx; FormSummaryView picks between them from the page's form id.

type Props = { page: FormAnalyticsPage; form: Form; entries: FormEntry[]; allEntries: FormEntry[]; teamNames: ReadonlyMap<number, string>; hideNames: boolean };

const allianceText = (a: "red" | "blue" | null) => (a === "red" ? "Red" : a === "blue" ? "Blue" : "");
const allianceTone = (a: "red" | "blue" | null) => (a === "red" ? "border-red-400/30 bg-red-500/5" : a === "blue" ? "border-sky-400/30 bg-sky-500/5" : "border-[var(--glass-border)]");

export function RebuiltFormSummaryView(props: Props) {
  switch (props.page.slug) {
    case "lead-scout":
      return <LeadSummary {...props} />;
    case "pit-scout":
      return <PitSummary {...props} />;
    case "team-strategy":
      return <StrategySummary {...props} />;
    case "match-strategy":
      return <PlanSummary {...props} />;
    case "drive-reflection":
      return <ReflectionSummary {...props} />;
    case "helper":
      return <HelperSummary {...props} />;
  }
}

const scaleText = (s: FuelScale): string | null => (s.text === "" ? null : s.text);

// --- Lead Scout -----------------------------------------------------------------------------------------------

function LeadSummary({ entries, teamNames, hideNames }: Props) {
  const s = useMemo(() => leadRebuiltSummary(entries), [entries]);
  if (s.teams.length === 0 && s.alliances.length === 0) return <Empty>No Lead Scout entries yet.</Empty>;
  return (
    <div className="flex flex-col gap-4" data-testid="summary-lead-scout">
      <GlassPanel className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Average skill per team</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead className="text-left text-xs text-[var(--muted-foreground)]">
              <tr>
                <th className="py-1 pr-3 font-medium">Team</th>
                <th className="py-1 pr-3 font-medium">Avg skill (1-5)</th>
                <th className="py-1 pr-3 font-medium">Ratings</th>
                <th className="py-1 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {s.teams.map((t) => (
                <tr key={t.teamNumber} className="border-t border-[var(--glass-border)] align-top" data-testid={`lead-team-${t.teamNumber}`}>
                  <td className="py-2 pr-3">
                    <TeamChip team={t.teamNumber} names={teamNames} />
                  </td>
                  <td className="py-2 pr-3">
                    <Skill value={t.averageSkill} />
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{t.entries}</td>
                  <td className="py-2">
                    {t.notes.length === 0 ? (
                      <span className="text-[var(--muted-foreground)]">—</span>
                    ) : (
                      <ul className="flex flex-col gap-1">
                        {t.notes.slice(-3).map((n, i) => (
                          <li key={i} className="text-xs">
                            {n.matchKey && <span className="mr-1 font-mono text-[var(--muted-foreground)]">{n.matchKey}</span>}
                            {n.text}
                            {!hideNames && <span className="ml-1 text-[var(--muted-foreground)]">— {n.scoutName}</span>}
                          </li>
                        ))}
                        {t.notes.length > 3 && <li className="text-xs text-[var(--muted-foreground)]">+{t.notes.length - 3} earlier in the table</li>}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassPanel>

      <GlassPanel className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Alliances</h3>
        <ul className="flex flex-col gap-2">
          {s.alliances.map((a) => (
            <li key={a.key} className={cn("flex flex-col gap-2 rounded-2xl border px-3 py-2 text-sm", allianceTone(a.alliance))} data-testid={`lead-alliance-${a.matchKey}-${a.alliance ?? "none"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-semibold">{a.matchKey}</span>
                <span className="text-xs">{allianceText(a.alliance)}</span>
                <span className="flex flex-wrap gap-1">
                  {a.teams.map((t) => (
                    <TeamChip key={t} team={t} names={teamNames} />
                  ))}
                </span>
                <span className="ml-auto text-xs text-[var(--muted-foreground)]">Alliance skill</span>
                <Skill value={a.allianceSkill} />
              </div>
              {a.allianceNotes && <p className="text-xs">{a.allianceNotes}</p>}
              {a.robots.some((r) => r.skill !== null || r.notes) && (
                <ul className="flex flex-col gap-1 border-t border-[var(--glass-border)] pt-2">
                  {a.robots.map((r) => (
                    <li key={r.slot} className="flex flex-wrap items-center gap-2 text-xs">
                      <TeamChip team={r.team} names={teamNames} />
                      <Skill value={r.skill} />
                      {r.notes && <span className="min-w-0 flex-1">{r.notes}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {!hideNames && <p className="text-[11px] text-[var(--muted-foreground)]">{a.scoutName}</p>}
            </li>
          ))}
        </ul>
      </GlassPanel>
    </div>
  );
}

// --- Pit Scout ------------------------------------------------------------------------------------------------

function PitCard({ row, names, older }: { row: PitRebuiltRow; names: ReadonlyMap<number, string>; older?: boolean }) {
  return (
    <GlassPanel className={cn("flex flex-col gap-3", older && "opacity-80")} data-testid={`pit-card-${row.teamNumber}`}>
      <div className="flex flex-wrap items-center gap-2">
        <TeamChip team={row.teamNumber} names={names} />
        <span className="text-sm text-[var(--muted-foreground)]">{names.get(row.teamNumber) ?? ""}</span>
        {row.rookie === true && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-300">Rookie</span>}
        <span className="ml-auto text-[11px] text-[var(--muted-foreground)]">
          {row.eventCode}
          {row.entryCount > 1 ? ` · ${row.entryCount} entries` : ""}
        </span>
      </div>
      {row.pictureUrl ? (
        <a href={row.pictureUrl} target="_blank" rel="noreferrer noopener" className="block h-32 w-full overflow-hidden rounded-xl border border-[var(--glass-border)] sm:w-48" data-testid="pit-picture" aria-label={`Open the robot picture of team ${row.teamNumber}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a URL the scout pasted, on a host we don't configure for next/image */}
          <img src={row.pictureUrl} alt={`Team ${row.teamNumber} robot`} loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
        </a>
      ) : (
        <p className="text-xs text-[var(--muted-foreground)]">No picture.</p>
      )}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <Fact label="Weight" value={weightLabel(row)} />
        <Fact label="Preload" value={scaleText(row.preload)} />
        <Fact label="Balls per second" value={scaleText(row.ballsPerSecond)} />
        <Fact label="Carry" value={scaleText(row.carry)} />
        <Fact label="Fuel cycle" value={row.fuelCycleText ? `${row.fuelCycleText} s` : null} />
        <Fact label="Climb time" value={row.climbTimeText ? `${row.climbTimeText} s` : null} />
      </div>
      <div>
        <div className="mb-1 text-xs font-medium text-[var(--muted-foreground)]">Climb</div>
        <ClimbChips climb={row.climb} />
      </div>
      <p className="text-xs text-[var(--muted-foreground)]">
        Friendly in the pit: <strong className="font-medium text-[var(--foreground)]">{row.pitDisposition.text}</strong> · in drive: <strong className="font-medium text-[var(--foreground)]">{row.driveDisposition.text}</strong>
      </p>
      {row.autoCycle && (
        <div>
          <div className="text-xs font-medium text-[var(--muted-foreground)]">Auto cycle</div>
          <p className="text-sm">{row.autoCycle}</p>
        </div>
      )}
      {row.notes && <p className="text-xs">{row.notes}</p>}
    </GlassPanel>
  );
}

function PitSummary({ entries, teamNames }: Props) {
  const [showAll, setShowAll] = useState(false);
  const rows = useMemo(() => pitRebuiltRows(entries, { latestOnly: !showAll }), [entries, showAll]);
  const overview = useMemo(() => pitRebuiltOverview(pitRebuiltRows(entries)), [entries]);
  if (entries.length === 0) return <Empty>No Pit Scout entries yet.</Empty>;
  return (
    <div className="flex flex-col gap-3" data-testid="summary-pit-scout">
      <GlassPanel className="flex flex-wrap items-center gap-x-8 gap-y-3" data-testid="pit-overview">
        <Stat label="Teams pit scouted">{overview.teams}</Stat>
        {CLIMB_LEVEL_LABELS.map((label, i) => (
          <Stat key={label} label={`Can climb ${label.toLowerCase()}`} testId={`pit-climb-count-${i + 1}`}>
            {overview.climbCounts[i]}
          </Stat>
        ))}
        <Stat label="Average weight">{overview.averageWeightLb === null ? "—" : `${overview.averageWeightLb} lb`}</Stat>
      </GlassPanel>
      <LatestToggle showAll={showAll} onChange={setShowAll} what="team" />
      <div className="grid gap-3 lg:grid-cols-2">
        {rows.map((r) => (
          <PitCard key={r.entryId} row={r} names={teamNames} older={showAll} />
        ))}
      </div>
    </div>
  );
}

// --- Team Strategy --------------------------------------------------------------------------------------------

function CountChips({ options, counts, testPrefix }: { options: readonly { value: string; label: string }[]; counts: Record<string, number>; testPrefix: string }) {
  // every known option (so a zero shows), then any other value the entries hold
  const known = new Set(options.map((o) => o.value));
  const extra = Object.keys(counts).filter((k) => !known.has(k));
  return (
    <div className="flex flex-wrap gap-2">
      {[...options, ...extra.map((value) => ({ value, label: titleCase(value) }))].map((o) => (
        <span key={o.value} className="rounded-full border border-[var(--glass-border)] px-3 py-1 text-sm" data-testid={`${testPrefix}-${o.value}`}>
          {o.label} <strong className="ml-1 tabular-nums">{counts[o.value] ?? 0}</strong>
        </span>
      ))}
    </div>
  );
}

function StrategySummary({ entries, teamNames }: Props) {
  const [showAll, setShowAll] = useState(false);
  const s = useMemo(() => strategyRebuiltSummary(entries, { latestOnly: !showAll }), [entries, showAll]);
  if (entries.length === 0 || (s.rows.length === 0 && !showAll)) return <Empty>No Team Strategy entries yet.</Empty>;
  return (
    <div className="flex flex-col gap-4" data-testid="summary-team-strategy">
      <GlassPanel className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Teams per best-at</h3>
          <CountChips options={BEST_AT_OPTIONS} counts={s.bestAtCounts} testPrefix="best-count" />
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Teams per preferred starting position</h3>
          <CountChips options={STARTING_POSITIONS.filter((o) => o.value !== "not-there")} counts={s.startCounts} testPrefix="start-count" />
        </div>
        <div className="flex flex-wrap gap-2">
          {STRATEGY_REBUILT_ABILITIES.map((a) => (
            <span key={a.key} className="rounded-full border border-[var(--glass-border)] px-3 py-1 text-sm" data-testid={`ability-count-${a.key}`}>
              {a.label} <strong className="ml-1 tabular-nums">{s.abilityCounts[a.key]}</strong>
            </span>
          ))}
        </div>
      </GlassPanel>
      <LatestToggle showAll={showAll} onChange={setShowAll} what="team" />
      <GlassPanel className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-left text-xs text-[var(--muted-foreground)]">
            <tr>
              <th className="py-1 pr-3 font-medium">Team</th>
              <th className="py-1 pr-3 font-medium">Preferred start</th>
              <th className="py-1 pr-3 font-medium">Best at</th>
              {STRATEGY_REBUILT_ABILITIES.map((a) => (
                <th key={a.key} className="py-1 pr-3 font-medium">
                  {a.label}
                </th>
              ))}
              <th className="py-1 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {s.rows.map((r) => (
              <tr key={r.entryId} className="border-t border-[var(--glass-border)] align-top" data-testid={`strategy-row-${r.teamNumber}`}>
                <td className="py-2 pr-3">
                  <TeamChip team={r.teamNumber} names={teamNames} />
                </td>
                <td className="py-2 pr-3">{dash(titleCase(r.preferredStartingPosition))}</td>
                <td className="py-2 pr-3">{dash(titleCase(r.bestAt))}</td>
                {STRATEGY_REBUILT_ABILITIES.map((a) => (
                  <td key={a.key} className="py-2 pr-3">
                    <Yes on={r.abilities[a.key]} label={a.label} />
                  </td>
                ))}
                <td className="py-2 text-xs">{r.notes || <span className="text-[var(--muted-foreground)]">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </GlassPanel>
    </div>
  );
}

// --- Match Strategy and Drive Reflection ------------------------------------------------------------------------

function PlanSummary({ entries, teamNames }: Props) {
  const [showAll, setShowAll] = useState(false);
  const rows = useMemo(() => planRebuiltRows(entries, { latestOnly: !showAll }), [entries, showAll]);
  if (entries.length === 0) return <Empty>No Match Strategy entries yet.</Empty>;
  return (
    <div className="flex flex-col gap-3" data-testid="summary-match-strategy">
      <LatestToggle showAll={showAll} onChange={setShowAll} what="match and alliance" />
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.entryId} className={cn("flex flex-col gap-2 rounded-2xl border px-3 py-2 text-sm", allianceTone(r.alliance))} data-testid={`plan-${r.matchKey}-${r.entryId}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-semibold">{r.matchKey}</span>
              <span className="text-xs">{allianceText(r.alliance)}</span>
              <span className="flex flex-wrap gap-1">
                {r.robots.map((x) => (
                  <TeamChip key={x.team} team={x.team} names={teamNames} />
                ))}
              </span>
            </div>
            <RobotChips robots={r.robots} names={teamNames} />
            {r.notes && <p className="text-xs">{r.notes}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReflectionSummary({ entries, allEntries, teamNames }: Props) {
  const [showAll, setShowAll] = useState(false);
  const plans = useMemo(() => allEntries.filter((e) => e.formType === "match-strategy"), [allEntries]);
  const rows = useMemo(() => reflectionRebuiltRows(entries, plans, { latestOnly: !showAll }), [entries, plans, showAll]);
  const went = useMemo(() => wentToPlanRebuilt(reflectionRebuiltRows(entries, plans)), [entries, plans]);
  if (entries.length === 0) return <Empty>No Drive Reflection entries yet.</Empty>;
  return (
    <div className="flex flex-col gap-3" data-testid="summary-drive-reflection">
      <GlassPanel className="flex flex-wrap items-center gap-4">
        <Stat label="Matches that went to plan" testId="went-to-plan">
          {went.percent === null ? "—" : `${went.percent}%`}
        </Stat>
        <p className="text-xs text-[var(--muted-foreground)]">{went.planned === 0 ? "None of these matches had a Match Strategy to compare with." : `${went.onPlan} of ${went.planned} reflections that had a plan matched it (starting position, auto climb and endgame climb).`}</p>
      </GlassPanel>
      <LatestToggle showAll={showAll} onChange={setShowAll} what="match and alliance" />
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.entryId} className="flex flex-col gap-1.5 rounded-2xl border border-[var(--glass-border)] px-3 py-2 text-sm" data-testid={`reflection-${r.matchKey}-${r.entryId}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-semibold">{r.matchKey}</span>
              <span className="text-xs">{allianceText(r.alliance)}</span>
              {r.plan === null ? (
                <span className="text-xs text-[var(--muted-foreground)]">No plan to compare with</span>
              ) : r.differences.length > 0 ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-200" data-testid="plan-caution">
                  <AlertTriangle className="h-3 w-3" aria-hidden /> {r.differences.length} difference{r.differences.length === 1 ? "" : "s"} from the plan
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs text-emerald-300">
                  <Check className="h-3 w-3" aria-hidden /> As planned
                </span>
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {r.plan && (
                <div>
                  <div className="mb-1 text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Plan</div>
                  <RobotChips robots={r.plan.robots} names={teamNames} />
                </div>
              )}
              <div>
                <div className="mb-1 text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Actual</div>
                <RobotChips robots={r.robots} names={teamNames} />
              </div>
            </div>
            {r.differences.length > 0 && (
              <ul className="flex flex-col gap-0.5 text-xs text-amber-200" data-testid="plan-differences">
                {r.differences.map((d, i) => (
                  <li key={i}>
                    {d.team}: {d.field === "startingPosition" ? "starting position" : d.field === "autoClimb" ? "auto climb" : "endgame climb"} planned {d.planned}, actual {d.actual}
                  </li>
                ))}
              </ul>
            )}
            {r.notes && <p className="text-xs">{r.notes}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- Helper -----------------------------------------------------------------------------------------------------

function HelperSummary({ entries, teamNames, hideNames }: Props) {
  const a = useMemo(() => helperRebuiltAnalytics(entries), [entries]);
  if (a.total === 0) return <Empty>No pit assists logged yet.</Empty>;
  return (
    <div className="flex flex-col gap-4" data-testid="summary-helper">
      <GlassPanel className="flex flex-wrap items-center gap-4">
        <Stat label="Assists logged">{a.total}</Stat>
        <Stat label="Success rate">{a.rate === null ? "—" : `${a.rate}%`}</Stat>
      </GlassPanel>
      <GlassPanel className="overflow-x-auto">
        <h3 className="mb-2 text-sm font-semibold">Success rate per scout</h3>
        <table className="w-full min-w-[320px] text-sm">
          <thead className="text-left text-xs text-[var(--muted-foreground)]">
            <tr>
              <th className="py-1 pr-3 font-medium">Scout</th>
              <th className="py-1 pr-3 font-medium">Assists</th>
              <th className="py-1 pr-3 font-medium">Successful</th>
              <th className="py-1 font-medium">Rate</th>
            </tr>
          </thead>
          <tbody>
            {a.perScout.map((s, i) => (
              <tr key={s.scoutName} className="border-t border-[var(--glass-border)]" data-testid={`helper-scout-${i}`}>
                <td className="py-2 pr-3">{hideNames ? `Scout ${i + 1}` : s.scoutName}</td>
                <td className="py-2 pr-3 tabular-nums">{s.assists}</td>
                <td className="py-2 pr-3 tabular-nums">{s.successful}</td>
                <td className="py-2 tabular-nums">{s.rate === null ? "—" : `${s.rate}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </GlassPanel>
      <GlassPanel className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Assist log</h3>
        <ul className="flex flex-col gap-1.5">
          {a.log.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--glass-border)] px-3 py-2 text-sm">
              {typeof e.teamNumber === "number" ? <TeamChip team={e.teamNumber} names={teamNames} /> : <span>—</span>}
              <span className="min-w-0 flex-1 text-xs">{helperIssue(e)}</span>
              <span className={helperWasSuccessful(e) ? "text-xs text-emerald-300" : "text-xs text-amber-300"}>{helperWasSuccessful(e) ? "Solved" : "Not solved"}</span>
              <span className="text-[11px] text-[var(--muted-foreground)]">{e.eventCode}</span>
            </li>
          ))}
        </ul>
      </GlassPanel>
    </div>
  );
}
