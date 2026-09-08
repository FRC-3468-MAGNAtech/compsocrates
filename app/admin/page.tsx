import PageShell from "../_components/PageShell";
import GlassCard from "../_components/GlassCard";
import StatTile from "../_components/StatTile";
import { ShieldAlert, Database, Users } from "lucide-react";

export default function AdminPage() {
  return (
    <PageShell
      title="Admin"
      eyebrow="Management"
      description="System-level configuration and access control."
    >
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile label="Total Users" value="34" icon={Users} accent="signal" />
          <StatTile label="Data Records" value="1,204" icon={Database} accent="current" />
          <StatTile label="Pending Approvals" value="2" icon={ShieldAlert} accent="plasma" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <GlassCard accent="plasma">
            <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-[var(--cs-text-dim)]">Access Control</h3>
            <p className="text-sm text-[var(--cs-text-dim)]">Manage role permissions and event-level access.</p>
          </GlassCard>
          <GlassCard accent="current">
            <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-[var(--cs-text-dim)]">Data Management</h3>
            <p className="text-sm text-[var(--cs-text-dim)]">Export, reset, or archive scouting data for the event.</p>
          </GlassCard>
        </div>
      </div>
    </PageShell>
  );
}
