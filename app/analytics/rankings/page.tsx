import PageShell from "../../_components/PageShell";
import StatTile from "../../_components/StatTile";
import PlaceholderTable from "../../_components/PlaceholderTable";
import { Trophy, BarChart3, Gauge } from "lucide-react";

export default function RankingsPage() {
  return (
    <PageShell
      title="Rankings"
      eyebrow="Analytics / Organized Data"
      description="Computed team rankings based on aggregated performance."
    >
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatTile label="Ranked Teams" value="—" icon={BarChart3} accent="current" />
        <StatTile label="Top Team" value="—" icon={Trophy} accent="signal" />
        <StatTile label="Data Confidence" value="—" icon={Gauge} accent="volt" />
      </div>
      <PlaceholderTable columns={["Rank", "Team", "RP", "Record", "Rating"]} />
    </PageShell>
  );
}
