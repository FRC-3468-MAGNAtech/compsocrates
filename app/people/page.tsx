import PageShell from "../_components/PageShell";
import StatTile from "../_components/StatTile";
import PlaceholderTable from "../_components/PlaceholderTable";
import { Users, UserCog, ShieldCheck } from "lucide-react";

export default function PeoplePage() {
  return (
    <PageShell
      title="People"
      eyebrow="Management"
      description="Directory of every member, scout, and staff account."
    >
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatTile label="Total Members" value="—" icon={Users} accent="current" />
        <StatTile label="Active Scouts" value="—" icon={UserCog} accent="signal" />
        <StatTile label="Verified Accounts" value="—" icon={ShieldCheck} accent="volt" />
      </div>
      <PlaceholderTable columns={["Name", "Role", "Team", "Status"]} />
    </PageShell>
  );
}
