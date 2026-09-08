import PageShell from "../_components/PageShell";
import StatTile from "../_components/StatTile";
import PlaceholderTable from "../_components/PlaceholderTable";
import { Gauge, UserCog, ShieldCheck } from "lucide-react";

export default function ScoutAccuracyPage() {
  return (
    <PageShell
      title="Scout Accuracy"
      eyebrow="Scouting Tools"
      description="Track how closely each scout's submissions match verified outcomes."
    >
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatTile label="Scouts Tracked" value="—" icon={UserCog} accent="current" />
        <StatTile label="Avg Accuracy" value="—" icon={ShieldCheck} accent="signal" />
        <StatTile label="Top Scout" value="—" icon={Gauge} accent="volt" />
      </div>
      <PlaceholderTable columns={["Scout", "Submissions", "Accuracy", "Trend"]} />
    </PageShell>
  );
}
