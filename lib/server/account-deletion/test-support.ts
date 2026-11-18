import type { AuthPort, AuthRecord, BlobPort, Data, DeletionStore, Deps, StoreOp, StoredDoc, StoreQuery } from "./ports";

/**
 * In-memory stand-ins for the deletion job's three doors (tests only). The store is faithful where the job depends on it: equality and array-contains on dotted
 * fields, a document-id range, atomic commits, `create` that fails on an existing document, `update` that fails on a missing one, a precondition that fails when the
 * document changed since it was read. Failures can be injected on any commit, query or auth call.
 */
const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
const getAt = (data: Data, path: string): unknown => {
  let cur: unknown = data;
  for (const seg of path.split(".")) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Data)[seg];
  }
  return cur;
};
const parentOf = (path: string) => path.slice(0, path.lastIndexOf("/"));
const idOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

export class FakeStore implements DeletionStore {
  readonly docs = new Map<string, { data: Data; version: number }>();
  reads = 0;
  writes = 0;
  /** Every commit as `kind path` lines. */
  readonly commits: string[][] = [];
  private failures: { when: (ops: readonly StoreOp[]) => boolean; error: Error; times: number }[] = [];
  private queryFailures: { when: (q: StoreQuery) => boolean; error: Error; times: number }[] = [];
  private version = 1;

  seed(path: string, data: Data): this {
    this.docs.set(path, { data: clone(data), version: this.version++ });
    return this;
  }
  read(path: string): Data | undefined {
    const d = this.docs.get(path);
    return d ? clone(d.data) : undefined;
  }
  has(path: string): boolean {
    return this.docs.has(path);
  }
  ids(collection: string): string[] {
    return [...this.docs.keys()].filter((k) => parentOf(k) === collection).map(idOf);
  }
  /** Everything stored, as one string (to look for a leftover uid, name or email). */
  dump(): string {
    return JSON.stringify([...this.docs.entries()]);
  }
  failCommit(when: (ops: readonly StoreOp[]) => boolean, error: Error = new Error("injected commit failure"), times = 1): this {
    this.failures.push({ when, error, times });
    return this;
  }
  failQuery(when: (q: StoreQuery) => boolean, error: Error = new Error("injected query failure"), times = 1): this {
    this.queryFailures.push({ when, error, times });
    return this;
  }

  private doc(path: string): StoredDoc {
    const d = this.docs.get(path) as { data: Data; version: number };
    return { path, id: idOf(path), data: clone(d.data), updateTime: String(d.version) };
  }

  async query(q: StoreQuery): Promise<StoredDoc[]> {
    const i = this.queryFailures.findIndex((f) => f.when(q));
    if (i !== -1) {
      const f = this.queryFailures[i];
      if (--f.times <= 0) this.queryFailures.splice(i, 1);
      throw f.error;
    }
    const out = [...this.docs.keys()]
      .filter((p) => parentOf(p) === q.path)
      .filter((p) => q.idPrefix === undefined || (idOf(p) >= q.idPrefix && idOf(p) < `${q.idPrefix}`))
      .filter((p) =>
        (q.where ?? []).every((w) => {
          const v = getAt((this.docs.get(p) as { data: Data }).data, w.field);
          return w.op === "==" ? v === w.value : Array.isArray(v) && v.includes(w.value);
        }),
      )
      .sort()
      .slice(0, q.limit)
      .map((p) => this.doc(p));
    this.reads += Math.max(1, out.length);
    return out;
  }

  async get(path: string): Promise<StoredDoc | null> {
    this.reads += 1;
    return this.docs.has(path) ? this.doc(path) : null;
  }

  async commit(ops: readonly StoreOp[]): Promise<void> {
    if (ops.length > 400) throw new Error("a batch holds at most 400 writes");
    const i = this.failures.findIndex((f) => f.when(ops));
    if (i !== -1) {
      const f = this.failures[i];
      if (--f.times <= 0) this.failures.splice(i, 1);
      throw f.error;
    }
    const before = new Map([...this.docs.entries()].map(([k, v]) => [k, { data: clone(v.data), version: v.version }]));
    try {
      for (const op of ops) {
        const cur = this.docs.get(op.path);
        if (op.kind === "create") {
          if (cur) throw Object.assign(new Error(`ALREADY_EXISTS ${op.path}`), { code: 6 });
          this.docs.set(op.path, { data: clone(op.data), version: this.version++ });
        } else if (op.kind === "set") {
          this.docs.set(op.path, { data: clone(op.data), version: this.version++ });
        } else if (op.kind === "update") {
          if (!cur) throw Object.assign(new Error(`NOT_FOUND ${op.path}`), { code: 5 });
          if (op.ifUnchangedSince !== undefined && String(cur.version) !== op.ifUnchangedSince) throw Object.assign(new Error(`FAILED_PRECONDITION ${op.path}`), { code: 9 });
          const next = { ...cur.data, ...clone(op.data) };
          for (const f of op.deleteFields ?? []) delete next[f];
          this.docs.set(op.path, { data: next, version: this.version++ });
        } else {
          this.docs.delete(op.path);
        }
      }
    } catch (err) {
      this.docs.clear();
      for (const [k, v] of before) this.docs.set(k, v);
      throw err;
    }
    this.writes += ops.length;
    this.commits.push(ops.map((o) => `${o.kind} ${o.path}`));
  }
}

export type FakeUser = Partial<AuthRecord> & { uid: string };

export class FakeAuth implements AuthPort {
  readonly users = new Map<string, AuthRecord>();
  readonly calls: string[] = [];
  private failures: { call: string; error: Error; times: number }[] = [];
  addUser(u: FakeUser): this {
    this.users.set(u.uid, { email: null, emailVerified: true, displayName: null, platformOwnerClaim: false, disabled: false, ...u });
    return this;
  }
  fail(call: "getUser" | "disable" | "revokeTokens" | "deleteUser", error: Error = new Error(`injected ${call} failure`), times = 1): this {
    this.failures.push({ call, error, times });
    return this;
  }
  private enter(call: string): void {
    this.calls.push(call);
    const i = this.failures.findIndex((f) => f.call === call);
    if (i === -1) return;
    const f = this.failures[i];
    if (--f.times <= 0) this.failures.splice(i, 1);
    throw f.error;
  }
  async getUser(uid: string) {
    this.enter("getUser");
    const u = this.users.get(uid);
    return u ? { ...u } : null;
  }
  async disable(uid: string) {
    this.enter("disable");
    const u = this.users.get(uid);
    if (u) u.disabled = true;
  }
  async revokeTokens() {
    this.enter("revokeTokens");
  }
  async deleteUser(uid: string) {
    this.enter("deleteUser");
    this.users.delete(uid);
  }
}

export class FakeBlobs implements BlobPort {
  removed: string[] = [];
  failTimes = 0;
  async deleteAvatars(uid: string) {
    if (this.failTimes > 0) {
      this.failTimes -= 1;
      throw new Error("injected blob failure");
    }
    this.removed.push(uid);
    return 1;
  }
}

export type AuditCall = { action: string; actor: { uid: string; name: string }; details: Record<string, unknown> };

export function makeDeps(parts: { store: FakeStore; auth: FakeAuth; blobs?: FakeBlobs; nowMs?: () => number; memberships?: boolean }): Deps & { blobs: FakeBlobs; audits: AuditCall[] } {
  const audits: AuditCall[] = [];
  let n = 0;
  const blobs = parts.blobs ?? new FakeBlobs();
  return {
    store: parts.store,
    auth: parts.auth,
    blobs,
    now: parts.nowMs ?? (() => 1_700_000_000_000),
    newOpaqueId: () => `deleted-${(0x1000 + n++).toString(16).padStart(32, "0")}`,
    membershipsEnabled: async () => parts.memberships ?? true,
    audit: async (action, actor, details) => void audits.push({ action, actor, details }),
    audits,
  };
}
