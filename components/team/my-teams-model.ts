// Account Settings > My teams: every team the account is on, across BOTH programs. Pure (no React, no Firebase). Labels come only from `lib/team-label.ts` (never an id).
import { membershipLabel, type RecallFn } from "@/components/team/team-switcher-model";
import type { AccountMembership, ProgramMemberships } from "@/lib/account-state";
import { PROGRAM_IDS, type ProgramId } from "@/lib/memberships/model";
import type { OurTeam } from "@/lib/our-team";
import { resolveTeamLabel, type TeamLabel } from "@/lib/team-label";

export type MyTeamRow = {
  key: string;
  program: ProgramId;
  badge: string;
  teamId: string;
  label: TeamLabel;
  role: string | null;
  isOwner: boolean;
  /** The team the person is on right now, in the program they are in right now (the only one the browser can tell). */
  active: boolean;
};

export function buildMyTeamsRows(input: {
  program: ProgramId;
  activeTeamId: string | null;
  /** The current program's memberships (the account state), null while they load. */
  current: readonly AccountMembership[] | null;
  others: Record<ProgramId, ProgramMemberships>;
  ours: OurTeam;
  badgeOf: (program: ProgramId) => string;
  recall: RecallFn;
}): { rows: MyTeamRow[]; loading: boolean } {
  const rows: MyTeamRow[] = [];
  let loading = input.current === null;
  for (const p of PROGRAM_IDS) {
    const isCurrent = p === input.program;
    const list = isCurrent ? (input.current ?? []) : input.others[p].memberships;
    if (!isCurrent && input.others[p].status !== "ready") loading = true;
    for (const m of list) {
      if (m.status !== "active") continue;
      const active = isCurrent && m.teamId === input.activeTeamId;
      const label = active && input.ours.loaded && input.ours.teamLevel ? resolveTeamLabel([input.ours.teamLevel], { forbid: [m.teamId] }) : membershipLabel(m, input.recall(p, m.teamId, "team"), m.teamId);
      rows.push({ key: `${p}|${m.teamId}`, program: p, badge: input.badgeOf(p), teamId: m.teamId, label, role: m.role, isOwner: m.isOwner === true, active });
    }
  }
  return { rows, loading };
}
