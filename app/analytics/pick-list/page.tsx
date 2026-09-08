import PageShell from "../../_components/PageShell";
import StatTile from "../../_components/StatTile";
import PlaceholderTable from "../../_components/PlaceholderTable";
import { ListChecks, Trophy, Gauge } from "lucide-react";

export default function PickListPage() {
  return (
    <PageShell
      title="Pick List"
      eyebrow="Analytics / Organized Data"
      description="Alliance selection pick list built from computed team ratings."
    >
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatTile label="Ranked Teams" value="—" icon={ListChecks} accent="current" />
        <StatTile label="First Pick" value="—" icon={Trophy} accent="signal" />
        <StatTile label="Data Confidence" value="—" icon={Gauge} accent="volt" />
      </div>
      <PlaceholderTable columns={["Rank", "Team", "Overall Rating", "Notes"]} />
    </PageShell>
  );
}
