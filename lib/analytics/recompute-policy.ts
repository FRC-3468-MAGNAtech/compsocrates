// Who recomputes accuracy after a save, and how a failed recompute is handled. Pure (no Firebase), so it is unit tested.
//
// Accuracy and automatic flags are DERIVED fields written onto an entry. In a program whose entries live in its own namespace (`ownEntryStore`) only an admin may update an
// entry (the rules: `scoutEntries` update is admin-only), so a scout's recompute would be denied. The rules are not loosened: the scout pages skip the recompute
// for everyone but an admin, and the next admin recompute (any admin's save, an import, or the "Recalculate Accuracy" button) covers it. The default program is
// unchanged: every save recomputes.

/** Does this person's save trigger a recompute? A program with its own entry store: admins only. The default program: everyone, as before. */
export function shouldRecomputeAfterSave(args: { ownEntryStore: boolean; isAdmin: boolean }): boolean {
  return !args.ownEntryStore || args.isAdmin;
}

/** May this person press "Recalculate Accuracy"? Same rule as the writes it makes. */
export function canRecalculateAccuracy(args: { ownEntryStore: boolean; isAdmin: boolean }): boolean {
  return shouldRecomputeAfterSave(args);
}

export type QuietRecomputeOptions = {
  /** Extra attempts after the first (default 2). */
  retries?: number;
  /** Wait before each retry, in ms (default 2s then 8s). */
  delaysMs?: number[];
  /** Sleep; replaced in tests. */
  wait?: (ms: number) => Promise<void>;
  /** Called with each failure (default: a console warning, never an alert and never thrown). */
  onFailure?: (err: unknown, attempt: number) => void;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs a recompute that follows a save. It NEVER throws and never blocks the save: a failure is reported quietly and retried a couple of times, then given up on
 * (the next admin recompute catches up). Resolves with whether a run finally succeeded.
 */
export async function recomputeQuietly(run: () => Promise<void>, options: QuietRecomputeOptions = {}): Promise<boolean> {
  const { retries = 2, delaysMs = [2000, 8000], wait = sleep, onFailure = (err, attempt) => console.warn(`[accuracy] recompute failed (attempt ${attempt}); it will be retried or picked up by the next recalculation.`, err) } = options;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      await run();
      return true;
    } catch (err) {
      try {
        onFailure(err, attempt);
      } catch {
        // a failing reporter must not break the save either
      }
      if (attempt > retries) return false;
      await wait(delaysMs[Math.min(attempt - 1, delaysMs.length - 1)] ?? 0);
    }
  }
  return false;
}
