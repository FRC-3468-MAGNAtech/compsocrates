import PageShell from "../../_components/PageShell";
import GlassCard from "../../_components/GlassCard";
import { FormField, FormSelect, FormTextarea } from "../../_components/FormField";

export default function MatchScoutForm() {
  return (
    <PageShell
      title="Match Scout"
      eyebrow="Forms"
      description="Rapid-entry form for live match observation."
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <GlassCard accent="volt">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-[var(--cs-text-dim)]">Match Info</h2>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Match Number" />
            <FormSelect label="Alliance" options={["Red", "Blue"]} />
            <FormField label="Team Number" />
            <FormSelect label="Station" options={["1", "2", "3"]} />
          </div>
        </GlassCard>
        <GlassCard accent="current">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-[var(--cs-text-dim)]">Autonomous</h2>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Pieces Scored" />
            <FormSelect label="Left Starting Zone" options={["Yes", "No"]} />
          </div>
        </GlassCard>
        <GlassCard accent="signal">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-[var(--cs-text-dim)]">Teleop</h2>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Cycles Completed" />
            <FormField label="Avg Cycle Time (s)" />
            <FormSelect label="Defense Played" options={["None", "Light", "Heavy"]} />
          </div>
        </GlassCard>
        <GlassCard accent="amber">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-[var(--cs-text-dim)]">Endgame</h2>
          <div className="grid grid-cols-2 gap-4">
            <FormSelect label="Endgame State" options={["Parked", "Docked", "Climbed", "None"]} />
            <FormField label="Penalties" />
          </div>
        </GlassCard>
        <GlassCard className="lg:col-span-2">
          <FormTextarea label="Additional Notes" />
        </GlassCard>
      </div>
    </PageShell>
  );
}
