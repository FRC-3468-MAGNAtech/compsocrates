// SNAPSHOT ROUTES, the pure part (read reduction 2a): datasets, flags, TTLs, chunking, freshness and the wire shapes. No Firebase, no React, no Next: shared by the
// route, the cache layer, the browser client and the tests.
//
// A snapshot route reads a read-mostly team dataset ONCE per cache window on the server and serves it as JSON to every authorized member of that team, so the
// second, third and eighteenth device do not each pay the Firestore reads. Browsers still write straight to Firestore; this only changes how some reads arrive.

export const SNAPSHOT_DATASETS = ["roster", "library", "flags", "sessions", "entries"] as const;
export type SnapshotDataset = (typeof SNAPSHOT_DATASETS)[number];

/** The datasets this build can serve. The others are named (their flags exist) but answer 404 `snapshot_not_available` until their phase ships. */
export const IMPLEMENTED_DATASETS: readonly SnapshotDataset[] = ["roster", "library"];

export const isSnapshotDataset = (value: unknown): value is SnapshotDataset => typeof value === "string" && (SNAPSHOT_DATASETS as readonly string[]).includes(value);

/** The `appSettings/global` field of a dataset's own switch (a boolean; missing = OFF). The master switch is `snapshotRoutesEnabled`. */
export const MASTER_FLAG = "snapshotRoutesEnabled";
export const TTL_FIELD = "snapshotTtl";
export const DATASET_FLAG: Record<SnapshotDataset, string> = {
  roster: "snapshotRoster",
  library: "snapshotLibrary",
  flags: "snapshotFlags",
  sessions: "snapshotSessions",
  entries: "snapshotEntries",
};

/** Code defaults, in seconds. `snapshotTtl` (an owner-tunable map) overrides them within the bounds below, with no deploy. */
export const DEFAULT_TTL_SECONDS: Record<SnapshotDataset, number> = { roster: 120, library: 900, flags: 600, sessions: 1800, entries: 600 };
/** The legacy halves of the entry and session datasets (a later phase) are historical: they live far longer than the fresh half. */
export const LEGACY_TTL_SECONDS = 21_600;
export const TTL_MIN_SECONDS = 30;
export const TTL_MAX_SECONDS = 3600;

/** A Refresh rebuilds a dataset at most once per this long (per team and dataset; the library, shared, per program). */
export const REFRESH_THROTTLE_MS = 120_000;

/** One cache entry (Next's data cache) may not exceed 2 MB; a chunk is cut at about this many serialized bytes so it never nears the cap. */
export const CHUNK_TARGET_BYTES = 1_200_000;
export const CACHE_ENTRY_CAP_BYTES = 2 * 1024 * 1024;

/** The response headers the owner reads in the browser's Network panel to see whether the cache is shared. */
export const HEADER_CACHE = "x-snapshot-cache";
export const HEADER_BUILT_AT = "x-snapshot-built-at";
export const HEADER_CHUNKS = "x-snapshot-chunks";
export const HEADER_OVERSIZE = "x-snapshot-oversize";
export const HEADER_STALE = "x-snapshot-stale";
export type CacheStatus = "HIT" | "MISS" | "REBUILD" | "THROTTLED";

export type SnapshotSettings = {
  /** The master switch AND nothing else: whether any dataset may be served. */
  master: boolean;
  datasets: Record<SnapshotDataset, boolean>;
  ttlSeconds: Record<SnapshotDataset, number>;
};

export function clampTtl(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(TTL_MAX_SECONDS, Math.max(TTL_MIN_SECONDS, Math.round(value)));
}

/** The settings as `appSettings/global` holds them. Anything missing or malformed is OFF (flags) or the code default (TTLs). Only an explicit `true` turns a switch on. */
export function parseSnapshotSettings(raw: Record<string, unknown> | null | undefined): SnapshotSettings {
  const data = raw ?? {};
  const ttlMap = data[TTL_FIELD] && typeof data[TTL_FIELD] === "object" && !Array.isArray(data[TTL_FIELD]) ? (data[TTL_FIELD] as Record<string, unknown>) : {};
  const datasets = {} as Record<SnapshotDataset, boolean>;
  const ttlSeconds = {} as Record<SnapshotDataset, number>;
  for (const d of SNAPSHOT_DATASETS) {
    datasets[d] = data[DATASET_FLAG[d]] === true;
    ttlSeconds[d] = clampTtl(ttlMap[d], DEFAULT_TTL_SECONDS[d]);
  }
  return { master: data[MASTER_FLAG] === true, datasets, ttlSeconds };
}

/** A dataset is served only when the master switch AND its own switch are true (and this build implements it). */
export const datasetEnabled = (settings: SnapshotSettings, dataset: SnapshotDataset): boolean => settings.master && settings.datasets[dataset] && IMPLEMENTED_DATASETS.includes(dataset);

/** What the browser learns from the public config: only booleans, one per dataset. */
export function publicSnapshotFlags(settings: SnapshotSettings): Record<SnapshotDataset, boolean> {
  const out = {} as Record<SnapshotDataset, boolean>;
  for (const d of SNAPSHOT_DATASETS) out[d] = datasetEnabled(settings, d);
  return out;
}

// ---- freshness ----

export const isFresh = (builtAt: number, ttlSeconds: number, now: number): boolean => now - builtAt < ttlSeconds * 1000;

/** Milliseconds until a Refresh is allowed again (0 = allowed now). The cached copy's own age is the throttle: no extra state, no extra read. */
export const refreshWaitMs = (builtAt: number, now: number, throttleMs: number = REFRESH_THROTTLE_MS): number => Math.max(0, builtAt + throttleMs - now);

// ---- chunking by SERIALIZED size ----

const encoder = new TextEncoder();
export const byteLength = (text: string): number => encoder.encode(text).length;

/**
 * Cuts `rows` into chunks whose JSON is at most `maxBytes` (a row bigger than that sits alone in its own chunk). Order is kept; no row is split, dropped or repeated, so
 * concatenating the chunks gives the input back. Never by a fixed row count: a roster row is small and a library row or an entry can be many times larger.
 */
export function chunkBySize<T>(rows: readonly T[], maxBytes: number = CHUNK_TARGET_BYTES): { chunks: T[][]; bytes: number[] } {
  const chunks: T[][] = [];
  const bytes: number[] = [];
  let current: T[] = [];
  let size = 2; // the brackets
  for (const row of rows) {
    const rowBytes = byteLength(JSON.stringify(row)) + 1; // the comma
    if (current.length > 0 && size + rowBytes > maxBytes) {
      chunks.push(current);
      bytes.push(size);
      current = [];
      size = 2;
    }
    current.push(row);
    size += rowBytes;
  }
  if (current.length > 0 || chunks.length === 0) {
    chunks.push(current);
    bytes.push(size);
  }
  return { chunks, bytes };
}

// ---- JSON-safe documents ----

/**
 * A Firestore document as JSON can carry it: a Timestamp (anything with `toMillis`) or a Date becomes epoch milliseconds, which every reader of this app already
 * accepts (`toEpochMs`); a document reference becomes its path; undefined is dropped. Plain objects and arrays are walked; everything else is returned as it is.
 */
export function toJsonSafe(value: unknown): unknown {
  if (value === null || typeof value !== "object") return typeof value === "function" || typeof value === "symbol" ? undefined : value;
  if (value instanceof Date) return value.getTime();
  const rec = value as { toMillis?: unknown; path?: unknown; firestore?: unknown };
  if (typeof rec.toMillis === "function") return (rec.toMillis as () => number)();
  if (typeof rec.path === "string" && rec.firestore !== undefined) return rec.path;
  if (Array.isArray(value)) return value.map((v) => toJsonSafe(v) ?? null);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const safe = toJsonSafe(v);
    if (safe !== undefined) out[k] = safe;
  }
  return out;
}

// ---- the wire shapes ----

/** A raw document of a dataset that ships documents (the library): the id and the data, converted exactly as the browser's own reader would. */
export type SnapshotDoc = { id: string; data: Record<string, unknown> };

export type SnapshotMeta = {
  ok: true;
  dataset: SnapshotDataset;
  program: string;
  /** The team the server served (from the caller's user document, never from the request). The library names none. */
  teamId: string | null;
  /** The OLDEST of the parts' build times, in epoch ms. */
  builtAt: number;
  /** The parts' build ids joined: every chunk of one snapshot carries the same one, so a client that sees two different ids asks again instead of mixing builds. */
  buildId: string;
  chunk: number;
  chunks: number;
  /** True when the server could not rebuild and is serving the last copy it has. */
  stale: boolean;
  /** Set on a refresh request the throttle refused: the wait in ms. The data is still sent. */
  refreshWaitMs: number | null;
  rows: unknown[];
};

// ---- what a person reads ----

/** "Updated just now" / "Updated 3 min ago" / "Updated 2 h ago" from the build time of the OLDEST dataset on screen. */
export function describeFreshness(builtAt: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - builtAt) / 60_000);
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes} min ago`;
  return `Updated ${Math.floor(minutes / 60)} h ago`;
}

/** Whole seconds until Refresh may be asked again (0 = now): the number the disabled button counts down. */
export const refreshCountdownSeconds = (availableAt: number, now: number): number => Math.max(0, Math.ceil((availableAt - now) / 1000));
