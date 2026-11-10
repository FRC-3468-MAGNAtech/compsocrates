/**
 * Deployment config for the CS data adapter (data/cs/**). Pure data and helpers: safe to import from client code.
 *
 * CS's production Firestore rules hard-code a single owner uid (docs/cs-firestore.rules `isOwner()`). The rebuild reads the
 * owner uids from the environment instead, so no uid lives in the source:
 *   NEXT_PUBLIC_CS_OWNER_UIDS=uid1,uid2   (browser-visible: drives the UI; not a secret, the rules do the enforcing)
 *   CS_OWNER_UIDS=uid1,uid2               (server fallback when the public one is unset)
 * Firebase uids are case sensitive, so they are compared exactly.
 */

/** Splits a comma/space/semicolon separated uid list, dropping empties and duplicates. */
export function parseUidList(raw: string | undefined | null): readonly string[] {
  const seen = new Set<string>();
  for (const part of String(raw ?? "").split(/[\s,;]+/)) {
    const uid = part.trim();
    if (uid) seen.add(uid);
  }
  return [...seen];
}

// Literal property access so Next can inline NEXT_PUBLIC_CS_OWNER_UIDS into client bundles.
export const CS_OWNER_UIDS: readonly string[] = parseUidList(process.env.NEXT_PUBLIC_CS_OWNER_UIDS ?? process.env.CS_OWNER_UIDS);

export function isCsOwnerUid(uid: string | null | undefined, ownerUids: readonly string[] = CS_OWNER_UIDS): boolean {
  const safe = String(uid ?? "").trim();
  return safe !== "" && ownerUids.includes(safe);
}

/** Theme a CS account gets when its stored `accountThemeId` is not one the rebuild knows. */
export const CS_DEFAULT_THEME_ID = "compsocrates";
