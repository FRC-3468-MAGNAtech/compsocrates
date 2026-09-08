import PageShell from "../../_components/PageShell";
import StatTile from "../../_components/StatTile";
import PlaceholderTable from "../../_components/PlaceholderTable";
import { ShieldCheck, Gauge, BarChart3 } from "lucide-react";

export default function PerformanceReliabilityPage() {
  return (
    <PageShell
      title="Performance Reliability"
      eyebrow="Analytics / Organized Data"
      description="Computed consistency and reliability metrics per team."
    >
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatTile label="Teams Scored" value="—" icon={BarChart3} accent="current" />
        <StatTile label="Most Reliable" value="—" icon={ShieldCheck} accent="signal" />
        <StatTile label="Avg Std Dev" value="—" icon={Gauge} accent="volt" />
      </div>
      <PlaceholderTable columns={["Team", "Reliability Score", "Std Dev", "Trend"]} />
    </PageShell>
  );
}
