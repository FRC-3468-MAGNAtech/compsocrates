"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { ApiError, authedApi } from "@/lib/api-client";
import { publicConfigOnce } from "@/lib/memberships/client";
import { REFRESH_THROTTLE_MS, type SnapshotDataset, type SnapshotMeta } from "@/lib/snapshot/model";

/**
 * The browser side of the snapshot routes (read reduction 2a). A hook that serves a snapshot dataset keeps its output shape; only WHERE the rows come from changes:
 *   - the switch for a dataset is learned once per page load from the public config (`snapshots.<dataset>`), never from Firestore; until it is known the hook reads nothing;
 *   - ON: `/api/snapshot/<dataset>` (the server verifies the caller and answers for the caller's own team); every chunk of one build is fetched and joined;
 *   - a 503 `quota_exceeded` keeps whatever the screen already shows (the banner is raised by `authedApi`); any other failure falls back to the direct Firestore read.
 * "Updated N min ago" and Refresh read `useSnapshotStatus`. A Refresh asks the server for a rebuild, which it grants at most once per 2 minutes per dataset.
 */

export type SnapshotLoad = { rows: unknown[]; builtAt: number; buildId: string; stale: boolean; teamId: string | null; fetchedAt: number; refreshWaitMs: number | null };

/** The snapshot dataset's switch, from the public config: false when the config could not be read (direct reads, as before). */
export async function snapshotEnabled(dataset: SnapshotDataset): Promise<boolean> {
  const config = await publicConfigOnce();
  const flags = config?.snapshots;
  return !!flags && typeof flags === "object" && (flags as Record<string, unknown>)[dataset] === true;
}

type Decision = "pending" | "on" | "off";
const known = new Map<SnapshotDataset, Decision>();

/** The dataset's switch as a hook: `pending` until the public config has answered (a hook reads nothing while pending), then `on` or `off`. */
export function useSnapshotDecision(dataset: SnapshotDataset): Decision {
  const [decision, setDecision] = useState<Decision>(() => known.get(dataset) ?? "pending");
  useEffect(() => {
    let alive = true;
    void snapshotEnabled(dataset).then((on) => {
      known.set(dataset, on ? "on" : "off");
      if (alive) setDecision(on ? "on" : "off");
    });
    return () => {
      alive = false;
    };
  }, [dataset]);
  return decision;
}

/** Test hook. */
export function resetSnapshotClientForTests(): void {
  known.clear();
  memo.clear();
  statuses.clear();
  updateListeners.clear();
  storeListeners.clear();
  version = 0;
}

export class SnapshotMismatch extends Error {}

async function fetchChunk(dataset: SnapshotDataset, program: string, chunk: number, refresh: boolean): Promise<SnapshotMeta> {
  const query = `program=${encodeURIComponent(program)}&chunk=${chunk}${refresh ? "&refresh=1" : ""}`;
  return authedApi<SnapshotMeta>(`/api/snapshot/${dataset}?${query}`);
}

/** Every chunk of one build, joined. Two chunks from different builds (a rebuild landed between the requests) are never mixed: it asks again once, then gives up. */
async function fetchWhole(dataset: SnapshotDataset, program: string, refresh: boolean): Promise<SnapshotLoad> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const first = await fetchChunk(dataset, program, 0, refresh && attempt === 0);
    const rest = await Promise.all(Array.from({ length: Math.max(0, first.chunks - 1) }, (_, i) => fetchChunk(dataset, program, i + 1, false)));
    if (rest.every((c) => c.buildId === first.buildId)) {
      return { rows: [first, ...rest].flatMap((c) => c.rows), builtAt: first.builtAt, buildId: first.buildId, stale: first.stale || rest.some((c) => c.stale), teamId: first.teamId, fetchedAt: Date.now(), refreshWaitMs: first.refreshWaitMs };
    }
  }
  throw new SnapshotMismatch("The snapshot changed while it was being read.");
}

// ---- one shared load per (program, dataset, team), remembered for a minute ----

const MEMO_MS = 60_000;
const memo = new Map<string, { at: number; promise: Promise<SnapshotLoad> }>();
const keyOf = (dataset: SnapshotDataset, program: string, team: string | null) => `${dataset}|${program}|${team ?? ""}`;

/**
 * The dataset for this program and (the browser's idea of the) team: one request however many hooks ask, remembered for a minute. `team` is only a CACHE KEY here (a
 * switch changes it, so the next ask loads again); it is never sent. A failed load is dropped so the next ask retries.
 */
export function loadSnapshot(dataset: SnapshotDataset, program: string, team: string | null): Promise<SnapshotLoad> {
  const key = keyOf(dataset, program, team);
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.promise;
  const promise = fetchWhole(dataset, program, false).then((load) => {
    publishStatus(dataset, load);
    return load;
  });
  memo.set(key, { at: Date.now(), promise });
  promise.catch(() => {
    if (memo.get(key)?.promise === promise) memo.delete(key);
  });
  return promise;
}

/** Forget what was loaded (a team switch, a membership change): the next ask loads again. The server's own cache is untouched. */
export function forgetSnapshots(): void {
  memo.clear();
}

// ---- Refresh and the "Updated N min ago" status ----

export type SnapshotStatus = { builtAt: number; stale: boolean; /** epoch ms at which a Refresh may be asked again */ refreshAvailableAt: number };
const statuses = new Map<SnapshotDataset, SnapshotStatus>();
const storeListeners = new Set<() => void>();
let version = 0;
const bump = () => {
  version += 1;
  storeListeners.forEach((l) => l());
};

function publishStatus(dataset: SnapshotDataset, load: SnapshotLoad): void {
  const wait = load.refreshWaitMs;
  statuses.set(dataset, { builtAt: load.builtAt, stale: load.stale, refreshAvailableAt: wait !== null ? Date.now() + wait : load.builtAt + REFRESH_THROTTLE_MS });
  bump();
}

/** Hooks that show a dataset subscribe here to be handed the rows of a Refresh. */
const updateListeners = new Set<(dataset: SnapshotDataset, program: string, load: SnapshotLoad) => void>();
export function onSnapshotRefreshed(listener: (dataset: SnapshotDataset, program: string, load: SnapshotLoad) => void): () => void {
  updateListeners.add(listener);
  return () => void updateListeners.delete(listener);
}

/** Ask the server to rebuild now (throttled to once per 2 minutes per dataset). The answer carries the data either way; listeners get it. Never throws: a failure leaves the screen as it is. */
export async function refreshSnapshot(dataset: SnapshotDataset, program: string): Promise<{ ok: boolean; waitMs: number | null }> {
  try {
    const load = await fetchWhole(dataset, program, true);
    publishStatus(dataset, load);
    for (const key of [...memo.keys()]) if (key.startsWith(`${dataset}|${program}|`)) memo.set(key, { at: Date.now(), promise: Promise.resolve(load) });
    updateListeners.forEach((l) => l(dataset, program, load));
    return { ok: true, waitMs: load.refreshWaitMs };
  } catch (err) {
    if (err instanceof ApiError && err.code === "quota_exceeded") return { ok: false, waitMs: null };
    return { ok: false, waitMs: null };
  }
}

const subscribeStore = (l: () => void) => {
  storeListeners.add(l);
  return () => void storeListeners.delete(l);
};

/** The oldest build among the datasets that are being served, and when a Refresh is next allowed; null while nothing is served from a snapshot. */
export function useSnapshotStatus(datasets: readonly SnapshotDataset[]): (SnapshotStatus & { datasets: SnapshotDataset[] }) | null {
  useSyncExternalStore(subscribeStore, () => version, () => 0);
  const served = datasets.filter((d) => statuses.has(d));
  if (served.length === 0) return null;
  const all = served.map((d) => statuses.get(d)!);
  return { datasets: served, builtAt: Math.min(...all.map((s) => s.builtAt)), stale: all.some((s) => s.stale), refreshAvailableAt: Math.max(...all.map((s) => s.refreshAvailableAt)) };
}

/** Is this failure the daily quota (keep what is on screen) rather than something to fall back from? */
export const isQuotaFailure = (err: unknown): boolean => err instanceof ApiError && err.code === "quota_exceeded";
