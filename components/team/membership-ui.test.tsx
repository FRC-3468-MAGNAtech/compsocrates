import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth")>()), useAuth: () => ({ user: null, profile: null }) }));
vi.mock("@/lib/program/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {} }), usePathname: () => "/dashboard" }));

import { TeamSwitcher } from "@/components/team/team-switcher";
import { MyTeamsSection } from "@/components/team/my-teams-section";
import { RoleChoiceSection } from "@/components/team/role-choice-section";
import { MemberRow } from "@/components/team/member-row";
import { resetMembershipsEnabled } from "@/lib/memberships/client";
import { MEMBERSHIP_TEXT } from "@/lib/memberships/strings";

const html = (node: React.ReactNode) => renderToString(node).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'");
const member = { uid: "u2", name: "Pat", email: "p@x.test", primaryRole: "match-scout" as const, secondaryRoles: [], isAdmin: false, isOwner: false };
const edit = { canEdit: true, lockedReason: null, adminToggleBlock: null };

describe("everything membership-related is hidden while the switch is OFF", () => {
  it("draws nothing for the team switcher, My teams and the role-choice switch", () => {
    resetMembershipsEnabled(false);
    expect(html(<TeamSwitcher />)).toBe("");
    expect(html(<TeamSwitcher compact />)).toBe("");
    expect(html(<MyTeamsSection />)).toBe("");
    expect(html(<RoleChoiceSection teamId="T1" canEdit />)).toBe("");
  });
});

describe("the member row", () => {
  it("offers Remove only when asked to, with a named accessible label", () => {
    expect(html(<MemberRow member={member} editState={edit} />)).not.toContain(MEMBERSHIP_TEXT.members.remove);
    const out = html(<MemberRow member={member} editState={edit} onRemove={() => {}} />);
    expect(out).toContain(MEMBERSHIP_TEXT.members.remove);
    expect(out).toContain(`aria-label="${MEMBERSHIP_TEXT.members.remove}: Pat"`);
    expect(out).toContain('data-testid="remove-member-u2"');
  });
});

describe("the strings", () => {
  it("name the consequences of leaving and removing, and map the server's codes to sentences", async () => {
    const { friendlyMembershipError } = await import("@/lib/memberships/strings");
    expect(MEMBERSHIP_TEXT.myTeams.confirmBody).toMatch(/entries, assignments and attendance stay/i);
    expect(MEMBERSHIP_TEXT.members.confirmBody).toMatch(/entries, assignments and attendance stay/i);
    expect(friendlyMembershipError(Object.assign(new Error("x"), { code: "last_admin" }))).toBe(MEMBERSHIP_TEXT.myTeams.lastAdmin);
    expect(friendlyMembershipError(Object.assign(new Error("x"), { code: "quota_exceeded" }))).toMatch(/busy/);
    expect(friendlyMembershipError(new Error("Something went wrong."), "fallback")).toBe("fallback");
    expect(friendlyMembershipError(new Error("A real sentence."), "fallback")).toBe("A real sentence.");
  });
});
