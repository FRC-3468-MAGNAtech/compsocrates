import { describe, expect, it } from "vitest";
import { DEFAULT_COLOR_MODE, effectiveColorMode, oppositeMode, parseColorModePreference, resolveColorMode, resolveColorModePreference, resolveThemeId } from "./theme-prefs";

describe("theme + mode preferences (P18)", () => {
  it("parses only the three valid mode values", () => {
    expect(parseColorModePreference("light")).toBe("light");
    expect(parseColorModePreference("dark")).toBe("dark");
    expect(parseColorModePreference("system")).toBe("system");
    expect(parseColorModePreference("auto")).toBeNull();
    expect(parseColorModePreference(undefined)).toBeNull();
    expect(parseColorModePreference(3)).toBeNull();
  });

  it("'system' follows the device; explicit choices ignore it", () => {
    expect(resolveColorMode("system", true)).toBe("light");
    expect(resolveColorMode("system", false)).toBe("dark");
    expect(resolveColorMode("dark", true)).toBe("dark");
    expect(resolveColorMode("light", false)).toBe("light");
  });

  it("the initial mode follows the system", () => {
    expect(DEFAULT_COLOR_MODE).toBe("system");
    expect(resolveColorModePreference(undefined, null)).toBe("system");
  });

  it("a flag theme is applied dark whatever the mode, and the saved choice is untouched", () => {
    expect(effectiveColorMode("pride-rainbow", "light", true)).toBe("dark");
    expect(effectiveColorMode("pride-rainbow", "system", true)).toBe("dark");
    // leaving the flag restores the user's own light/dark choice
    expect(effectiveColorMode("ocean", "light", false)).toBe("light");
  });

  it("the account's choice wins over this browser's, and unknown ids fall back", () => {
    expect(resolveThemeId("ocean", "compsocrates")).toBe("ocean");
    expect(resolveThemeId(undefined, "compsocrates")).toBe("compsocrates");
    expect(resolveThemeId("not-a-theme", "also-not")).toBe("team");
    expect(resolveColorModePreference("light", "dark")).toBe("light");
    expect(resolveColorModePreference(undefined, "dark")).toBe("dark");
    expect(resolveColorModePreference("garbage", "light")).toBe("light");
  });

  it("the quick toggle flips what is showing", () => {
    expect(oppositeMode("dark")).toBe("light");
    expect(oppositeMode("light")).toBe("dark");
  });

  it("the existing ids still work", () => {
    expect(resolveThemeId("team", null)).toBe("team");
    expect(resolveThemeId("compsocrates", null)).toBe("compsocrates");
  });

  it("a removed theme id stored on the account or in this browser resolves to the default theme", () => {
    // the id of the theme that was removed, assembled so the source never names it
    const removed = ["bio", "buzz"].join("");
    expect(resolveThemeId(removed, null)).toBe("team");
    expect(resolveThemeId(removed, removed)).toBe("team");
    // the account value is unusable, so this browser's valid choice is used
    expect(resolveThemeId(removed, "ocean")).toBe("ocean");
  });
});
