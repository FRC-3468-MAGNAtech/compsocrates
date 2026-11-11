import { describe, expect, it } from "vitest";
import { eventLabel, resolveEventName, UNKNOWN_EVENT_NAME, usableEventName } from "@/lib/events/names";

describe("resolveEventName: the chain", () => {
  it("prefers the API name over everything", () => {
    expect(resolveEventName({ key: "2026lake", api: "FIRST Bayou Regional", stored: "Stored", now: 1 })).toEqual({ name: "FIRST Bayou Regional", source: "api" });
  });

  it("uses the stored name when the API has none", () => {
    expect(resolveEventName({ key: "2026lake", api: null, stored: "Our Bayou" })).toEqual({ name: "Our Bayou", source: "stored" });
    expect(resolveEventName({ key: "2026lake", stored: "Our Bayou" })).toEqual({ name: "Our Bayou", source: "stored" });
  });

  it("uses the static map when neither the API nor the stored name is usable", () => {
    expect(resolveEventName({ key: "2026lake" })).toEqual({ name: "Bayou Regional", source: "static" });
    expect(resolveEventName({ key: "2026arli", api: "", stored: "   " })).toEqual({ name: "Arkansas Regional", source: "static" });
  });

  it("falls back to the raw key as the last resort", () => {
    expect(resolveEventName({ key: "2026zzzz" })).toEqual({ name: "2026zzzz", source: "key" });
  });

  it("resolves a legacy alias through the static map", () => {
    expect(resolveEventName({ key: "2026labr" })).toEqual({ name: "Bayou Regional", source: "static" });
  });
});

describe("resolveEventName: missing names", () => {
  it("treats a name equal to the key as missing, in any case", () => {
    expect(resolveEventName({ key: "2026lake", api: "2026lake" })).toEqual({ name: "Bayou Regional", source: "static" });
    expect(resolveEventName({ key: "2026lake", api: "2026LAKE", stored: " 2026lake " })).toEqual({ name: "Bayou Regional", source: "static" });
    expect(resolveEventName({ key: "2026zzzz", stored: "2026zzzz" })).toEqual({ name: "2026zzzz", source: "key" });
  });

  it("treats a name equal to the alias-resolved key as missing", () => {
    expect(resolveEventName({ key: "2026labr", api: "2026lake" })).toEqual({ name: "Bayou Regional", source: "static" });
  });

  it("skips an API name equal to the key and takes the stored one", () => {
    expect(resolveEventName({ key: "2026zzzz", api: "2026zzzz", stored: "Zed Regional" })).toEqual({ name: "Zed Regional", source: "stored" });
  });

  it("ignores non-string candidates", () => {
    expect(resolveEventName({ key: "2026lake", api: 5 as unknown as string, stored: {} as unknown as string }).source).toBe("static");
  });

  it("trims every candidate", () => {
    expect(resolveEventName({ key: "2026zzzz", api: "  Zed Regional  " })).toEqual({ name: "Zed Regional", source: "api" });
    expect(resolveEventName({ key: "  2026zzzz  " })).toEqual({ name: "2026zzzz", source: "key" });
  });

  it("never returns an empty string", () => {
    for (const key of ["", "   ", undefined as unknown as string, null as unknown as string]) {
      const r = resolveEventName({ key, api: "", stored: "" });
      expect(r.name.length).toBeGreaterThan(0);
      expect(r).toEqual({ name: UNKNOWN_EVENT_NAME, source: "key" });
    }
  });
});

describe("usableEventName", () => {
  it("returns the trimmed name or null", () => {
    expect(usableEventName("  Bayou  ", "2026lake")).toBe("Bayou");
    expect(usableEventName("2026lake", "2026lake")).toBeNull();
    expect(usableEventName("", "2026lake")).toBeNull();
    expect(usableEventName(undefined, "2026lake")).toBeNull();
  });
});

describe("eventLabel", () => {
  it("is the resolved name", () => {
    expect(eventLabel({ key: "2026lake" })).toBe("Bayou Regional");
    expect(eventLabel({ key: "2026lake", api: "From API" })).toBe("From API");
  });

  it("appends the key on request, but not when the name is the key", () => {
    expect(eventLabel({ key: "2026lake", withKey: true })).toBe("Bayou Regional (2026lake)");
    expect(eventLabel({ key: "2026zzzz", withKey: true })).toBe("2026zzzz");
  });
});
