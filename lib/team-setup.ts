// Pure validation and states for the one Join / Apply screen (`components/team-setup/team-setup-screen.tsx`), the same for every program.
// No React, no Firebase.
import { isValidTeamCode, normalizeTeamCode } from "@/data/cs/join-requests";

export const NAME_MAX = 80;

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

/** What the Apply tab shows when applications are closed (one string for every program). */
export const TEAM_CREATION_CLOSED_TEXT =
  "Applications to create a team aren't open yet. If your team already has an account, ask your team admin for its join code and use Join a team.";

/**
 * The Apply tab's state, the same rule for every program: unknown while the setting loads; open only when `appSettings/global.teamCreationEnabled` (the Admin Panel's
 * "Accept team applications") is explicitly true; otherwise closed.
 */
export function applicationsState(applicationsOpen: boolean | null): "open" | "closed" | "loading" {
  if (applicationsOpen === null) return "loading";
  return applicationsOpen ? "open" : "closed";
}

/** The notice above the form for the last request that ended without a team (denied by an admin, or canceled by the person). Same words in every program. */
export function closedRequestNotice(status: "denied" | "canceled"): string {
  return status === "denied" ? "Your last join request was denied. Check the code with your team admin and try again." : "You canceled your last join request.";
}

/** The line under "Request sent": the code the request went to. One sentence for every program. */
export function requestSentText(code: string): string {
  return `Request sent for code ${code}. A team admin has to approve it. This page moves on by itself once they do.`;
}
