import "server-only";
import { isCsOwnerUid } from "@/config/cs";

function parseEmailList(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

/** OWNER_EMAILS / ADMIN_EMAILS — server-only env vars, comma-separated, compared case-insensitively. See .env.example and docs/ASSUMPTIONS.md (P1b). */
export function isOwnerEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return parseEmailList(process.env.OWNER_EMAILS).has(email.toLowerCase());
}

/**
 * Is this verified ID token a **platform owner**? Two ways in, both checked live on every platform-only server route:
 *  1. CS's owner layer (D1/D6): the token's uid is in `CS_OWNER_UIDS` (config/cs.ts). A uid cannot be spoofed, so no claim or
 *     email check is needed.
 *  2. CE's: a verified email in the server-only OWNER_EMAILS list *and* the `platformOwner` claim (the claim alone could be
 *     stale after someone is removed from the env var), so revoking takes effect on the next request.
 */
export function isPlatformOwnerToken(decoded: { uid?: string; email?: string | null; email_verified?: boolean; platformOwner?: unknown }): boolean {
  if (isCsOwnerUid(decoded.uid)) return true;
  return decoded.platformOwner === true && decoded.email_verified === true && isOwnerEmail(decoded.email);
}

export function isPreconfiguredAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return parseEmailList(process.env.ADMIN_EMAILS).has(email.toLowerCase());
}
