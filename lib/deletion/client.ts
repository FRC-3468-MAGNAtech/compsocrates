"use client";

import { useEffect, useState } from "react";
import { authedApi } from "@/lib/api-client";
import { publicConfigOnce } from "@/lib/memberships/client";
import type { JobSummary } from "@/lib/server/account-deletion/job";

/**
 * The browser side of account deletion: the kill switch (learned once per page load from the public config route, shared with the memberships switch: one fetch) and one
 * function per server route. While the switch is OFF or unknown nothing renders and nothing is read.
 */
let enabledPromise: Promise<boolean> | null = null;
let knownEnabled = false;

export function accountDeletionEnabled(): Promise<boolean> {
  if (!enabledPromise) {
    enabledPromise = publicConfigOnce().then((json) => {
      knownEnabled = json?.accountDeletionEnabled === true;
      return knownEnabled;
    });
  }
  return enabledPromise;
}

/** Test hook: forget the answer, or set it. */
export function resetAccountDeletionEnabled(value?: boolean): void {
  enabledPromise = value === undefined ? null : Promise.resolve(value);
  knownEnabled = value === true;
}

/** The kill switch as a hook: false until the answer arrives. */
export function useAccountDeletionEnabled(): boolean {
  const [on, setOn] = useState(() => knownEnabled);
  useEffect(() => {
    let alive = true;
    void accountDeletionEnabled().then((v) => {
      if (alive) setOn(v);
    });
    return () => {
      alive = false;
    };
  }, []);
  return on;
}

const post = <T>(path: string, body: Record<string, unknown>) => authedApi<T>(path, { method: "POST", body, timeoutMs: 25_000 });

export type DeletionJobRow = Pick<JobSummary, "opaqueId" | "status" | "step" | "startedAt" | "updatedAt" | "notBeforeMs" | "sweepLoops" | "runs" | "lastError" | "requestedBy">;

export const deletionApi = {
  /** The person deletes their own account (the caller re-authenticates first). */
  deleteMyAccount: (confirm: string) => post<{ status: "started" }>("/api/account/delete", { confirm }),
  list: () => post<{ jobs: DeletionJobRow[] }>("/api/platform/account-deletions", { action: "list" }),
  start: (uid: string) => post<{ status: string }>("/api/platform/account-deletions", { action: "start", uid }),
  resume: (opaqueId: string) => post<{ status: string; done?: boolean }>("/api/platform/account-deletions", { action: "resume", opaqueId }),
};
