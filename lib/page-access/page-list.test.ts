import { describe, expect, it } from "vitest";
import { normalizeEntries } from "@/lib/sidebar/layout";
import { FORMS_GROUP_ID } from "@/lib/sidebar/types";
import { FOOTER_GROUP_ID, LOOSE_GROUP_ID, MORE_GROUP_ID, accessPageGroups, filterGroups, flatRows } from "./page-list";
import { PAGES } from "./pages";

const frc = accessPageGroups("frc", normalizeEntries(null));
const ftc = accessPageGroups("ftc", normalizeEntries(null));
const ids = (g: ReturnType<typeof accessPageGroups>) => flatRows(g).map((r) => r.id);

describe("accessPageGroups", () => {
  it("lists EVERY page of the registry exactly once for the program that has them all", () => {
    expect(ids(frc).sort()).toEqual(PAGES.map((p) => p.id).sort());
  });
  it("is grouped like the sidebar: the Forms group holds the form pages, the footer block the account pages", () => {
    const forms = frc.find((g) => g.id === FORMS_GROUP_ID);
    expect(forms?.label).toBe("Forms");
    expect(forms?.rows.map((r) => r.id)).toEqual(["match-scout-form", "lead-scout-form", "match-strategy-form", "drive-reflection-form", "pit-scout-form", "team-strategy-form", "helper-form"]);
    expect(frc.find((g) => g.id === FOOTER_GROUP_ID)?.rows.map((r) => r.id)).toEqual(["admin-panel", "changelog", "credits", "account-settings"]);
    expect(frc.find((g) => g.id === LOOSE_GROUP_ID)).toBeTruthy();
    expect(frc.find((g) => g.id === MORE_GROUP_ID)?.rows.map((r) => r.id).sort()).toEqual(["accuracy-verification", "event-details", "scout-status"]);
  });
  it("classifies rows: restricted, open, always-on (with a reason) and the admin-only panel", () => {
    const row = (id: string) => flatRows(frc).find((r) => r.id === id)!;
    expect(row("assignments").kind).toBe("restricted");
    expect(row("match-list").kind).toBe("open");
    expect(row("dashboard")).toMatchObject({ kind: "always", reason: expect.stringContaining("landing page") });
    expect(row("practice-scouting").kind).toBe("always");
    expect(row("admin-panel")).toMatchObject({ kind: "admin" });
  });
  it("leaves out the pages a program does not have (never greyed out), through the same unavailablePaths rule as the sidebar", () => {
    expect(ids(frc)).toContain("judge-book");
    expect(ids(ftc)).not.toContain("judge-book");
    expect(ids(ftc)).not.toContain("accuracy-verification");
    expect(ids(ftc)).toContain("assignments");
  });
  it("follows the team's own arrangement (a renamed group, a moved page)", () => {
    const entries = normalizeEntries(null).map((e) => (e.id === FORMS_GROUP_ID ? { ...e, label: "Scouting forms" } : e));
    expect(accessPageGroups("frc", entries).find((g) => g.id === FORMS_GROUP_ID)?.label).toBe("Scouting forms");
  });
});

describe("filterGroups", () => {
  it("filters by page title, drops empty groups, and a group-name match keeps its rows", () => {
    expect(ids(filterGroups(frc, "match list"))).toEqual(["match-list"]);
    expect(filterGroups(frc, "forms").find((g) => g.id === FORMS_GROUP_ID)?.rows.length).toBe(7);
    expect(filterGroups(frc, "zzz")).toEqual([]);
    expect(filterGroups(frc, "  ")).toEqual(frc);
  });
});
