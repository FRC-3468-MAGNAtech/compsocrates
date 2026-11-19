"use client";

import { useEffect, useMemo, useState } from "react";
import { LogOut, ShieldCheck } from "lucide-react";
import Link from "@/components/program/link";
import { ConfirmDialog } from "@/components/scout/confirm-dialog";
import { buildMyTeamsRows, type MyTeamRow } from "@/components/team/my-teams-model";
import { TeamLabelView } from "@/components/team/team-label-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { PROGRAMS } from "@/config/programs";
import { useAccountState, useAllProgramMemberships, refreshAccountState } from "@/lib/account-state";
import { useAuth } from "@/lib/auth";
import { membershipApi, useMembershipsEnabled } from "@/lib/memberships/client";
import { friendlyMembershipError, MEMBERSHIP_TEXT } from "@/lib/memberships/strings";
import { useAccountTeamChoice, useOurTeam } from "@/lib/our-team";
import { useProgram, useProgramConfig } from "@/lib/program/context";
import { getRole } from "@/lib/roles";
import { rememberTeamLabel, recallTeamLabel } from "@/lib/team-label-cache";
import { invalidateRoster } from "@/lib/team-roster";

/**
 * Account Settings > My teams: EVERY team this account is on, in both programs (the same card for every program): the program badge, the team's number (bold) and name beneath, the
 * person's role there, an Owner badge, an Active badge on the team they are on now, and Leave (for that row's own program). Robot teams of the active team are listed under its row with
 * a link to Team Settings. Leaving asks first and says what happens; the server refuses the only admin of a team that still has members and an owner who has not transferred
 * ownership, and its words are shown as they are. The other program's memberships are read ONCE, when this section mounts (at most 5 documents, metered), and read again after a
 * leave. Hidden entirely while the memberships kill switch is OFF (then nothing here is read).
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
  const ours = useOurTeam();
  const { multiTeam } = useProgramConfig();
  const choice = useAccountTeamChoice();
  const all = useAllProgramMemberships(true);
  const uid = user?.uid ?? null;
  const [leaving, setLeaving] = useState<{ row: MyTeamRow } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const current = state.status === "loading" ? null : state.memberships;
  const { rows, loading } = useMemo(
    () => buildMyTeamsRows({ program, activeTeamId: state.activeTeamId, current, others: all, ours, badgeOf: (p) => PROGRAMS[p].brand.label, recall: (p, teamId, kind) => recallTeamLabel(uid, p, teamId, kind) }),
    [program, state.activeTeamId, current, all, ours, uid]
  );
  // What was learned here also paints the switcher's next first load.
  useEffect(() => {
    if (!uid) return;
    for (const r of rows) if (r.label.state === "ready") rememberTeamLabel(uid, r.program, r.teamId, "team", { number: r.label.number, name: r.label.name });
  }, [rows, uid]);

  const leave = async () => {
    if (!leaving) return;
    const { row } = leaving;
    setBusy(true);
    setNote(null);
    try {
      await membershipApi.leave(row.program, row.teamId);
      invalidateRoster();
      refreshAccountState(user?.uid);
      setNote({ kind: "ok", text: MEMBERSHIP_TEXT.myTeams.left(row.label.text) });
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
      <MyTeamsRows rows={rows} loading={loading} busyKey={busy && leaving ? leaving.row.key : null} robots={multiTeam ? choice.teams : []} onLeave={(row) => setLeaving({ row })} />
      <ConfirmDialog
        open={leaving !== null}
        onOpenChange={(open) => !open && !busy && setLeaving(null)}
        title={MEMBERSHIP_TEXT.myTeams.confirmTitle(leaving?.row.label.text ?? "")}
        description={MEMBERSHIP_TEXT.myTeams.confirmBody}
        confirmLabel={busy ? MEMBERSHIP_TEXT.myTeams.leaving : MEMBERSHIP_TEXT.myTeams.confirmAction}
        cancelLabel="Stay on the team"
        onConfirm={() => void leave()}
        testId="leave-team-confirm"
      />
    </GlassPanel>
  );
}

type RobotLine = { id: string; number: number; name: string | null };

/** The rows (props only, so tests render every state). `robots`: the robot teams of the ACTIVE team, listed under its row. */
export function MyTeamsRows({ rows, loading, busyKey = null, robots = [], onLeave = () => {} }: { rows: MyTeamRow[]; loading: boolean; busyKey?: string | null; robots?: readonly RobotLine[]; onLeave?: (row: MyTeamRow) => void }) {
  if (rows.length === 0) return loading ? <div className="glass-card h-16 animate-pulse" /> : <p className="text-sm text-[var(--muted-foreground)]">{MEMBERSHIP_TEXT.myTeams.empty}</p>;
  return (
    <>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => {
          const role = row.role ? getRole(row.role) : null;
          return (
            <li key={row.key} className="glass-card flex flex-col gap-3 p-4" data-testid={`my-team-${row.teamId}`}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="glass" className="shrink-0 text-[10px]" data-testid="my-team-program">
                      {row.badge}
                    </Badge>
                    {row.isOwner && (
                      <Badge variant="glass" className="shrink-0 gap-1 text-[10px]">
                        <ShieldCheck className="h-3 w-3" /> {MEMBERSHIP_TEXT.myTeams.owner}
                      </Badge>
                    )}
                    {row.active && (
                      <Badge variant="glass" className="shrink-0 text-[10px]">
                        {MEMBERSHIP_TEXT.switcher.activeBadge}
                      </Badge>
                    )}
                  </div>
                  <TeamLabelView label={row.label} nameLines={3} />
                  <div className="text-xs text-[var(--muted-foreground)]">{role ? role.label : "Member"}</div>
                </div>
                <Button variant="glass" className="min-h-11 shrink-0 gap-2 self-start text-red-300" disabled={busyKey !== null} onClick={() => onLeave(row)} aria-label={`${MEMBERSHIP_TEXT.myTeams.leave} ${row.label.text}`}>
                  <LogOut className="h-4 w-4" /> {busyKey === row.key ? MEMBERSHIP_TEXT.myTeams.leaving : MEMBERSHIP_TEXT.myTeams.leave}
                </Button>
              </div>
              {row.active && robots.length > 0 && <RobotTeamsList robots={robots} />}
            </li>
          );
        })}
      </ul>
      {loading && <p className="text-xs text-[var(--muted-foreground)]">{MEMBERSHIP_TEXT.switcher.otherLoading}</p>}
    </>
  );
}

function RobotTeamsList({ robots }: { robots: readonly RobotLine[] }) {
  return (
    <div className="border-t border-[var(--glass-border)] pt-3" data-testid="my-team-robots">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{MEMBERSHIP_TEXT.myTeams.robotTeams}</div>
      <ul className="flex flex-col gap-1">
        {robots.map((r) => (
          <li key={r.id} className="break-words text-sm">
            <span className="font-bold">{r.number}</span>
            {r.name && <span className="ml-2 text-[var(--muted-foreground)]">{r.name}</span>}
          </li>
        ))}
      </ul>
      <Link href="/team-settings" className="mt-2 inline-flex min-h-11 items-center text-sm underline underline-offset-2" data-testid="my-team-settings-link">
        {MEMBERSHIP_TEXT.myTeams.teamSettings}
      </Link>
    </div>
  );
}
