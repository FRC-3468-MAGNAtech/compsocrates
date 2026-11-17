"use client";

import { useState } from "react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Switch } from "@/components/ui/switch";
import { useMembershipsEnabled } from "@/lib/memberships/client";
import { friendlyMembershipError, MEMBERSHIP_TEXT } from "@/lib/memberships/strings";
import { useProgram } from "@/lib/program/context";
import { setAllowMemberRoleChoice, useTeamDoc } from "@/lib/team";

/**
 * Team Settings: "Let joiners choose their role" (ADDITIVE team field `allowMemberRoleChoice`, default OFF), the same card for every program. ON: the Join screen shows a
 * role select for this team and the pending-request card shows the role asked for and lets an admin change it. The server still decides at approval, and an admin role is never
 * a choice. Hidden while the memberships kill switch is OFF; only an admin can change it (the rules check that too).
 */
export function RoleChoiceSection({ teamId, canEdit }: { teamId: string; canEdit: boolean }) {
  const enabled = useMembershipsEnabled();
  const program = useProgram();
  const { team, loaded } = useTeamDoc(enabled ? teamId : null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!enabled) return null;
  const on = team?.allowMemberRoleChoice === true;

  const save = async (value: boolean) => {
    setSaving(true);
    setError(null);
    try {
      await setAllowMemberRoleChoice(teamId, value, program);
    } catch (err) {
      setError(friendlyMembershipError(err, "Couldn't save that setting."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <GlassPanel className="flex flex-col gap-3" data-testid="role-choice-section">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="role-choice-label" className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            {MEMBERSHIP_TEXT.members.roleChoiceTitle}
          </h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">{MEMBERSHIP_TEXT.members.roleChoiceBody}</p>
        </div>
        {loaded ? (
          <Switch aria-labelledby="role-choice-label" checked={on} disabled={!canEdit || saving} onCheckedChange={(v) => void save(v)} className="mt-1" />
        ) : (
          <div className="glass-card mt-1 h-7 w-12 animate-pulse rounded-full" />
        )}
      </div>
      {!canEdit && <p className="text-xs text-[var(--muted-foreground)]">Only a team admin can change this.</p>}
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
    </GlassPanel>
  );
}
