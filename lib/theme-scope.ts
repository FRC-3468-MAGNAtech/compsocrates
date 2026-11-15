// Theme scope (Session G): does a person's theme apply on all their devices (the account document, today's behavior), or only on this device?
//
// Storage: ONE localStorage record per account on this device, `storageKey("deviceTheme") + ":" + uid`, holding
//   { scope: "account" | "device", theme: { themeId, colorMode, gradientIntensity } | null }.
// The scope choice itself is per device AND per uid (two accounts on a shared device never see each other's choice or theme). The device theme is
// kept while the scope is "account", so switching scope loses neither theme. The account theme stays in Firestore (`users/{uid}`), untouched here.
// Resolution on screen: the device theme (scope "device" and a valid theme) -> the account's -> the default. Signed out, nothing here applies at all
// (see lib/account-appearance.ts: the owner marker names whose record the pre-paint script may read). The glass layer level stays account-wide.
// Pure and unit-tested; ThemeProvider and the pre-paint script (lib/theme-css.ts) apply the same rules.

import { storageKey } from "@/config/brand";
import { defaultThemeId, isThemeId, type ColorModePreference } from "@/lib/themes";
import { DEFAULT_COLOR_MODE, parseColorModePreference, parseGradientIntensity, resolveColorModePreference, resolveGradientIntensity, resolveThemeId } from "@/lib/theme-prefs";
import { DEFAULT_GRADIENT_INTENSITY, type GradientIntensity } from "@/lib/theme-gradient";

export type ThemeScope = "account" | "device";

export type ThemeLook = { themeId: string; colorMode: ColorModePreference; gradientIntensity: GradientIntensity };

export type DeviceThemeRecord = { scope: ThemeScope; theme: ThemeLook | null };

/** The account's saved values, as they come off the user document (any of them may be missing or invalid). */
export type AccountLook = { themeId?: unknown; colorMode?: unknown; gradientIntensity?: unknown };

export const DEVICE_THEME_KEY_BASE = storageKey("deviceTheme");

export const deviceThemeKey = (uid: string): string => `${DEVICE_THEME_KEY_BASE}:${uid}`;

export const EMPTY_DEVICE_RECORD: DeviceThemeRecord = { scope: "account", theme: null };

export const DEFAULT_LOOK: ThemeLook = { themeId: defaultThemeId, colorMode: DEFAULT_COLOR_MODE, gradientIntensity: DEFAULT_GRADIENT_INTENSITY };

/** A device theme is only usable when its theme id is real; the other two fields fall back one by one. */
function parseLook(raw: unknown): ThemeLook | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isThemeId(r.themeId)) return null;
  return {
    themeId: r.themeId,
    colorMode: parseColorModePreference(r.colorMode) ?? DEFAULT_COLOR_MODE,
    gradientIntensity: parseGradientIntensity(r.gradientIntensity) ?? DEFAULT_GRADIENT_INTENSITY,
  };
}

/** Anything unreadable is "all my devices, no device theme": the safe default that changes nothing. */
export function parseDeviceThemeRecord(raw: string | null | undefined): DeviceThemeRecord {
  if (!raw) return EMPTY_DEVICE_RECORD;
  try {
    const json = JSON.parse(raw) as { scope?: unknown; theme?: unknown } | null;
    const theme = parseLook(json?.theme);
    const scope: ThemeScope = json?.scope === "device" && theme ? "device" : "account";
    return { scope, theme };
  } catch {
    return EMPTY_DEVICE_RECORD;
  }
}

type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readDeviceThemeRecord(uid: string, storage: KeyValueStorage | null = defaultStorage()): DeviceThemeRecord {
  try {
    return parseDeviceThemeRecord(storage?.getItem(deviceThemeKey(uid)));
  } catch {
    return EMPTY_DEVICE_RECORD;
  }
}

export function writeDeviceThemeRecord(uid: string, record: DeviceThemeRecord, storage: KeyValueStorage | null = defaultStorage()): void {
  try {
    if (record.scope === "account" && !record.theme) storage?.removeItem(deviceThemeKey(uid));
    else storage?.setItem(deviceThemeKey(uid), JSON.stringify(record));
  } catch {
    // storage blocked: the choice still applies for this session
  }
}

/** The look the account has saved, with defaults for what it has not. */
export function accountLook(account: AccountLook | null | undefined): ThemeLook {
  return {
    themeId: resolveThemeId(account?.themeId, null),
    colorMode: resolveColorModePreference(account?.colorMode, null),
    gradientIntensity: resolveGradientIntensity(account?.gradientIntensity, null),
  };
}

/** Resolution order: the device theme when the scope is "device", else the account's, else the default. */
export function resolveLook(record: DeviceThemeRecord, account: AccountLook | null | undefined): ThemeLook {
  if (record.scope === "device" && record.theme) return record.theme;
  return accountLook(account);
}

export const looksEqual = (a: ThemeLook, b: ThemeLook): boolean => a.themeId === b.themeId && a.colorMode === b.colorMode && a.gradientIntensity === b.gradientIntensity;

/** Does leaving "This device only" need the "upload or keep the account's?" question? Only when a device theme exists and is different. */
export function scopeSwitchNeedsChoice(record: DeviceThemeRecord, account: AccountLook | null | undefined): boolean {
  return record.scope === "device" && record.theme !== null && !looksEqual(record.theme, accountLook(account));
}

/**
 * The record after a scope switch. To "device": the device theme is kept if there is one, else it starts as a copy of what is on screen now
 * (so nothing jumps). To "account": the scope flips and the device theme is KEPT (never lost; it comes back if the person switches again).
 * Uploading the device theme to the account is a separate step (`ThemeProvider.setScope(..., "upload")`), and never touches the record.
 */
export function switchScope(record: DeviceThemeRecord, to: ThemeScope, current: ThemeLook): DeviceThemeRecord {
  if (to === "device") return { scope: "device", theme: record.theme ?? current };
  return { scope: "account", theme: record.theme };
}

/** A change made while the scope is "device" updates the device theme (never the account). */
export function applyDeviceChange(record: DeviceThemeRecord, current: ThemeLook, patch: Partial<ThemeLook>): DeviceThemeRecord {
  return { scope: "device", theme: { ...(record.theme ?? current), ...patch } };
}
