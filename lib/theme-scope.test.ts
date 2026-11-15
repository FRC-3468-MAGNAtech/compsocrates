import { describe, expect, it } from "vitest";
import { ACCOUNT_APPEARANCE_OWNER_KEY, clearAccountAppearance } from "@/lib/account-appearance";
import { themeInitScript } from "@/lib/theme-css";
import { COLOR_MODE_STORAGE_KEY, GRADIENT_INTENSITY_STORAGE_KEY, THEME_STORAGE_KEY } from "@/lib/theme-prefs";
import {
  DEFAULT_LOOK,
  EMPTY_DEVICE_RECORD,
  accountLook,
  applyDeviceChange,
  deviceThemeKey,
  parseDeviceThemeRecord,
  readDeviceThemeRecord,
  resolveLook,
  scopeSwitchNeedsChoice,
  switchScope,
  writeDeviceThemeRecord,
  type DeviceThemeRecord,
  type ThemeLook,
} from "@/lib/theme-scope";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

const ACCOUNT = { themeId: "ocean", colorMode: "light", gradientIntensity: "subtle" } as const;
const DEVICE: ThemeLook = { themeId: "pride-bisexual", colorMode: "dark", gradientIntensity: "normal" };
const deviceRecord: DeviceThemeRecord = { scope: "device", theme: DEVICE };

describe("resolution order", () => {
  it("device override first, then the account, then the default", () => {
    expect(resolveLook(deviceRecord, ACCOUNT)).toEqual(DEVICE);
    expect(resolveLook(EMPTY_DEVICE_RECORD, ACCOUNT)).toEqual({ themeId: "ocean", colorMode: "light", gradientIntensity: "subtle" });
    expect(resolveLook(EMPTY_DEVICE_RECORD, null)).toEqual(DEFAULT_LOOK);
    expect(resolveLook(EMPTY_DEVICE_RECORD, { themeId: "nope" })).toEqual(DEFAULT_LOOK);
  });

  it("a device theme that is kept while the scope is 'account' does not apply", () => {
    expect(resolveLook({ scope: "account", theme: DEVICE }, ACCOUNT).themeId).toBe("ocean");
  });
});

describe("the stored record", () => {
  it("is keyed by uid: two accounts on one device never see each other's choice", () => {
    const s = fakeStorage();
    writeDeviceThemeRecord("alice", deviceRecord, s);
    expect(readDeviceThemeRecord("alice", s)).toEqual(deviceRecord);
    expect(readDeviceThemeRecord("bob", s)).toEqual(EMPTY_DEVICE_RECORD);
    expect(deviceThemeKey("alice")).not.toBe(deviceThemeKey("bob"));
  });

  it("unreadable, wrong-shape or unknown-theme data is 'all my devices, no device theme'", () => {
    expect(parseDeviceThemeRecord(null)).toEqual(EMPTY_DEVICE_RECORD);
    expect(parseDeviceThemeRecord("{not json")).toEqual(EMPTY_DEVICE_RECORD);
    expect(parseDeviceThemeRecord(JSON.stringify({ scope: "device", theme: { themeId: "not-a-theme" } }))).toEqual(EMPTY_DEVICE_RECORD);
    expect(parseDeviceThemeRecord(JSON.stringify({ scope: "device", theme: null }))).toEqual(EMPTY_DEVICE_RECORD);
  });

  it("fills a missing mode or intensity with the defaults, one by one", () => {
    const r = parseDeviceThemeRecord(JSON.stringify({ scope: "device", theme: { themeId: "ocean", colorMode: "bad" } }));
    expect(r).toEqual({ scope: "device", theme: { themeId: "ocean", colorMode: "system", gradientIntensity: "vivid" } });
  });

  it("an empty record leaves nothing behind", () => {
    const s = fakeStorage();
    writeDeviceThemeRecord("alice", deviceRecord, s);
    writeDeviceThemeRecord("alice", EMPTY_DEVICE_RECORD, s);
    expect(s.data.size).toBe(0);
  });
});

describe("switching scope", () => {
  const current = accountLook(ACCOUNT);

  it("to 'device' with no device theme starts from what is on screen, and does not touch the account", () => {
    const next = switchScope(EMPTY_DEVICE_RECORD, "device", current);
    expect(next).toEqual({ scope: "device", theme: current });
  });

  it("to 'device' with a kept device theme brings it back", () => {
    expect(switchScope({ scope: "account", theme: DEVICE }, "device", current)).toEqual(deviceRecord);
  });

  it("to 'account' keeps the device theme, so neither theme is lost", () => {
    expect(switchScope(deviceRecord, "account", DEVICE)).toEqual({ scope: "account", theme: DEVICE });
  });

  it("asks only when leaving 'device' with a device theme that differs from the account's", () => {
    expect(scopeSwitchNeedsChoice(deviceRecord, ACCOUNT)).toBe(true);
    expect(scopeSwitchNeedsChoice({ scope: "device", theme: accountLook(ACCOUNT) }, ACCOUNT)).toBe(false);
    expect(scopeSwitchNeedsChoice({ scope: "account", theme: DEVICE }, ACCOUNT)).toBe(false);
    expect(scopeSwitchNeedsChoice(EMPTY_DEVICE_RECORD, ACCOUNT)).toBe(false);
  });

  it("a change made in 'device' scope changes the device theme only", () => {
    const next = applyDeviceChange(deviceRecord, DEVICE, { themeId: "ocean" });
    expect(next.theme).toEqual({ ...DEVICE, themeId: "ocean" });
    expect(accountLook(ACCOUNT).themeId).toBe("ocean"); // the account's look is a separate value, never an input here
  });
});

describe("the pre-paint script and sign-out", () => {
  function run(stored: Record<string, string>) {
    const attrs: Record<string, string> = {};
    const props: Record<string, string> = {};
    const doc = { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v), style: { setProperty: (k: string, v: string) => (props[k] = v) } } };
    const storage = { getItem: (k: string) => stored[k] ?? null };
    const win = { matchMedia: () => ({ matches: false }) };
    new Function("document", "localStorage", "window", "matchMedia", themeInitScript())(doc, storage, win, win.matchMedia);
    return { attrs, props };
  }
  const mirrors = { [THEME_STORAGE_KEY]: "ocean", [COLOR_MODE_STORAGE_KEY]: "light", [GRADIENT_INTENSITY_STORAGE_KEY]: "subtle" };

  it("applies the signed-in account's device theme before first paint, over the account mirrors", () => {
    const { attrs, props } = run({ ...mirrors, [ACCOUNT_APPEARANCE_OWNER_KEY]: "alice", [deviceThemeKey("alice")]: JSON.stringify(deviceRecord) });
    expect(attrs).toMatchObject({ "data-theme": "pride-bisexual", "data-mode": "dark" });
    expect(props["--gradient-strength"]).toBeDefined();
  });

  it("uses the account mirrors when the scope is 'account' (a kept device theme does not apply)", () => {
    const { attrs } = run({ ...mirrors, [ACCOUNT_APPEARANCE_OWNER_KEY]: "alice", [deviceThemeKey("alice")]: JSON.stringify({ scope: "account", theme: DEVICE }) });
    expect(attrs).toMatchObject({ "data-theme": "ocean", "data-mode": "light" });
  });

  it("never applies another account's device theme", () => {
    const { attrs } = run({ ...mirrors, [ACCOUNT_APPEARANCE_OWNER_KEY]: "bob", [deviceThemeKey("alice")]: JSON.stringify(deviceRecord) });
    expect(attrs).toMatchObject({ "data-theme": "ocean" });
  });

  it("with nobody signed in (no owner marker) a device theme does not apply", () => {
    const { attrs } = run({ [deviceThemeKey("alice")]: JSON.stringify(deviceRecord) });
    expect(attrs).toMatchObject({ "data-theme": "team" });
  });

  it("sign-out: the account mirrors and marker go, the default shows, and the device record stays for the next sign-in", () => {
    const s = fakeStorage({ ...mirrors, [ACCOUNT_APPEARANCE_OWNER_KEY]: "alice", [deviceThemeKey("alice")]: JSON.stringify(deviceRecord) });
    clearAccountAppearance(s);
    expect(s.data.has(ACCOUNT_APPEARANCE_OWNER_KEY)).toBe(false);
    expect(run(Object.fromEntries(s.data)).attrs).toMatchObject({ "data-theme": "team" });
    expect(readDeviceThemeRecord("alice", s)).toEqual(deviceRecord);
    // signing in again (the marker is set back) returns the device theme
    s.setItem(ACCOUNT_APPEARANCE_OWNER_KEY, "alice");
    expect(run(Object.fromEntries(s.data)).attrs).toMatchObject({ "data-theme": "pride-bisexual" });
  });
});
