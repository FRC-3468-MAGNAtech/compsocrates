"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { defaultThemeId, getTheme, isFlagTheme, tokensFor, type ColorMode, type ColorModePreference, type ThemeDefinition } from "@/lib/themes";
import {
  ACCOUNT_APPEARANCE_OWNER_KEY,
  clearAccountAppearance,
  markAccountAppearance,
  readAccountAppearanceOwner,
  signOutResetNeeded,
} from "@/lib/account-appearance";
import {
  COLOR_MODE_STORAGE_KEY,
  DEFAULT_COLOR_MODE,
  GRADIENT_INTENSITY_STORAGE_KEY,
  THEME_STORAGE_KEY,
  effectiveColorMode,
  gradientStrength,
  oppositeMode,
  parseColorModePreference,
  parseGradientIntensity,
  resolveColorModePreference,
  resolveGradientIntensity,
  resolveThemeId,
} from "@/lib/theme-prefs";
import { DEFAULT_GRADIENT_INTENSITY, type GradientIntensity } from "@/lib/theme-gradient";
import {
  EMPTY_DEVICE_RECORD,
  accountLook,
  applyDeviceChange,
  readDeviceThemeRecord,
  scopeSwitchNeedsChoice,
  switchScope,
  writeDeviceThemeRecord,
  type DeviceThemeRecord,
  type ThemeLook,
  type ThemeScope,
} from "@/lib/theme-scope";

// Theme + light/dark mode (P18). Two independent settings, both kept per user (users/{uid}.themeId / .colorMode),
// mirrored in this browser's localStorage so they apply before sign-in and before first paint (the inline script in
// app/layout.tsx reads the same keys). Changing one never touches the other. A flag theme is one fixed look, so the
// *applied* mode is "dark" while one is active, but the saved Light/Dark/System choice is left alone and comes back
// the moment a different theme is picked.
//
// Applying a theme only sets two attributes on <html> (data-theme, data-mode); the CSS for every theme already exists
// (lib/theme-css.ts). The brief color fade is a temporary class that transitions color properties on elements, never
// opacity / filter / transform on an ancestor of glass: those turn a parent into a backdrop root and switch the blur
// of every glass layer inside it off. (That, via document.startViewTransition on the root, was the "all blurs vanish
// after picking a theme" bug.)

type ThemeContextValue = {
  theme: ThemeDefinition;
  themeId: string;
  setThemeId: (id: string) => void;
  /** The saved choice: light, dark, or follow the system. */
  colorMode: ColorModePreference;
  setColorMode: (mode: ColorModePreference) => void;
  /** What is actually applied right now (always "dark" for a flag theme). */
  resolvedMode: ColorMode;
  /** True while a flag theme is active: the mode controls are disabled. */
  modeLocked: boolean;
  /** The quick sun/moon switch: flips the applied mode by saving an explicit light or dark. */
  toggleColorMode: () => void;
  /** P32: Subtle / Normal / Vivid (default Vivid): how strongly a gradient or pride theme's painted page shows. Saved per user. */
  gradientIntensity: GradientIntensity;
  setGradientIntensity: (intensity: GradientIntensity) => void;
  /** Session G: does the theme apply on all the account's devices ("account", the default) or only on this device ("device")? Per device and per account. */
  scope: ThemeScope;
  /** False when nobody is signed in: there is no account, so there is no scope to choose. */
  scopeAvailable: boolean;
  /** True when leaving "device" would drop a different device theme: the UI asks "upload it to the account, or keep the account's?" first. */
  scopeNeedsChoice: boolean;
  /** `choice` only matters when leaving "device" with a different device theme: "upload" saves it to the account, "keep" leaves the account's. Neither deletes the device theme. */
  setScope: (next: ThemeScope, choice?: "upload" | "keep") => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const FADE_CLASS = "theme-animating";
const FADE_MS = 450;

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Stores a non-default value and removes the key for the default, so a cleared look leaves nothing behind (the pre-paint script treats a missing key as the default). */
function writeLocal(key: string, value: string, defaultValue: string) {
  try {
    if (value === defaultValue) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage blocked: the choice still applies for this session
  }
}

const systemPrefersLight = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: light)").matches;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user, loading, profile, updateUserProfile } = useAuth();
  const accountThemeId = profile?.themeId;
  const accountMode = profile?.colorMode;
  const accountIntensity = profile?.gradientIntensity;
  const uid = user?.uid ?? null;

  // Session G (lib/theme-scope.ts): this device's record for the signed-in account. Read in render, the moment the account is known, so the right
  // theme is chosen on the same pass (never from another account's record). Nobody signed in: the empty record, so nothing device-only applies.
  const [store, setStore] = useState<{ uid: string | null; record: DeviceThemeRecord }>({ uid: null, record: EMPTY_DEVICE_RECORD });
  if (store.uid !== uid) setStore({ uid, record: uid ? readDeviceThemeRecord(uid) : EMPTY_DEVICE_RECORD });
  const record = store.record;
  const deviceActive = record.scope === "device" && record.theme !== null;
  const deviceThemeId = record.theme?.themeId;
  const deviceColorMode = record.theme?.colorMode;
  const deviceIntensity = record.theme?.gradientIntensity;

  // SSR (and the first client render) assume the defaults, matching the markup; the real values sync in right after mount.
  const [themeId, setThemeIdState] = useState("team");
  const [colorMode, setColorModeState] = useState<ColorModePreference>("system");
  const [gradientIntensity, setGradientIntensityState] = useState<GradientIntensity>(DEFAULT_GRADIENT_INTENSITY);
  const [systemLight, setSystemLight] = useState(false);
  // False until this browser's saved values have been read in, so the defaults above never overwrite them.
  const [ready, setReady] = useState(false);
  const fadeTimer = useRef<number | null>(null);
  const hasApplied = useRef(false);

  useEffect(() => {
    // Deliberately deferred: no localStorage / matchMedia on the server, so the persisted values sync in after mount.
    /* eslint-disable react-hooks/set-state-in-effect */
    setThemeIdState(resolveThemeId(null, readLocal(THEME_STORAGE_KEY)));
    setColorModeState(resolveColorModePreference(null, readLocal(COLOR_MODE_STORAGE_KEY)));
    setGradientIntensityState(resolveGradientIntensity(null, readLocal(GRADIENT_INTENSITY_STORAGE_KEY)));
    setSystemLight(systemPrefersLight());
    setReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    const mq = window.matchMedia?.("(prefers-color-scheme: light)");
    if (!mq) return;
    const onChange = () => setSystemLight(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Sign-out: drop the account's look (memory and this browser's mirrors) and render the defaults at once. The saved copy in Firestore is
  // untouched, so the same account gets its theme back on the next sign-in. The owner marker also covers a session that ended without a
  // click on "sign out" (expired, revoked, ended in another tab), including on a hard refresh of the login page. See lib/account-appearance.ts.
  const wasSignedIn = useRef(false);
  useEffect(() => {
    if (loading) return;
    if (user) {
      wasSignedIn.current = true;
      markAccountAppearance(user.uid);
      return;
    }
    if (!signOutResetNeeded({ wasSignedIn: wasSignedIn.current, ownerMarker: readAccountAppearanceOwner() })) return;
    wasSignedIn.current = false;
    clearAccountAppearance();
    setThemeIdState(defaultThemeId);
    setColorModeState(DEFAULT_COLOR_MODE);
    setGradientIntensityState(DEFAULT_GRADIENT_INTENSITY);
  }, [user, loading]);

  // Signing out in another tab: Firebase Auth shares the session between tabs, so this tab's `user` turns null by itself and the effect above
  // resets it. The other tab's clean-up removes the owner marker first, though; if this tab is still signed in when that arrives, put the marker
  // back so a refresh before the sign-out reaches us still knows the mirrors are account-derived.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== ACCOUNT_APPEARANCE_OWNER_KEY || e.newValue !== null || !user) return;
      markAccountAppearance(user.uid);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [user]);

  // This device only: the device theme wins over the account's while the scope says so. It is kept in this browser per account, so it persists.
  useEffect(() => {
    if (!deviceActive || deviceThemeId === undefined || deviceColorMode === undefined || deviceIntensity === undefined) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setThemeIdState(deviceThemeId);
    setColorModeState(deviceColorMode);
    setGradientIntensityState(deviceIntensity);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [deviceActive, deviceThemeId, deviceColorMode, deviceIntensity]);

  useEffect(() => {
    if (!uid) return;
    writeDeviceThemeRecord(uid, record);
  }, [uid, record]);

  // Once the account's profile is known, its saved choices win (they follow the user between devices), unless this device overrides them.
  useEffect(() => {
    if (deviceActive) return;
    if (accountThemeId === undefined && accountMode === undefined) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setThemeIdState((cur) => resolveThemeId(accountThemeId, cur));
    const parsed = parseColorModePreference(accountMode);
    if (parsed) setColorModeState(parsed);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [deviceActive, accountThemeId, accountMode]);

  useEffect(() => {
    if (deviceActive) return;
    const parsed = parseGradientIntensity(accountIntensity);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (parsed) setGradientIntensityState(parsed);
  }, [deviceActive, accountIntensity]);

  // Gradient intensity: this browser's copy, and the CSS variable the page-gradient layer reads (lib/theme-css.ts sets it pre-paint too).
  useEffect(() => {
    if (!ready) return;
    writeLocal(GRADIENT_INTENSITY_STORAGE_KEY, gradientIntensity, DEFAULT_GRADIENT_INTENSITY);
    document.documentElement.style.setProperty("--gradient-strength", String(gradientStrength(gradientIntensity)));
  }, [ready, gradientIntensity]);

  const resolvedMode = effectiveColorMode(themeId, colorMode, systemLight);
  const theme = useMemo(() => getTheme(themeId), [themeId]);

  // Mirror to this browser, and put it on <html>.
  useEffect(() => {
    if (!ready) return;
    writeLocal(THEME_STORAGE_KEY, themeId, defaultThemeId);
    writeLocal(COLOR_MODE_STORAGE_KEY, colorMode, DEFAULT_COLOR_MODE);
    const el = document.documentElement;
    const animate = hasApplied.current && (el.getAttribute("data-theme") !== themeId || el.getAttribute("data-mode") !== resolvedMode);
    hasApplied.current = true;
    if (animate && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      el.classList.add(FADE_CLASS);
      if (fadeTimer.current !== null) window.clearTimeout(fadeTimer.current);
      fadeTimer.current = window.setTimeout(() => {
        el.classList.remove(FADE_CLASS);
        fadeTimer.current = null;
      }, FADE_MS);
    }
    el.setAttribute("data-theme", themeId);
    el.setAttribute("data-mode", resolvedMode);
    // The browser chrome (address bar, iOS status bar) follows the page.
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", tokensFor(getTheme(themeId), resolvedMode).background);
  }, [ready, themeId, colorMode, resolvedMode]);

  useEffect(
    () => () => {
      if (fadeTimer.current !== null) window.clearTimeout(fadeTimer.current);
    },
    []
  );

  const save = useCallback(
    (patch: Partial<ThemeLook>) => {
      if (!user) return; // signed out (the marketing pages): this browser's copy is all there is
      // This device only: the change goes to this browser's record, never to the account.
      if (record.scope === "device") {
        setStore((prev) => ({ uid: prev.uid, record: applyDeviceChange(prev.record, { themeId, colorMode, gradientIntensity }, patch) }));
        return;
      }
      updateUserProfile(patch).catch((err) => console.error("couldn't save the appearance settings:", err));
    },
    [user, record.scope, updateUserProfile, themeId, colorMode, gradientIntensity]
  );

  const scopeNeedsChoice = scopeSwitchNeedsChoice(record, { themeId: accountThemeId, colorMode: accountMode, gradientIntensity: accountIntensity });
  const setScope = useCallback(
    (next: ThemeScope, choice?: "upload" | "keep") => {
      if (!uid || next === record.scope) return;
      const account = accountLook({ themeId: accountThemeId, colorMode: accountMode, gradientIntensity: accountIntensity });
      setStore({ uid, record: switchScope(record, next, { themeId, colorMode, gradientIntensity }) });
      if (next === "device") return; // the device effect applies the device theme
      // Back to all devices: either this device's theme goes to the account (and stays on screen), or the account's comes back. The device theme is kept either way.
      const look = choice === "upload" && record.theme ? record.theme : account;
      setThemeIdState(look.themeId);
      setColorModeState(look.colorMode);
      setGradientIntensityState(look.gradientIntensity);
      if (look === record.theme) updateUserProfile(look).catch((err) => console.error("couldn't upload this device's theme to the account:", err));
    },
    [uid, record, accountThemeId, accountMode, accountIntensity, themeId, colorMode, gradientIntensity, updateUserProfile]
  );

  const setThemeId = useCallback(
    (id: string) => {
      const next = getTheme(id).id;
      setThemeIdState(next);
      save({ themeId: next });
    },
    [save]
  );

  const setColorMode = useCallback(
    (mode: ColorModePreference) => {
      setColorModeState(mode);
      save({ colorMode: mode });
    },
    [save]
  );

  const setGradientIntensity = useCallback(
    (intensity: GradientIntensity) => {
      setGradientIntensityState(intensity);
      save({ gradientIntensity: intensity });
    },
    [save]
  );

  const modeLocked = isFlagTheme(themeId);
  const toggleColorMode = useCallback(() => {
    if (modeLocked) return;
    setColorMode(oppositeMode(resolvedMode));
  }, [modeLocked, resolvedMode, setColorMode]);

  const scope = record.scope;
  const scopeAvailable = uid !== null;
  const value = useMemo(
    () => ({ theme, themeId, setThemeId, colorMode, setColorMode, resolvedMode, modeLocked, toggleColorMode, gradientIntensity, setGradientIntensity, scope, scopeAvailable, scopeNeedsChoice, setScope }),
    [theme, themeId, setThemeId, colorMode, setColorMode, resolvedMode, modeLocked, toggleColorMode, gradientIntensity, setGradientIntensity, scope, scopeAvailable, scopeNeedsChoice, setScope]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useAppTheme must be used within ThemeProvider");
  return ctx;
}
