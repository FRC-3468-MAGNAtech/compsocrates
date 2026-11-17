/**
 * Every user-visible string of the membership features, in ONE place (both programs show the same words). Server refusals carry a machine `code`; `friendlyMembershipError`
 * turns it into a sentence. Nothing here names a program or the product (the screens add the team's own label where they need it).
 */
export const MEMBERSHIP_TEXT = {
  switcher: {
    label: "Team",
    switching: "Switching…",
    joinAnother: "Join another team",
    activeBadge: "Active",
    failed: "Could not switch teams.",
    slow: "The switch is taking too long. Reload the page to check which team you are on.",
  },
  myTeams: {
    heading: "My teams",
    empty: "You are not on a team in this program yet.",
    owner: "Owner",
    leave: "Leave",
    leaving: "Leaving…",
    confirmTitle: (team: string) => `Leave ${team}?`,
    confirmBody:
      "You will lose access to this team's scouting data, schedule and roster. Your entries, assignments and attendance stay with the team, with your name on them. To come back you have to ask to join again and an admin has to approve it.",
    confirmAction: "Leave team",
    left: (team: string) => `You left ${team}.`,
    inactive: "Not your active team: switch to it from the team menu.",
    lastAdmin: "You are the only admin. Make another member an admin before you leave.",
  },
  join: {
    anotherTitle: "Join another team",
    anotherBody: "Ask to join a team with its join code. An admin of that team has to approve you, and you keep your current team until you switch.",
    roleLabel: "Your role on this team",
    roleNote: "This team lets you pick a role. An admin can still change it.",
    alreadyMember: "You are already on that team.",
    atLimit: "You are on the most teams an account can have. Leave one first.",
    sent: (code: string) => `Request sent for code ${code}. A team admin has to approve it.`,
    checking: "Checking…",
  },
  members: {
    remove: "Remove from team",
    removing: "Removing…",
    confirmTitle: (name: string) => `Remove ${name}?`,
    confirmBody: "They lose access to the team right away. Their entries, assignments and attendance stay, and they appear under Past Team Members. They can ask to join again.",
    confirmAction: "Remove member",
    removed: (name: string) => `${name} was removed from the team.`,
    requestedRole: "Asked for",
    roleChoiceTitle: "Let joiners choose their role",
    roleChoiceBody: "When this is on, people who ask to join can pick a role, and you can change it before you approve. Admin is never a choice. Off: everyone joins as a Match Scout.",
  },
  past: {
    heading: "Past Team Members",
    empty: "No one has left yet.",
    loading: "Loading past members…",
    role: "Role",
    joined: "Joined",
    left: "Left",
    events: "Events attended",
    noEvents: "None recorded",
    needsVerification: "Ask the platform owner to verify team admins to see past members",
    leftBySelf: "Left",
    removedByAdmin: "Removed",
  },
  verify: {
    heading: "Verify admins",
    intro: "Pick a team, check each admin below against who you know, and verify only the ones you are sure of. Verified admins can read their team's past members.",
    teamLabel: "Team id (join code)",
    load: "List admins",
    none: "That team has no active admins.",
    evidence: "Evidence",
    membership: { pointer: "Not verified yet", verified: "Verified", none: "No membership yet" },
    confirmLabel: (name: string) => `Type "${name}" to confirm`,
    submit: "Verify selected admins",
    result: (n: number) => `Verified ${n} admin${n === 1 ? "" : "s"}.`,
    skipped: "Skipped",
  },
} as const;

const BY_CODE: Record<string, string> = {
  not_a_member: "You are not a member of that team.",
  membership_ended: "Your membership of that team has ended.",
  not_admin: "Only a team admin can do that.",
  forbidden: "Only the platform owner can do that.",
  last_admin: MEMBERSHIP_TEXT.myTeams.lastAdmin,
  owner_must_transfer: "The owner has to transfer ownership to another admin first (Team Settings), then leave.",
  owner_admin_locked: "Owner access can't be removed.",
  membership_limit: MEMBERSHIP_TEXT.join.atLimit,
  already_member: MEMBERSHIP_TEXT.join.alreadyMember,
  no_profile: "This account has no profile in that program yet.",
  not_pending: "Someone already handled this request.",
  team_not_found: "That join code doesn't match any team.",
  bad_code: "Enter the join code your team admin gave you.",
  bad_name: "Enter your name (80 characters at most).",
  rate_limited: "Too many tries. Wait a little and try again.",
  quota_exceeded: "The database is busy right now. Try again in a little while.",
  server_not_configured: "The server is not set up for this yet.",
  memberships_disabled: "This feature is not switched on.",
  timeout: "The server took too long to answer. Reload and check before you try again.",
  confirmation_mismatch: "Type the team name exactly to confirm.",
  use_leave: "To leave your own team, use Leave team.",
  invalid_changes: "That change is not allowed.",
  not_allowed: "You cannot do that to this member.",
};

/** A sentence for a failed membership call: our friendly line for the server's code, else the server's own text, else a plain fallback. */
export function friendlyMembershipError(err: unknown, fallback = "Something went wrong. Try again."): string {
  const code = typeof (err as { code?: unknown } | null)?.code === "string" ? (err as { code: string }).code : null;
  if (code && BY_CODE[code]) return BY_CODE[code];
  const message = err instanceof Error ? err.message : "";
  return message && message !== "Something went wrong." ? message : fallback;
}
