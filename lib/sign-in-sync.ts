// The sign-in sync (/api/auth/sync-roles: owner claims, role repair, membership pointers) costs about 4 to 6 Firestore reads, and it used to run on EVERY page load because
// restoring a session counts as a sign-in. A real sign-in (login, signup, Google, link) still always runs it. A restored session runs it at most once per 10 minutes per
// browser session (sessionStorage), and two callers that start together share one request. The answer a restored session reuses is the last one the server gave.
import { storageKey } from "@/config/brand";

export const SIGN_IN_SYNC_MIN_INTERVAL_MS = 10 * 60 * 1000;

export type SyncResult = { changed: boolean; ownerPendingVerification: boolean; ok?: boolean };
type Marker = { uid: string; at: number; pending: boolean };

const keyName = () => storageKey("rolesSyncedAt");
const inflight = new Map<string, Promise<SyncResult>>();

function session(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function recent(uid: string, now: number): Marker | null {
  try {
    const raw = session()?.getItem(keyName());
    const marker = raw ? (JSON.parse(raw) as Marker) : null;
    return marker && marker.uid === uid && typeof marker.at === "number" && now >= marker.at && now - marker.at < SIGN_IN_SYNC_MIN_INTERVAL_MS ? marker : null;
  } catch {
    return null;
  }
}

/** Run `run` (the sync request) unless `force` is off and this session synced `uid` less than 10 minutes ago. */
export function syncRolesThrottled(uid: string, run: () => Promise<SyncResult>, opts: { force: boolean }, now: number = Date.now()): Promise<SyncResult> {
  if (!opts.force) {
    const marker = recent(uid, now);
    if (marker) return Promise.resolve({ changed: false, ownerPendingVerification: marker.pending, ok: true });
  }
  const running = inflight.get(uid);
  if (running) return running;
  const promise = run()
    .then((result) => {
      if (result.ok !== false) {
        try {
          session()?.setItem(keyName(), JSON.stringify({ uid, at: now, pending: result.ownerPendingVerification } satisfies Marker));
        } catch {
          // blocked storage: the next restore simply syncs again
        }
      }
      return result;
    })
    .finally(() => void inflight.delete(uid));
  inflight.set(uid, promise);
  return promise;
}

/** Forget the marker (sign-out). */
export function clearSignInSyncMarker(): void {
  try {
    session()?.removeItem(keyName());
  } catch {
    // ignore
  }
}
