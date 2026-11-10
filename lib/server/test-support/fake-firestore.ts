/**
 * A tiny in-memory stand-in for the slice of the Admin SDK's Firestore the join/team routes use, for unit tests that must not
 * touch an emulator or the network. NOT a faithful emulator: it supports `collection().doc().get/set/update/delete`,
 * `collection().where(field, "==" | "array-contains", value).limit().get()`, `runTransaction` (reads then writes, applied
 * immediately), `batch()`, and `doc("a/b")`. Sentinels (`FieldValue.*`) are NOT supported, so code under test must write plain
 * values (the join-request flows do: epoch-ms times, like CS).
 */
import type { Firestore } from "firebase-admin/firestore";

type Data = Record<string, unknown>;

function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

function deepMergeData(base: Data, patch: Data): Data {
  const out: Data = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const existing = out[k];
    if (v && typeof v === "object" && !Array.isArray(v) && existing && typeof existing === "object" && !Array.isArray(existing)) out[k] = deepMergeData(existing as Data, v as Data);
    else out[k] = clone(v);
  }
  return out;
}

export class FakeFirestore {
  readonly store = new Map<string, Data>();

  /** Seeds a document (`"users/u1"`). */
  seed(path: string, data: Data): this {
    this.store.set(path, clone(data));
    return this;
  }

  read(path: string): Data | undefined {
    const d = this.store.get(path);
    return d ? clone(d) : undefined;
  }

  ids(collection: string): string[] {
    return [...this.store.keys()].filter((k) => k.startsWith(`${collection}/`) && !k.slice(collection.length + 1).includes("/")).map((k) => k.slice(collection.length + 1));
  }

  private snap(path: string) {
    const data = this.store.get(path);
    const ref = this.docRef(path);
    return { id: path.split("/").pop() as string, exists: data !== undefined, ref, data: () => (data ? clone(data) : undefined) };
  }

  docRef(path: string) {
    return {
      id: path.split("/").pop() as string,
      path,
      get: async () => this.snap(path),
      set: async (data: Data, options?: { merge?: boolean }) => {
        const current = this.store.get(path);
        this.store.set(path, options?.merge && current ? deepMergeData(current, data) : clone(data));
      },
      update: async (data: Data) => {
        const current = this.store.get(path);
        if (!current) throw new Error(`NOT_FOUND: ${path}`);
        this.store.set(path, deepMergeData(current, data));
      },
      delete: async () => {
        this.store.delete(path);
      },
    };
  }

  private query(collection: string, filters: { field: string; op: string; value: unknown }[], max: number | null) {
    const run = () => {
      let paths = this.ids(collection).map((id) => `${collection}/${id}`);
      paths = paths.filter((p) => {
        const data = this.store.get(p) as Data;
        return filters.every((f) => {
          const v = data[f.field];
          if (f.op === "==") return v === f.value;
          if (f.op === "array-contains") return Array.isArray(v) && v.includes(f.value);
          throw new Error(`unsupported op ${f.op}`);
        });
      });
      if (max !== null) paths = paths.slice(0, max);
      const docs = paths.map((p) => this.snap(p));
      return { docs, size: docs.length, empty: docs.length === 0 };
    };
    return {
      where: (field: string, op: string, value: unknown) => this.query(collection, [...filters, { field, op, value }], max),
      limit: (n: number) => this.query(collection, filters, n),
      get: async () => run(),
      __run: run,
    };
  }

  collection(name: string) {
    let auto = 0;
    return {
      doc: (id?: string) => this.docRef(`${name}/${id ?? `auto${Date.now()}_${auto++}`}`),
      where: (field: string, op: string, value: unknown) => this.query(name, [{ field, op, value }], null),
      limit: (n: number) => this.query(name, [], n),
      get: async () => this.query(name, [], null).get(),
    };
  }

  doc(path: string) {
    return this.docRef(path);
  }

  async runTransaction<T>(fn: (txn: unknown) => Promise<T>): Promise<T> {
    const txn = {
      get: async (target: { get?: () => Promise<unknown>; __run?: () => unknown }) => (target.__run ? target.__run() : (target.get as () => Promise<unknown>)()),
      set: (ref: { set: (d: Data, o?: { merge?: boolean }) => Promise<void> }, data: Data, options?: { merge?: boolean }) => void ref.set(data, options),
      update: (ref: { update: (d: Data) => Promise<void> }, data: Data) => void ref.update(data),
      delete: (ref: { delete: () => Promise<void> }) => void ref.delete(),
    };
    return fn(txn);
  }

  batch() {
    const ops: (() => Promise<void>)[] = [];
    return {
      set: (ref: { set: (d: Data, o?: { merge?: boolean }) => Promise<void> }, data: Data, options?: { merge?: boolean }) => void ops.push(() => ref.set(data, options)),
      update: (ref: { update: (d: Data) => Promise<void> }, data: Data) => void ops.push(() => ref.update(data)),
      delete: (ref: { delete: () => Promise<void> }) => void ops.push(() => ref.delete()),
      commit: async () => {
        for (const op of ops) await op();
      },
    };
  }

  /** The instance typed as the Admin SDK's `Firestore` (the fake implements only the slice documented above). */
  asFirestore(): Firestore {
    // The fake is structurally partial by design; a double cast is the honest way to hand it to code typed against Firestore.
    return this as unknown as Firestore;
  }
}
