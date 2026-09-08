import PageShell from "../_components/PageShell";
import StatTile from "../_components/StatTile";
import PlaceholderTable from "../_components/PlaceholderTable";
import { ListOrdered, Swords, CalendarClock } from "lucide-react";

export default function MatchListPage() {
  return (
    <PageShell
      title="Match List"
      eyebrow="Scouting Tools"
      description="Full match schedule for the active event."
    >
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatTile label="Total Matches" value="—" icon={ListOrdered} accent="current" />
        <StatTile label="Completed" value="—" icon={Swords} accent="signal" />
        <StatTile label="Next Match" value="—" icon={CalendarClock} accent="volt" />
      </div>
      <PlaceholderTable columns={["Match", "Red Alliance", "Blue Alliance", "Time", "Status"]} />
    </PageShell>
  );
}
