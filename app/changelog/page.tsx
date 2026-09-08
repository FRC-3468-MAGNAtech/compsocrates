import PageShell from "../_components/PageShell";
import GlassCard from "../_components/GlassCard";
import { History } from "lucide-react";

const entries = [
  { version: "v2.4.0", date: "2026-09-01", notes: "Added Robot Radar and Pick List analytics views." },
  { version: "v2.3.0", date: "2026-08-14", notes: "Introduced role-aware dashboards for all 9 roles." },
  { version: "v2.2.1", date: "2026-07-30", notes: "Fixed scout accuracy calculation edge cases." },
  { version: "v2.2.0", date: "2026-07-12", notes: "Launched practice scouting simulation mode." },
];

export default function ChangelogPage() {
  return (
    <PageShell title="Changelog" eyebrow="Management" description="Recent updates to the CompSocrates platform.">
      <div className="space-y-4">
        {entries.map((entry) => (
          <GlassCard key={entry.version} accent="current" className="flex items-start gap-4">
            <History size={18} className="mt-0.5 text-[var(--cs-current)]" />
            <div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-[var(--cs-volt)]">{entry.version}</span>
                <span className="text-xs text-[var(--cs-text-faint)]">{entry.date}</span>
              </div>
              <p className="mt-1 text-sm text-[var(--cs-text-dim)]">{entry.notes}</p>
            </div>
          </GlassCard>
        ))}
      </div>
    </PageShell>
  );
}
