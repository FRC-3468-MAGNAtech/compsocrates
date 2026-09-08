import PageShell from "../../_components/PageShell";
import GlassCard from "../../_components/GlassCard";
import { FormField, FormSelect, FormTextarea } from "../../_components/FormField";

export default function DriveReflectionForm() {
  return (
    <PageShell
      title="Drive Reflection"
      eyebrow="Forms"
      description="Post-match debrief from the drive team's perspective."
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <GlassCard accent="volt">
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Match Number" />
            <FormSelect label="Overall Feel" options={["Great", "Okay", "Rough"]} />
            <FormField label="Battery Voltage" />
            <FormSelect label="Would Repeat Strategy" options={["Yes", "No", "Adjust"]} />
          </div>
        </GlassCard>
        <GlassCard accent="signal">
          <FormTextarea label="Reflection Notes" />
        </GlassCard>
      </div>
    </PageShell>
  );
}
