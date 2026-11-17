/**
 * Who sees what of Assignments > Past Team Members. Pure, so the rule is tested without rendering.
 *  - "hidden": the memberships switch is OFF, or the viewer is not an active admin of the team: no section at all.
 *  - "unverified": an active admin whose OWN membership of the team is not verified: the header and a one-line hint, no data, nothing read (the rules would refuse it).
 *  - "verified": an active admin whose own membership is active, admin and VERIFIED (the rule's own test): the section reads and shows the past members.
 */
export type PastMembersAccess = "hidden" | "unverified" | "verified";

export function pastMembersAccess(input: {
  enabled: boolean;
  isAdmin: boolean;
  membership: { implicit?: boolean; status: string; origin: string; isAdmin: boolean | null } | undefined;
}): PastMembersAccess {
  if (!input.enabled || !input.isAdmin) return "hidden";
  const m = input.membership;
  return !!m && !m.implicit && m.status === "active" && m.origin === "verified" && m.isAdmin === true ? "verified" : "unverified";
}
