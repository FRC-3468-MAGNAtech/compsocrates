// The one way a rescore (events or sessions) writes: in chunks of 400 (Firestore's batch limit is 500), every write of a chunk attempted, the first failure
import { clearLegacyCache } from "@/lib/legacy-cache";
// stopping the run AFTER its chunk with an exact count of what went through. Safe to re-run: a rescore plan is rebuilt from the current data, and re-applying an
// already-applied plan writes the same values again. Pure apart from the writes it is given.

export const RESCORE_CHUNK_SIZE = 400;

/** A rescore that stopped part-way: what was written, what was not. Run it again to continue. */
export class RescoreApplyError extends Error {
  readonly written: number;
  readonly total: number;
  constructor(written: number, total: number, cause: unknown) {
    const why = cause instanceof Error ? cause.message : String(cause);
    super(`The rescore stopped after ${written} of ${total} writes (${total - written} not written): ${why} Nothing was lost: run it again to continue.`, { cause });
    this.name = "RescoreApplyError";
    this.written = written;
    this.total = total;
  }
}

export function chunkWrites<T>(items: readonly T[], size: number = RESCORE_CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function runRescoreWrites(writes: readonly (() => Promise<void>)[], onProgress?: (done: number, total: number) => void, size: number = RESCORE_CHUNK_SIZE): Promise<{ written: number }> {
  clearLegacyCache(); // rescoring rewrites rows the remembered legacy copy may hold
  let done = 0;
  for (const group of chunkWrites(writes, size)) {
    const results = await Promise.allSettled(group.map((write) => write()));
    done += results.filter((r) => r.status === "fulfilled").length;
    const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed) throw new RescoreApplyError(done, writes.length, failed.reason);
    onProgress?.(done, writes.length);
  }
  return { written: done };
}
