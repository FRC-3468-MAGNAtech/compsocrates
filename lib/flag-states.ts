"use client";

import { collection, onSnapshot, query, where, type Unsubscribe } from "@/lib/firebase/metered";
import { indexFlagStates } from "@/data/cs/scouting";
import type { CsFlagState } from "@/data/cs/types";
import { db } from "@/lib/firebase/client";
import { isQuotaExceeded } from "@/lib/quota";

/**
 * The team's `scoutingFlagStates` documents: ONE listener per team, shared by every reader (read reduction 2a). The entries feed (`lib/scout-entries.ts`) used to own
 * this listener while `lib/practice-extras.ts` read the same collection again with a one-time query, so a page that showed both paid for the documents twice. Now the
 * extras take the documents from the live listener when one is running (`liveFlagDocs`) and only query by themselves when none is.
 */
const FLAG_COLLECTION = "scoutingFlagStates";

type FlagStore = {
  listeners: Set<() => void>;
  states: ReadonlyMap<string, CsFlagState>;
  docs: Record<string, unknown>[];
  /** Resolves with the raw documents at the first snapshot; rejects with the listener's first error. */
  ready: Promise<Record<string, unknown>[]>;
  unsubscribe: Unsubscribe;
};
const flagStores = new Map<string, FlagStore>();

export function subscribeFlagStates(teamId: string, onChange: () => void): Unsubscribe {
  let store = flagStores.get(teamId);
  if (!store) {
    let resolveReady: (docs: Record<string, unknown>[]) => void = () => {};
    let rejectReady: (err: unknown) => void = () => {};
    const ready = new Promise<Record<string, unknown>[]>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    ready.catch(() => {}); // a store nobody asked `liveFlagDocs` about must not raise an unhandled rejection
    const created: FlagStore = { listeners: new Set(), states: new Map(), docs: [], ready, unsubscribe: () => {} };
    created.unsubscribe = onSnapshot(
      query(collection(db, FLAG_COLLECTION), where("teamId", "==", teamId)),
      (snap) => {
        created.docs = snap.docs.map((d) => d.data() as Record<string, unknown>);
        created.states = indexFlagStates(created.docs as CsFlagState[]);
        resolveReady(created.docs);
        created.listeners.forEach((listener) => listener());
      },
      (err) => {
        // CS does the same: carry on without flag states.
        console.warn("scoutingFlagStates subscription failed:", err);
        if (!isQuotaExceeded(err)) {
          created.states = new Map(); // quota: keep the last flag states
          created.docs = [];
        }
        rejectReady(err);
        created.listeners.forEach((listener) => listener());
      }
    );
    flagStores.set(teamId, created);
    store = created;
  }
  const active = store;
  active.listeners.add(onChange);
  return () => {
    active.listeners.delete(onChange);
    if (active.listeners.size === 0) {
      active.unsubscribe();
      if (flagStores.get(teamId) === active) flagStores.delete(teamId);
    }
  };
}

export function currentFlagStates(teamId: string): ReadonlyMap<string, CsFlagState> {
  return flagStores.get(teamId)?.states ?? new Map();
}

/**
 * The team's raw flag-state documents from the listener that is ALREADY running for it (null when none is: the caller then makes its own one-time read). Waits for the
 * listener's first snapshot, so the answer is never an empty list that only means "not loaded yet". Rejects with the listener's error.
 */
export function liveFlagDocs(teamId: string): Promise<Record<string, unknown>[]> | null {
  return flagStores.get(teamId)?.ready ?? null;
}
