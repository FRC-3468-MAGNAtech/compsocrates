import { describe, expect, it } from "vitest";
import { filterByGame, gameSeasonId, readGameParam } from "./game-filter";

const IDS = ["rebuilt", "reefscape", "charged_up"];
const opts = (seasonId: string | null) => ({ seasonId, seasonIds: IDS, fallbackSeasonId: "reefscape" });

describe("gameSeasonId", () => {
  it("reads stored game strings", () => {
    expect(gameSeasonId("REBUILT", IDS, "reefscape")).toBe("rebuilt");
    expect(gameSeasonId("CHARGED UP", IDS, "reefscape")).toBe("charged_up");
    expect(gameSeasonId("charged_up", IDS, "reefscape")).toBe("charged_up");
  });
  it("counts a missing or unknown game as the fallback (FRC: REEFSCAPE)", () => {
    expect(gameSeasonId(undefined, IDS, "reefscape")).toBe("reefscape");
    expect(gameSeasonId("", IDS, "reefscape")).toBe("reefscape");
    expect(gameSeasonId("MYSTERY", IDS, "reefscape")).toBe("reefscape");
  });
});

describe("filterByGame", () => {
  const items = [{ id: 1, game: "REBUILT" }, { id: 2, game: "REEFSCAPE" }, { id: 3 }, { id: 4, game: "CHARGED UP" }];
  const ids = (list: { id: number }[]) => list.map((i) => i.id);
  const gameOf = (i: { game?: string }) => i.game;

  it("keeps the selected game, missing counting as REEFSCAPE", () => {
    expect(ids(filterByGame(items, gameOf, opts("reefscape")))).toEqual([2, 3]);
    expect(ids(filterByGame(items, gameOf, opts("rebuilt")))).toEqual([1]);
    expect(ids(filterByGame(items, gameOf, opts("charged_up")))).toEqual([4]);
  });
  it("keeps everything for all games or a one-game program", () => {
    expect(filterByGame(items, gameOf, opts(""))).toHaveLength(4);
    expect(filterByGame(items, gameOf, opts(null))).toHaveLength(4);
    expect(filterByGame(items, gameOf, { seasonId: "solo", seasonIds: ["solo"], fallbackSeasonId: "solo" })).toHaveLength(4);
  });
});

describe("readGameParam", () => {
  it("defaults to the current game, accepts a known id, and 'all' means every game", () => {
    expect(readGameParam(null, IDS, "rebuilt")).toBe("rebuilt");
    expect(readGameParam("reefscape", IDS, "rebuilt")).toBe("reefscape");
    expect(readGameParam("nope", IDS, "rebuilt")).toBe("rebuilt");
    expect(readGameParam("all", IDS, "rebuilt")).toBe("");
  });
});
