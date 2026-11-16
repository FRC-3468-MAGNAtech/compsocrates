import { describe, expect, it } from "vitest";
import {
  MAX_OPEN_RESTRICTIONS_PER_ROLE,
  accessiblePages,
  canAccessPage,
  defaultPageAccessConfig,
  explainAccess,
  parsePageAccess,
  rolePageCount,
  samePageAccess,
  sanitizeOpenRestrictions,
  setMemberPageState,
  setOpenRestriction,
  type AccessUser,
  type PageAccessConfig,
} from "./access";
import { ALWAYS_ON_PAGES, PAGES, RESTRICTABLE_OPEN_PAGES, isAlwaysOnPage } from "./pages";
import { ROLES } from "@/lib/roles";

// Session 6: an admin can close an OPEN page to a role (`openRestrictions`). With none stored, behavior is what access.characterization.test.ts pins.

const user = (over: Partial<AccessUser> = {}): AccessUser => ({ uid: "u1", isAdmin: false, isOwner: false, primaryRole: "match-scout", secondaryRoles: [], ...over });
const restrict = (role: "match-scout" | "team-coach" | "media" | "lead-scout", pageId: string, base: PageAccessConfig = defaultPageAccessConfig()) => setOpenRestriction(base, role, pageId, true);

describe("explicit restriction on an open page", () => {
  it("closes the page to that role only, and says why", () => {
    const cfg = restrict("match-scout", "match-list");
    expect(explainAccess(user(), "match-list", cfg)).toEqual({ allowed: false, source: "restricted", viaRoles: [] });
    expect(canAccessPage(user({ primaryRole: "media" }), "match-list", cfg)).toBe(true);
    expect(canAccessPage(user({ primaryRole: "match-scout" }), "my-scouting", cfg)).toBe(true);
  });
  it("a person with several roles keeps the page while ANY of their roles is not restricted", () => {
    const cfg = restrict("match-scout", "match-list");
    expect(canAccessPage(user({ secondaryRoles: ["media"] }), "match-list", cfg)).toBe(true);
    expect(canAccessPage(user({ secondaryRoles: ["media"] }), "match-list", restrict("media", "match-list", cfg))).toBe(false);
  });
  it("an individual grant re-opens it for one member only", () => {
    const cfg = setMemberPageState(restrict("match-scout", "match-list"), "u1", "match-list", "grant");
    expect(explainAccess(user(), "match-list", cfg)).toEqual({ allowed: true, source: "grant", viaRoles: [] });
    expect(canAccessPage(user({ uid: "u2" }), "match-list", cfg)).toBe(false);
  });
  it("an open page takes a grant or 'follow roles' but never a deny", () => {
    const base = restrict("match-scout", "match-list");
    expect(setMemberPageState(base, "u1", "match-list", "deny")).toBe(base);
    expect(setMemberPageState(setMemberPageState(base, "u1", "match-list", "grant"), "u1", "match-list", "default").memberOverrides).toEqual({});
  });
  it("leaves role grants and restricted pages alone", () => {
    const cfg = restrict("team-coach", "people");
    expect(canAccessPage(user({ primaryRole: "team-coach" }), "team-management", cfg)).toBe(true);
    expect(cfg.roleGrants).toEqual(defaultPageAccessConfig().roleGrants);
  });
  it("un-restricting removes the entry, and an empty config has no field at all", () => {
    const cfg = restrict("match-scout", "match-list");
    const back = setOpenRestriction(cfg, "match-scout", "match-list", false);
    expect("openRestrictions" in back).toBe(false);
    expect(samePageAccess(back, defaultPageAccessConfig())).toBe(true);
    expect(samePageAccess(cfg, defaultPageAccessConfig())).toBe(false);
  });
});

describe("what can never be restricted", () => {
  it("always-on pages and the admin panel refuse a restriction", () => {
    const base = defaultPageAccessConfig();
    for (const id of [...Object.keys(ALWAYS_ON_PAGES), "admin-panel", "assignments", "nope"]) expect(setOpenRestriction(base, "match-scout", id, true), id).toBe(base);
    for (const id of Object.keys(ALWAYS_ON_PAGES)) expect(canAccessPage(user(), id, parsePageAccess({ openRestrictions: { "match-scout": [id] } })), id).toBe(true);
  });
  it("an admin or owner id is never a restricted role, and the save-path cleaner drops one", () => {
    const base = defaultPageAccessConfig();
    expect(setOpenRestriction(base, "admin" as never, "match-list", true)).toBe(base);
    expect(setOpenRestriction(base, "owner" as never, "match-list", true)).toBe(base);
    expect(sanitizeOpenRestrictions({ admin: ["match-list"], owner: ["match-list"], media: ["match-list"] })).toEqual({ media: ["match-list"] });
  });
  it("an admin or the owner keeps every page whatever is restricted (the resolver checks admin first), including Page Access and the Admin Panel", () => {
    const all = ROLES.reduce((cfg, r) => RESTRICTABLE_OPEN_PAGES.reduce((c, p) => setOpenRestriction(c, r.id, p.id, true), cfg), defaultPageAccessConfig());
    for (const flags of [{ isAdmin: true }, { isOwner: true }]) {
      expect(new Set(accessiblePages(user({ ...flags, primaryRole: "media" }), all).map((p) => p.id))).toEqual(new Set(PAGES.map((p) => p.id)));
    }
    expect(canAccessPage(user({ isAdmin: true }), "admin-panel", all)).toBe(true);
  });
  it("the Dashboard and the personal pages stay open even with every restrictable page closed to every role", () => {
    const all = ROLES.reduce((cfg, r) => RESTRICTABLE_OPEN_PAGES.reduce((c, p) => setOpenRestriction(c, r.id, p.id, true), cfg), defaultPageAccessConfig());
    for (const role of ROLES) {
      const open = accessiblePages(user({ primaryRole: role.id }), all).map((p) => p.id);
      for (const id of Object.keys(ALWAYS_ON_PAGES)) expect(open, `${role.id} ${id}`).toContain(id);
    }
  });
});

describe("reading a stored doc", () => {
  it("a doc without the field is today's behavior, and the field is not invented", () => {
    expect("openRestrictions" in parsePageAccess({ roleGrants: {}, memberOverrides: {} })).toBe(false);
    expect("openRestrictions" in parsePageAccess(undefined)).toBe(false);
  });
  it("keeps role ids as keys, string-array values and restrictable open page ids only", () => {
    const cfg = parsePageAccess({
      openRestrictions: { media: ["match-list", "match-list", "dashboard", "assignments", "admin-panel", 7, "nope"], "not-a-role": ["match-list"], "team-coach": "match-list", "pit-team": [] },
    });
    expect(cfg.openRestrictions).toEqual({ media: ["match-list"] });
  });
  it("tolerates garbage (arrays, strings, nulls) without throwing, and caps a list", () => {
    for (const raw of [null, 3, "x", [], [["media"]], { media: null }]) expect(sanitizeOpenRestrictions(raw)).toEqual({});
    const many = Array.from({ length: 500 }, (_, i) => `p${i}`);
    expect(sanitizeOpenRestrictions({ media: [...RESTRICTABLE_OPEN_PAGES.map((p) => p.id), ...many] }).media?.length).toBeLessThanOrEqual(MAX_OPEN_RESTRICTIONS_PER_ROLE);
  });
  it("a member grant of a restrictable open page survives a read; an unknown or always-on grant does not", () => {
    const cfg = parsePageAccess({ memberOverrides: { u1: { grant: ["match-list", "dashboard", "nope"], deny: ["match-list"] } } });
    expect(cfg.memberOverrides.u1).toEqual({ grant: ["match-list"], deny: [] });
  });
});

describe("empty roles", () => {
  it("counts pages beyond the always-on ones, and reaches 0 only when everything is closed", () => {
    const base = defaultPageAccessConfig();
    expect(rolePageCount(base, "match-scout")).toBe(RESTRICTABLE_OPEN_PAGES.length);
    const closed = RESTRICTABLE_OPEN_PAGES.reduce((c, p) => setOpenRestriction(c, "media", p.id, true), base);
    expect(rolePageCount(closed, "media")).toBe(0);
    expect(rolePageCount(closed, "team-coach")).toBeGreaterThan(0);
    // the role is allowed: the always-on pages still open
    expect(canAccessPage(user({ primaryRole: "media" }), "dashboard", closed)).toBe(true);
    expect(isAlwaysOnPage("dashboard")).toBe(true);
  });
});
