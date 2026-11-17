import { describe, expect, it } from "vitest";
import {
  ACCOUNT_APPEARANCE_OWNER_KEY,
  clearAccountAppearance,
  markAccountAppearance,
  readAccountAppearanceOwner,
  signOutResetNeeded,
} from "@/lib/account-appearance";
import { GLASS_LAYER_STORAGE_KEY } from "@/lib/glass-layer-level";
import { COLOR_MODE_STORAGE_KEY, GRADIENT_INTENSITY_STORAGE_KEY, THEME_STORAGE_KEY } from "@/lib/theme-prefs";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe("signOutResetNeeded", () => {
  it("resets after a sign-out seen in this session", () => {
    expect(signOutResetNeeded({ wasSignedIn: true, ownerMarker: null })).toBe(true);
  });

  it("resets on a cold load when a previous account's marker is left over", () => {
    expect(signOutResetNeeded({ wasSignedIn: false, ownerMarker: "uid-1" })).toBe(true);
  });

  it("leaves a plain signed-out visitor's device choice alone", () => {
    expect(signOutResetNeeded({ wasSignedIn: false, ownerMarker: null })).toBe(false);
    expect(signOutResetNeeded({ wasSignedIn: false, ownerMarker: "" })).toBe(false);
  });
});

describe("account appearance storage", () => {
  it("marks and reads the owner", () => {
    const s = fakeStorage();
    markAccountAppearance("uid-1", s);
    expect(readAccountAppearanceOwner(s)).toBe("uid-1");
  });

  it("clears every account mirror and the marker, and nothing else", () => {
    const s = fakeStorage({
      [THEME_STORAGE_KEY]: "pride",
      [COLOR_MODE_STORAGE_KEY]: "light",
      [GRADIENT_INTENSITY_STORAGE_KEY]: "subtle",
      [GLASS_LAYER_STORAGE_KEY]: "1.5",
      [ACCOUNT_APPEARANCE_OWNER_KEY]: "uid-1",
      unrelated: "keep",
    });
    clearAccountAppearance(s);
    expect([...s.data.keys()]).toEqual(["unrelated"]);
  });

  it("does not throw when storage is unavailable", () => {
    expect(() => clearAccountAppearance(null)).not.toThrow();
    expect(() => markAccountAppearance("uid-1", null)).not.toThrow();
    expect(readAccountAppearanceOwner(null)).toBeNull();
  });
});
