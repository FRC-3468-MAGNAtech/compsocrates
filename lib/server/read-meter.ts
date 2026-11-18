import "server-only";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { addCount, collectionKeyOf, pacificDayKey, recentDayKeys, sanitizeKey, totalOf, type Counts, type DayDoc } from "@/lib/read-meter/model";
import { isReadMeterOnSync } from "@/lib/server/team-settings";

// The read meter's server half (Admin SDK only; no client rule matches `readMeter`). The daily document `readMeter/{YYYY-MM-DD in Pacific time}` is bumped with
// FieldValue.increment, so concurrent writers never overwrite each other. Everything here is inert while `appSettings/global.readMeterEnabled` is missing or false:
// `meterDb` hands back the real database untouched, and the flush route answers without writing.
//
// COUNTED: documents the listed routes read through a `meterDb`-wrapped database. NOT COUNTED: reads Firestore bills for evaluating security rules, index overhead, the
// meter's own writes, and any route that is not instrumented. Compare the day's total with the Firebase console's Usage number.

export const READ_METER_COLLECTION = "readMeter";
const SERVER_FLUSH_EVERY_MS = 60_000;

let serverPending: Counts = {}; // route -> collection -> documents
let lastServerFlush = 0;

type Counted = { ref?: { parent?: { path?: string } }; exists?: boolean; docs?: unknown[] };

/** Count the documents one read returned, under `route`, by collection. */
function countResult(route: string, result: unknown, rawDb: Firestore): void {
  try {
    const add = (path: string | undefined, n: number) => addCount(serverPending, sanitizeKey(route), collectionKeyOf(path ?? "(unknown)"), n);
    const one = (value: unknown) => {
      const snap = value as Counted;
      if (Array.isArray(snap?.docs)) {
        if (snap.docs.length === 0) add("(empty result)", 1);
        for (const d of snap.docs as Counted[]) add(d.ref?.parent?.path, 1);
      } else if (snap && typeof snap === "object" && "exists" in snap) add(snap.ref?.parent?.path, 1);
    };
    if (Array.isArray(result)) result.forEach(one);
    else one(result);
    if (Date.now() - lastServerFlush >= SERVER_FLUSH_EVERY_MS) void flushServerMeter(rawDb).catch((err) => console.error("read meter flush failed:", err instanceof Error ? err.message : "unknown error"));
  } catch {
    // counting is best effort and must never break the route
  }
}

const isRefOrQuery = (v: unknown): boolean => !!v && typeof v === "object" && !(v instanceof Promise) && ("firestore" in (v as object) || typeof (v as { where?: unknown }).where === "function") && !("exists" in (v as object)) && !("docs" in (v as object));

function wrap<T extends object>(target: T, route: string, rawDb: Firestore): T {
  return new Proxy(target, {
    get(t, prop) {
      const value = Reflect.get(t, prop, t);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        if (prop === "runTransaction") {
          const [fn, ...rest] = args as [(tx: object) => unknown, ...unknown[]];
          return (value as (...a: unknown[]) => unknown).call(t, (tx: object) => fn(wrap(tx, route, rawDb)), ...rest);
        }
        const out = (value as (...a: unknown[]) => unknown).apply(t, args);
        if ((prop === "get" || prop === "getAll") && out instanceof Promise) {
          return out.then((result) => {
            countResult(route, result, rawDb);
            return result;
          });
        }
        return isRefOrQuery(out) ? wrap(out as object, route, rawDb) : out;
      };
    },
  });
}

/**
 * The database for one instrumented route. While the meter is OFF (the default; the answer is the last one the shared appSettings snapshot gave this instance, so
 * asking costs nothing) the real database is returned and nothing is counted. ON, reads through the returned database are counted under `route`.
 */
export function meterDb<T extends Firestore>(db: T, route: string): T;
export function meterDb<T extends Firestore>(db: T | null, route: string): T | null;
export function meterDb<T extends Firestore>(db: T | null, route: string): T | null {
  return db && isReadMeterOnSync() ? wrap(db, route, db) : db;
}

const increments = (counts: Counts): Record<string, Record<string, FieldValue>> => {
  const out: Record<string, Record<string, FieldValue>> = {};
  for (const [page, byCollection] of Object.entries(counts)) {
    out[page] = {};
    for (const [collection, n] of Object.entries(byCollection)) out[page][collection] = FieldValue.increment(n);
  }
  return out;
};

/** Add the browser counts of one flush to today's document (Pacific day). One write. */
export async function applyClientFlush(db: Firestore, counts: Counts, at: Date = new Date()): Promise<{ docs: number }> {
  const docs = totalOf(counts);
  if (docs <= 0) return { docs: 0 };
  await db.doc(`${READ_METER_COLLECTION}/${pacificDayKey(at)}`).set({ day: pacificDayKey(at), total: FieldValue.increment(docs), updatedAt: at.getTime(), client: { total: FieldValue.increment(docs), pages: increments(counts) } }, { merge: true });
  return { docs };
}

/** Add what the instrumented routes counted since the last flush to today's document. At most one write per minute per server instance. */
export async function flushServerMeter(db: Firestore, at: Date = new Date()): Promise<void> {
  const counts = serverPending;
  const docs = totalOf(counts);
  lastServerFlush = at.getTime();
  if (docs <= 0) return;
  serverPending = {};
  try {
    await db.doc(`${READ_METER_COLLECTION}/${pacificDayKey(at)}`).set({ day: pacificDayKey(at), total: FieldValue.increment(docs), updatedAt: at.getTime(), server: { total: FieldValue.increment(docs), routes: increments(counts) } }, { merge: true });
  } catch (err) {
    console.error("read meter server flush dropped:", err instanceof Error ? err.message : "unknown error"); // log and drop: the meter never breaks the app
  }
}

/** Today and the last 14 days, newest first: ONE getAll of 15 documents (15 reads at most). */
export async function readUsageDays(db: Firestore, at: Date = new Date()): Promise<{ day: string; data: DayDoc | null }[]> {
  const days = recentDayKeys(at, 15);
  const snaps = await db.getAll(...days.map((day) => db.doc(`${READ_METER_COLLECTION}/${day}`)));
  return snaps.map((snap, i) => ({ day: days[i], data: snap.exists ? (snap.data() as DayDoc) : null }));
}

/** Test hook. */
export function resetServerMeterForTests(): void {
  serverPending = {};
  lastServerFlush = 0;
}
export const pendingServerCountsForTests = (): Counts => serverPending;
