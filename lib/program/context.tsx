"use client";

import { createContext, useContext, useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { clearLegacyCache } from "@/lib/legacy-cache";
import { BRAND } from "@/config/brand";
import { DEFAULT_PROGRAM, isProgramId, type ProgramId } from "@/config/programs/types";
import { programConfig } from "@/config/programs";

// The active program. Inside `app/(app)/[program]` it comes from the URL (ProgramProvider); elsewhere (landing, login)
// it is the program the person used last, kept in localStorage, else FRC.

const ProgramContext = createContext<ProgramId | null>(null);

const STORAGE_KEY = `${BRAND.storagePrefix}.program`;
const COOKIE_NAME = "program";

/** The program the person used last, or null when there is no history (the home page then shows the selector instead of guessing). */
export function readStoredProgram(): ProgramId | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (isProgramId(v)) return v;
  } catch {
    /* storage blocked: fall through to the cookie */
  }
  try {
    const m = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
    if (m && isProgramId(m[1])) return m[1];
  } catch {
    /* cookies blocked: no history */
  }
  return null;
}

export function readLastProgram(): ProgramId {
  return readStoredProgram() ?? DEFAULT_PROGRAM;
}

/** Remembers the program in localStorage and in the `program` cookie (one year, this site only). Switching programs never changes data, only the path. */
export function rememberProgram(id: ProgramId): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* storage blocked: the cookie below may still work */
  }
  try {
    document.cookie = `${COOKIE_NAME}=${id}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    /* cookies blocked: the choice just is not remembered */
  }
}

export function ProgramProvider({ program, children }: { program: ProgramId; children: ReactNode }) {
  useEffect(() => rememberProgram(program), [program]);
  // A program switch inside one visit drops the device copy of the legacy rows (the first run only records the program).
  const shown = useRef(program);
  useEffect(() => {
    if (shown.current !== program) clearLegacyCache();
    shown.current = program;
  }, [program]);
  return <ProgramContext.Provider value={program}>{children}</ProgramContext.Provider>;
}

function subscribeLast(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/** The active program id. Outside the URL's program, the last-used one (the server and first client render say FRC). */
export function useProgram(): ProgramId {
  const fromUrl = useContext(ProgramContext);
  const last = useSyncExternalStore(subscribeLast, readLastProgram, () => DEFAULT_PROGRAM);
  return fromUrl ?? last;
}

/** The active program's config (brand copy, alliance size, season rule, Firestore prefix). */
export function useProgramConfig() {
  return programConfig(useProgram());
}
