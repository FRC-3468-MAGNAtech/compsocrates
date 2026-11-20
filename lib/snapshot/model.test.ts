import { describe, expect, it } from "vitest";
import {
  CACHE_ENTRY_CAP_BYTES,
  CHUNK_TARGET_BYTES,
  DEFAULT_TTL_SECONDS,
  REFRESH_THROTTLE_MS,
  TTL_MAX_SECONDS,
  TTL_MIN_SECONDS,
  byteLength,
  chunkBySize,
  clampTtl,
  datasetEnabled,
  describeFreshness,
  isFresh,
  parseSnapshotSettings,
  publicSnapshotFlags,
  refreshCountdownSeconds,
  refreshWaitMs,
  toJsonSafe,
} from "@/lib/snapshot/model";

describe("snapshot settings (appSettings/global)", () => {
  it("everything missing is OFF with the code defaults", () => {
    const s = parseSnapshotSettings(undefined);
    expect(s.master).toBe(false);
    expect(Object.values(s.datasets).every((on) => on === false)).toBe(true);
    expect(s.ttlSeconds).toEqual({ roster: 120, library: 900, flags: 600, sessions: 1800, entries: 600 });
    expect(publicSnapshotFlags(s)).toEqual({ roster: false, library: false, flags: false, sessions: false, entries: false });
  });

  it("only an explicit true turns a switch on; a string, a number or 1 does not", () => {
    for (const bad of ["true", 1, "yes", {}, [], null]) expect(parseSnapshotSettings({ snapshotRoutesEnabled: bad, snapshotRoster: bad }).master).toBe(false);
    expect(parseSnapshotSettings({ snapshotRoster: "true" }).datasets.roster).toBe(false);
  });

  it("a dataset is served only when the master switch AND its own switch are true (and this build implements it)", () => {
    const only = (raw: Record<string, unknown>) => publicSnapshotFlags(parseSnapshotSettings(raw));
    expect(only({ snapshotRoster: true })).toMatchObject({ roster: false });
    expect(only({ snapshotRoutesEnabled: true })).toMatchObject({ roster: false, library: false });
    expect(only({ snapshotRoutesEnabled: true, snapshotRoster: true })).toMatchObject({ roster: true, library: false });
    expect(only({ snapshotRoutesEnabled: true, snapshotRoster: true, snapshotLibrary: true })).toMatchObject({ roster: true, library: true });
    // entries, sessions and flags are not built in this phase: their switches do nothing yet
    expect(only({ snapshotRoutesEnabled: true, snapshotEntries: true, snapshotSessions: true, snapshotFlags: true })).toMatchObject({ entries: false, sessions: false, flags: false });
    expect(datasetEnabled(parseSnapshotSettings({ snapshotRoutesEnabled: false, snapshotRoster: true }), "roster")).toBe(false);
  });

  it("the TTL map is owner-tunable, bounded 30 to 3600 seconds, and a bad value falls back to the default", () => {
    const s = parseSnapshotSettings({ snapshotTtl: { roster: 5, library: 99_999, sessions: 300.4, entries: "60", flags: NaN } });
    expect(s.ttlSeconds.roster).toBe(TTL_MIN_SECONDS);
    expect(s.ttlSeconds.library).toBe(TTL_MAX_SECONDS);
    expect(s.ttlSeconds.sessions).toBe(300);
    expect(s.ttlSeconds.entries).toBe(DEFAULT_TTL_SECONDS.entries);
    expect(s.ttlSeconds.flags).toBe(DEFAULT_TTL_SECONDS.flags);
    expect(clampTtl(undefined, 77)).toBe(77);
    for (const notAMap of [5, "x", [1, 2], null]) expect(parseSnapshotSettings({ snapshotTtl: notAMap }).ttlSeconds).toEqual(DEFAULT_TTL_SECONDS);
  });
});

describe("freshness and the refresh throttle", () => {
  it("fresh until the TTL, stale after", () => {
    expect(isFresh(1_000, 120, 1_000 + 119_999)).toBe(true);
    expect(isFresh(1_000, 120, 1_000 + 120_000)).toBe(false);
  });
  it("a Refresh waits out the 2 minutes since the copy was built", () => {
    expect(REFRESH_THROTTLE_MS).toBe(120_000);
    expect(refreshWaitMs(10_000, 10_000)).toBe(120_000);
    expect(refreshWaitMs(10_000, 70_000)).toBe(60_000);
    expect(refreshWaitMs(10_000, 130_000)).toBe(0);
    expect(refreshWaitMs(10_000, 999_999)).toBe(0);
  });
  it("the words and the countdown", () => {
    expect(describeFreshness(1_000_000, 1_000_000 + 20_000)).toBe("Updated just now");
    expect(describeFreshness(1_000_000, 1_000_000 + 3 * 60_000 + 5_000)).toBe("Updated 3 min ago");
    expect(describeFreshness(1_000_000, 1_000_000 + 2 * 3_600_000 + 5_000)).toBe("Updated 2 h ago");
    expect(describeFreshness(5_000, 1_000)).toBe("Updated just now");
    expect(refreshCountdownSeconds(10_500, 10_000)).toBe(1);
    expect(refreshCountdownSeconds(10_000, 10_000)).toBe(0);
    expect(refreshCountdownSeconds(5_000, 10_000)).toBe(0);
    expect(refreshCountdownSeconds(10_000 + 119_001, 10_000)).toBe(120);
  });
});

const sized = (id: number, bytes: number) => ({ id: `e${id}`, pad: "x".repeat(Math.max(0, bytes - 20)) });

describe("chunking by serialized size", () => {
  it("5,000 synthetic entries of 4 KB: every chunk is about 1.2 MB at most, nothing is lost, repeated or reordered, and each is far under the 2 MB cache cap", () => {
    const rows = Array.from({ length: 5_000 }, (_, i) => sized(i, 4096));
    const { chunks, bytes } = chunkBySize(rows);
    expect(chunks.length).toBeGreaterThanOrEqual(17); // 20.5 MB / 1.2 MB
    expect(chunks.length).toBeLessThanOrEqual(19);
    for (const [i, chunk] of chunks.entries()) {
      const actual = byteLength(JSON.stringify(chunk));
      expect(actual).toBeLessThanOrEqual(CHUNK_TARGET_BYTES);
      expect(actual).toBeLessThan(CACHE_ENTRY_CAP_BYTES);
      expect(bytes[i]).toBeGreaterThanOrEqual(actual); // the estimate never under-counts
    }
    expect(chunks.flat()).toEqual(rows);
  });

  it("is by size, never by a fixed row count: small rows share a chunk, a big row sits alone, whatever the count", () => {
    const small = Array.from({ length: 3_000 }, (_, i) => ({ id: i }));
    expect(chunkBySize(small).chunks).toHaveLength(1);
    const mixed = [...Array.from({ length: 10 }, (_, i) => sized(i, 100)), sized(99, 1_500_000), ...Array.from({ length: 10 }, (_, i) => sized(200 + i, 100))];
    const { chunks } = chunkBySize(mixed);
    expect(chunks.map((c) => c.length)).toEqual([10, 1, 10]);
    expect(chunks.flat()).toEqual(mixed);
  });

  it("nothing in, one empty chunk out (a manifest always has a chunk 0)", () => {
    expect(chunkBySize([]).chunks).toEqual([[]]);
  });

  it("counts bytes, not characters", () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ id: i, name: "é".repeat(500) }));
    const { chunks } = chunkBySize(rows, 20_000);
    for (const chunk of chunks) expect(byteLength(JSON.stringify(chunk))).toBeLessThanOrEqual(20_000);
    expect(chunks.flat()).toEqual(rows);
  });
});

describe("toJsonSafe: a Firestore document as JSON can carry it", () => {
  it("a Timestamp becomes epoch milliseconds, a Date too, a reference its path; nested and in arrays", () => {
    const ts = { toMillis: () => 1_700_000_123_456, seconds: 1, nanoseconds: 2 };
    const out = toJsonSafe({ createdAt: ts, when: new Date(5_000), list: [ts, { at: ts }], ref: { path: "users/u1", firestore: {} }, n: 3, s: "a", b: false, nil: null, missing: undefined }) as Record<string, unknown>;
    expect(out).toEqual({ createdAt: 1_700_000_123_456, when: 5_000, list: [1_700_000_123_456, { at: 1_700_000_123_456 }], ref: "users/u1", n: 3, s: "a", b: false, nil: null });
    expect("missing" in out).toBe(false);
  });
  it("survives a JSON round trip unchanged", () => {
    const doc = { a: [1, { b: 2 }], c: { d: "e", f: [true, null] }, t: { toMillis: () => 42 } };
    const safe = toJsonSafe(doc);
    expect(JSON.parse(JSON.stringify(safe))).toEqual(safe);
  });
});
