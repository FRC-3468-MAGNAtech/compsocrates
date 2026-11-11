"use client";

import { Check, X } from "lucide-react";
import { CLIMB_LEVEL_LABELS, titleCase, type PitRebuiltRow, type PlanRobot } from "@/lib/analytics/form-summaries-rebuilt";
import { cn } from "@/lib/utils";

// Small pieces of the REBUILT summary views (the six Analytics summaries and the Team Profile section). Display only: every value is read in
// lib/analytics/form-summaries-rebuilt.ts.

export const dash = (v: string): string => (v ? v : "—");

export function Yes({ on, label }: { on: boolean; label?: string }) {
  return on ? <Check className="h-4 w-4 text-emerald-300" aria-label={label ? `${label}: yes` : "Yes"} /> : <X className="h-4 w-4 text-[var(--muted-foreground)]/50" aria-label={label ? `${label}: no` : "No"} />;
}

export function Stat({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">{label}</div>
      <div className="text-2xl font-semibold tabular-nums" data-testid={testId}>
        {children}
      </div>
    </div>
  );
}

/** Level 1, 2 and 3 as chips, a tick on the ones the team can do. */
export function ClimbChips({ climb }: { climb: PitRebuiltRow["climb"] }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Climb levels">
      {CLIMB_LEVEL_LABELS.map((label, i) => (
        <li key={label} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs", climb[i] ? "border-emerald-400/40 text-emerald-200" : "border-[var(--glass-border)] text-[var(--muted-foreground)]")} data-testid={`climb-${i + 1}`} data-on={climb[i] ? "true" : "false"}>
          <Yes on={climb[i]} label={label} /> {label}
        </li>
      ))}
    </ul>
  );
}

/** A plan's or a reflection's robots: team, starting position, role and the climbs. */
export function RobotChips({ robots, names }: { robots: PlanRobot[]; names: ReadonlyMap<number, string> }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {robots.map((r) => (
        <li key={r.slot} className="flex flex-wrap items-center gap-1.5 text-xs" title={names.get(r.team)} data-testid={`robot-${r.team}`}>
          <strong className="tabular-nums">{r.team}</strong>
          <span className="rounded-full border border-[var(--glass-border)] px-2 py-0.5">{dash(titleCase(r.startingPosition))}</span>
          <span className="rounded-full border border-[var(--glass-border)] px-2 py-0.5">{dash(titleCase(r.role))}</span>
          {r.autoClimb && <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] uppercase text-amber-200">Auto climb</span>}
          {r.endgameClimb && <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] uppercase text-sky-200">{titleCase(r.endgameClimb)}</span>}
        </li>
      ))}
    </ul>
  );
}

/** The robot weight as shown: free text, with "lb" added to a bare number. */
export const weightLabel = (row: Pick<PitRebuiltRow, "weightText">): string | null => (row.weightText ? (/^\d+(\.\d+)?$/.test(row.weightText) ? `${row.weightText} lb` : row.weightText) : null);
