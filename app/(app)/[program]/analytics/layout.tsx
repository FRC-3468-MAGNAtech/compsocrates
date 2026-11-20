import { SnapshotFreshness } from "@/components/snapshot/snapshot-freshness";
import { AnalyticsShell } from "@/components/analytics/analytics-shell";

export default function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
          <SnapshotFreshness datasets={["roster", "library"]} />
        </div>
        <p className="text-sm text-[var(--muted-foreground)]">Everything the scouting data tells us, sliced a few ways.</p>
      </div>
      <AnalyticsShell>{children}</AnalyticsShell>
    </div>
  );
}
