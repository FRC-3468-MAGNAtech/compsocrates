import { describe, expect, it } from "vitest";
import { isPathConnected, isUnavailableInProgram } from "@/config/programs";
import { FTC_UNAVAILABLE_PATHS } from "@/config/programs/ftc";
import { analyticsNav } from "@/lib/nav";
import { resolveSidebar, type SidebarNode } from "@/lib/sidebar/resolve";

// Performance Reliability and Robot Radar exist in BOTH programs: the same links in the sidebar section (Analytics), the tab strip and the customizer.

const PAGES = ["/analytics/performance-reliability", "/analytics/robot-radar"];
const tabsFor = (program: "frc" | "ftc") => analyticsNav.filter((item) => !isUnavailableInProgram(program, item.href)).map((item) => item.href);
const flat = (nodes: SidebarNode[]): SidebarNode[] => nodes.flatMap((n) => [n, ...(n.children ?? [])]);

describe("the three pages are connected and available for both programs", () => {
  it("the two analytics pages and any event key are connected and not greyed out", () => {
    for (const program of ["frc", "ftc"] as const) {
      for (const path of [...PAGES, "/events/2025-USCALAB", "/events/2026lake"]) {
        expect(isUnavailableInProgram(program, path), `${program} ${path}`).toBe(false);
        expect(isPathConnected(program, path), `${program} ${path}`).toBe(true);
      }
    }
  });

  it("the greyed-out list keeps only the pages that still do not exist in FTC", () => {
    expect([...FTC_UNAVAILABLE_PATHS]).toEqual(["/analytics/accuracy-compare", "/analytics/accuracy-verification", "/analytics/match-prediction", "/judge-book"]);
  });
});

describe("tab strip", () => {
  it("lists both pages for both programs, in the same order", () => {
    for (const program of ["frc", "ftc"] as const) for (const page of PAGES) expect(tabsFor(program)).toContain(page);
    const ftc = tabsFor("ftc");
    expect(tabsFor("frc").filter((h) => ftc.includes(h))).toEqual(ftc);
  });

  it("FTC lacks only the pages that are still FRC-only", () => {
    const missing = tabsFor("frc").filter((h) => !tabsFor("ftc").includes(h));
    expect(missing.sort()).toEqual(["/analytics/accuracy-compare", "/analytics/accuracy-verification", "/analytics/match-prediction"]);
  });
});

describe("sidebar and customizer resolver", () => {
  it("both programs show the Analytics section (the home of the analytics tabs), with no greyed entry", () => {
    for (const program of ["frc", "ftc"] as const) {
      const out = resolveSidebar({ program, isAdmin: true, can: () => true, config: null });
      const ids = flat([...out.main, ...out.footer]).map((n) => n.id);
      expect(ids).toContain("analytics");
      expect(flat([...out.main, ...out.footer]).some((n) => (n as { greyed?: boolean }).greyed)).toBe(false);
    }
  });
});
