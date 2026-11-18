import { beforeEach, describe, expect, it, vi } from "vitest";
import { FEED_MIN_INTERVAL_MS, cachedFeed, clearFeedCacheForTests, rememberFeed } from "./feed-cache";
import type { PlatformEntry } from "./model";

const entries = [{ id: "a" }] as unknown as PlatformEntry[];

beforeEach(() => {
  vi.unstubAllGlobals();
  clearFeedCacheForTests();
});

describe("the changelog feed's 10-minute minimum interval", () => {
  it("serves the remembered feed until 10 minutes have passed", () => {
    expect(cachedFeed(1_000)).toBeNull();
    rememberFeed(entries, 1_000);
    expect(cachedFeed(1_000 + FEED_MIN_INTERVAL_MS - 1)).toBe(entries);
    expect(cachedFeed(1_000 + FEED_MIN_INTERVAL_MS)).toBeNull();
  });

  it("also keeps it in sessionStorage for page reloads, and never throws when storage is blocked", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", { sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } });
    rememberFeed(entries, 5_000);
    expect(store.size).toBe(1);
    expect(JSON.parse([...store.values()][0])).toEqual({ at: 5_000, entries });
    vi.stubGlobal("window", {
      get sessionStorage(): never {
        throw new Error("blocked");
      },
    });
    expect(() => rememberFeed(entries, 7_000)).not.toThrow();
    expect(cachedFeed(7_001)).toBe(entries); // the in-memory copy still serves
  });
});
