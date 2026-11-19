"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Input } from "@/components/ui/input";
import { useMembershipsEnabled } from "@/lib/memberships/client";
import { friendlyMembershipError, MEMBERSHIP_TEXT } from "@/lib/memberships/strings";
import { useProgram } from "@/lib/program/context";
import { setAccountName, useTeamDoc } from "@/lib/team";

/** The longest organization name the rules in both programs accept. */
export const ORGANIZATION_NAME_MAX = 60;

/**
 * Team Settings: the team's optional "Organization name" (the team document's `accountName`), the same card for every program, for admins only. When set it is the name shown for the team in
 * the team switcher and My teams (above the robot team numbers); empty removes it. Hidden while the memberships kill switch is OFF (the name is only used by those screens) and for anyone who
 * is not an admin (the rules check that too). It reads the team document the page already has: no new read.
 */
export function OrganizationNameSection({ teamId, canEdit }: { teamId: string; canEdit: boolean }) {
  const enabled = useMembershipsEnabled();
  const program = useProgram();
  const { team, loaded } = useTeamDoc(enabled && canEdit ? teamId : null);
  const stored = typeof team?.accountName === "string" ? team.accountName : "";
  const [value, setValue] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  // Start the field from what is stored, once, and again whenever the stored name changes under it (another admin, or our own save).
  useEffect(() => {
    // Deliberate: the field follows the saved value.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValue(null);
  }, [stored]);
  if (!enabled || !canEdit) return null;
  const text = value ?? stored;
  const dirty = text.trim() !== stored.trim();

  const save = async () => {
    setSaving(true);
    setNote(null);
    try {
      await setAccountName(teamId, text, program);
      setNote({ kind: "ok", text: MEMBERSHIP_TEXT.members.orgSaved });
    } catch (err) {
      setNote({ kind: "error", text: friendlyMembershipError(err, "Couldn't save the name.") });
    } finally {
      setSaving(false);
    }
  };

  return (
    <GlassPanel className="flex flex-col gap-3" data-testid="organization-name-section">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{MEMBERSHIP_TEXT.members.orgTitle}</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">{MEMBERSHIP_TEXT.members.orgBody}</p>
      </div>
      {loaded ? (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (dirty && !saving) void save();
          }}
        >
          <Input aria-label={MEMBERSHIP_TEXT.members.orgTitle} value={text} maxLength={ORGANIZATION_NAME_MAX} onChange={(e) => setValue(e.target.value)} disabled={saving} className="sm:max-w-sm" />
          <Button type="submit" variant="glass" className="min-h-11" disabled={!dirty || saving}>
            {MEMBERSHIP_TEXT.members.orgSave}
          </Button>
        </form>
      ) : (
        <div className="glass-card h-11 animate-pulse" />
      )}
      {note && (
        <p role={note.kind === "error" ? "alert" : "status"} className={note.kind === "error" ? "text-sm text-red-300" : "text-sm text-emerald-300"}>
          {note.text}
        </p>
      )}
    </GlassPanel>
  );
}
