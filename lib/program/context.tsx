"use client";

import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { BRAND } from "@/config/brand";
import { DEFAULT_PROGRAM, isProgramId, type ProgramId } from "@/config/programs/types";
import { programConfig } from "@/config/programs";

// The active program. Inside `app/(app)/[program]` it comes from the URL (ProgramProvider); elsewhere (landing, login)
// it is the program the person used last, kept in localStorage, else FRC.

const ProgramContext = createContext<ProgramId | null>(null);

const STORAGE_KEY = `${BRAND.storagePrefix}.program`;

export function readLastProgram(): ProgramId {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (isProgramId(v)) return v;
  } catch {
    /* storage blocked: fall through */
  }
  return DEFAULT_PROGRAM;
}

export function rememberProgram(id: ProgramId): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* storage blocked: the choice just is not remembered */
  }
}

export function ProgramProvider({ program, children }: { program: ProgramId; children: ReactNode }) {
  useEffect(() => rememberProgram(program), [program]);
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
