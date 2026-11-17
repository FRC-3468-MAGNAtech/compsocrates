"use client";

// Failed live reads of a program's data port, kept so the shell can say so instead of showing an empty list. A port's subscription reports a failure
// here (after `reportFirestoreError` logged it) and clears it when the same read next succeeds; the shell renders what is left
// (`components/program/read-failure-banner.tsx`). Keyed by the failing path/query, so one broken read is one banner row however often it retries.

import { useSyncExternalStore } from "react";
import type { FirestoreFailure } from "@/lib/firestore-errors";

const failures = new Map<string, FirestoreFailure>();
const listeners = new Set<() => void>();
let snapshot: readonly FirestoreFailure[] = [];

function publish(): void {
  snapshot = [...failures.values()];
  for (const listener of listeners) listener();
}

const keyOf = (failure: Pick<FirestoreFailure, "context" | "path">) => `${failure.path ?? ""}|${failure.context}`;

export function recordReadFailure(failure: FirestoreFailure): void {
  failures.set(keyOf(failure), failure);
  publish();
}

/** The read at `path` answered: whatever failure it had is gone. */
export function clearReadFailure(context: string, path: string): void {
  if (failures.delete(keyOf({ context, path }))) publish();
}

export function clearAllReadFailures(): void {
  if (failures.size === 0) return;
  failures.clear();
  publish();
}

export function currentReadFailures(): readonly FirestoreFailure[] {
  return snapshot;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

const EMPTY: readonly FirestoreFailure[] = [];

export function useReadFailures(): readonly FirestoreFailure[] {
  return useSyncExternalStore(subscribe, currentReadFailures, () => EMPTY);
}
