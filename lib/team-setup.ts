// Pure validation for the "start a team / join a team" screen of a program whose people set themselves up (ProgramData.enrollment).
// No React, no Firebase. The bounds match the rules of the program that uses it.
import { isValidTeamCode, normalizeTeamCode } from "@/data/cs/join-requests";
import { parseTeamNumber } from "@/lib/team-number";

export const NAME_MAX = 80;
export const LOCATION_MAX = 80;

export type SetupForm = { teamNumber: string; teamName: string; location: string; displayName: string };
export type SetupFormErrors = { teamNumber?: string; teamName?: string; location?: string; displayName?: string };

/** Validates the create form. `number` is the parsed team number (null when invalid); `errors` is empty when the form can be sent. */
export function validateNewTeam(form: SetupForm): { number: number | null; errors: SetupFormErrors } {
  const errors: SetupFormErrors = {};
  const number = parseTeamNumber(form.teamNumber);
  if (number === null) errors.teamNumber = "Enter your team number: 1 to 5 digits.";
  const teamName = form.teamName.trim();
  if (!teamName) errors.teamName = "Enter your team name.";
  else if (teamName.length > NAME_MAX) errors.teamName = `Keep the team name under ${NAME_MAX} characters.`;
  if (form.location.trim().length > LOCATION_MAX) errors.location = `Keep the location under ${LOCATION_MAX} characters.`;
  const displayName = form.displayName.trim();
  if (!displayName) errors.displayName = "Enter your name.";
  else if (displayName.length > NAME_MAX) errors.displayName = `Keep your name under ${NAME_MAX} characters.`;
  return { number, errors };
}

/** A typed join code, trimmed and uppercased; null when it cannot be a team code. */
export function parseJoinCode(input: string): string | null {
  const code = normalizeTeamCode(input);
  return isValidTeamCode(code) ? code : null;
}

/** Validates the join form (code and name). `code` is the normalised code (null when invalid); `errors` is empty when the form can be sent. */
export function validateJoin(form: { joinCode: string; displayName: string }): { code: string | null; errors: { joinCode?: string; displayName?: string } } {
  const errors: { joinCode?: string; displayName?: string } = {};
  const code = parseJoinCode(form.joinCode);
  if (!code) errors.joinCode = "Enter the join code your team admin gave you.";
  const displayName = form.displayName.trim();
  if (!displayName) errors.displayName = "Enter your name.";
  else if (displayName.length > NAME_MAX) errors.displayName = `Keep your name under ${NAME_MAX} characters.`;
  return { code, errors };
}

/** Validates the create form (team number, optional team name). `number` is null when invalid; `teamName` is trimmed; `errors` is empty when the form can be sent. */
export function validateCreate(form: { teamNumber: string; teamName: string }): { number: number | null; teamName: string; errors: { teamNumber?: string; teamName?: string } } {
  const errors: { teamNumber?: string; teamName?: string } = {};
  const number = parseTeamNumber(form.teamNumber);
  if (number === null) errors.teamNumber = "Enter your team number: 1 to 5 digits.";
  const teamName = form.teamName.trim();
  if (teamName.length > NAME_MAX) errors.teamName = `Keep the team name under ${NAME_MAX} characters.`;
  return { number, teamName, errors };
}

/** What the Create tab shows when public team creation is switched off and the program has no application to go on to (one string for every program). */
export const TEAM_CREATION_CLOSED_TEXT =
  "Applications to create a team aren't open yet. If your team already has an account, ask your team admin for its join code and use Join a team.";

/**
 * The Create tab's state, the same rule for every program: unknown while the setting loads; open only when `appSettings/global.teamCreationEnabled` is
 * explicitly true; otherwise an application when the program has one (`ProgramFeatures.applications`), else a plain "not open yet" notice.
 */
export function creationMode(teamCreationEnabled: boolean | null, applicationsAvailable: boolean): "open" | "apply" | "closed" | "loading" {
  if (teamCreationEnabled === null) return "loading";
  if (teamCreationEnabled) return "open";
  return applicationsAvailable ? "apply" : "closed";
}
