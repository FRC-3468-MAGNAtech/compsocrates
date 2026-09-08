"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import PageShell from "../_components/PageShell";
import RoleDashboard, { Role, ROLE_OPTIONS } from "../_components/RoleDashboard";

function RoleSelector({ role, onChange }: { role: Role; onChange: (r: Role) => void }) {
  return (
    <select
      value={role}
      onChange={(e) => onChange(e.target.value as Role)}
      className="rounded-xl border border-[var(--cs-border-strong)] bg-white/[0.04] px-3 py-2 text-sm font-medium text-[var(--cs-text)] outline-none"
    >
      {ROLE_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value} className="bg-[#0a0e1a]">
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function DashboardInner() {
  const params = useSearchParams();
  const initial = (params.get("role") as Role) ?? "match-scout";
  const [role, setRole] = useState<Role>(
    ROLE_OPTIONS.some((o) => o.value === initial) ? initial : "match-scout"
  );

  useEffect(() => {
    const fromQuery = params.get("role") as Role | null;
    if (fromQuery && ROLE_OPTIONS.some((o) => o.value === fromQuery)) {
      setRole(fromQuery);
    }
  }, [params]);

  const label = ROLE_OPTIONS.find((o) => o.value === role)?.label ?? "";

  return (
    <PageShell
      title={`${label} Dashboard`}
      eyebrow="Dashboard"
      description="Mock role switcher — swap the view to preview each role's dashboard shell."
      actions={<RoleSelector role={role} onChange={setRole} />}
    >
      <RoleDashboard role={role} />
    </PageShell>
  );
}

export default function DashboardClient() {
  return (
    <Suspense fallback={null}>
      <DashboardInner />
    </Suspense>
  );
}
