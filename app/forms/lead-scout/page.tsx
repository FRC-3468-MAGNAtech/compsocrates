import PageShell from "../../_components/PageShell";
import GlassCard from "../../_components/GlassCard";
import { FormField, FormSelect, FormTextarea } from "../../_components/FormField";

export default function LeadScoutForm() {
  return (
    <PageShell
      title="Lead Scout"
      eyebrow="Forms"
      description="Shift oversight, conflict resolution, and coverage notes."
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <GlassCard accent="current">
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Shift Block" />
            <FormField label="Scouts On Duty" />
            <FormSelect label="Coverage Status" options={["Full", "Partial", "Understaffed"]} />
            <FormField label="Conflicts Flagged" />
          </div>
        </GlassCard>
        <GlassCard accent="plasma">
          <FormTextarea label="Handoff Notes" />
        </GlassCard>
      </div>
    </PageShell>
  );
}
