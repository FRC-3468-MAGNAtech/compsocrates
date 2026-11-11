import { describe, expect, it } from "vitest";
import {
  EVENT_CONFIG,
  dedupeEventKeys,
  expandEventKeyAliases,
  getFirstEventCodeFromTbaKey,
  getSeasonFromEventKey,
  isTbaEventKey,
  normalizeEventKey,
} from "./event";

describe("EVENT_CONFIG", () => {
  it("is the FRC season with three-team alliances", () => {
    expect(EVENT_CONFIG.allianceSize).toBe(3);
    expect(EVENT_CONFIG.season).toBe(2026);
    expect(EVENT_CONFIG.fallbackEventKey).toBe("app-testing");
  });
});

describe("event key aliases", () => {
  it("resolves legacy and mistyped keys to the current key", () => {
    expect(normalizeEventKey("2025lake")).toBe("2026lake");
    expect(normalizeEventKey("2026labr")).toBe("2026lake");
    expect(normalizeEventKey("  2026LABR ")).toBe("2026lake");
  });

  it("leaves current keys alone and lowercases them", () => {
    expect(normalizeEventKey("2026arli")).toBe("2026arli");
    expect(normalizeEventKey("2026ARLI")).toBe("2026arli");
    expect(normalizeEventKey("")).toBe("");
  });

  it("expands a canonical key to every stored spelling", () => {
    expect(expandEventKeyAliases("2026lake").sort()).toEqual(["2025lake", "2026labr", "2026lake"]);
    expect(expandEventKeyAliases("2025lake").sort()).toEqual(["2025lake", "2026labr", "2026lake"]);
    expect(expandEventKeyAliases("2026arli")).toEqual(["2026arli"]);
  });

  it("dedupes after alias resolution, keeping order and dropping empties", () => {
    expect(dedupeEventKeys(["2025lake", "2026arli", "2026labr", "", "2026lake"])).toEqual(["2026lake", "2026arli"]);
  });
});

describe("FIRST event code derivation (D12)", () => {
  it("strips the year and upper-cases", () => {
    expect(getFirstEventCodeFromTbaKey("2026arli")).toBe("ARLI");
    expect(getFirstEventCodeFromTbaKey("2025alhu")).toBe("ALHU");
  });

  it("applies the override table", () => {
    expect(getFirstEventCodeFromTbaKey("2026lake")).toBe("LAKE");
    expect(getFirstEventCodeFromTbaKey("2025lake")).toBe("LAKE");
  });
});

describe("key shape helpers", () => {
  it("reads the season from a TBA key", () => {
    expect(getSeasonFromEventKey("2026arli")).toBe(2026);
    expect(getSeasonFromEventKey("app-testing")).toBeNull();
  });

  it("tells real keys from the fallback sentinel", () => {
    expect(isTbaEventKey("2026arli")).toBe(true);
    expect(isTbaEventKey("app-testing")).toBe(false);
    expect(isTbaEventKey("USWABON1")).toBe(false);
  });
});
