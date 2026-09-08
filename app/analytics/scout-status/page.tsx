import PageShell from "../../_components/PageShell";
import StatTile from "../../_components/StatTile";
import PlaceholderTable from "../../_components/PlaceholderTable";
import { UserCog, Gauge, ListOrdered } from "lucide-react";

export default function ScoutStatusPage() {
  return (
    <PageShell
      title="Scout Status"
      eyebrow="Analytics / Organized Data"
      description="Live status of each scout's submission activity and coverage."
    >
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatTile label="Active Scouts" value="—" icon={UserCog} accent="current" />
        <StatTile label="Assignments Filled" value="—" icon={ListOrdered} accent="signal" />
        <StatTile label="Avg Response Time" value="—" icon={Gauge} accent="volt" />
      </div>
      <PlaceholderTable columns={["Scout", "Assignment", "Status", "Last Submission"]} />
    </PageShell>
  );
}
