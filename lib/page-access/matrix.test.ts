import { describe, expect, it } from "vitest";
import { defaultPageAccessConfig, setMemberPageState, setOpenRestriction, type AccessUser } from "./access";
import { cellAction, cellLabel, cellState } from "./matrix";
import type { AccessPageRow } from "./page-list";

const user = (over: Partial<AccessUser> = {}): AccessUser => ({ uid: "u1", isAdmin: false, isOwner: false, primaryRole: "match-scout", secondaryRoles: [], ...over });
const row = (id: string, kind: AccessPageRow["kind"], title = id): AccessPageRow => ({ id, title, kind });
const cfg = defaultPageAccessConfig();

describe("cellState", () => {
  it("none, granted, role, blocked", () => {
    expect(cellState(user(), row("assignments", "restricted"), cfg)).toEqual({ kind: "none" });
    expect(cellState(user(), row("assignments", "restricted"), setMemberPageState(cfg, "u1", "assignments", "grant"))).toEqual({ kind: "granted" });
    expect(cellState(user({ primaryRole: "lead-scout" }), row("assignments", "restricted"), cfg)).toEqual({ kind: "role", roles: ["lead-scout"] });
    expect(cellState(user({ primaryRole: "lead-scout" }), row("assignments", "restricted"), setMemberPageState(cfg, "u1", "assignments", "deny"))).toEqual({ kind: "blocked", roles: ["lead-scout"] });
  });
  it("an open page is grey, becomes empty when the member's roles are closed out, and solid when granted back", () => {
    expect(cellState(user(), row("match-list", "open"), cfg)).toEqual({ kind: "open" });
    const closed = setOpenRestriction(cfg, "match-scout", "match-list", true);
    expect(cellState(user(), row("match-list", "open"), closed)).toEqual({ kind: "none" });
    expect(cellState(user(), row("match-list", "open"), setMemberPageState(closed, "u1", "match-list", "grant"))).toEqual({ kind: "granted" });
  });
  it("always-on cells are locked; an admin's access shows as role access; the admin panel is empty for a member", () => {
    expect(cellState(user(), row("dashboard", "always"), cfg)).toEqual({ kind: "always" });
    expect(cellState(user({ isAdmin: true }), row("assignments", "restricted"), cfg)).toEqual({ kind: "role", roles: [], admin: true });
    expect(cellState(user(), row("admin-panel", "admin"), cfg)).toEqual({ kind: "none" });
    expect(cellState(user({ isAdmin: true }), row("admin-panel", "admin"), cfg)).toEqual({ kind: "role", roles: [], admin: true });
  });
});

describe("cellAction and cellLabel", () => {
  it("empty grants, solid removes, grey explains, locked and admin-only do nothing", () => {
    expect(cellAction({ kind: "none" }, row("a", "restricted"))).toEqual({ type: "grant" });
    expect(cellAction({ kind: "granted" }, row("a", "restricted"))).toEqual({ type: "remove" });
    expect(cellAction({ kind: "role", roles: ["lead-scout"] }, row("a", "restricted"))).toEqual({ type: "explain" });
    expect(cellAction({ kind: "open" }, row("a", "open"))).toEqual({ type: "explain" });
    expect(cellAction({ kind: "blocked", roles: [] }, row("a", "restricted"))).toEqual({ type: "explain" });
    expect(cellAction({ kind: "always" }, row("a", "always"))).toEqual({ type: "none" });
    expect(cellAction({ kind: "none" }, row("admin-panel", "admin"))).toEqual({ type: "none" });
  });
  it("names the member, the page and where the access comes from", () => {
    expect(cellLabel("Maria Lopez", "Match List", { kind: "role", roles: ["match-scout"] })).toBe("Maria Lopez, Match List: granted by role Match Scout");
    expect(cellLabel("Maria Lopez", "Assignments", { kind: "none" })).toContain("no access");
    expect(cellLabel("Maria Lopez", "Admin Panel", { kind: "none" }, true)).toContain("admins only");
  });
});
