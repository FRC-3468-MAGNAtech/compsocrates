"use client";

import { useEffect, useSyncExternalStore } from "react";

// Session 8: the two picture settings the browser needs, fetched once per page load from the public config route and shared by every component that asks:
//  - `blobHost`: the ONE host an uploaded picture may be served from (null when uploads are not set up on this server). resolveAvatar trusts nothing else.
//  - `uploadsEnabled`: the platform owner's switch (missing = on). null = not known yet (treated as on for display, off for offering an upload).
export type AvatarSettings = { loaded: boolean; blobHost: string | null; uploadsEnabled: boolean | null };

let value: AvatarSettings = { loaded: false, blobHost: null, uploadsEnabled: null };
let started = false;
const listeners = new Set<() => void>();

function publish(next: AvatarSettings) {
  value = next;
  listeners.forEach((l) => l());
}

/** The Admin Panel calls this after the owner flips the switch, so this tab updates without a reload. */
export function setAvatarUploadsEnabledLocal(enabled: boolean) {
  started = true;
  publish({ ...value, loaded: true, uploadsEnabled: enabled });
}

async function fetchSettings(): Promise<AvatarSettings | null> {
  try {
    const res = await fetch("/api/public/config");
    const json = (await res.json()) as { avatarUploadsEnabled?: unknown; avatarBlobHost?: unknown };
    return {
      loaded: true,
      blobHost: typeof json.avatarBlobHost === "string" && json.avatarBlobHost !== "" ? json.avatarBlobHost.toLowerCase() : null,
      uploadsEnabled: typeof json.avatarUploadsEnabled === "boolean" ? json.avatarUploadsEnabled : null,
    };
  } catch {
    return null;
  }
}

export function useAvatarSettings(): AvatarSettings {
  const current = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => value,
    () => value
  );
  useEffect(() => {
    if (started) return;
    started = true;
    void fetchSettings().then((s) => {
      if (s === null) started = false; // a failed read may be retried by the next mount
      else publish(s);
    });
  }, []);
  return current;
}

/** Offer the Upload option only when the server has a Blob store and the owner's switch is not off. */
export const canOfferUpload = (s: AvatarSettings): boolean => s.blobHost !== null && s.uploadsEnabled !== false;
