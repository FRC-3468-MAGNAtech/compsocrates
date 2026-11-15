import { describe, expect, it } from "vitest";
import { PROGRAMS } from "@/config/programs";
import { ADMIN_TAB_IDS } from "@/config/programs/types";
import { activeAdminTab, resolveAdminTabs } from "@/lib/admin/tabs";

// FRC's Admin Panel tab list as it was before the per-program config (the order of the page's label table).
const FRC_BEFORE = ["match-library", "forms", "page-access", "sidebar", "submissions", "entries", "sessions", "match-scout-ids", "practice-session-ids", "rescore", "audit-log", "backups", "applications", "templates", "recovery", "setup-check"];
const owner = { isPlatformOwner: true, canManageForms: true };
const plainAdmin = { isPlatformOwner: false, canManageForms: true };

describe("admin tab resolver", () => {
  it("FRC is unchanged: every tab in the old order for an owner, platform tabs hidden for an admin, Forms by permission", () => {
    expect([...ADMIN_TAB_IDS]).toEqual(FRC_BEFORE);
    expect(resolveAdminTabs(PROGRAMS.frc.admin, owner)).toEqual(FRC_BEFORE);
    expect(resolveAdminTabs(PROGRAMS.frc.admin, plainAdmin)).toEqual(FRC_BEFORE.filter((t) => !["applications", "templates", "recovery"].includes(t)));
    expect(resolveAdminTabs(PROGRAMS.frc.admin, { isPlatformOwner: false, canManageForms: false })).not.toContain("forms");
    expect(PROGRAMS.frc.admin.platformSettings).toBe(true);
  });

  it("FTC shows the nine ported tabs in FRC's order (Forms, Sessions, Rescore and Backups are the Batch 5b ones; templates live inside Forms)", () => {
    const ftc = resolveAdminTabs(PROGRAMS.ftc.admin, plainAdmin);
    expect(ftc).toEqual(["match-library", "forms", "page-access", "sidebar", "submissions", "sessions", "rescore", "audit-log", "backups"]);
    // the shared tabs keep the order FRC has them in
    const frc = resolveAdminTabs(PROGRAMS.frc.admin, plainAdmin);
    expect(frc.filter((t) => ftc.includes(t))).toEqual(ftc);
  });

  it("Forms follows the permission to manage forms in both programs", () => {
    const noForms = { isPlatformOwner: false, canManageForms: false };
    expect(resolveAdminTabs(PROGRAMS.ftc.admin, noForms)).not.toContain("forms");
    expect(resolveAdminTabs(PROGRAMS.frc.admin, noForms)).not.toContain("forms");
  });

  it("FTC has no public template sharing; FRC keeps it", () => {
    expect(PROGRAMS.ftc.admin.templateSharing).toBe(false);
    expect(PROGRAMS.frc.admin.templateSharing).toBe(true);
  });

  it("FTC hides the unported and owner-only tabs even from a platform owner", () => {
    const shown = resolveAdminTabs(PROGRAMS.ftc.admin, owner);
    for (const hidden of ["templates", "applications", "recovery", "entries", "match-scout-ids", "practice-session-ids", "setup-check"]) expect(shown, hidden).not.toContain(hidden);
    expect(PROGRAMS.ftc.admin.platformSettings).toBe(false);
  });

  it("opens the first shown tab when the wanted one is not shown", () => {
    const ftc = resolveAdminTabs(PROGRAMS.ftc.admin, plainAdmin);
    expect(activeAdminTab(ftc, null)).toBe("match-library");
    expect(activeAdminTab(ftc, "recovery")).toBe("match-library");
    expect(activeAdminTab(ftc, "rescore")).toBe("rescore");
    expect(activeAdminTab(ftc, "sidebar")).toBe("sidebar");
    expect(activeAdminTab([], "sidebar")).toBeNull();
  });
});

describe("FTC admin connection", () => {
  it("/admin is connected and the library flag is on; live and lobby are on too (Batch 6: they read by path, never by collection group)", () => {
    expect(PROGRAMS.ftc.connection.paths).toContain("/admin");
    expect(PROGRAMS.ftc.connection.features.library).toBe(true);
    for (const on of ["live", "lobby"] as const) expect(PROGRAMS.ftc.connection.features[on], on).toBe(true);
  });
});
