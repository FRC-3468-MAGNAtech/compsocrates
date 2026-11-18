"use client";

// The free plan's daily read allowance runs out around midnight Pacific (about 3 AM Eastern). When it does, Firestore answers `resource-exhausted` and our own routes
// answer 503 `quota_exceeded`. This module is the one place that recognizes that and tells the shell, which shows ONE non-blocking banner. A read that fails for this
// reason never wipes what is on screen (see the shared team feed) and never makes a signed-in member look like someone with no team (see the auth provider).
import { useSyncExternalStore } from "react";

export const QUOTA_MESSAGE = "Daily data limit reached: resets around 3 AM Eastern";

/** Is this error the daily quota? Firestore client (`resource-exhausted`, with or without the `firestore/` prefix), gRPC code 8, or our server's `quota_exceeded`. */
export function isQuotaExceeded(err: unknown): boolean {
  if (typeof err === "string") return /quota|resource-exhausted/i.test(err);
  const raw = err as { code?: unknown; message?: unknown } | null | undefined;
  const code = raw?.code;
  if (code === 8) return true;
  if (typeof code === "string" && /(^|\/)(resource-exhausted|quota_exceeded)$/.test(code)) return true;
  return typeof raw?.message === "string" && /quota exceeded|RESOURCE_EXHAUSTED/i.test(raw.message);
}

let exceeded = false;
let dismissed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function markQuotaExceeded(): void {
  if (exceeded) return;
  exceeded = true;
  dismissed = false;
  notify();
}
/** A read just succeeded from the server: the allowance is back (or was never gone). */
export function clearQuotaExceeded(): void {
  if (!exceeded) return;
  exceeded = false;
  notify();
}
export function dismissQuotaBanner(): void {
  dismissed = true;
  notify();
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
export const isQuotaFlagged = (): boolean => exceeded;

/** True while a banner should show: the quota error was seen, a server read has not succeeded since, and nobody dismissed it. */
export function useQuotaBanner(): boolean {
  return useSyncExternalStore(subscribe, () => exceeded && !dismissed, () => false);
}

/** Test hook. */
export function resetQuotaForTests(): void {
  exceeded = false;
  dismissed = false;
  listeners.clear();
}
