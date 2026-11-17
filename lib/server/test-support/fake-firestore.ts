/**
 * A tiny in-memory stand-in for the slice of the Admin SDK's Firestore the join/team routes use, for unit tests that must not
 * touch an emulator or the network. NOT a faithful emulator: it supports `collection().doc().get/set/update/delete`,
 * `collection().where(field, "==" | "array-contains", value).limit().get()`, `runTransaction` (reads then writes, applied
 * immediately), `batch()`, and `doc("a/b")`. Sentinels (`FieldValue.*`) are NOT supported, so code under test must write plain
 * values (the join-request flows do: epoch-ms times, like CS), with ONE exception: `FieldValue.delete()` is understood by `update` (it removes the field).
 *
 * Transactions are ATOMIC here, like the real thing: writes are buffered and applied together when the callback returns; a throw in the callback, or an
 * injected commit failure (`injectCommitFailure`), applies NOTHING. As in the Admin SDK, a read after a write in the same transaction throws.
 */
import { FieldValue, type Firestore } from "firebase-admin/firestore";

type Data = Record<string, unknown>;

function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

const DELETE_FIELD = FieldValue.delete();
const isDeleteField = (v: unknown): boolean => typeof v === "object" && v !== null && typeof (v as { isEqual?: unknown }).isEqual === "function" && (v as { isEqual: (o: unknown) => boolean }).isEqual(DELETE_FIELD);

function deepMergeData(base: Data, patch: Data): Data {
  const out: Data = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (isDeleteField(v)) {
      delete out[k];
      continue;
    }
    const existing = out[k];
    if (v && typeof v === "object" && !Array.isArray(v) && existing && typeof existing === "object" && !Array.isArray(existing)) out[k] = deepMergeData(existing as Data, v as Data);
    else out[k] = clone(v);
  }
  return out;
}

export type CommitFailure = {
  /** Fail only a commit whose written paths satisfy this (default: any commit). */
  when?: (writtenPaths: string[]) => boolean;
  /** Apply this many of the commit's writes before failing (default 0). Nothing is kept either way: the commit is atomic. */
  afterWrites?: number;
  error?: Error;
  /** How many matching commits fail (default 1). */
  times?: number;
};

type TxnWrite = { kind: "set" | "create" | "update" | "delete"; path: string; data?: Data; merge?: boolean };

export class FakeFirestore {
  readonly store = new Map<string, Data>();
  private commitFailures: CommitFailure[] = [];
  /** Every transaction commit that was applied, as the list of "kind path" writes (for tests that count writes). */
  readonly commits: string[][] = [];

  /** Test hook: make a transaction commit fail (see `CommitFailure`). Failures are consumed in the order added. */
  injectCommitFailure(failure: CommitFailure = {}): this {
    this.commitFailures.push({ ...failure });
    return this;
  }

  private async applyTxnWrites(writes: TxnWrite[]): Promise<void> {
    const paths = writes.map((w) => w.path);
    const idx = this.commitFailures.findIndex((f) => !f.when || f.when(paths));
    const failure = idx === -1 ? null : { ...this.commitFailures[idx] };
    if (idx !== -1) {
      const left = (this.commitFailures[idx].times ?? 1) - 1;
      if (left <= 0) this.commitFailures.splice(idx, 1);
      else this.commitFailures[idx].times = left;
    }
    // Writes go through `docRef` (so a test that wraps it still sees them); the store is restored if any of them fails, which makes the commit atomic.
    const before = new Map<string, Data>(this.store);
    try {
      for (const [i, w] of writes.entries()) {
        if (failure && i === (failure.afterWrites ?? 0)) throw failure.error ?? new Error("injected commit failure");
        const ref = this.docRef(w.path);
        if (w.kind === "create") await ref.create(w.data as Data);
        else if (w.kind === "update") await ref.update(w.data as Data);
        else if (w.kind === "set") await ref.set(w.data as Data, { merge: w.merge });
        else await ref.delete();
      }
      if (failure && (failure.afterWrites ?? 0) >= writes.length) throw failure.error ?? new Error("injected commit failure");
    } catch (err) {
      this.store.clear();
      for (const [k, v] of before) this.store.set(k, v);
      throw err;
    }
    this.commits.push(writes.map((w) => `${w.kind} ${w.path}`));
  }

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
      create: async (data: Data) => {
        if (this.store.has(path)) throw Object.assign(new Error(`ALREADY_EXISTS: ${path}`), { code: 6 });
        this.store.set(path, clone(data));
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

  private autoId = 0;

  collection(name: string) {
    return {
      // One counter for the whole fake, so two auto ids never collide (even within the same millisecond or across collections).
      doc: (id?: string) => this.docRef(`${name}/${id ?? `auto${Date.now()}_${this.autoId++}`}`),
      where: (field: string, op: string, value: unknown) => this.query(name, [{ field, op, value }], null),
      limit: (n: number) => this.query(name, [], n),
      get: async () => this.query(name, [], null).get(),
    };
  }

  doc(path: string) {
    return this.docRef(path);
  }

  async runTransaction<T>(fn: (txn: unknown) => Promise<T>): Promise<T> {
    const writes: TxnWrite[] = [];
    const noReadAfterWrite = () => {
      if (writes.length) throw new Error("Firestore transactions require all reads to be executed before all writes.");
    };
    const txn = {
      get: async (target: { get?: () => Promise<unknown>; __run?: () => unknown }) => {
        noReadAfterWrite();
        return target.__run ? target.__run() : (target.get as () => Promise<unknown>)();
      },
      set: (ref: { path: string }, data: Data, options?: { merge?: boolean }) => void writes.push({ kind: "set", path: ref.path, data, merge: options?.merge }),
      create: (ref: { path: string }, data: Data) => void writes.push({ kind: "create", path: ref.path, data }),
      update: (ref: { path: string }, data: Data) => void writes.push({ kind: "update", path: ref.path, data }),
      delete: (ref: { path: string }) => void writes.push({ kind: "delete", path: ref.path }),
    };
    const result = await fn(txn);
    await this.applyTxnWrites(writes);
    return result;
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
