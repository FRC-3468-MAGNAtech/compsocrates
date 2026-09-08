import PageShell from "../../_components/PageShell";
import GlassCard from "../../_components/GlassCard";
import { FormField, FormSelect, FormTextarea } from "../../_components/FormField";

export default function HelperForm() {
  return (
    <PageShell
      title="Helper Report"
      eyebrow="Forms"
      description="Catch-all report for volunteers and general observations."
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <GlassCard accent="amber">
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Reported By" />
            <FormSelect label="Category" options={["Logistics", "Equipment", "Safety", "Other"]} />
          </div>
        </GlassCard>
        <GlassCard accent="current">
          <FormTextarea label="Details" />
        </GlassCard>
      </div>
    </PageShell>
  );
}
