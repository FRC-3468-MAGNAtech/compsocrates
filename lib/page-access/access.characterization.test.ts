import { describe, expect, it } from "vitest";
import { accessiblePages, canAccessPage, explainAccess, parsePageAccess, setMemberPageState, type AccessUser, type PageAccessConfig } from "./access";
import { PAGES } from "./pages";
import { PROGRAMS, isUnavailableInProgram } from "@/config/programs";
import type { ProgramId } from "@/config/programs/types";
import { canShowPage } from "@/lib/sidebar/resolve";
import { ROLES, type RoleId } from "@/lib/roles";

// Session 6, Task 1: pins TODAY's effective-access results, committed before any change. They must keep passing unchanged afterwards:
// a stored doc with no new field behaves exactly as before.

const user = (over: Partial<AccessUser> = {}): AccessUser => ({ uid: "u1", isAdmin: false, isOwner: false, primaryRole: "match-scout", secondaryRoles: [], ...over });
const ids = (u: AccessUser, cfg?: PageAccessConfig | null) => accessiblePages(u, cfg).map((p) => p.id);

const OPEN = ["dashboard", "match-scout-form", "analytics", "practice-scouting", "my-scouting", "people", "achievements", "changelog", "credits", "account-settings", "match-list", "event-details", "judge-book"];
const ALL = PAGES.map((p) => p.id);

/** What each role opens beyond the open pages, with no stored config. */
const ROLE_PAGES: Record<RoleId, string[]> = {
  "match-scout": [],
  "pit-scout": ["pit-scout-form", "helper-form"],
  "pit-team": ["helper-form"],
  "drive-team": ["drive-reflection-form"],
  "lead-scout": ["lead-scout-form", "scout-status", "scout-accuracy", "assignments", "event-selection"],
  "lead-strategist": ["team-strategy-form", "match-strategy-form", "event-selection"],
  "team-coach": ["accuracy-verification", "scout-status", "scout-accuracy", "event-selection", "team-management"],
  media: [],
  "judge-awards": [],
};

describe("characterization: effective access per role (no config, empty config, defaults)", () => {
  const empty: PageAccessConfig = { roleGrants: {}, memberOverrides: {} };
  for (const role of ROLES) {
    it(`${role.id}: open pages plus ${ROLE_PAGES[role.id].length} restricted`, () => {
      const expected = new Set([...OPEN, ...ROLE_PAGES[role.id]]);
      for (const cfg of [undefined, null, empty, parsePageAccess(undefined), parsePageAccess({})]) {
        expect(new Set(ids(user({ primaryRole: role.id }), cfg))).toEqual(expected);
      }
    });
  }
});

describe("characterization: page types", () => {
  it("an open page is open to every role, with source 'open'", () => {
    for (const role of ROLES) expect(explainAccess(user({ primaryRole: role.id }), "match-list", null)).toEqual({ allowed: true, source: "open", viaRoles: [] });
  });
  it("a role-gated page: allowed through the role (source 'role'), a secondary role counts", () => {
    expect(explainAccess(user({ primaryRole: "team-coach" }), "team-management", null)).toEqual({ allowed: true, source: "role", viaRoles: ["team-coach"] });
    expect(explainAccess(user({ secondaryRoles: ["team-coach"] }), "team-management", null)).toEqual({ allowed: true, source: "role", viaRoles: ["team-coach"] });
    expect(explainAccess(user(), "team-management", null)).toEqual({ allowed: false, source: "none", viaRoles: [] });
  });
  it("the admin panel is admin-only: no role, grant or config opens it for a member", () => {
    const cfg: PageAccessConfig = { roleGrants: { "team-coach": ["admin-panel"] }, memberOverrides: { u1: { grant: ["admin-panel"], deny: [] } } };
    expect(explainAccess(user({ primaryRole: "team-coach" }), "admin-panel", cfg)).toEqual({ allowed: false, source: "admin-only", viaRoles: [] });
    expect(explainAccess(user({ isAdmin: true }), "admin-panel", null)).toEqual({ allowed: true, source: "admin", viaRoles: [] });
  });
  it("an unknown page is closed, even for no roles; an unknown user is closed everywhere", () => {
    expect(canAccessPage(user(), "nope", null)).toBe(false);
    expect(canAccessPage(null, "dashboard", null)).toBe(false);
    expect(canAccessPage(undefined, "dashboard", null)).toBe(false);
  });
  it("a page the program lacks (an unavailable path) is hidden by the shared resolver even though access allows it, and a program that has it shows it", () => {
    const judgeBook = { id: "judge-book", href: "/judge-book", label: "Judge Book", icon: (() => null) as never };
    const programs = Object.keys(PROGRAMS) as ProgramId[];
    const lacking = programs.filter((id) => isUnavailableInProgram(id, "/judge-book"));
    const having = programs.filter((id) => !isUnavailableInProgram(id, "/judge-book"));
    expect(lacking.length).toBe(1);
    expect(canAccessPage(user(), "judge-book", null)).toBe(true);
    for (const program of lacking) expect(canShowPage(judgeBook, { program, isAdmin: true, can: () => true })).toBe(false);
    for (const program of having) expect(canShowPage(judgeBook, { program, isAdmin: false, can: (id) => canAccessPage(user(), id, null) })).toBe(true);
  });
});

describe("characterization: member grants and denies", () => {
  it("a grant opens a restricted page the roles don't; a deny wins over role and grant", () => {
    const granted: PageAccessConfig = { roleGrants: {}, memberOverrides: { u1: { grant: ["assignments"], deny: [] } } };
    expect(explainAccess(user(), "assignments", granted)).toEqual({ allowed: true, source: "grant", viaRoles: [] });
    const denied = setMemberPageState(granted, "u1", "assignments", "deny");
    expect(canAccessPage(user({ primaryRole: "lead-scout" }), "assignments", denied)).toBe(false);
    expect(explainAccess(user({ primaryRole: "lead-scout" }), "assignments", denied)).toEqual({ allowed: false, source: "denied", viaRoles: ["lead-scout"] });
  });
  it("a grant for one member does not reach another member", () => {
    const cfg: PageAccessConfig = { roleGrants: {}, memberOverrides: { u1: { grant: ["assignments"], deny: [] } } };
    expect(canAccessPage(user({ uid: "u2" }), "assignments", cfg)).toBe(false);
  });
  it("an open page ignores a deny (deny only applies to restricted pages today)", () => {
    const cfg: PageAccessConfig = { roleGrants: {}, memberOverrides: { u1: { grant: [], deny: ["match-list"] } } };
    expect(canAccessPage(user(), "match-list", cfg)).toBe(true);
  });
});

describe("characterization: missing, empty and stored config", () => {
  it("a role stored with an empty list stays empty; a role missing from the doc gets its defaults", () => {
    const cfg = parsePageAccess({ roleGrants: { "team-coach": [] } });
    expect(ids(user({ primaryRole: "team-coach" }), cfg)).toEqual(ALL.filter((id) => OPEN.includes(id)));
    expect(ids(user({ primaryRole: "lead-scout" }), cfg)).toContain("lead-scout-form");
  });
  it("an admin edit of roleGrants changes exactly that role's pages", () => {
    const cfg = parsePageAccess({ roleGrants: { "match-scout": ["assignments"] } });
    expect(canAccessPage(user(), "assignments", cfg)).toBe(true);
    expect(canAccessPage(user(), "team-management", cfg)).toBe(false);
  });
  it("garbage in the doc is dropped, never thrown", () => {
    const cfg = parsePageAccess({ roleGrants: { "match-scout": ["nope", 3, "dashboard"] }, memberOverrides: { u1: "x", u2: { grant: ["nope"], deny: null } } });
    expect(cfg.roleGrants["match-scout"]).toEqual([]);
    expect(cfg.memberOverrides).toEqual({});
  });
});

describe("characterization: admin, owner and the platform owner", () => {
  it("an admin or the owner opens every page whatever their roles, grants or denies say", () => {
    const cfg: PageAccessConfig = { roleGrants: { "match-scout": [] }, memberOverrides: { u1: { grant: [], deny: ["team-management", "assignments"] } } };
    for (const flags of [{ isAdmin: true }, { isOwner: true }, { isAdmin: true, isOwner: true }]) expect(new Set(ids(user(flags), cfg))).toEqual(new Set(ALL));
  });
  it("a platform owner reaches access as an admin/owner (access reads only those two flags); with neither, they are an ordinary member", () => {
    expect(new Set(ids(user({ isAdmin: true, primaryRole: "media" }), null))).toEqual(new Set(ALL));
    expect(canAccessPage(user({ primaryRole: "media" }), "team-management", null)).toBe(false);
  });
});
