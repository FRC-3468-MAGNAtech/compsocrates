import PageShell from "../_components/PageShell";
import StatTile from "../_components/StatTile";
import PlaceholderTable from "../_components/PlaceholderTable";
import { ListChecks, Users, Gauge } from "lucide-react";

export default function AssignmentsPage() {
  return (
    <PageShell
      title="Assignments"
      eyebrow="Management"
      description="Scouting station and duty assignments for the current event."
    >
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatTile label="Assignments" value="—" icon={ListChecks} accent="current" />
        <StatTile label="Scouts Assigned" value="—" icon={Users} accent="signal" />
        <StatTile label="Coverage" value="—" icon={Gauge} accent="volt" />
      </div>
      <PlaceholderTable columns={["Scout", "Role", "Station", "Match Range"]} />
    </PageShell>
  );
}
