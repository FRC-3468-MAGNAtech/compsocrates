// The changelog feed behind the sidebar's unread dot is a hint, not content, so it is fetched at most once per 10 minutes per browser session: kept in memory for
// client-side navigation and in sessionStorage for page reloads. The Changelog page itself still fetches its own fresh copy. The numbers the dot is derived from
// are the same entries, just up to 10 minutes old.
import { storageKey } from "@/config/brand";
import type { PlatformEntry } from "@/lib/platform-changelog/model";

export const FEED_MIN_INTERVAL_MS = 10 * 60 * 1000;
const MAX_STORED_CHARS = 200_000;

type Held = { at: number; entries: PlatformEntry[] };
let memo: Held | null = null;

const keyName = () => storageKey("changelogFeed");

function session(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** The feed fetched less than 10 minutes ago, or null (fetch again). */
export function cachedFeed(now: number = Date.now()): PlatformEntry[] | null {
  if (memo && now - memo.at < FEED_MIN_INTERVAL_MS && now >= memo.at) return memo.entries;
  try {
    const raw = session()?.getItem(keyName());
    if (raw) {
      const held = JSON.parse(raw) as Held;
      if (typeof held?.at === "number" && Array.isArray(held.entries) && now - held.at < FEED_MIN_INTERVAL_MS && now >= held.at) {
        memo = held;
        return held.entries;
      }
    }
  } catch {
    // unreadable storage or a bad value: fetch again
  }
  return null;
}

export function rememberFeed(entries: PlatformEntry[], now: number = Date.now()): void {
  memo = { at: now, entries };
  try {
    const raw = JSON.stringify(memo);
    if (raw.length <= MAX_STORED_CHARS) session()?.setItem(keyName(), raw);
  } catch {
    // storage is full or blocked: the in-memory copy still serves this page load
  }
}

/** Test hook. */
export function clearFeedCacheForTests(): void {
  memo = null;
  try {
    session()?.removeItem(keyName());
  } catch {
    // ignore
  }
}
