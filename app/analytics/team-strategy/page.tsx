import PageShell from "../../_components/PageShell";
import StatTile from "../../_components/StatTile";
import PlaceholderTable from "../../_components/PlaceholderTable";
import { Wrench, Gauge, ListOrdered } from "lucide-react";

export default function TeamStrategyAnalyticsPage() {
  return (
    <PageShell
      title="Team Strategy Data"
      eyebrow="Analytics / Raw Data"
      description="Raw team strategy submissions across the event."
    >
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatTile label="Submissions" value="—" icon={ListOrdered} accent="current" />
        <StatTile label="Teams Covered" value="—" icon={Wrench} accent="signal" />
        <StatTile label="Avg per Team" value="—" icon={Gauge} accent="volt" />
      </div>
      <PlaceholderTable columns={["Team", "Strategy", "Scout", "Submitted"]} />
    </PageShell>
  );
}
