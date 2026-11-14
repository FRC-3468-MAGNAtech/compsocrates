import { describe, expect, it } from "vitest";
import { DEFAULT_PROGRAM } from "@/config/programs/types";
import { FTC_GAME_DEFINITIONS } from "@/config/games/ftc";
import { FTC_SEASONS, ftcProgramData } from "@/lib/ftc/program-data";
import { programData } from "@/lib/program/data";

describe("the program data port", () => {
  it("the namespaced program has a port, and the default program has none (its hooks keep their own reads)", () => {
    expect(programData("ftc")).toBe(ftcProgramData);
    expect(programData(DEFAULT_PROGRAM)).toBeNull();
  });

  it("offers every read and write the connected pages use", () => {
    expect(Object.keys(ftcProgramData).sort()).toEqual(["attendance", "formEntries", "forms", "games", "members", "pickList", "profile", "scoutEntries", "team"]);
    for (const fn of [ftcProgramData.profile.subscribe, ftcProgramData.profile.update, ftcProgramData.team.subscribe, ftcProgramData.team.setActiveEvents, ftcProgramData.scoutEntries.subscribeTeam, ftcProgramData.scoutEntries.save, ftcProgramData.scoutEntries.update, ftcProgramData.scoutEntries.delete, ftcProgramData.formEntries.subscribe, ftcProgramData.forms.subscribeDocs, ftcProgramData.forms.loadVersion, ftcProgramData.members.subscribe, ftcProgramData.members.updateAccess, ftcProgramData.attendance.subscribeTeam, ftcProgramData.attendance.set, ftcProgramData.pickList.subscribe, ftcProgramData.pickList.edit]) {
      expect(typeof fn).toBe("function");
    }
  });

  it("its games are its own: one season per game, the default season is the current game, and every season's built-in form exists", () => {
    const { games } = ftcProgramData;
    expect(games.seasons).toBe(FTC_SEASONS);
    expect(games.seasons.map((s) => s.id)).toEqual(["biobuzz"]);
    expect(games.defaultSeasonId).toBe("biobuzz");
    expect(games.seasons[0]).toEqual({ id: "biobuzz", name: "BIOBUZZ", apiSeason: 2026, formId: FTC_GAME_DEFINITIONS.BIOBUZZ.formId, enabled: true });
    for (const season of games.seasons) expect(games.builtinForms[season.formId], season.id).toBeDefined();
    expect(games.seasons.some((s) => s.id === games.defaultSeasonId)).toBe(true);
  });
});
