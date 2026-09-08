import PageShell from "../../_components/PageShell";
import StatTile from "../../_components/StatTile";
import PlaceholderTable from "../../_components/PlaceholderTable";
import { ListOrdered, Swords, Gauge } from "lucide-react";

export default function MatchBreakdownPage() {
  return (
    <PageShell
      title="Match Breakdown"
      eyebrow="Analytics / Organized Data"
      description="Computed per-match breakdown of alliance performance."
    >
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatTile label="Matches" value="—" icon={Swords} accent="current" />
        <StatTile label="Avg Margin" value="—" icon={Gauge} accent="signal" />
        <StatTile label="Data Confidence" value="—" icon={ListOrdered} accent="volt" />
      </div>
      <PlaceholderTable columns={["Match", "Red Alliance", "Blue Alliance", "Winner"]} />
    </PageShell>
  );
}
