import PageShell from "../../_components/PageShell";
import StatTile from "../../_components/StatTile";
import PlaceholderTable from "../../_components/PlaceholderTable";
import { ListChecks, Gauge, ListOrdered } from "lucide-react";

export default function HelperReportsAnalyticsPage() {
  return (
    <PageShell
      title="Helper Reports"
      eyebrow="Analytics / Raw Data"
      description="Raw helper submissions across the event."
    >
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatTile label="Submissions" value="—" icon={ListOrdered} accent="current" />
        <StatTile label="Helpers Active" value="—" icon={ListChecks} accent="signal" />
        <StatTile label="Avg per Helper" value="—" icon={Gauge} accent="volt" />
      </div>
      <PlaceholderTable columns={["Helper", "Task", "Notes", "Submitted"]} />
    </PageShell>
  );
}
