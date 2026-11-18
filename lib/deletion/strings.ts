/**
 * Every word the account deletion screens say, in one place (the dialog, the sign-in notice, the Admin Panel tab), the same for both programs. This is not legal
 * advice and says nothing about the law: the only policy statement is "your team's policy applies". Facts only: what is kept, what is deleted, that it cannot be undone.
 */
export const DELETION_TEXT = {
  sectionTitle: "Delete account",
  sectionIntro: "Delete this account and the personal information tied to it. This cannot be undone.",
  open: "Delete my account…",
  dialogTitle: "Delete your account?",
  /** What is kept, what is deleted, that it cannot be undone, and the policy line. */
  keptTitle: "What stays",
  kept: [
    "Scouting entries, practice sessions, attendance and assignments you were part of stay with your team, so team numbers and scouting accuracy do not change.",
    "They show the name “Deleted Account” instead of yours, and nothing in them points back to you.",
    "Robot photos uploaded for the team belong to the team and stay.",
  ],
  deletedTitle: "What is deleted",
  deleted: [
    "Your profile, email address, picture and notification settings.",
    "Your join requests, private practice and anything else that was only yours.",
    "Your sign-in. The deletion starts at once and finishes in about an hour or more.",
  ],
  irreversible: "This cannot be undone. Deleted information cannot be restored, and you cannot sign in to this account again.",
  policy: "Your team's policy applies to what a team keeps.",
  confirmLabel: "Type DELETE to confirm",
  confirmPlaceholder: "DELETE",
  submit: "Delete my account",
  submitting: "Deleting…",
  cancel: "Cancel",
  /** The state after the request was accepted. */
  inProgressTitle: "Deletion in progress",
  inProgress: "Your account is being deleted. You are being signed out. It can take an hour or more to finish.",
  signOut: "Sign out now",
  /** The sign-in screen's notice for an account that is being deleted (`auth/user-disabled`). */
  signInBlocked: "This account is being deleted.",
  /** Refusals the server gives, in words the person can act on. */
  errors: {
    last_admin: "You are the only admin or owner of a team that still has other members. Transfer ownership or make another member an admin first, or leave the team, then try again.",
    platform_owner: "This account cannot be deleted here.",
    deletion_in_progress: "Your account is already being deleted.",
    reauth_required: "Confirm it's you: sign in again, then retry.",
    not_confirmed: "Type DELETE to confirm.",
    rate_limited: "Too many attempts. Try again in a while.",
    quota_exceeded: "The service is busy right now. Try again in a little while.",
    timeout: "The server took too long to answer. Check whether you were signed out, and try again if not.",
  } as Record<string, string>,
  generic: "Could not delete the account. Try again.",
} as const;

export function friendlyDeletionError(code: string | null | undefined, fallback?: string): string {
  if (code && code in DELETION_TEXT.errors) return DELETION_TEXT.errors[code];
  return fallback && fallback.trim() !== "" ? fallback : DELETION_TEXT.generic;
}

/** The Admin Panel tab (platform owner). Opaque ids and statuses only. */
export const DELETION_ADMIN_TEXT = {
  title: "Account deletions",
  intro: "Deletions in progress, by opaque id. A deletion waits about 70 minutes after the account is disabled, then rewrites and deletes in runs; a stalled one needs Resume.",
  empty: "No deletions in progress.",
  refresh: "Refresh",
  resume: "Resume",
  startTitle: "Delete an account for someone",
  startHint: "Enter the account's uid. A platform owner's account cannot be deleted here.",
  startConfirm: "Type DELETE to confirm",
  startSubmit: "Start deletion",
  statusLabels: { running: "Running", cooldown: "Waiting (cooldown)", stalled: "Stalled" } as Record<string, string>,
} as const;
