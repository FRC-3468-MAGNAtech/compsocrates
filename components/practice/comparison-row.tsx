import { comparisonColumns } from "@/components/practice/comparison-columns";

/** One labelled number tile of the practice results. */
export function Stat({ label, value, emphasize, signed }: { label: string; value: number | string; emphasize?: boolean; signed?: boolean }) {
  const display = signed && typeof value === "number" && value > 0 ? `+${value}` : String(value);
  return (
    <div className="glass-card flex flex-col gap-1 p-3">
      <span className="text-[11px] text-[var(--muted-foreground)]">{label}</span>
      <span className={emphasize ? "text-lg font-bold text-gradient" : "text-lg font-semibold"}>{display}</span>
    </div>
  );
}

/**
 * The Comparison row of the solo and the live practice results, for any alliance size: one tile per scouted robot (2 or 3), then the
 * penalties tile (`penalties` null: the match has no official score, so no tile) and the total.
 */
export function ComparisonRow({ robots, penalties, totalLabel, total }: { robots: readonly { team: number; total: number }[]; penalties: number | null; totalLabel: string; total: number }) {
  return (
    <div className={`grid grid-cols-2 gap-3 text-sm ${comparisonColumns(robots.length, penalties !== null)}`} data-testid="comparison-row">
      {robots.map((r) => (
        <Stat key={r.team} label={`Team ${r.team}`} value={r.total} />
      ))}
      {penalties !== null && <Stat label="+ Penalties" value={penalties} />}
      <Stat label={totalLabel} value={total} emphasize />
    </div>
  );
}
