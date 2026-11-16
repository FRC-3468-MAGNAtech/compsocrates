import { describe, expect, it } from "vitest";
import { isTbaEventKey } from "@/config/event";
import { FRC_PROGRAM } from "@/config/programs/frc";
import { FTC_PROGRAM } from "@/config/programs/ftc";
import { buildEventKey, canonicalEventKey, eventPagePath, parseEventKey, seasonLabel, seasonOfEventKey } from "@/lib/events/event-key";
import { lookupSeasonForKey } from "@/lib/events/name-store";

describe("event key shapes", () => {
  it("each program names its shape in config", () => {
    expect(FRC_PROGRAM.event.keyShape).toBe("tba");
    expect(FTC_PROGRAM.event.keyShape).toBe("season-code");
  });

  it("tba keys: unchanged (season is the prefix, the code is the key as given)", () => {
    expect(parseEventKey("tba", "2026lake")).toEqual({ season: 2026, code: "2026lake" });
    expect(parseEventKey("tba", "2025LAKE")).toEqual({ season: 2025, code: "2025LAKE" });
    expect(buildEventKey("tba", { code: "2026lake", season: 2026 })).toBe("2026lake");
    expect(eventPagePath("tba", { code: "2026lake", season: 2026 })).toBe("/events/2026lake");
    for (const bad of ["app-testing", "", "2026", "26arli"]) expect(parseEventKey("tba", bad)).toBeNull();
  });

  it("season-code keys build upper case and parse in any case", () => {
    expect(buildEventKey("season-code", { code: "uscalab", season: 2025 })).toBe("2025-USCALAB");
    expect(parseEventKey("season-code", "2025-USCALAB")).toEqual({ season: 2025, code: "USCALAB" });
    expect(parseEventKey("season-code", "2025-uscalab")).toEqual({ season: 2025, code: "USCALAB" });
    expect(eventPagePath("season-code", { code: "USCALAB", season: 2025 })).toBe("/events/2025-USCALAB");
  });

  it("round trips", () => {
    for (const [code, season] of [["USCALAB", 2025], ["AUSAQ1", 2024], ["usnycmp", 1999]] as const) {
      const key = buildEventKey("season-code", { code, season });
      expect(parseEventKey("season-code", key)).toEqual({ season, code: code.toUpperCase() });
      expect(buildEventKey("season-code", parseEventKey("season-code", key)!)).toBe(key);
    }
  });

  it("rejects malformed season-code keys", () => {
    for (const bad of ["USCALAB", "2025USCALAB", "2025-", "2025-U", "2025-US CA", "2025-US/CA", "25-USCALAB", "2025-USCALAB-2", ""]) {
      expect(parseEventKey("season-code", bad)).toBeNull();
    }
  });

  it("a key of one shape never parses as the other (no collision)", () => {
    for (const frc of ["2026lake", "2025casj", "2026arli", "2026week0"]) expect(parseEventKey("season-code", frc)).toBeNull();
    for (const ftc of ["2025-USCALAB", "2025-uscalab", "2024-AUSAQ1"]) {
      expect(parseEventKey("tba", ftc)).toBeNull();
      expect(isTbaEventKey(ftc)).toBe(false);
      expect(lookupSeasonForKey(ftc)).toBeNull(); // the FRC name store never asks TBA about an FTC key
    }
  });

  it("is URL safe", () => {
    const key = buildEventKey("season-code", { code: "USCALAB", season: 2025 });
    expect(encodeURIComponent(key)).toBe(key);
  });
});

describe("seasonLabel", () => {
  it("shows a start-year season in the two-year form", () => {
    expect(seasonLabel("start-year", 2025)).toBe("2025-26");
    expect(seasonLabel("start-year", 2099)).toBe("2099-00");
    expect(seasonLabel("start-year", 2008)).toBe("2008-09");
  });
  it("shows a calendar season as the year", () => {
    expect(seasonLabel("calendar", 2026)).toBe("2026");
  });
});

describe("canonicalEventKey / seasonOfEventKey", () => {
  it("a tba key goes through the alias table and lower case", () => {
    expect(canonicalEventKey("tba", " 2026LABR ")).toBe("2026lake");
    expect(canonicalEventKey("tba", "2026arli")).toBe("2026arli");
  });

  it("a season-code key is rebuilt with an upper-case code, and a stray key is kept trimmed", () => {
    expect(canonicalEventKey("season-code", "2025-uscalab")).toBe("2025-USCALAB");
    expect(canonicalEventKey("season-code", " app-testing ")).toBe("app-testing");
  });

  it("reads the season of each shape, null for a key without one", () => {
    expect(seasonOfEventKey("tba", "2026labr")).toBe(2026);
    expect(seasonOfEventKey("season-code", "2025-uscalab")).toBe(2025);
    expect(seasonOfEventKey("tba", "app-testing")).toBeNull();
    expect(seasonOfEventKey("season-code", "2026lake")).toBeNull();
  });
});
