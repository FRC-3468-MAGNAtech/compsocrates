// Account-derived appearance in this browser, and what happens to it on sign-out.
//
// How theme storage works today (one set of keys, written by ThemeProvider and GlassLayerProvider):
//   - Firestore `users/{uid}`: themeId, colorMode, gradientIntensity, glassLayerLevel. The source of truth for a signed-in person; never deleted here.
//   - localStorage mirrors of those four (THEME_STORAGE_KEY, COLOR_MODE_STORAGE_KEY, GRADIENT_INTENSITY_STORAGE_KEY, GLASS_LAYER_STORAGE_KEY), only
//     non-default values. The pre-paint script in <head> (lib/theme-css.ts) reads them so there is no flash on load. While nobody is signed in,
//     the same keys hold a device-only choice made on a public page.
//   - ACCOUNT_APPEARANCE_OWNER_KEY: set to the uid while someone is signed in, which marks the four mirrors above as account-derived.
// On sign-out the mirrors and the marker are removed and the providers fall back to the defaults. The marker also catches a session that ended
// without an explicit sign-out (expired, revoked, another tab) so a cold load of the login page never shows the previous account's look.
// A later "account-wide vs this device only" setting should split the mirrors into account keys and device keys; the marker is the seam.

import { storageKey } from "@/config/brand";
import { GLASS_LAYER_STORAGE_KEY } from "@/lib/glass-layer-level";
import { COLOR_MODE_STORAGE_KEY, GRADIENT_INTENSITY_STORAGE_KEY, THEME_STORAGE_KEY } from "@/lib/theme-prefs";

export const ACCOUNT_APPEARANCE_OWNER_KEY = storageKey("appearanceOwner");

/** Fired on `window` (this tab) after the account-derived appearance was cleared, so every provider can drop its in-memory copy. */
export const APPEARANCE_RESET_EVENT = "appearance-reset";

const ACCOUNT_MIRROR_KEYS = [THEME_STORAGE_KEY, COLOR_MODE_STORAGE_KEY, GRADIENT_INTENSITY_STORAGE_KEY, GLASS_LAYER_STORAGE_KEY];

type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Pure: after auth has settled with nobody signed in, is there an account's look left to drop? */
export function signOutResetNeeded(args: { wasSignedIn: boolean; ownerMarker: string | null }): boolean {
  return args.wasSignedIn || (args.ownerMarker !== null && args.ownerMarker !== "");
}

export function markAccountAppearance(uid: string, storage: KeyValueStorage | null = defaultStorage()): void {
  try {
    storage?.setItem(ACCOUNT_APPEARANCE_OWNER_KEY, uid);
  } catch {
    // storage blocked: nothing persists, so nothing can go stale either
  }
}

export function readAccountAppearanceOwner(storage: KeyValueStorage | null = defaultStorage()): string | null {
  try {
    return storage?.getItem(ACCOUNT_APPEARANCE_OWNER_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Removes the account-derived mirrors and the marker. The Firestore copy is untouched, so the same account gets its look back when it signs in. */
export function clearAccountAppearance(storage: KeyValueStorage | null = defaultStorage()): void {
  for (const key of [...ACCOUNT_MIRROR_KEYS, ACCOUNT_APPEARANCE_OWNER_KEY]) {
    try {
      storage?.removeItem(key);
    } catch {
      // ignore
    }
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(APPEARANCE_RESET_EVENT));
}
