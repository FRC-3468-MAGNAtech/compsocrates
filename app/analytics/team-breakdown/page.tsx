import PageShell from "../../_components/PageShell";
import StatTile from "../../_components/StatTile";
import PlaceholderTable from "../../_components/PlaceholderTable";
import { BarChart3, Gauge, ListOrdered } from "lucide-react";

export default function TeamBreakdownPage() {
  return (
    <PageShell
      title="Team Breakdown"
      eyebrow="Analytics / Organized Data"
      description="Computed per-team match-by-match breakdown."
    >
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatTile label="Teams" value="—" icon={BarChart3} accent="current" />
        <StatTile label="Matches per Team" value="—" icon={ListOrdered} accent="signal" />
        <StatTile label="Data Confidence" value="—" icon={Gauge} accent="volt" />
      </div>
      <PlaceholderTable columns={["Team", "Match", "Score", "Trend"]} />
    </PageShell>
  );
}
