"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, authedApi } from "@/lib/api-client";
import type { CreditSection } from "@/lib/credits/ops";
import { DEFAULT_CREDITS } from "@/lib/credits/seed";

// The client side of the platform Credits (Session 7). One document for the whole site, read through the public cached route (so a signed-out
// visitor can read it) and edited by the platform owner through the owner route. No team is needed anywhere in here, and the browser never
// touches Firestore for credits. While nothing is saved (or while the read fails) the page shows the built-in list, so it is never blank.

export type StoredCredits = { sections: CreditSection[]; version: number; updatedAtMs: number | null };

/** The public read. Rejects with a message to show; never returns partial data. */
export async function fetchPublicCredits(signal?: AbortSignal): Promise<StoredCredits | null> {
  const res = await fetch("/api/public/credits", { signal });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; credits?: StoredCredits | null };
  if (!res.ok || json.ok === false) throw new Error(`credits read failed (${res.status})`);
  return json.credits ?? null;
}

/** What the page shows: the saved credits, else the built-in list (`isDefault`). A failed read keeps the built-in list and reports `error`. */
export function usePublicCredits() {
  const [state, setState] = useState<{ credits: StoredCredits | null; loaded: boolean; error: boolean }>({ credits: null, loaded: false, error: false });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchPublicCredits(controller.signal).then(
      (credits) => setState({ credits, loaded: true, error: false }),
      (err: unknown) => {
        if (controller.signal.aborted) return;
        console.error("credits load failed:", err instanceof Error ? err.message : err);
        setState({ credits: null, loaded: true, error: true });
      }
    );
    return () => controller.abort();
  }, [attempt]);

  const retry = useCallback(() => {
    setState((s) => ({ ...s, loaded: false, error: false }));
    setAttempt((n) => n + 1);
  }, []);
  return { sections: state.credits?.sections ?? DEFAULT_CREDITS, isDefault: state.credits === null, loaded: state.loaded, error: state.error, retry };
}

// --- the owner's editor ---------------------------------------------------------------------------------------------------------------------------

/** The stored document the editor starts from (uncached); `null` when nothing was saved yet (version 0). */
export async function fetchOwnerCredits(): Promise<StoredCredits | null> {
  const json = await authedApi<{ credits: StoredCredits | null }>("/api/platform/credits");
  return json.credits ?? null;
}

export type SaveOutcome = { ok: true; credits: StoredCredits } | { ok: false; conflict: boolean; message: string };

/** Saves the whole document against the version the editor loaded; `reset` stores the built-in list instead. A 409 comes back as `conflict`. */
export async function saveOwnerCredits(expectedVersion: number, body: { sections: CreditSection[] } | { reset: true }): Promise<SaveOutcome> {
  try {
    const json = await authedApi<{ credits: StoredCredits }>("/api/platform/credits", { method: "POST", body: { expectedVersion, ...body } });
    return { ok: true, credits: json.credits };
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) return { ok: false, conflict: true, message: "Someone else changed the credits first. Load the latest version, check it, and save again." };
    return { ok: false, conflict: false, message: err instanceof ApiError ? err.message : "Couldn't save. Check your connection and try again." };
  }
}
