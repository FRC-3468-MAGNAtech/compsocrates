"use client";

import { useEffect, useSyncExternalStore } from "react";
import { fetchAdminsSeeAllProfiles } from "@/lib/team-enrollment";

/**
 * The owner's `adminsSeeAllProfiles` switch as the browser sees it: fetched once per page load from the public config route and shared
 * by every component that asks. `null` means "not known yet" (or the read failed); callers treat it as ON, which is the default, and
 * the profile rules (which read the same field) stay the real gate either way.
 */
let value: boolean | null = null;
let started = false;
const listeners = new Set<() => void>();

function publish(next: boolean | null) {
  if (next === value) return;
  value = next;
  listeners.forEach((l) => l());
}

/** The Admin Panel calls this after the owner flips the switch, so this tab updates without a reload. */
export function setAdminsSeeAllProfilesLocal(next: boolean) {
  started = true;
  publish(next);
}

export function useAdminsSeeAllProfiles(): boolean | null {
  const current = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => value,
    () => null
  );
  useEffect(() => {
    if (started) return;
    started = true;
    void fetchAdminsSeeAllProfiles().then((v) => {
      if (v === null) started = false; // a failed read may be retried by the next mount
      else publish(v);
    });
  }, []);
  return current;
}
