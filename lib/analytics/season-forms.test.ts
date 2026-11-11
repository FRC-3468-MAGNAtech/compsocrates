import { describe, expect, it } from "vitest";
import { GAME_DEFINITIONS, GAME_ID_LIST } from "@/config/games";
import { FORM_ANALYTICS_PAGES } from "@/lib/analytics/form-analytics";
import { GAMES } from "@/lib/analytics/game-schema";
import { BUILTIN_FORMS, DEFAULT_FORM_ID, NON_MATCH_FORM_IDS, nonMatchTypeOfFormId, seasonFormId } from "@/lib/forms/builtin";
import { DEFAULT_SEASON_ID, getEnabledSeasons, getSeason, SEASONS } from "@/lib/seasons";
import { pageIdForForm } from "@/lib/server/blob-auth";
import { TEAM_ASSIGN_KIND_INFO } from "@/lib/team-assignments/model";

// The three games (REBUILT, REEFSCAPE, CHARGED UP) are the seasons, generated from the game registry. The six non-match forms exist for REBUILT only ("pit-scout-v1", ...),
// as in CS, so the Analytics pages, team assignments and the photo rules all resolve one id per form type.

describe("seasons come from the game registry", () => {
  it("lists the three games, REBUILT first and the default", () => {
    expect(SEASONS.map((s) => s.id)).toEqual(["rebuilt", "reefscape", "charged_up"]);
    expect(getEnabledSeasons().map((s) => s.name)).toEqual(["REBUILT", "REEFSCAPE", "CHARGED UP"]);
    expect(DEFAULT_SEASON_ID).toBe("rebuilt");
    expect(DEFAULT_FORM_ID).toBe("rebuilt");
  });

  it("every season is a game with a built-in match form, and an unknown season falls back to the default", () => {
    for (const id of GAME_ID_LIST) {
      const season = getSeason(id.toLowerCase());
      expect(season.gameId).toBe(id);
      expect(season.formId).toBe(GAME_DEFINITIONS[id].formId);
      expect(BUILTIN_FORMS[season.formId]?.formType, id).toBe("match-scout");
      expect(season.enabled).toBe(true);
    }
    expect(getSeason("nonsense").id).toBe("rebuilt");
  });

  it("the analytics Game filter offers a table for each of the three games", () => {
    expect(Object.keys(GAMES).sort()).toEqual(SEASONS.map((s) => s.formId).sort());
  });
});

describe("the six Analytics pages", () => {
  it("point at the REBUILT non-match forms", () => {
    expect(FORM_ANALYTICS_PAGES.map((p) => p.formId)).toEqual(["lead-scout-v1", "pit-scout-v1", "team-strategy-v1", "match-strategy-v1", "drive-reflection-v1", "helper-v1"]);
  });

  it("each page's form exists and has the page's form type", () => {
    for (const p of FORM_ANALYTICS_PAGES) expect(BUILTIN_FORMS[p.formId]?.formType, p.slug).toBe(p.formType);
  });

  it("describe the REBUILT data", () => {
    expect(FORM_ANALYTICS_PAGES.find((p) => p.slug === "pit-scout")?.description).toMatch(/preload/i);
  });
});

describe("other places that name a form id", () => {
  it("team assignments use the pit and strategy forms", () => {
    expect(TEAM_ASSIGN_KIND_INFO.pit.formId).toBe(seasonFormId("pit-scout"));
    expect(TEAM_ASSIGN_KIND_INFO.teamStrategy.formId).toBe(seasonFormId("team-strategy"));
  });

  it("resolves a form type or its id to the one id, and leaves a custom form id alone", () => {
    for (const [type, id] of Object.entries(NON_MATCH_FORM_IDS)) {
      expect(seasonFormId(type)).toBe(id);
      expect(seasonFormId(id)).toBe(id);
      expect(nonMatchTypeOfFormId(id)).toBe(type);
    }
    expect(seasonFormId("my-pit-form")).toBe("my-pit-form");
    expect(nonMatchTypeOfFormId("my-pit-form")).toBeNull();
  });

  it("a photo's page follows the form id", () => {
    for (const type of ["pit-scout", "lead-scout", "team-strategy", "match-strategy", "drive-reflection", "helper"]) expect(pageIdForForm(seasonFormId(type)), type).toBe(`${type}-form`);
    for (const game of ["rebuilt", "reefscape", "charged_up"]) expect(pageIdForForm(game)).toBe("match-scout-form");
  });
});
