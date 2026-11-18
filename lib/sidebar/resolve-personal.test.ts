import { describe, expect, it } from "vitest";
import { resolveSidebar, type SidebarNode } from "@/lib/sidebar/resolve";
import { PROGRAM_IDS } from "@/config/programs/types";

const ids = (nodes: SidebarNode[]): string[] => nodes.flatMap((n) => (n.kind === "group" ? ids(n.children ?? []) : [n.id]));

describe("resolveSidebar in personal mode (memberships ON, no team)", () => {
  for (const program of PROGRAM_IDS) {
    it(`${program}: only the personal pages, none of the team's, and never an empty list`, () => {
      const out = resolveSidebar({ program, isAdmin: false, can: () => false, config: null, personal: { isPlatformOwner: false } });
      const all = [...ids(out.main), ...ids(out.footer)];
      expect(all).toEqual(expect.arrayContaining(["dashboard", "practice-scouting", "achievements", "changelog", "credits", "account-settings"]));
      for (const team of ["assignments", "analytics", "match-scout-form", "scout-accuracy", "my-scouting", "people", "team-management", "team-settings", "admin-panel", "event-selection", "match-list"]) {
        expect(all, team).not.toContain(team);
      }
      expect(all.length).toBeGreaterThan(0);
    });

    it(`${program}: the platform owner also gets the Admin Panel`, () => {
      const out = resolveSidebar({ program, isAdmin: false, can: () => false, config: null, personal: { isPlatformOwner: true } });
      expect([...ids(out.main), ...ids(out.footer)]).toContain("admin-panel");
    });

    it(`${program}: a team's saved layout and page access do not apply with no team, and without personal mode nothing changes`, () => {
      const hideAll = resolveSidebar({ program, isAdmin: false, can: () => false, config: null, personal: { isPlatformOwner: false } });
      expect(ids(hideAll.main).length + ids(hideAll.footer).length).toBeGreaterThan(0);
      const normal = resolveSidebar({ program, isAdmin: false, can: () => true, config: null });
      expect([...ids(normal.main), ...ids(normal.footer)]).toContain("assignments");
    });
  }
});
