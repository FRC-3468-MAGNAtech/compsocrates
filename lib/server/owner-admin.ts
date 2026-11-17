import "server-only";
import { releaseOwnerEmails, releaseOwnerUids } from "@/lib/server/env";

/** Is this uid a platform owner? RELEASE_OWNER_UIDS (the CompSocrates app's variable), read live from the environment. Compared exactly (uids are case sensitive). */
export function isOwnerUid(uid: string | null | undefined): boolean {
  const safe = String(uid ?? "").trim();
  return safe !== "" && releaseOwnerUids().includes(safe);
}

/** Is this email a platform owner's? RELEASE_OWNER_EMAILS, comma-separated, compared case-insensitively. */
export function isOwnerEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return releaseOwnerEmails().includes(email.trim().toLowerCase());
}

/**
 * Is this verified ID token a **platform owner**? Two ways in, both checked live on every platform-only server route:
 *  1. The token's uid is in RELEASE_OWNER_UIDS. A uid cannot be spoofed, so no claim or email check is needed.
 *  2. A verified email in RELEASE_OWNER_EMAILS *and* the `platformOwner` claim (the claim alone could be stale after someone is
 *     removed from the env var), so revoking takes effect on the next request.
 */
export function isPlatformOwnerToken(decoded: { uid?: string; email?: string | null; email_verified?: boolean; platformOwner?: unknown }): boolean {
  if (isOwnerUid(decoded.uid)) return true;
  return decoded.platformOwner === true && decoded.email_verified === true && isOwnerEmail(decoded.email);
}
