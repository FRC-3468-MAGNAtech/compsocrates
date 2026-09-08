import PageShell from "../../_components/PageShell";
import StatTile from "../../_components/StatTile";
import PlaceholderTable from "../../_components/PlaceholderTable";
import { BookOpenCheck, Gauge, ListOrdered } from "lucide-react";

export default function DriveReflectionAnalyticsPage() {
  return (
    <PageShell
      title="Drive Reflection Data"
      eyebrow="Analytics / Raw Data"
      description="Raw driver reflection submissions across the event."
    >
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatTile label="Submissions" value="—" icon={ListOrdered} accent="current" />
        <StatTile label="Matches Covered" value="—" icon={BookOpenCheck} accent="signal" />
        <StatTile label="Avg per Match" value="—" icon={Gauge} accent="volt" />
      </div>
      <PlaceholderTable columns={["Match", "Driver", "Reflection", "Submitted"]} />
    </PageShell>
  );
}
