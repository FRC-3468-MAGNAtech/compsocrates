import { describe, expect, it } from "vitest";
import { EVENT_NAMES, staticEventName } from "@/config/event-names";
import { EVENT_CONFIG } from "@/config/event";

describe("EVENT_NAMES", () => {
  it("holds the names CS's own code states", () => {
    expect(EVENT_NAMES["2026arli"]).toBe("Arkansas Regional");
    expect(EVENT_NAMES["2026lake"]).toBe("Bayou Regional");
    expect(EVENT_NAMES["2025alhu"]).toBe("Rocket City Regional");
    expect(EVENT_NAMES["2023mslr"]).toBe("Magnolia Regional");
    expect(EVENT_NAMES["2023lake"]).toBe("Bayou Regional");
    expect(EVENT_NAMES["2026tuis"]).toBe("Istanbul Regional");
    expect(EVENT_NAMES["2026okok"]).toBe("Oklahoma Regional");
    expect(EVENT_NAMES["2026cosp"]).toBe("Pikes Peak Regional");
    expect(EVENT_NAMES["2025cmptx"]).toBe("Einstein Field");
    expect(EVENT_NAMES["2026week0"]).toBe("Week 0");
    expect(EVENT_NAMES["app-testing"]).toBe("App Testing");
  });

  it("uses lowercase keys and non-empty trimmed names", () => {
    for (const [key, name] of Object.entries(EVENT_NAMES)) {
      expect(key).toBe(key.toLowerCase());
      expect(name).toBe(name.trim());
      expect(name.length).toBeGreaterThan(0);
      expect(name.toLowerCase()).not.toBe(key);
    }
  });
});

describe("staticEventName", () => {
  it("finds a name, ignoring case and whitespace", () => {
    expect(staticEventName("2026ARLI")).toBe("Arkansas Regional");
    expect(staticEventName("  2026arli ")).toBe("Arkansas Regional");
  });

  it("applies the alias table from config/event.ts", () => {
    expect(staticEventName("2026labr")).toBe("Bayou Regional");
    expect(staticEventName("2026LABR")).toBe("Bayou Regional");
    expect(staticEventName("2025lake")).toBe("Bayou Regional");
  });

  it("honors an injected config's aliases", () => {
    const config = { ...EVENT_CONFIG, eventKeyAliases: { "2026old": "2026arli" } };
    expect(staticEventName("2026old", config)).toBe("Arkansas Regional");
    expect(staticEventName("2026labr", config)).toBeNull();
  });

  it("returns null for unknown or empty keys, and never an inherited property", () => {
    expect(staticEventName("2026zzzz")).toBeNull();
    expect(staticEventName("")).toBeNull();
    expect(staticEventName("constructor")).toBeNull();
    expect(staticEventName("__proto__")).toBeNull();
  });
});
