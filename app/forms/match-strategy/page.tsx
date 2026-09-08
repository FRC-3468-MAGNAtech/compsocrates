import PageShell from "../../_components/PageShell";
import GlassCard from "../../_components/GlassCard";
import { FormField, FormSelect, FormTextarea } from "../../_components/FormField";

export default function MatchStrategyForm() {
  return (
    <PageShell
      title="Match Strategy"
      eyebrow="Forms"
      description="Pre-match plan for a specific alliance matchup."
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <GlassCard accent="plasma">
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Match Number" />
            <FormSelect label="Alliance" options={["Red", "Blue"]} />
            <FormField label="Partner Teams" />
            <FormField label="Opponent Teams" />
          </div>
        </GlassCard>
        <GlassCard accent="current">
          <FormTextarea label="Game Plan" />
        </GlassCard>
      </div>
    </PageShell>
  );
}
