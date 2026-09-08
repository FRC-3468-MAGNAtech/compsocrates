import PageShell from "../_components/PageShell";
import GlassCard from "../_components/GlassCard";
import { FormField, FormSelect } from "../_components/FormField";

export default function PracticeScoutingPage() {
  return (
    <PageShell
      title="Practice Scouting"
      eyebrow="Scouting Tools"
      description="Run practice reps to train new scouts before the event starts."
    >
      <GlassCard accent="volt">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-[var(--cs-text-dim)]">Practice Session</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormSelect label="Trainee" options={["—"]} />
          <FormSelect label="Video Source" options={["Live Match", "Recorded Match"]} />
          <FormField label="Match Reference" />
          <FormField label="Session Notes" />
        </div>
        <button
          disabled
          className="mt-6 rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-[var(--cs-text-dim)]"
        >
          Start Session
        </button>
      </GlassCard>
    </PageShell>
  );
}
