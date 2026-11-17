import { describe, expect, it } from "vitest";
import { eventsOfGameSeason } from "./event-options";

describe("eventsOfGameSeason", () => {
  const events = [{ code: "2025arli", season: 2025 }, { code: "2026lake", season: 2026 }, { code: "2027bayou", season: 2027 }];
  it("keeps the events of the game's season only", () => {
    expect(eventsOfGameSeason(events, 2025).map((e) => e.code)).toEqual(["2025arli"]);
    expect(eventsOfGameSeason(events, 2027).map((e) => e.code)).toEqual(["2027bayou"]);
    expect(eventsOfGameSeason(events, 2030)).toEqual([]);
  });
});
