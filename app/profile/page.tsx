import PageShell from "../_components/PageShell";
import GlassCard from "../_components/GlassCard";
import StatTile from "../_components/StatTile";
import { Trophy, ListChecks, Gauge } from "lucide-react";

export default function ProfilePage() {
  return (
    <PageShell title="Profile" eyebrow="Account" description="Your scouting activity and personal stats.">
      <div className="space-y-6">
        <GlassCard accent="volt" className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-[var(--cs-volt)] to-[var(--cs-current)] text-xl font-bold text-[#06210a]">
            AC
          </div>
          <div>
            <h2 className="text-lg font-bold text-[var(--cs-text)]">Ava Chen</h2>
            <p className="text-sm text-[var(--cs-text-dim)]">Lead Scout · Team 4029</p>
          </div>
        </GlassCard>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile label="Matches Scouted" value="118" icon={ListChecks} accent="current" />
          <StatTile label="Accuracy Score" value="96%" icon={Gauge} accent="volt" />
          <StatTile label="Events Attended" value="5" icon={Trophy} accent="signal" />
        </div>
      </div>
    </PageShell>
  );
}
