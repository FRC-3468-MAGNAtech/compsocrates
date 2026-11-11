/**
 * Adapter between CS's `users/{uid}` documents and CE's profile (`UserDoc`, lib/auth.tsx) and roster row (`TeamMember`).
 * docs/ROUTES.md D1 (adapter), D6 (CE permission model), D10 (unknown fields pass through). No React, no Firebase.
 *
 * Reading: `csUserToProfile`.   Writing: `profilePatchToCsUser`, which returns ONLY the fields to merge-write, with CS's
 * own field names, and keeps the CS-readable ones (`role`, `roles`, `secondaryRoles`, `isTeamAdmin`) consistent.
 * `encryptedUserData` / `userDataEncryptedAt` are never read or written here, so a merge write can never drop them.
 */
import { CS_DEFAULT_THEME_ID, CS_OWNER_UIDS, isCsOwnerUid } from "@/config/cs";
import type { CsRecord, CsUserDoc } from "@/data/cs/types";
import { str, toEpochMs } from "@/data/cs/util";
import type { UserDoc } from "@/lib/auth";
import { parseAvatar } from "@/lib/profile/model";
import { isRoleId, normalizeLegacyRole, sortRolesCanonical, ROLES, type RoleId } from "@/lib/roles";
import type { TeamMember } from "@/lib/team-members";
import { isThemeId } from "@/lib/themes";

type ColorMode = "light" | "dark" | "system";

/** CS theme ids the rebuild maps onto its own (theme id + light/dark mode). Pride ids are shared and need no entry. */
const CS_THEME_TO_CE: Record<string, { themeId: string; colorMode: "light" | "dark" }> = {
  "light-compsocrates": { themeId: "compsocrates", colorMode: "light" },
  "dark-compsocrates": { themeId: "compsocrates", colorMode: "dark" },
};

/** CS pride theme ids whose CE id is spelled differently (both lists are in lib/themes.ts and CS app/utils/themes.ts). */
const CS_PRIDE_TO_CE: Record<string, string> = {
  "pride-gay": "pride-gay-mlm",
  "pride-bi": "pride-bisexual",
  "pride-pan": "pride-pansexual",
  "pride-trans": "pride-transgender",
  "pride-nonbinary": "pride-non-binary",
};
const CE_PRIDE_TO_CS: Record<string, string> = Object.fromEntries(Object.entries(CS_PRIDE_TO_CE).map(([cs, ce]) => [ce, cs]));

/** The CS `accountThemeId` for a CE theme (+ mode), or null when CS has no such theme (its picker would not know the id). */
export function csThemeIdFor(themeId: string, colorMode?: ColorMode): string | null {
  if (themeId === "compsocrates") return colorMode === "dark" ? "dark-compsocrates" : "light-compsocrates";
  if (themeId.startsWith("pride-")) return CE_PRIDE_TO_CS[themeId] ?? themeId;
  return null;
}

function isColorMode(value: unknown): value is ColorMode {
  return value === "light" || value === "dark" || value === "system";
}

/** Theme for a user doc: the CE `themeId` field when it is a known theme, else CS's `accountThemeId` when it maps, else the default. */
export function resolveTheme(doc: CsRecord): { themeId: string; colorMode?: ColorMode } {
  const ownColorMode = isColorMode(doc.colorMode) ? doc.colorMode : undefined;
  if (isThemeId(doc.themeId)) return { themeId: doc.themeId, ...(ownColorMode ? { colorMode: ownColorMode } : {}) };
  const csTheme = str(doc.accountThemeId).trim();
  const mapped = CS_THEME_TO_CE[csTheme];
  if (mapped) return { themeId: mapped.themeId, colorMode: ownColorMode ?? mapped.colorMode };
  const pride = CS_PRIDE_TO_CE[csTheme];
  if (pride && isThemeId(pride)) return { themeId: pride, ...(ownColorMode ? { colorMode: ownColorMode } : {}) };
  if (isThemeId(csTheme)) return { themeId: csTheme, ...(ownColorMode ? { colorMode: ownColorMode } : {}) };
  return { themeId: CS_DEFAULT_THEME_ID, ...(ownColorMode ? { colorMode: ownColorMode } : {}) };
}

/** `role` + `roles` + `secondaryRoles` of a CS doc -> canonical primary and secondary roles (secondary excludes the primary). */
export function rolesFromCsUser(doc: Pick<CsUserDoc, "role" | "roles" | "secondaryRoles">): { primaryRole: RoleId; secondaryRoles: RoleId[] } {
  const listed = [...(Array.isArray(doc.roles) ? doc.roles : []), ...(Array.isArray(doc.secondaryRoles) ? doc.secondaryRoles : [])]
    .filter((value): value is string => typeof value === "string")
    .map((value) => normalizeLegacyRole(value));
  const rawPrimary = typeof doc.role === "string" ? doc.role.trim() : "";
  // CS getPrimaryRole: the stored `role`, else Drive Team when held, else the first listed role.
  const primaryRole: RoleId = rawPrimary ? normalizeLegacyRole(rawPrimary) : listed.includes("drive-team") ? "drive-team" : (listed[0] ?? "match-scout");
  const secondaryRoles = sortRolesCanonical(listed.filter((role) => role !== primaryRole)).slice(0, ROLES.length);
  return { primaryRole, secondaryRoles };
}

/** D6: CS's `isTeamAdmin`, and the legacy `role == "coach"` the production rules also treat as admin. */
export function isAdminFromCsUser(doc: Pick<CsUserDoc, "isTeamAdmin" | "role">): boolean {
  return doc.isTeamAdmin === true || str(doc.role).trim().toLowerCase() === "coach";
}

export type CsUserReadOptions = {
  /** Platform owner uids; defaults to `CS_OWNER_UIDS` (config/cs.ts). */
  ownerUids?: readonly string[];
};

/** Reads `users/{uid}` as CE's profile. Never throws on missing fields (old docs lack most of them). */
export function csUserToProfile(uid: string, doc: CsUserDoc, options: CsUserReadOptions = {}): UserDoc {
  const ownerUids = options.ownerUids ?? CS_OWNER_UIDS;
  const { primaryRole, secondaryRoles } = rolesFromCsUser(doc);
  const owner = isCsOwnerUid(uid, ownerUids);
  const theme = resolveTheme(doc);
  const record = doc as CsRecord;

  const profile: UserDoc = {
    name: str(doc.displayName).trim() || str(record.name).trim() || str(doc.email).split("@")[0] || "",
    email: str(doc.email),
    teamId: str(doc.teamId).trim(),
    primaryRole,
    secondaryRoles,
    isAdmin: isAdminFromCsUser(doc) || owner,
    // `isOwner` is the TEAM owner mirror in CE; CS has no such field, so only the allowlisted platform owner (or an explicit
    // CE-written mirror, additive) is one. The team's `verifiedOwnerId` is exposed on the team doc (`ownerUid`).
    isOwner: owner || record.isOwner === true,
    isPlatformOwner: owner || record.isPlatformOwner === true,
    themeId: theme.themeId,
    ...(theme.colorMode ? { colorMode: theme.colorMode } : {}),
    ...(isCeGradient(record.gradientIntensity) ? { gradientIntensity: record.gradientIntensity } : {}),
    ...(record.lastSeenChangelogAt !== undefined ? { lastSeenChangelogAt: record.lastSeenChangelogAt } : {}),
    ...(typeof record.glassLayerLevel === "number" ? { glassLayerLevel: record.glassLayerLevel } : {}),
    ...(typeof record.workspaceFormWidth === "number" ? { workspaceFormWidth: record.workspaceFormWidth } : {}),
    ...(typeof record.workspacePhoneSplit === "number" ? { workspacePhoneSplit: record.workspacePhoneSplit } : {}),
    ...(record.avatar ? { avatar: parseAvatar(record.avatar) } : {}),
    ...(typeof doc.bio === "string" ? { bio: doc.bio } : {}),
    ...(typeof doc.photoURL === "string" && doc.photoURL ? { photoURL: doc.photoURL } : {}),
    ...(doc.profileVisibility === "team" || doc.profileVisibility === "public" || doc.profileVisibility === "private" ? { profileVisibility: doc.profileVisibility } : {}),
    ...(typeof doc.profileComplete === "boolean" ? { profileComplete: doc.profileComplete } : {}),
    ...(typeof doc.experiencedScout === "boolean" ? { experiencedScout: doc.experiencedScout } : {}),
    ...(typeof doc.preferredDashboard === "string" && doc.preferredDashboard ? { preferredDashboard: doc.preferredDashboard } : {}),
  };
  return profile;
}

function isCeGradient(value: unknown): value is "subtle" | "normal" | "vivid" {
  return value === "subtle" || value === "normal" || value === "vivid";
}

/** Reads a roster row (Team Management / People) from a CS user doc. */
export function csUserToMember(uid: string, doc: CsUserDoc, options: CsUserReadOptions = {}): TeamMember {
  const profile = csUserToProfile(uid, doc, options);
  const record = doc as CsRecord;
  const createdMs = toEpochMs(doc.createdAt);
  return {
    uid,
    name: profile.name,
    email: profile.email,
    primaryRole: profile.primaryRole,
    secondaryRoles: profile.secondaryRoles,
    isAdmin: profile.isAdmin,
    isOwner: profile.isOwner,
    legacyRole: typeof doc.role === "string" ? doc.role : undefined,
    avatar: record.avatar ? parseAvatar(record.avatar) : undefined,
    joinedAtMs: createdMs || undefined,
  };
}

/** What CE may write to the user doc (`updateUserProfile`, member editing, the CE-only preference writers). */
export type ProfilePatch = Partial<
  Pick<UserDoc, "name" | "themeId" | "colorMode" | "gradientIntensity" | "avatar" | "primaryRole" | "secondaryRoles" | "isAdmin" | "bio" | "photoURL" | "profileVisibility" | "profileComplete" | "experiencedScout">
>;

/**
 * CE profile patch -> the CS fields to merge-write. Only what the patch touches is returned.
 *  - name -> `displayName`
 *  - primaryRole / secondaryRoles -> `role`, `roles` (primary first, then the secondaries) and `secondaryRoles`, always written together
 *    so CS's `getUserRoles` and the production rules agree. `current` supplies the half the patch leaves out.
 *  - isAdmin -> `isTeamAdmin`. A legacy `role: "coach"` is an admin to the rules, so demoting it rewrites `role` too; changing the role
 *    of a legacy coach keeps them an admin by setting `isTeamAdmin`.
 *  - themeId / colorMode -> the CE fields as written, plus `accountThemeId` when CS has the matching theme (so CS's own picker follows).
 *  - everything else (avatar, gradientIntensity, bio, ...) keeps its name: additive fields CS ignores.
 * Never returns `encryptedUserData`, `teamId`, `email`, `isOwner` or `isPlatformOwner`.
 */
export function profilePatchToCsUser(patch: ProfilePatch, current: CsUserDoc = {}): CsRecord {
  const out: CsRecord = {};
  if (patch.name !== undefined) out.displayName = patch.name;

  const demotingCoach = patch.isAdmin === false && str(current.role).trim().toLowerCase() === "coach";
  const rolesTouched = patch.primaryRole !== undefined || patch.secondaryRoles !== undefined;
  if (rolesTouched || demotingCoach) {
    const now = rolesFromCsUser(current);
    const primary: RoleId = patch.primaryRole !== undefined && isRoleId(patch.primaryRole) ? patch.primaryRole : now.primaryRole;
    const secondary = sortRolesCanonical((patch.secondaryRoles ?? now.secondaryRoles).filter((r) => isRoleId(r) && r !== primary));
    out.role = primary;
    out.roles = [primary, ...secondary];
    out.secondaryRoles = secondary;
    if (rolesTouched && patch.isAdmin === undefined && str(current.role).trim().toLowerCase() === "coach" && primary !== "team-coach") out.isTeamAdmin = true;
  }
  if (patch.isAdmin !== undefined) out.isTeamAdmin = patch.isAdmin;

  if (patch.themeId !== undefined) out.themeId = patch.themeId;
  if (patch.colorMode !== undefined) out.colorMode = patch.colorMode;
  if (patch.themeId !== undefined || patch.colorMode !== undefined) {
    const themeId = patch.themeId ?? resolveTheme(current as CsRecord).themeId;
    const mode = patch.colorMode ?? (isColorMode(current.colorMode) ? current.colorMode : undefined);
    const csTheme = csThemeIdFor(themeId, mode);
    if (csTheme) out.accountThemeId = csTheme;
  }

  for (const key of ["gradientIntensity", "avatar", "bio", "photoURL", "profileVisibility", "profileComplete", "experiencedScout"] as const) {
    if (patch[key] !== undefined) out[key] = patch[key];
  }
  return out;
}
