import { describe, expect, it } from "vitest";
import { defaultFormSeasonId, eventsForSeason, readFormSeasonParam, seasonOfYear, seasonsOfForm, withSeasonParam } from "@/lib/forms/form-season";
import { draftKey } from "@/lib/forms/draft";
import { BUILTIN_FORMS } from "@/lib/forms/builtin";
import { SEASONS } from "@/lib/seasons";

const seasons = SEASONS.map((s) => ({ id: s.id, apiSeason: s.apiSeason }));
const ev = (code: string, season: number) => ({ code, season });

describe("form season", () => {
  it("knows the three FRC seasons and defaults to the active event's season", () => {
    expect(seasons.map((s) => s.id)).toEqual(["rebuilt", "reefscape", "charged_up"]);
    expect(seasonOfYear(seasons, 2025)?.id).toBe("reefscape");
    expect(defaultFormSeasonId(seasons, { season: 2023 }, "rebuilt")).toBe("charged_up");
    expect(defaultFormSeasonId(seasons, { season: 2026 }, "rebuilt")).toBe("rebuilt");
  });

  it("defaults to the current season with no active event, or one from a year with no game", () => {
    expect(defaultFormSeasonId(seasons, null, "rebuilt")).toBe("rebuilt");
    expect(defaultFormSeasonId(seasons, undefined, "rebuilt")).toBe("rebuilt");
    expect(defaultFormSeasonId(seasons, { season: 2019 }, "rebuilt")).toBe("rebuilt");
  });

  it("reads the URL's game query, falling back for anything unknown", () => {
    expect(readFormSeasonParam("reefscape", seasons, "rebuilt")).toBe("reefscape");
    expect(readFormSeasonParam(" CHARGED_UP ", seasons, "rebuilt")).toBe("charged_up");
    expect(readFormSeasonParam("all", seasons, "rebuilt")).toBe("rebuilt");
    expect(readFormSeasonParam("nope", seasons, "rebuilt")).toBe("rebuilt");
    expect(readFormSeasonParam(null, seasons, "reefscape")).toBe("reefscape");
  });

  it("offers each season only its own events, and an unmatched event under the current season", () => {
    const events = [ev("2026a", 2026), ev("2025b", 2025), ev("2023c", 2023), ev("2019x", 2019)];
    expect(eventsForSeason(events, seasons, "rebuilt", "rebuilt").map((e) => e.code)).toEqual(["2026a", "2019x"]);
    expect(eventsForSeason(events, seasons, "reefscape", "rebuilt").map((e) => e.code)).toEqual(["2025b"]);
    expect(eventsForSeason(events, seasons, "charged_up", "rebuilt").map((e) => e.code)).toEqual(["2023c"]);
  });

  it("never filters the events of a program with one season (one game)", () => {
    const one = [{ id: "solo", apiSeason: 2026 }];
    const events = [ev("a", 2025), ev("b", 2026)];
    expect(eventsForSeason(events, one, "solo", "solo")).toHaveLength(2);
    expect(defaultFormSeasonId(one, null, "solo")).toBe("solo");
  });

  it("offers a form only the seasons it exists for", () => {
    expect(seasonsOfForm({ tags: ["pit-scout", "rebuilt", "2026"] }, seasons).map((s) => s.id)).toEqual(["rebuilt"]);
    expect(seasonsOfForm({ tags: ["match-strategy", "reefscape"] }, seasons).map((s) => s.id)).toEqual(["reefscape"]);
    // no season tag (a custom form, the second program's forms): every season of the program
    expect(seasonsOfForm({ tags: [] }, seasons)).toHaveLength(3);
    expect(seasonsOfForm({ tags: ["strategy"] }, [{ id: "solo", apiSeason: 2026 }]).map((s) => s.id)).toEqual(["solo"]);
    expect(seasonsOfForm(null, seasons)).toHaveLength(3);
    // the match forms of each game are tagged with their game
    expect(seasonsOfForm(BUILTIN_FORMS.reefscape, seasons).map((s) => s.id)).toEqual(["reefscape"]);
    expect(seasonsOfForm(BUILTIN_FORMS["pit-scout-v1"], seasons).map((s) => s.id)).toEqual(["rebuilt"]);
  });

  it("sets the game query and keeps the others", () => {
    expect(withSeasonParam("", "reefscape")).toBe("game=reefscape");
    expect(withSeasonParam("event=2026a&game=rebuilt", "charged_up")).toBe("event=2026a&game=charged_up");
  });

  it("keeps a draft per season: each game's form has its own draft key", () => {
    const keys = ["rebuilt", "reefscape", "charged_up"].map((id) => draftKey({ uid: "u", formId: BUILTIN_FORMS[id].id, matchKey: "Qualification-1", teamNumber: 254 }));
    expect(new Set(keys).size).toBe(3);
  });
});
