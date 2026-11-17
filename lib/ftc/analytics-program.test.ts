import { describe, expect, it } from "vitest";
import { parseFilters } from "@/lib/analytics/filters";
import { getDefaultSeason, getSelectableSeasons } from "@/lib/events/config";
import { buildFormsValue } from "@/lib/forms/forms-context";
import { ftcProgramData } from "@/lib/ftc/program-data";

const games = ftcProgramData.games;
const params = (q: string) => new URLSearchParams(q);

describe("analytics filters for a program with its own games", () => {
  const valid = games.seasons.map((s) => s.id);

  it("defaults to the program's game, and accepts only the program's games", () => {
    expect(parseFilters(params(""), valid, games.defaultSeasonId).gameId).toBe("biobuzz");
    expect(parseFilters(params("game=biobuzz"), valid, games.defaultSeasonId).gameId).toBe("biobuzz");
    // another program's game id in a hand-edited link is not a game here
    expect(parseFilters(params("game=rebuilt"), valid, games.defaultSeasonId).gameId).toBe("biobuzz");
  });

  it("without a program's games the filters are exactly what they were", () => {
    expect(parseFilters(params("")).gameId).toBe("rebuilt");
    expect(parseFilters(params("game=reefscape")).gameId).toBe("reefscape");
    expect(parseFilters(params("game=biobuzz")).gameId).toBe("rebuilt");
  });
});

describe("seasonFor", () => {
  const catalog = { docs: new Map(), versions: new Map(), builtins: games.builtinForms };
  const value = buildFormsValue(catalog, true, {}, () => {}, new Set(), games);

  it("gives the program's season with the events API's season year, and falls back to the default season", () => {
    expect(value.seasonFor("biobuzz")).toMatchObject({ id: "biobuzz", name: "BIOBUZZ", apiSeason: 2026 });
    expect(value.seasonFor()).toMatchObject({ id: "biobuzz" });
    expect(value.seasonFor("rebuilt")).toMatchObject({ id: "biobuzz" });
  });

  it("without a program's games it is the default program's season list", () => {
    const root = buildFormsValue({ docs: new Map(), versions: new Map() }, true, {}, () => {});
    expect(root.seasonFor("reefscape")).toMatchObject({ id: "reefscape", name: "REEFSCAPE" });
    expect(root.seasonFor().id).toBe("rebuilt");
  });
});

describe("the events API season range", () => {
  const catalog = { docs: new Map(), versions: new Map(), builtins: games.builtinForms };

  it("is the program's current game's season, with the next one and the two before it", () => {
    const value = buildFormsValue(catalog, true, {}, () => {}, new Set(), games);
    expect(value.defaultApiSeason).toBe(2026);
    expect(value.selectableApiSeasons).toEqual([2027, 2026, 2025, 2024]);
  });

  it("without a program's games it is the configured season range, as the event pages always used", () => {
    const root = buildFormsValue({ docs: new Map(), versions: new Map() }, true, {}, () => {});
    expect(root.defaultApiSeason).toBe(getDefaultSeason());
    expect(root.selectableApiSeasons).toEqual(getSelectableSeasons());
  });
});
