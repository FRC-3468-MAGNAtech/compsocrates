// An in-memory stand-in for the `firebase/firestore` functions the data layer reads with, plus the BILLING counters the query-count harness reports.
// Test-only. Billing model (Firestore's): a one-time read costs the documents it returns (at least 1); a listener costs every document of its first
// snapshot plus every document added, changed or removed-by-update afterwards. Writes made through `fake.write` notify the listeners.

type Data = Record<string, unknown>;
type Constraint = { kind: "where"; field: string; op: string; value: unknown } | { kind: "limit"; n: number } | { kind: "orderBy"; field: string; dir: string };
type Target = { kind: "collection"; path: string } | { kind: "group"; id: string } | { kind: "query"; base: Target; constraints: Constraint[] };
type DocRef = { kind: "doc"; path: string };
type Doc = { id: string; path: string; data: Data };

export type Billing = { total: number; byCollection: Record<string, number>; calls: { kind: string; target: string; docs: number }[] };

const store = new Map<string, Data>(); // full doc path -> data
let listeners: { id: number; target: Target; seen: Map<string, string>; next: (s: unknown) => void; error?: (e: unknown) => void; alive: boolean; first: boolean }[] = [];
let failure: { code: string } | null = null;
let seq = 0;
export const billing: Billing = { total: 0, byCollection: {}, calls: [] };

const parentOf = (path: string) => path.split("/").slice(0, -1).join("/");
const idOf = (path: string) => path.split("/").pop() as string;
/** `liveMatches/2026x_q1/scouts` -> `liveMatches/{id}/scouts` so subcollections group in the report. */
const shape = (collectionPath: string) => collectionPath.split("/").map((seg, i) => (i % 2 === 1 ? "{id}" : seg)).join("/");

function charge(kind: string, target: string, docs: Doc[] | number, collection?: string) {
  const n = typeof docs === "number" ? docs : docs.length;
  const billed = Math.max(n, 1);
  billing.total += billed;
  if (typeof docs === "number") {
    const key = collection ?? target;
    billing.byCollection[key] = (billing.byCollection[key] ?? 0) + billed;
  } else if (docs.length === 0) {
    const key = collection ?? target;
    billing.byCollection[key] = (billing.byCollection[key] ?? 0) + 1;
  } else {
    for (const d of docs) {
      const key = shape(parentOf(d.path));
      billing.byCollection[key] = (billing.byCollection[key] ?? 0) + 1;
    }
  }
  billing.calls.push({ kind, target, docs: billed });
}

export function resetFake(): void {
  store.clear();
  listeners = [];
  failure = null;
  billing.total = 0;
  billing.byCollection = {};
  billing.calls = [];
}
export function resetBilling(): void {
  billing.total = 0;
  billing.byCollection = {};
  billing.calls = [];
}
export function seed(path: string, data: Data): void {
  store.set(path, { ...data });
}
/** The next read (one-time or listener) fails with this Firestore error code. */
export function failNext(code: string): void {
  failure = { code };
}
export function failAllListeners(code: string): void {
  for (const l of listeners) if (l.alive) l.error?.(Object.assign(new Error(code), { code }));
}
export const activeListeners = () => listeners.filter((l) => l.alive).length;

const describe = (t: Target): string => (t.kind === "collection" ? t.path : t.kind === "group" ? `group:${t.id}` : `${describe(t.base)} [${t.constraints.map((c) => (c.kind === "where" ? `${c.field} ${c.op} ${JSON.stringify(c.value)}` : c.kind)).join(", ")}]`);

function baseDocs(t: Target): Doc[] {
  if (t.kind === "query") return baseDocs(t.base);
  const out: Doc[] = [];
  for (const [path, data] of store) {
    if (t.kind === "collection" ? parentOf(path) === t.path : parentOf(path).split("/").slice(-1)[0] === t.id && parentOf(path).split("/").length % 2 === 1) out.push({ id: idOf(path), path, data });
  }
  return out;
}

function matches(data: Data, c: Constraint): boolean {
  if (c.kind !== "where") return true;
  const v = data[c.field];
  if (c.op === "==") return v !== undefined && v === c.value;
  if (c.op === "!=") return v !== undefined && v !== c.value;
  if (c.op === "in") {
    const list = c.value as unknown[];
    if (list.length > 30) throw new Error("fake firestore: `in` takes at most 30 values");
    return v !== undefined && list.includes(v);
  }
  if (c.op === "array-contains") return Array.isArray(v) && v.includes(c.value);
  if (c.op === ">=") return v !== undefined && (v as number) >= (c.value as number);
  if (c.op === "<") return v !== undefined && (v as number) < (c.value as number);
  throw new Error(`fake firestore: unsupported operator ${c.op}`);
}

function run(t: Target): Doc[] {
  let docs = baseDocs(t);
  if (t.kind === "query") {
    for (const c of t.constraints) docs = docs.filter((d) => matches(d.data, c));
    const order = t.constraints.find((c) => c.kind === "orderBy") as { field: string; dir: string } | undefined;
    if (order) docs = [...docs].sort((a, b) => (((a.data[order.field] as number) ?? 0) - ((b.data[order.field] as number) ?? 0)) * (order.dir === "desc" ? -1 : 1));
    const limit = t.constraints.find((c) => c.kind === "limit") as { n: number } | undefined;
    if (limit) docs = docs.slice(0, limit.n);
  }
  return docs.sort((a, b) => a.path.localeCompare(b.path));
}

const refOf = (d: Doc) => {
  const parentPath = parentOf(d.path);
  const grand = parentOf(parentPath);
  return { id: d.id, path: d.path, parent: { id: idOf(parentPath), path: parentPath, parent: grand ? { id: idOf(grand), path: grand } : null } };
};
const snapDoc = (d: Doc, fromCache = false) => ({ id: d.id, ref: refOf(d), exists: () => true, data: () => ({ ...d.data }), metadata: { hasPendingWrites: false, fromCache } });
const snapshot = (docs: Doc[], changes: Doc[]) => ({
  docs: docs.map((d) => snapDoc(d)),
  size: docs.length,
  empty: docs.length === 0,
  metadata: { fromCache: false, hasPendingWrites: false },
  docChanges: () => changes.map((d) => ({ type: "added", doc: snapDoc(d) })),
  forEach(cb: (d: ReturnType<typeof snapDoc>) => void) {
    docs.forEach((d) => cb(snapDoc(d)));
  },
});

// ---- the module surface (what `vi.mock("firebase/firestore", () => fakeFirestoreModule)` serves) ----
function takeFailure(): { code: string } | null {
  const f = failure;
  failure = null;
  return f;
}

export const fakeFirestoreModule = {
  collection: (base: unknown, ...segments: string[]): Target => ({ kind: "collection", path: [...(typeof base === "object" && base && "path" in base ? [(base as { path: string }).path] : []), ...segments].join("/") }),
  collectionGroup: (_db: unknown, id: string): Target => ({ kind: "group", id }),
  doc: (base: unknown, ...segments: string[]): DocRef => ({ kind: "doc", path: [...(typeof base === "object" && base && "path" in base ? [(base as { path: string }).path] : []), ...segments].join("/") }),
  where: (field: string, op: string, value: unknown): Constraint => ({ kind: "where", field, op, value }),
  limit: (n: number): Constraint => ({ kind: "limit", n }),
  orderBy: (field: string, dir = "asc"): Constraint => ({ kind: "orderBy", field, dir }),
  query: (base: Target, ...constraints: Constraint[]): Target => ({ kind: "query", base, constraints }),
  getDocs: async (t: Target) => {
    const f = takeFailure();
    if (f) throw Object.assign(new Error(f.code), { code: f.code });
    const docs = run(t);
    charge("getDocs", describe(t), docs, t.kind === "collection" ? t.path : undefined);
    return snapshot(docs, docs);
  },
  getDoc: async (r: DocRef) => {
    const f = takeFailure();
    if (f) throw Object.assign(new Error(f.code), { code: f.code });
    const data = store.get(r.path);
    charge("getDoc", r.path, 1, shape(parentOf(r.path)));
    return { id: idOf(r.path), exists: () => data !== undefined, data: () => (data ? { ...data } : undefined), ref: refOf({ id: idOf(r.path), path: r.path, data: data ?? {} }), metadata: { fromCache: false } };
  },
  onSnapshot: (t: Target | DocRef, ...rest: unknown[]) => {
    const fns = rest.filter((x) => typeof x === "function") as ((s: unknown) => void)[];
    const [next, error] = fns;
    const f = takeFailure();
    if (t.kind === "doc") {
      let seen = "";
      const listener = { id: (seq += 1), target: { kind: "collection", path: t.path } as Target, seen: new Map<string, string>(), next, error, alive: true, first: true };
      const push = () => {
        const data = store.get(t.path);
        const key = data ? JSON.stringify(data) : "";
        if (!listener.first && key === seen) return;
        charge("onSnapshot", t.path, listener.first || data ? 1 : 0, shape(parentOf(t.path)));
        listener.first = false;
        seen = key;
        next({ id: idOf(t.path), exists: () => data !== undefined, data: () => (data ? { ...data } : undefined), ref: refOf({ id: idOf(t.path), path: t.path, data: data ?? {} }), metadata: { fromCache: false, hasPendingWrites: false } });
      };
      listeners.push(listener);
      Object.assign(listener, { push });
      queueMicrotask(() => {
        if (!listener.alive) return;
        if (f) listener.error?.(Object.assign(new Error(f.code), { code: f.code }));
        else push();
      });
      return () => {
        listener.alive = false;
      };
    }
    const listener = { id: (seq += 1), target: t, seen: new Map<string, string>(), next, error, alive: true, first: true };
    const push = () => {
      const docs = run(t);
      const changed: Doc[] = [];
      const seenNow = new Map<string, string>();
      for (const d of docs) {
        const key = JSON.stringify(d.data);
        seenNow.set(d.path, key);
        if (listener.seen.get(d.path) !== key) changed.push(d);
      }
      if (!listener.first && changed.length === 0 && seenNow.size === listener.seen.size) return;
      if (listener.first || changed.length > 0) charge("onSnapshot", describe(t), changed.length === 0 ? 0 : listener.first ? docs : changed, t.kind === "collection" ? t.path : undefined);
      listener.seen = seenNow;
      listener.first = false;
      next(snapshot(docs, changed));
    };
    listeners.push(listener);
    Object.assign(listener, { push });
    queueMicrotask(() => {
      if (!listener.alive) return;
      if (f) listener.error?.(Object.assign(new Error(f.code), { code: f.code }));
      else push();
    });
    return () => {
      listener.alive = false;
    };
  },
  serverTimestamp: () => ({ __serverTimestamp: true }),
  Timestamp: { now: () => ({ toMillis: () => Date.now() }), fromMillis: (ms: number) => ({ toMillis: () => ms }) },
};

/** A write from "another device": stores the doc and pushes it to every live listener. */
export function write(path: string, data: Data): void {
  store.set(path, { ...data });
  notify();
}
export function remove(path: string): void {
  store.delete(path);
  notify();
}
function notify(): void {
  for (const l of [...listeners]) if (l.alive) (l as unknown as { push: () => void }).push();
}
