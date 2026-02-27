type OwnerAwareUser = {
  uid?: string | null;
  email?: string | null;
  specialRole?: string | null;
  specialRoles?: string[] | null;
};

function parseAllowlist(value: string | undefined): Set<string> {
  if (!value) return new Set<string>();
  return new Set(
    value
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  );
}

function getReleaseOwnerUids(): Set<string> {
  const fromServer = parseAllowlist(process.env.RELEASE_OWNER_UIDS);
  const fromClient = parseAllowlist(process.env.NEXT_PUBLIC_RELEASE_OWNER_UIDS);
  return new Set([...fromServer, ...fromClient]);
}

function getReleaseOwnerEmails(): Set<string> {
  const fromServer = parseAllowlist(process.env.RELEASE_OWNER_EMAILS);
  const fromClient = parseAllowlist(process.env.NEXT_PUBLIC_RELEASE_OWNER_EMAILS);
  return new Set([...fromServer, ...fromClient]);
}

function hasOwnerSpecialRole(user: OwnerAwareUser): boolean {
  const single = String(user.specialRole || "").trim().toLowerCase();
  if (single === "owner" || single === "release-owner") return true;
  const list = Array.isArray(user.specialRoles) ? user.specialRoles : [];
  return list.some((role) => {
    const normalized = String(role || "").trim().toLowerCase();
    return normalized === "owner" || normalized === "release-owner";
  });
}

export function hasReleaseOwnerAccess(user: OwnerAwareUser | null | undefined): boolean {
  if (!user) return false;
  if (hasOwnerSpecialRole(user)) return true;

  const uid = String(user.uid || "").trim().toLowerCase();
  if (uid && getReleaseOwnerUids().has(uid)) return true;

  const email = String(user.email || "").trim().toLowerCase();
  if (email && getReleaseOwnerEmails().has(email)) return true;

  return false;
}

export function withHiddenOwnerPermissions<T extends OwnerAwareUser>(
  user: T
): T & { canManageVersionReleases: boolean } {
  return {
    ...user,
    canManageVersionReleases: hasReleaseOwnerAccess(user),
  };
}
