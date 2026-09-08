import PageShell from "../_components/PageShell";
import StatTile from "../_components/StatTile";
import PlaceholderTable from "../_components/PlaceholderTable";
import { Users2, ShieldCheck, Wrench } from "lucide-react";

export default function TeamManagementPage() {
  return (
    <PageShell
      title="Team Management"
      eyebrow="Management"
      description="Roster, subteams, and roles for your own FRC team."
    >
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile label="Roster Size" value="34" icon={Users2} accent="signal" />
          <StatTile label="Subteams" value="5" icon={Wrench} accent="volt" />
          <StatTile label="Active Mentors" value="6" icon={ShieldCheck} accent="current" />
        </div>
        <PlaceholderTable columns={["Member", "Subteam", "Role", "Status"]} rows={6} />
      </div>
    </PageShell>
  );
}
