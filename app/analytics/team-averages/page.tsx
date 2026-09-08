import PageShell from "../../_components/PageShell";
import StatTile from "../../_components/StatTile";
import PlaceholderTable from "../../_components/PlaceholderTable";
import { BarChart3, Gauge, Trophy } from "lucide-react";

export default function TeamAveragesPage() {
  return (
    <PageShell
      title="Team Averages"
      eyebrow="Analytics / Organized Data"
      description="Computed per-team performance averages across all matches."
    >
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatTile label="Teams" value="—" icon={BarChart3} accent="current" />
        <StatTile label="Top Average" value="—" icon={Trophy} accent="signal" />
        <StatTile label="Data Confidence" value="—" icon={Gauge} accent="volt" />
      </div>
      <PlaceholderTable columns={["Team", "Auto Avg", "Teleop Avg", "Endgame Avg", "Total Avg"]} />
    </PageShell>
  );
}
