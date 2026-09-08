import PageShell from "../_components/PageShell";
import GlassCard from "../_components/GlassCard";
import { FormField, FormTextarea } from "../_components/FormField";

export default function JudgeBookPage() {
  return (
    <PageShell
      title="Judge Book"
      eyebrow="Scouting Tools"
      description="Compile award-submission talking points and team highlights."
    >
      <GlassCard accent="current">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-[var(--cs-text-dim)]">Award Notes</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Award Category" />
          <FormField label="Team" />
        </div>
        <div className="mt-4">
          <FormTextarea label="Talking Points" />
        </div>
      </GlassCard>
    </PageShell>
  );
}
