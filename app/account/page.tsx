import PageShell from "../_components/PageShell";
import GlassCard from "../_components/GlassCard";
import { FormField, FormSelect } from "../_components/FormField";

export default function AccountPage() {
  return (
    <PageShell title="Account" eyebrow="Account" description="Manage your login credentials and notification preferences.">
      <div className="grid gap-5 lg:grid-cols-2">
        <GlassCard accent="current">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-[var(--cs-text-dim)]">Credentials</h2>
          <div className="flex flex-col gap-4">
            <FormField label="Email" />
            <FormField label="Password" />
          </div>
        </GlassCard>
        <GlassCard accent="signal">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-[var(--cs-text-dim)]">Preferences</h2>
          <div className="flex flex-col gap-4">
            <FormSelect label="Notifications" options={["All", "Mentions Only", "None"]} />
            <FormSelect label="Theme" options={["Dark (Default)"]} />
          </div>
        </GlassCard>
      </div>
    </PageShell>
  );
}
