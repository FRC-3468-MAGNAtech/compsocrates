// Pure logic for the several teams an account scouts for (`ProgramConfig.multiTeam`): the Team Settings editor, the member assignment and the
// removal guard. No React and no Firebase, so the page, the data layer, the server route and the tests share it.
//
// The model is the one `lib/our-team.ts` already reads: `AccountTeam` (id, number, name) on the team doc and `assignedTeamIds` on a member.
// A member with no assignment (or only ids that no longer exist) counts as assigned to ALL teams, so nobody is ever left with "no team" and a removed
// team never strands someone. An admin sees every team. Scouting entries belong to the account, not to one of its teams, so removing a team never
// touches an entry.

import { personName } from "@/lib/people/display-name";
import { parseTeamNumber, type AccountTeam } from "@/lib/team-number";

/** At most this many teams per account (also enforced in firestore.rules). */
export const MAX_ACCOUNT_TEAMS = 10;
export const MAX_ACCOUNT_TEAM_NAME = 60;

/** A team name as typed or fetched: control characters removed, whitespace collapsed, trimmed and cut to the limit. Never throws. */
export function sanitizeTeamName(input: unknown): string {
  const text = typeof input === "string" ? input : "";
  return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_ACCOUNT_TEAM_NAME);
}

/** An id for a team added in Settings: stable for the team's life, so a rename or a renumber never breaks a member's assignment. */
export function newAccountTeamId(random: () => number = Math.random): string {
  let s = "";
  while (s.length < 8) s += Math.floor(random() * 36).toString(36);
  return `fteam_${s}`;
}

/** Everything wrong with a team list, as messages (empty when it can be saved). Numbers are 1 to 5 digits and unique; names are bounded. */
export function validateAccountTeams(teams: readonly AccountTeam[]): string[] {
  const problems: string[] = [];
  if (teams.length === 0) problems.push("An account needs at least one team.");
  if (teams.length > MAX_ACCOUNT_TEAMS) problems.push(`An account can have at most ${MAX_ACCOUNT_TEAMS} teams.`);
  const seen = new Set<number>();
  const ids = new Set<string>();
  for (const t of teams) {
    if (!t.id || ids.has(t.id)) problems.push("A team has a missing or repeated id.");
    ids.add(t.id);
    if (parseTeamNumber(t.number) === null) problems.push("Enter a team number with 1 to 5 digits.");
    else if (seen.has(t.number)) problems.push(`Team ${t.number} is already on this account.`);
    else seen.add(t.number);
    if ((t.name ?? "").length > MAX_ACCOUNT_TEAM_NAME) problems.push(`Names can be at most ${MAX_ACCOUNT_TEAM_NAME} characters.`);
  }
  return problems;
}

/** What one Team Settings save writes (see `saveAccountTeams` in the program's data layer): the team list (null = unchanged), members' new assignments, and the audit entry's content. */
export type AccountTeamsChange = {
  teams: AccountTeam[] | null;
  assignments: { uid: string; assignedTeamIds: string[] }[];
  action: "edit-account-teams" | "edit-member-teams";
  target: Record<string, unknown>;
  before: unknown;
  after: unknown;
};

type MemberLike = { uid: string; name?: string; assignedTeamIds?: readonly string[] | null };

/** Members who list this team explicitly (the ones who must be moved before it can be removed). Members who "count as all" do not block removal. */
export function membersAssignedTo<M extends MemberLike>(teamId: string, members: readonly M[]): M[] {
  return members.filter((m) => (m.assignedTeamIds ?? []).includes(teamId));
}

/** The ids a member is effectively assigned to, in the account's order: their list narrowed to teams that exist, else every team. */
export function effectiveTeamIds(assigned: readonly string[] | null | undefined, teams: readonly AccountTeam[]): string[] {
  const wanted = new Set(assigned ?? []);
  const kept = teams.filter((t) => wanted.has(t.id)).map((t) => t.id);
  return kept.length > 0 ? kept : teams.map((t) => t.id);
}

/** Can this team be removed? Not the last one, and not while a member lists it (the answer carries who, for the warning). */
export function removalCheck(teamId: string, teams: readonly AccountTeam[], members: readonly MemberLike[]): { ok: true } | { ok: false; reason: "last-team" | "assigned"; members: { uid: string; name: string }[] } {
  if (teams.length <= 1) return { ok: false, reason: "last-team", members: [] };
  const assigned = membersAssignedTo(teamId, members);
  if (assigned.length > 0) return { ok: false, reason: "assigned", members: assigned.map((m) => ({ uid: m.uid, name: personName(m.uid, [{ uid: m.uid, name: m.name ?? "" }]) })) };
  return { ok: true };
}

/** A member's new stored list after ticking `teamId` on or off, starting from what they effectively have, in the account's order. Null when it would leave them with none. */
export function toggleAssignment(current: readonly string[] | null | undefined, teamId: string, on: boolean, teams: readonly AccountTeam[]): string[] | null {
  const base = new Set(effectiveTeamIds(current, teams));
  if (on) base.add(teamId);
  else base.delete(teamId);
  const next = teams.filter((t) => base.has(t.id)).map((t) => t.id);
  return next.length > 0 ? next : null;
}

export function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && b.every((id) => a.includes(id));
}

/** The renamed or added list: a new team goes last; a rename keeps the id and the position. */
export function upsertTeam(teams: readonly AccountTeam[], team: AccountTeam): AccountTeam[] {
  return teams.some((t) => t.id === team.id) ? teams.map((t) => (t.id === team.id ? team : t)) : [...teams, team];
}
