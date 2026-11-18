// What a FAILED read of the signed-in person's own profile document means. The rules deny a read of a document that does not exist yet, so `permission-denied` is the
// legitimate answer for "this account has no profile (or team) yet". Anything else (the daily quota, a dropped network, a server error) says NOTHING about the account:
// it must never be turned into "no profile", which would send a member with a team to the team setup screen.
export function readFailureMeansNoProfile(err: unknown): boolean {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" && code.replace(/^firestore\//, "") === "permission-denied";
}

/** How long to wait before asking again after a failed profile read that left the app with nothing to show. */
export const PROFILE_RETRY_MS = 60_000;
