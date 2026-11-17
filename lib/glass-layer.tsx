"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth, type UserDoc } from "@/lib/auth";
import { useProgramData } from "@/lib/program/data";
import { saveUserFields } from "@/lib/program/user-fields";
import { APPEARANCE_RESET_EVENT } from "@/lib/account-appearance";
import { isFirebaseConfigured } from "@/lib/firebase/client";
import {
  GLASS_LAYER_DEFAULT,
  GLASS_LAYER_STORAGE_KEY,
  clampGlassLayerLevel,
  isGlassLayerLevel,
  parseStoredLevel,
  resolveGlassLayerLevel,
  shouldSaveLocalLevelToProfile,
} from "@/lib/glass-layer-level";

// The one shared state for the layered-glass level (FIX3). Every slider in the app —
// the sidebar's droplet popover, the top bar's, the home page's — reads and writes it
// through `useGlassLayerLevel()`, so they are always in sync. It is applied app-wide as
// the `--glass-shade` CSS multiplier, remembered in this browser (so it applies before
// sign-in and instantly on load), and saved to the signed-in user's own doc
// (`users/{uid}.glassLayerLevel`) so it follows them across devices.

type GlassLayerContextValue = {
  /** Multiplier on every glass surface's base opacity. 1 = the default look. */
  level: number;
  setLevel: (value: number) => void;
  reset: () => void;
  /** Why the last save to the account failed (null when it worked). The level still applies in this browser. */
  saveError: string | null;
};

const GlassLayerContext = createContext<GlassLayerContextValue | null>(null);

/** Slider drags fire constantly; the user doc is only written once they pause. */
const SAVE_DEBOUNCE_MS = 500;

function readLocal(): number | null {
  try {
    return parseStoredLevel(localStorage.getItem(GLASS_LAYER_STORAGE_KEY));
  } catch {
    return null; // storage blocked: the default (or the account's level) is fine
  }
}

export function GlassLayerProvider({ children }: { children: ReactNode }) {
  const { user, profile: rootProfile } = useAuth();
  const uid = user?.uid ?? null;
  // This provider sits above the program shell, so it reads the profile of the program in use itself: a program with a data port keeps the level on
  // its own user doc (an account that only exists there has no root `users` doc), the root program on `users/{uid}` as ever.
  const port = useProgramData();
  const portRef = useRef(port);
  useEffect(() => {
    portRef.current = port;
  }, [port]);
  const [held, setHeld] = useState<{ uid: string; profile: UserDoc | null } | null>(null);
  useEffect(() => {
    if (!port || !uid) return;
    return port.profile.subscribe(
      uid,
      (p) => setHeld({ uid, profile: p }),
      () => setHeld({ uid, profile: null }) // already reported by the port
    );
  }, [port, uid]);
  const profile = port ? (held?.uid === uid ? held.profile : null) : rootProfile;
  const profileLevel = profile?.glassLayerLevel;
  const profileLoaded = profile !== null;
  const [saveError, setSaveError] = useState<string | null>(null);

  const [level, setLevelState] = useState(GLASS_LAYER_DEFAULT);
  const saveTimer = useRef<number | null>(null);
  const pendingSave = useRef<{ uid: string; value: number } | null>(null);
  const migratedFor = useRef<string | null>(null);

  const persist = useCallback(
    (value: number) => {
      try {
        localStorage.setItem(GLASS_LAYER_STORAGE_KEY, String(value));
      } catch {
        // storage blocked: still applies for this session
      }
      if (!uid || !isFirebaseConfigured()) return;
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      pendingSave.current = { uid, value };
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = null;
        pendingSave.current = null;
        saveUserFields(portRef.current, uid, { glassLayerLevel: value }, "Couldn't save the glass shading").then(
          () => setSaveError(null),
          (err: unknown) => setSaveError(err instanceof Error ? err.message : "Couldn't save the glass shading.")
        );
      }, SAVE_DEBOUNCE_MS);
    },
    [uid]
  );

  // On load: this browser's remembered level (SSR renders the default, matching the inline init script, then syncs in).
  useEffect(() => {
    const local = readLocal();
    if (local !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLevelState(local);
    }
  }, []);

  // Sign-out (ThemeProvider cleared the account-derived mirrors, lib/account-appearance.ts): back to the default level. The saved level in
  // the user doc is untouched. Any pending debounced save belongs to the account that just left and has already been flushed or is dropped.
  useEffect(() => {
    const onReset = () => setLevelState(GLASS_LAYER_DEFAULT);
    window.addEventListener(APPEARANCE_RESET_EVENT, onReset);
    return () => window.removeEventListener(APPEARANCE_RESET_EVENT, onReset);
  }, []);

  // Once the profile is known, the account's level wins; a level only this browser had is saved to the account once.
  useEffect(() => {
    if (!profileLoaded || !uid) return;
    const local = readLocal();
    const resolved = resolveGlassLayerLevel(profileLevel, local);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLevelState(resolved);
    if (isGlassLayerLevel(profileLevel)) {
      try {
        localStorage.setItem(GLASS_LAYER_STORAGE_KEY, String(profileLevel)); // mirror, so the next cold load has it instantly
      } catch {
        // ignore
      }
    } else if (shouldSaveLocalLevelToProfile(profileLevel, local) && migratedFor.current !== uid) {
      migratedFor.current = uid;
      persist(resolved);
    }
  }, [profileLoaded, uid, profileLevel, persist]);

  useEffect(() => {
    document.documentElement.style.setProperty("--glass-shade", String(level));
  }, [level]);

  // A pending debounced save shouldn't be lost if the provider unmounts: write it now.
  useEffect(
    () => () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      const pending = pendingSave.current;
      if (pending && isFirebaseConfigured()) {
        // The provider is going away, so there is nobody to show an error to; saveUserFields has already reported it.
        saveUserFields(portRef.current, pending.uid, { glassLayerLevel: pending.value }, "Couldn't save the glass shading").catch(() => {});
      }
    },
    []
  );

  const setLevel = useCallback(
    (value: number) => {
      const clamped = clampGlassLayerLevel(value);
      setLevelState(clamped);
      persist(clamped);
    },
    [persist]
  );
  const reset = useCallback(() => setLevel(GLASS_LAYER_DEFAULT), [setLevel]);

  const value = useMemo(() => ({ level, setLevel, reset, saveError }), [level, setLevel, reset, saveError]);
  return <GlassLayerContext.Provider value={value}>{children}</GlassLayerContext.Provider>;
}

export function useGlassLayerLevel() {
  const ctx = useContext(GlassLayerContext);
  if (!ctx) throw new Error("useGlassLayerLevel must be used within GlassLayerProvider");
  return ctx;
}
