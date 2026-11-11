import { describe, expect, it } from "vitest";
import { FORM_ANALYTICS_PAGES, formAnalyticsPagesForSeason } from "@/lib/analytics/form-analytics";
import { summaryFlavorForFormId, summaryFlavorForSeason } from "@/lib/analytics/summary-flavor";
import { BUILTIN_FORMS, seasonFormId } from "@/lib/forms/builtin";
import { DEFAULT_SEASON_ID } from "@/lib/seasons";
import { pageIdForForm } from "@/lib/server/blob-auth";
import { TEAM_ASSIGN_KIND_INFO } from "@/lib/team-assignments/model";

// The six forms exist once per season (REBUILT: "pit-scout-v1", BIOBUZZ: "biobuzz-pit-scout-v1"). The Analytics pages, the summary module, team assignments and the
// photo rules must all follow the season, so FTC mode (EVENT_PROGRAM=ftc) keeps reading the BIOBUZZ forms.

describe("summary flavor", () => {
  it("follows the season: BIOBUZZ for FTC, REBUILT for everything else", () => {
    expect(summaryFlavorForSeason("biobuzz")).toBe("biobuzz");
    expect(summaryFlavorForSeason("rebuilt")).toBe("rebuilt");
    expect(summaryFlavorForSeason("reefscape")).toBe("rebuilt");
    expect(summaryFlavorForSeason()).toBe(DEFAULT_SEASON_ID === "biobuzz" ? "biobuzz" : "rebuilt");
  });

  it("follows the form id, and a custom form id follows the season", () => {
    expect(summaryFlavorForFormId("pit-scout-v1")).toBe("rebuilt");
    expect(summaryFlavorForFormId("helper-v1", "biobuzz")).toBe("rebuilt");
    expect(summaryFlavorForFormId("biobuzz-pit-scout-v1", "rebuilt")).toBe("biobuzz");
    expect(summaryFlavorForFormId("biobuzz-drive-reflection-v1")).toBe("biobuzz");
    expect(summaryFlavorForFormId("my-pit-form", "biobuzz")).toBe("biobuzz");
    expect(summaryFlavorForFormId("my-pit-form", "rebuilt")).toBe("rebuilt");
  });
});

describe("the six Analytics pages per season", () => {
  it("point at the REBUILT forms in the REBUILT season and at the biobuzz-* forms in the BIOBUZZ season", () => {
    expect(formAnalyticsPagesForSeason("rebuilt").map((p) => p.formId)).toEqual(["lead-scout-v1", "pit-scout-v1", "team-strategy-v1", "match-strategy-v1", "drive-reflection-v1", "helper-v1"]);
    expect(formAnalyticsPagesForSeason("biobuzz").map((p) => p.formId)).toEqual(["biobuzz-lead-scout-v1", "biobuzz-pit-scout-v1", "biobuzz-team-strategy-v1", "biobuzz-match-strategy-v1", "biobuzz-drive-reflection-v1", "biobuzz-helper-v1"]);
  });

  it("each page's form exists and has the page's form type, in both seasons", () => {
    for (const season of ["rebuilt", "biobuzz"]) {
      for (const p of formAnalyticsPagesForSeason(season)) expect(BUILTIN_FORMS[p.formId]?.formType, `${season} ${p.slug}`).toBe(p.formType);
    }
  });

  it("describe each season's data, and the running season's pages are the exported ones", () => {
    const rebuilt = formAnalyticsPagesForSeason("rebuilt");
    const biobuzz = formAnalyticsPagesForSeason("biobuzz");
    expect(rebuilt.find((p) => p.slug === "pit-scout")?.description).toMatch(/preload/i);
    expect(biobuzz.find((p) => p.slug === "pit-scout")?.description).toMatch(/capabilities/i);
    expect(FORM_ANALYTICS_PAGES.map((p) => p.formId)).toEqual(formAnalyticsPagesForSeason(DEFAULT_SEASON_ID).map((p) => p.formId));
    // everything but the form id and the description is the same in both seasons
    const shape = (pages: typeof rebuilt) => pages.map((p) => [p.slug, p.href, p.title, p.navLabel, p.formType, p.unit, p.hasMatch, p.hasAlliance]);
    expect(shape(rebuilt)).toEqual(shape(biobuzz));
  });
});

describe("other places that name a form id", () => {
  it("team assignments use the running season's pit and strategy forms", () => {
    expect(TEAM_ASSIGN_KIND_INFO.pit.formId).toBe(seasonFormId("pit-scout"));
    expect(TEAM_ASSIGN_KIND_INFO.teamStrategy.formId).toBe(seasonFormId("team-strategy"));
  });

  it("a photo's page is the same for either season's form", () => {
    for (const type of ["pit-scout", "lead-scout", "team-strategy", "match-strategy", "drive-reflection", "helper"]) {
      const page = `${type}-form`;
      expect(pageIdForForm(seasonFormId(type, "rebuilt")), type).toBe(page);
      expect(pageIdForForm(seasonFormId(type, "biobuzz")), type).toBe(page);
    }
    expect(pageIdForForm("biobuzz")).toBe("match-scout-form");
    expect(pageIdForForm("rebuilt")).toBe("match-scout-form");
  });
});
