import PageShell from "../../_components/PageShell";
import GlassCard from "../../_components/GlassCard";
import { FormSelect } from "../../_components/FormField";
import { Radar } from "lucide-react";

export default function RobotRadarPage() {
  return (
    <PageShell
      title="Robot Radar"
      eyebrow="Analytics / Organized Data"
      description="Compare team capability profiles across key performance axes."
    >
      <GlassCard accent="signal">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--cs-text-dim)]">Compare Teams</h2>
          <Radar size={18} className="text-[var(--cs-signal)]" />
        </div>
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <FormSelect label="Team A" options={["—"]} />
          <FormSelect label="Team B" options={["—"]} />
          <FormSelect label="Team C" options={["—"]} />
        </div>
        <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed border-[var(--cs-border)] text-sm text-[var(--cs-text-faint)]">
          Radar chart placeholder
        </div>
      </GlassCard>
    </PageShell>
  );
}
