// Which roster members belong to the team an account is viewing as (pure; no React, no Firebase).
//
// A roster is read per team document (`teamId ==`), so it never holds another account's people. Inside that one team document a program with
// several teams per account (`ProgramConfig.multiTeam`) can assign a member to only some of the teams (`assignedTeamIds`):
// People shows the members of the team being viewed as (`lib/our-team.ts`), plus every member with no assignment (an absent or empty list
// means "all teams", the same rule `chooseAccountTeam` uses).

import type { TeamMember } from "@/lib/team-members";

export function membersOfSelectedTeam<T extends Pick<TeamMember, "assignedTeamIds">>(members: readonly T[], selectedTeamId: string | null | undefined): T[] {
  if (!selectedTeamId) return [...members];
  return members.filter((m) => !m.assignedTeamIds || m.assignedTeamIds.length === 0 || m.assignedTeamIds.includes(selectedTeamId));
}
