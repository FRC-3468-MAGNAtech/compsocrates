import { describe, expect, it } from "vitest";
import { FRC_PROGRAM } from "@/config/programs/frc";
import { FTC_PROGRAM } from "@/config/programs/ftc";
import { FTC_GAME_DEFINITIONS, FTC_GAME_ID_LIST } from "@/config/games/ftc";
import { SEASONS } from "@/lib/seasons";
import { eventGamesOf, gameNameOfSeason } from "./event-games";

// Event Select sorts by game, not by year.
describe("Event Select game list", () => {
  const frc = eventGamesOf(SEASONS, FRC_PROGRAM.event.otherGames);
  const ftc = eventGamesOf(
    FTC_GAME_ID_LIST.map((id) => ({ apiSeason: FTC_GAME_DEFINITIONS[id].year, name: FTC_GAME_DEFINITIONS[id].label })),
    FTC_PROGRAM.event.otherGames
  );

  it("the first program: its coming game, then each game newest to oldest, including one it does not scout", () => {
    expect(frc.map((g) => g.name)).toEqual(["BIOCORE", "REBUILT", "REEFSCAPE", "CRESCENDO", "CHARGED UP"]);
    expect(frc.map((g) => g.apiSeason)).toEqual([...frc.map((g) => g.apiSeason)].sort((a, b) => b - a));
  });

  it("the second program: only its one current game (no empty next season, no older seasons)", () => {
    expect(ftc).toHaveLength(FTC_GAME_ID_LIST.length);
    expect(ftc).toHaveLength(1);
    expect(ftc[0].apiSeason).toBe(FTC_GAME_DEFINITIONS[FTC_GAME_ID_LIST[0]].year);
  });

  it("a scouted game wins over an 'other' entry for the same season, and there is one entry per season", () => {
    const merged = eventGamesOf([{ apiSeason: 2026, name: "Scouted" }], [{ apiSeason: 2026, name: "Other" }, { apiSeason: 2025, name: "Past" }]);
    expect(merged).toEqual([{ apiSeason: 2026, name: "Scouted" }, { apiSeason: 2025, name: "Past" }]);
    expect(eventGamesOf([], undefined)).toEqual([]);
  });

  it("names the game of a season, or null", () => {
    expect(gameNameOfSeason(frc, frc[0].apiSeason)).toBe("BIOCORE");
    expect(gameNameOfSeason(frc, 1900)).toBeNull();
  });
});
