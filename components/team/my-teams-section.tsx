"use client";

import { useState } from "react";
import { LogOut, ShieldCheck } from "lucide-react";
import { ConfirmDialog } from "@/components/scout/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { useAccountState, refreshAccountState } from "@/lib/account-state";
import { useAuth } from "@/lib/auth";
import { membershipApi, useMembershipsEnabled } from "@/lib/memberships/client";
import { friendlyMembershipError, MEMBERSHIP_TEXT } from "@/lib/memberships/strings";
import { useOurTeam } from "@/lib/our-team";
import { useProgram, useProgramConfig } from "@/lib/program/context";
import { getRole } from "@/lib/roles";
import { invalidateRoster } from "@/lib/team-roster";
import { teamLabel } from "@/lib/team-number";

/**
 * Account Settings > My teams: the teams this account is on in this program (the same card for every program): the team, the program it belongs to, the person's role
 * there, an Owner badge, and Leave. Leaving asks first and says what happens; the server refuses the only admin of a team that still has members and an owner who has
 * not transferred ownership, and its words are shown as they are. Hidden entirely while the memberships kill switch is OFF (then nothing here is read).
 */
export function MyTeamsSection() {
  const enabled = useMembershipsEnabled();
  if (!enabled) return null;
  return <MyTeamsList />;
}

function MyTeamsList() {
  const state = useAccountState();
  const { user } = useAuth();
  const program = useProgram();
  const { brand } = useProgramConfig();
  const ours = useOurTeam();
  const [leaving, setLeaving] = useState<{ id: string; label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const active = state.memberships.filter((m) => m.status === "active");
  const labelOf = (teamId: string, stored?: string) => (teamId === state.activeTeamId && ours.number !== null ? teamLabel(ours.number, ours.name) : stored || `Team ${teamId}`);

  const leave = async () => {
    if (!leaving) return;
    setBusy(true);
    setNote(null);
    try {
      await membershipApi.leave(program, leaving.id);
      invalidateRoster();
      refreshAccountState(user?.uid);
      setNote({ kind: "ok", text: MEMBERSHIP_TEXT.myTeams.left(leaving.label) });
    } catch (err) {
      setNote({ kind: "error", text: friendlyMembershipError(err, "Couldn't leave that team.") });
    } finally {
      setBusy(false);
      setLeaving(null);
    }
  };

  return (
    <GlassPanel className="flex flex-col gap-3" data-testid="my-teams">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{MEMBERSHIP_TEXT.myTeams.heading}</h2>
      {note && (
        <p role={note.kind === "error" ? "alert" : "status"} className={note.kind === "error" ? "text-sm text-red-300" : "text-sm text-emerald-300"}>
          {note.text}
        </p>
      )}
      {state.status === "loading" ? (
        <div className="glass-card h-16 animate-pulse" />
      ) : active.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">{MEMBERSHIP_TEXT.myTeams.empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {active.map((m) => {
            const label = labelOf(m.teamId, m.teamLabel);
            const role = m.role ? getRole(m.role) : null;
            return (
              <li key={m.teamId} className="glass-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between" data-testid={`my-team-${m.teamId}`}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{label}</span>
                    <Badge variant="glass" className="shrink-0 text-[10px]">
                      {brand.label}
                    </Badge>
                    {m.isOwner && (
                      <Badge variant="glass" className="shrink-0 gap-1 text-[10px]">
                        <ShieldCheck className="h-3 w-3" /> {MEMBERSHIP_TEXT.myTeams.owner}
                      </Badge>
                    )}
                    {m.teamId === state.activeTeamId && (
                      <Badge variant="glass" className="shrink-0 text-[10px]">
                        {MEMBERSHIP_TEXT.switcher.activeBadge}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-[var(--muted-foreground)]">{role ? role.label : "Member"}</div>
                </div>
                <Button variant="glass" className="min-h-11 gap-2 self-start text-red-300 sm:self-auto" disabled={busy} onClick={() => setLeaving({ id: m.teamId, label })} aria-label={`${MEMBERSHIP_TEXT.myTeams.leave} ${label}`}>
                  <LogOut className="h-4 w-4" /> {busy && leaving?.id === m.teamId ? MEMBERSHIP_TEXT.myTeams.leaving : MEMBERSHIP_TEXT.myTeams.leave}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <ConfirmDialog
        open={leaving !== null}
        onOpenChange={(open) => !open && !busy && setLeaving(null)}
        title={MEMBERSHIP_TEXT.myTeams.confirmTitle(leaving?.label ?? "")}
        description={MEMBERSHIP_TEXT.myTeams.confirmBody}
        confirmLabel={busy ? MEMBERSHIP_TEXT.myTeams.leaving : MEMBERSHIP_TEXT.myTeams.confirmAction}
        cancelLabel="Stay on the team"
        onConfirm={() => void leave()}
        testId="leave-team-confirm"
      />
    </GlassPanel>
  );
}
