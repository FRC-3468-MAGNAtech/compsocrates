import { type MembershipDoc } from "@/lib/memberships/model";
import { DEFAULT_ROLE_ID, isRoleId, normalizeLegacyRole, type RoleId } from "@/lib/roles";
import type { TeamMember } from "@/lib/team-members";

// The pure half of the roster seam, importable by the browser (lib/team-roster.ts) and the server (the snapshot roster dataset).

/** A roster row from a membership (a person whose ACTIVE team is another one). No email is stored on a membership, so none is shown. */
export function membershipToMember(m: MembershipDoc): TeamMember {
  const primary: RoleId = m.role ? normalizeLegacyRole(m.role) : DEFAULT_ROLE_ID;
  return {
    uid: m.uid,
    name: m.name || "Member",
    email: "",
    primaryRole: primary,
    secondaryRoles: (m.secondaryRoles ?? []).filter((r): r is RoleId => isRoleId(r) && r !== primary),
    isAdmin: m.isAdmin === true,
    isOwner: m.isOwner === true,
    ...(m.joinedAt > 0 ? { joinedAtMs: m.joinedAt } : {}),
    ...(m.fieldTeamIds && m.fieldTeamIds.length > 0 ? { assignedTeamIds: m.fieldTeamIds } : {}),
  };
}
