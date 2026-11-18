"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { serverTimestamp } from "firebase/firestore";
import { authedApi, ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth";
import { timestampMs } from "@/lib/changelog";
import { cachedFeed, rememberFeed } from "@/lib/platform-changelog/feed-cache";
import { hasUnread, sortEntries, type EntryInput, type PlatformEntry } from "@/lib/platform-changelog/model";
import type { TimePatch } from "@/lib/platform-changelog/times";
import { useProgram } from "@/lib/program/context";
import type { ProgramData } from "@/lib/program/data";
import { saveUserFields } from "@/lib/program/user-fields";

// The client side of the platform changelog (Session 7): everything goes through the server routes (`/api/platform/changelog`); no
// Firestore read or write of the new collection from the browser. No team is needed anywhere in here.

const FEED = "/api/platform/changelog";

export const describeFeedError = (err: unknown): string =>
  err instanceof ApiError && err.code === "server_not_configured" ? "The server isn't set up to load the changelog yet." : "Couldn't load the changelog. Check your connection and try again.";

export async function fetchFeed(opts: { drafts?: boolean } = {}): Promise<{ entries: PlatformEntry[]; isOwner: boolean }> {
  const json = await authedApi<{ entries: PlatformEntry[]; isOwner?: boolean }>(`${FEED}${opts.drafts ? "?drafts=1" : ""}`);
  return { entries: sortEntries(json.entries ?? []), isOwner: json.isOwner === true };
}

/** The feed for the signed-in account (published entries; with `drafts`, the platform owner's drafts too). Loading, error and a retry are part of the result. */
export function usePlatformFeed(opts: { drafts?: boolean } = {}) {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const drafts = opts.drafts === true;
  const [state, setState] = useState<{ entries: PlatformEntry[]; loaded: boolean; error: string | null }>({ entries: [], loaded: false, error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    fetchFeed({ drafts }).then(
      (r) => !cancelled && setState({ entries: r.entries, loaded: true, error: null }),
      (err: unknown) => {
        console.error("platform changelog load failed:", err instanceof Error ? err.message : err);
        if (!cancelled) setState({ entries: [], loaded: true, error: describeFeedError(err) });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [uid, drafts, attempt]);

  const reload = useCallback(() => {
    setState((s) => ({ ...s, loaded: false, error: null }));
    setAttempt((n) => n + 1);
  }, []);
  return { ...state, reload };
}

/** When the signed-in account was created (Firebase Auth's own record: no read or write of ours), or null. */
export function useAccountCreatedMs(): number | null {
  const { user } = useAuth();
  const created = user?.metadata?.creationTime;
  return useMemo(() => {
    const ms = created ? Date.parse(created) : NaN;
    return Number.isFinite(ms) ? ms : null;
  }, [created]);
}

/**
 * The unread dot for the current program: fetches the published feed when the shell mounts and when the tab becomes visible, but never more than once per
 * 10 minutes per browser session (lib/platform-changelog/feed-cache.ts), then derives the dot from the account's `lastSeenChangelogAt` (so opening the page, which stamps it, clears the dot without another fetch).
 * A failed fetch shows no dot (it is a hint, not a content read; the page itself reports errors).
 */
export function usePlatformChangelogUnread(enabled: boolean, lastSeenChangelogAt: unknown): boolean {
  const program = useProgram();
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const createdMs = useAccountCreatedMs();
  const [entries, setEntries] = useState<PlatformEntry[]>([]);

  useEffect(() => {
    if (!enabled || !uid) return;
    let cancelled = false;
    const load = () => {
      const fresh = cachedFeed();
      if (fresh) {
        queueMicrotask(() => !cancelled && setEntries(fresh));
        return;
      }
      fetchFeed().then(
        (r) => {
          rememberFeed(r.entries);
          if (!cancelled) setEntries(r.entries);
        },
        () => !cancelled && setEntries([])
      );
    };
    load();
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, uid]);

  const seenMs = timestampMs(lastSeenChangelogAt);
  return useMemo(() => enabled && hasUnread(entries, program, seenMs, createdMs), [enabled, entries, program, seenMs, createdMs]);
}

/**
 * Stamps "I've seen the changelog up to now" on the user's own doc (the program's own through its port, else the root `users/{uid}`): clears the dot.
 * Unchanged from before the platform changelog: the same write path, no new user-document write. A failure is thrown with text to show.
 */
export async function markChangelogSeen(uid: string, port: Pick<ProgramData, "profile"> | null = null): Promise<void> {
  await saveUserFields(port, uid, { lastSeenChangelogAt: serverTimestamp() }, "Couldn't record the changelog visit");
}

// --- the owner's writes ---------------------------------------------------------------------------------------------------------------------------

export type OwnerWrite =
  | { action: "create"; entry: EntryInput; status: "draft" | "published" }
  | { action: "update"; id: string; expectedRev: number; entry: EntryInput; status?: "draft" | "published"; times?: TimePatch; recordEdit?: boolean; dateUnlocked?: boolean }
  | { action: "publish" | "unpublish"; id: string; expectedRev: number }
  | { action: "delete"; id: string; expectedRev: number };

export type WriteOutcome = { ok: true; entry: PlatformEntry | null } | { ok: false; conflict: boolean; message: string };

/** Sends one owner write. A 409 comes back as `conflict` (the caller reloads the stored entry); every other failure as a message to show. */
export async function ownerWrite(body: OwnerWrite): Promise<WriteOutcome> {
  try {
    const json = await authedApi<{ entry?: PlatformEntry }>(FEED, { method: "POST", body });
    return { ok: true, entry: json.entry ?? null };
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      return { ok: false, conflict: true, message: "Someone else changed this entry first. The latest version is loaded; check it and save again." };
    }
    return { ok: false, conflict: false, message: err instanceof ApiError ? err.message : "Couldn't save. Check your connection and try again." };
  }
}
