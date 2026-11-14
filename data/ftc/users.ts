/**
 * Adapter between an FTC `programs/ftc/users/{uid}` document and the app's profile (`UserDoc`, lib/auth.tsx) and roster row
 * (`TeamMember`, lib/team-members.ts). No React, no Firebase.
 *
 * The stored doc already uses the app's own field names (`name`, `primaryRole`, `secondaryRoles`, `isAdmin`, `isOwner`), so this is a
 * tolerant read, not a translation: a missing or unknown value gets a neutral one and nothing throws. Admin and owner status are
 * exactly the stored flags; there is no allowlist (platform ownership is a mirror the server writes, and the rules read the token).
 * The members' assigned FTC team ids (`fieldTeamIds`) have no slot on `TeamMember`, so `readMemberFieldTeamIds` returns them.
 */
import type { UserDoc } from "@/lib/auth";
import { parseAvatar } from "@/lib/profile/model";
import { isRoleId, normalizeLegacyRole, sortRolesCanonical, type RoleId } from "@/lib/roles";
import type { TeamMember } from "@/lib/team-members";
import { defaultThemeId, isThemeId } from "@/lib/themes";
import { finiteNumber, nonEmptyString, str, stringList, toEpochMs } from "@/data/ftc/util";

/** `programs/ftc/users/{uid}` as stored. Everything optional: old docs lack most of it. */
export type FtcUserDoc = {
  name?: unknown;
  email?: unknown;
  teamId?: unknown;
  primaryRole?: unknown;
  secondaryRoles?: unknown;
  isAdmin?: unknown;
  isOwner?: unknown;
  isPlatformOwner?: unknown;
  themeId?: unknown;
  colorMode?: unknown;
  gradientIntensity?: unknown;
  lastSeenChangelogAt?: unknown;
  glassLayerLevel?: unknown;
  workspaceFormWidth?: unknown;
  workspacePhoneSplit?: unknown;
  avatar?: unknown;
  fieldTeamIds?: unknown;
  createdAt?: unknown;
  [key: string]: unknown;
};

/** The stored primary role (anything unknown is a Match Scout) and the secondaries: known roles only, no duplicates, never the primary, in canonical order. */
export function rolesFromFtcUser(doc: Pick<FtcUserDoc, "primaryRole" | "secondaryRoles">): { primaryRole: RoleId; secondaryRoles: RoleId[] } {
  const primaryRole = normalizeLegacyRole(str(doc.primaryRole));
  const secondary = new Set(stringList(doc.secondaryRoles).filter((role): role is RoleId => isRoleId(role) && role !== primaryRole));
  return { primaryRole, secondaryRoles: sortRolesCanonical(secondary) };
}

/** The member's assigned FTC team ids, or undefined when the doc has none (an absent list is how the rest of the app reads "all teams"). */
export function readMemberFieldTeamIds(doc: Pick<FtcUserDoc, "fieldTeamIds">): string[] | undefined {
  return Array.isArray(doc.fieldTeamIds) ? stringList(doc.fieldTeamIds) : undefined;
}

function colorModeOf(value: unknown): "light" | "dark" | "system" | undefined {
  return value === "light" || value === "dark" || value === "system" ? value : undefined;
}

function gradientOf(value: unknown): "subtle" | "normal" | "vivid" | undefined {
  return value === "subtle" || value === "normal" || value === "vivid" ? value : undefined;
}

/** Reads `programs/ftc/users/{uid}` as the app's profile. Never throws on missing fields. */
export function ftcUserToProfile(uid: string, doc: FtcUserDoc): UserDoc {
  void uid; // the document id is the account id; the profile type carries no uid (it comes from auth)
  const { primaryRole, secondaryRoles } = rolesFromFtcUser(doc);
  const email = str(doc.email);
  const colorMode = colorModeOf(doc.colorMode);
  const gradientIntensity = gradientOf(doc.gradientIntensity);
  const glassLayerLevel = finiteNumber(doc.glassLayerLevel);
  const workspaceFormWidth = finiteNumber(doc.workspaceFormWidth);
  const workspacePhoneSplit = finiteNumber(doc.workspacePhoneSplit);
  const assignedTeamIds = readMemberFieldTeamIds(doc);

  return {
    name: nonEmptyString(doc.name) ?? email.split("@")[0] ?? "",
    email,
    teamId: str(doc.teamId).trim(),
    primaryRole,
    secondaryRoles,
    isAdmin: doc.isAdmin === true,
    isOwner: doc.isOwner === true,
    isPlatformOwner: doc.isPlatformOwner === true,
    ...(assignedTeamIds && assignedTeamIds.length > 0 ? { assignedTeamIds } : {}),
    themeId: isThemeId(doc.themeId) ? doc.themeId : defaultThemeId,
    ...(colorMode ? { colorMode } : {}),
    ...(gradientIntensity ? { gradientIntensity } : {}),
    ...(doc.lastSeenChangelogAt !== undefined ? { lastSeenChangelogAt: doc.lastSeenChangelogAt } : {}),
    ...(glassLayerLevel !== null ? { glassLayerLevel } : {}),
    ...(workspaceFormWidth !== null ? { workspaceFormWidth } : {}),
    ...(workspacePhoneSplit !== null ? { workspacePhoneSplit } : {}),
    ...(doc.avatar ? { avatar: parseAvatar(doc.avatar) } : {}),
  };
}

/** Reads a roster row (Team Management / People) from a user doc. */
export function ftcUserToMember(uid: string, doc: FtcUserDoc): TeamMember {
  const profile = ftcUserToProfile(uid, doc);
  const joinedAtMs = toEpochMs(doc.createdAt);
  return {
    uid,
    name: profile.name,
    email: profile.email,
    primaryRole: profile.primaryRole,
    secondaryRoles: profile.secondaryRoles,
    isAdmin: profile.isAdmin,
    isOwner: profile.isOwner,
    ...(doc.avatar ? { avatar: parseAvatar(doc.avatar) } : {}),
    ...(joinedAtMs ? { joinedAtMs } : {}),
  };
}
