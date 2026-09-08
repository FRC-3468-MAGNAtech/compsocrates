import PageShell from "../../_components/PageShell";
import GlassCard from "../../_components/GlassCard";
import { FormField, FormSelect, FormTextarea } from "../../_components/FormField";

export default function TeamStrategyForm() {
  return (
    <PageShell
      title="Team Strategy"
      eyebrow="Forms"
      description="Season-level strategic profile for a scouted team."
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <GlassCard accent="signal">
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Team Number" />
            <FormSelect label="Drivetrain" options={["Swerve", "Tank", "Mecanum", "Other"]} />
            <FormSelect label="Preferred Role" options={["Scorer", "Defender", "Support"]} />
            <FormField label="Avg Auto Pieces" />
          </div>
        </GlassCard>
        <GlassCard accent="volt">
          <FormTextarea label="Strategic Notes" />
        </GlassCard>
      </div>
    </PageShell>
  );
}
