import { stripHtml } from "@/lib/forms/sanitize";
import {
  BIO_MAX,
  DEFAULT_AVATAR,
  DEFAULT_PROFILE_VISIBILITY,
  DISPLAY_NAME_MAX,
  PRONOUNS_MAX,
  presetById,
  type AvatarChoice,
  type ProfileVisibility,
} from "@/lib/profile/config";

// P25: the profile document and the pure rules around it (shared by the pages and mirrored by firestore.rules).

/** `profiles/{uid}`. Created on the member's first save; until then the defaults below apply. */
export type ProfileDoc = {
  teamId: string;
  /** Shown in the profile header only; falls back to the account name. */
  displayName: string;
  bio: string;
  pronouns: string;
  avatar: AvatarChoice;
  /** The member's PREFERENCE. What non-admin viewers get is effectiveVisibility(); admins of the same team see all (profileAccess). */
  visibility: ProfileVisibility;
  updatedAt?: unknown;
};

export function parseAvatar(raw: unknown): AvatarChoice {
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    if ((r.type === "google" || r.type === "initials" || r.type === "preset") && typeof r.value === "string") {
      if (r.type === "preset" && !presetById(r.value)) return DEFAULT_AVATAR;
      if (r.type === "google" && !isGoogleAvatarUrl(r.value)) return DEFAULT_AVATAR;
      return { type: r.type, value: r.value };
    }
  }
  return DEFAULT_AVATAR;
}

/** Google profile pictures only: an https URL on googleusercontent.com (also what the rules accept). */
export function isGoogleAvatarUrl(url: string): boolean {
  return url.length <= 500 && /^https:\/\/lh[0-9]\.googleusercontent\.com\/[^\s]*$/.test(url);
}

export function parseProfile(raw: Record<string, unknown> | undefined, teamId: string): ProfileDoc {
  const d = raw ?? {};
  return {
    teamId,
    displayName: typeof d.displayName === "string" ? d.displayName : "",
    bio: typeof d.bio === "string" ? d.bio : "",
    pronouns: typeof d.pronouns === "string" ? d.pronouns : "",
    avatar: parseAvatar(d.avatar),
    visibility: d.visibility === "private" || d.visibility === "public" ? d.visibility : DEFAULT_PROFILE_VISIBILITY,
    updatedAt: d.updatedAt,
  };
}

/** Plain text only: tags and control characters removed, runs of blank lines collapsed, trimmed, capped. */
export function sanitizeProfileText(input: string, max: number, opts: { multiline?: boolean } = {}): string {
  let s = stripHtml(String(input ?? ""))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\r\n?/g, "\n");
  s = opts.multiline ? s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n") : s.replace(/\s+/g, " ");
  return s.trim().slice(0, max);
}

export const sanitizeBio = (s: string) => sanitizeProfileText(s, BIO_MAX, { multiline: true });
export const sanitizePronouns = (s: string) => sanitizeProfileText(s, PRONOUNS_MAX);
export const sanitizeDisplayName = (s: string) => sanitizeProfileText(s, DISPLAY_NAME_MAX);

/** What applies to non-admin viewers: the member's own preference, whoever they are (an admin may set theirs private). */
export function effectiveVisibility(input: { visibility: ProfileVisibility | null | undefined }): ProfileVisibility {
  return input.visibility ?? DEFAULT_PROFILE_VISIBILITY;
}

export type ProfileAccess = "full" | "limited";

/**
 * What a viewer sees: everything, or only avatar, name and primary role ("This profile is private").
 * Yourself: everything. The platform owner: everything. A team admin: everything for members of THEIR OWN team while the owner's
 * `adminsSeeAllProfiles` switch is on (missing means on); with it off, admins are treated like members. Anyone else follows the
 * member's preference. Mirrors the `profiles/{uid}` rules, which are the real gate.
 */
export function profileAccess(input: {
  viewerUid: string;
  viewerIsAdmin: boolean;
  viewerIsPlatformOwner?: boolean;
  /** The viewer and the member are on the same team. A team admin's extra access never crosses teams. */
  sameTeam: boolean;
  targetUid: string;
  visibility: ProfileVisibility | null | undefined;
  /** appSettings/global.adminsSeeAllProfiles; null/undefined (not loaded, or never set) means on. */
  adminsSeeAll?: boolean | null;
}): ProfileAccess {
  if (input.viewerUid === input.targetUid || input.viewerIsPlatformOwner) return "full";
  if (input.viewerIsAdmin && input.sameTeam && input.adminsSeeAll !== false) return "full";
  return effectiveVisibility({ visibility: input.visibility }) === "public" ? "full" : "limited";
}

/** The visibility to write when saving: what the member chose (admins included). */
export function visibilityToSave(input: { chosen: ProfileVisibility }): ProfileVisibility {
  return input.chosen;
}

/** Admins can clear a teammate's bio / pronouns (never write them). The owner's own row is only theirs to edit. */
export function canModerateProfile(input: { viewerUid: string; viewerIsAdmin: boolean; targetUid: string; targetIsOwner: boolean }): boolean {
  return input.viewerIsAdmin && input.viewerUid !== input.targetUid && !input.targetIsOwner;
}

/** The header name: the profile's display name when set, else the account name. */
export const headerName = (profile: Pick<ProfileDoc, "displayName"> | null, accountName: string): string => profile?.displayName?.trim() || accountName;

export function initialsOf(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
