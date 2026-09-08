import PageShell from "../_components/PageShell";
import GlassCard from "../_components/GlassCard";
import { FormSelect } from "../_components/FormField";
import { CalendarClock } from "lucide-react";

export default function EventSelectionPage() {
  return (
    <PageShell
      title="Event Selection"
      eyebrow="Scouting Tools"
      description="Choose the active event that scouting data is scoped to."
    >
      <GlassCard accent="signal">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--cs-text-dim)]">Active Event</h2>
          <CalendarClock size={18} className="text-[var(--cs-signal)]" />
        </div>
        <FormSelect label="Event" options={["—"]} />
        <button
          disabled
          className="mt-6 rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-[var(--cs-text-dim)]"
        >
          Set Active Event
        </button>
      </GlassCard>
    </PageShell>
  );
}
