import { GlassPanel } from "@/components/ui/glass-panel";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { getPercentColor } from "@/lib/accuracy/engine";
import type { ScoutCategory, UnassignedStats } from "@/lib/scout-stats/types";

/**
 * Admin-only: sessions and entries whose scout is not on the team's roster (no scout id, or someone who left). They are counted here instead of being dropped,
 * so a gap in a scout's numbers can be traced.
 */
export function UnassignedRow({ category, stats }: { category: ScoutCategory; stats: UnassignedStats }) {
  const practice = category !== "real-event";
  return (
    <GlassPanel className="flex flex-col gap-2" data-testid="unassigned-row">
      <div>
        <h2 className="text-sm font-semibold">Unassigned</h2>
        <p className="text-xs text-[var(--muted-foreground)]">Data with no scout on the roster. It is not part of any scout&apos;s numbers above.</p>
      </div>
      <Table>
        <THead>
          <TR>
            <TH>Row</TH>
            {practice && <TH>Sessions</TH>}
            <TH>Entries</TH>
            {practice && <TH>Avg accuracy</TH>}
          </TR>
        </THead>
        <TBody>
          <TR>
            <TD>Unassigned</TD>
            {practice && <TD className="tabular-nums">{stats.sessions}</TD>}
            <TD className="tabular-nums">{stats.entries}</TD>
            {practice && (
              <TD className={`tabular-nums ${stats.averageAccuracy !== null ? getPercentColor(stats.averageAccuracy) : ""}`}>
                {stats.averageAccuracy === null ? "?" : `${Math.round(stats.averageAccuracy)}%`}
              </TD>
            )}
          </TR>
        </TBody>
      </Table>
    </GlassPanel>
  );
}
