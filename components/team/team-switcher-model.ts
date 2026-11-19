// The one team switcher's view model. Pure (no React, no Firebase): what the trigger shows, which teams the panel lists in which program, and the robot teams of the active team.
// Every label goes through `resolveTeamLabel` (lib/team-label.ts), which can never return a team id or join code; this file never reads a team id for display.
import type { AccountMembership, ProgramMemberships } from "@/lib/account-state";
import { PROGRAM_IDS, type MembershipDoc, type ProgramId } from "@/lib/memberships/model";
import type { OurTeam } from "@/lib/our-team";
import { legacyLabelParts, resolveTeamLabel, type NameParts, type TeamLabel } from "@/lib/team-label";
import type { AccountTeam } from "@/lib/team-number";

export type RobotOption = { id: string; number: number; name: string | null; selected: boolean };
export type SwitcherRow = { key: string; program: ProgramId; teamId: string; label: TeamLabel; active: boolean };
export type SwitcherGroup = {
  program: ProgramId;
  badge: string;
  /** The program the person is in right now. */
  isCurrent: boolean;
  /** "idle"/"loading": the program's teams have not been read yet (rows, if any, are the device-cached labels). */
  status: "idle" | "loading" | "ready";
  rows: SwitcherRow[];
};
export type SwitcherModel = {
  /** The active context: program badge and label (the robot team being viewed as, when there is one). */
  trigger: { badge: string; label: TeamLabel };
  groups: SwitcherGroup[];
  /** The robot teams of the ACTIVE team the person may view as, only when there are two or more. */
  robots: RobotOption[];
  /** Is there anything to choose at all? (false: the switcher is not drawn) */
  worthShowing: boolean;
};

export type RecallFn = (program: ProgramId, teamId: string, kind: "team" | "context") => NameParts | null;
export type RememberedTeamsFn = (program: ProgramId) => { teamId: string; parts: NameParts }[];

export type ModelInput = {
  /** The memberships kill switch. OFF: no groups, only the robot teams. */
  membershipsOn: boolean;
  program: ProgramId;
  activeTeamId: string | null;
  /** The current program's memberships (the account state), or null while they load. */
  current: readonly AccountMembership[] | null;
  /** Every program's memberships as read (`useAllProgramMemberships`); the current program's entry is ignored. */
  others: Record<ProgramId, ProgramMemberships>;
  ours: OurTeam;
  robots: { teams: readonly AccountTeam[]; selectedId: string | null };
  badgeOf: (program: ProgramId) => string;
  recall: RecallFn;
  remembered: RememberedTeamsFn;
};

const snapshotParts = (m: Pick<MembershipDoc, "teamNumber" | "teamName"> | undefined): NameParts | null => (m && (m.teamNumber !== undefined || m.teamName !== undefined) ? { number: m.teamNumber ?? null, name: m.teamName ?? null } : null);

/** The label of one membership's team: its snapshot, its older label string, the device cache. `forbid` carries the team id only so it can be dropped if a piece equals it. */
export function membershipLabel(m: Pick<MembershipDoc, "teamId" | "teamNumber" | "teamName" | "teamLabel"> | undefined, cached: NameParts | null, forbidId: string): TeamLabel {
  return resolveTeamLabel([snapshotParts(m), legacyLabelParts(m?.teamLabel), cached], { forbid: [forbidId] });
}

export function buildSwitcherModel(input: ModelInput): SwitcherModel {
  const { program, activeTeamId, ours } = input;
  const robots: RobotOption[] = input.robots.teams.length >= 2 ? input.robots.teams.map((t) => ({ id: t.id, number: t.number, name: t.name, selected: t.id === input.robots.selectedId })) : [];
  const currentRows = (input.current ?? []).filter((m) => m.status === "active");
  const activeMembership = currentRows.find((m) => m.teamId === activeTeamId);

  // The trigger: the live team being viewed as, else what was last seen on this device for this context, else the membership's snapshot.
  const live: NameParts | null = ours.loaded && (ours.number !== null || ours.name) ? { number: ours.number, name: ours.name } : null;
  const trigger = {
    badge: input.badgeOf(program),
    label: resolveTeamLabel([live, activeTeamId ? input.recall(program, activeTeamId, "context") : null, snapshotParts(activeMembership), legacyLabelParts(activeMembership?.teamLabel), activeTeamId ? input.recall(program, activeTeamId, "team") : null], { forbid: [activeTeamId] }),
  };

  if (!input.membershipsOn) return { trigger, groups: [], robots, worthShowing: robots.length >= 2 };

  const groups: SwitcherGroup[] = PROGRAM_IDS.map((p) => {
    const isCurrent = p === program;
    let rows: SwitcherRow[];
    let status: SwitcherGroup["status"] = "ready";
    if (isCurrent) {
      rows = currentRows.map((m) => {
        const active = m.teamId === activeTeamId;
        const label = active && ours.teamLevel && ours.loaded ? resolveTeamLabel([ours.teamLevel], { forbid: [m.teamId] }) : membershipLabel(m, input.recall(p, m.teamId, "team"), m.teamId);
        return { key: `${p}|${m.teamId}`, program: p, teamId: m.teamId, label, active };
      });
      // A pointer the memberships do not list yet (the account state adds an implicit one; this is only the loading case).
      if (activeTeamId && !rows.some((r) => r.active)) {
        const label = resolveTeamLabel([ours.loaded && ours.teamLevel ? ours.teamLevel : null, input.recall(p, activeTeamId, "team")], { forbid: [activeTeamId] });
        rows.unshift({ key: `${p}|${activeTeamId}`, program: p, teamId: activeTeamId, label, active: true });
      }
    } else {
      const read = input.others[p];
      status = read.status;
      rows =
        read.status === "ready"
          ? read.memberships.filter((m) => m.status === "active").map((m) => ({ key: `${p}|${m.teamId}`, program: p, teamId: m.teamId, label: membershipLabel(m, input.recall(p, m.teamId, "team"), m.teamId), active: false }))
          : input.remembered(p).map(({ teamId, parts }) => ({ key: `${p}|${teamId}`, program: p, teamId, label: resolveTeamLabel([parts], { forbid: [teamId] }), active: false }));
    }
    return { program: p, badge: input.badgeOf(p), isCurrent, status, rows };
  });
  const rowCount = groups.reduce((n, g) => n + g.rows.length, 0);
  // Always worth drawing with memberships ON and a team: it holds the Join link, the other program's teams and the robot teams.
  return { trigger, groups, robots, worthShowing: rowCount > 0 || activeTeamId !== null };
}
