/**
 * The three doors the account deletion job uses (memberships build 4). The job is written against these, never against the Admin SDK directly, so the tests can
 * hand it an in-memory store, an auth stand-in and a blob stand-in with failures injected at any step, and so the budget accounting has one place to look.
 * Nothing here is server-only: `admin-adapters.ts` is the one file that touches the SDK.
 */
export type Data = Record<string, unknown>;
export type StoredDoc = { path: string; id: string; data: Data; updateTime?: string };

export type Where = { field: string; op: "==" | "array-contains"; value: unknown };

/** A query over ONE collection path (never a collection group). `idPrefix` is a document-id range; no `where` and no prefix lists the collection. */
export type StoreQuery = { path: string; where?: readonly Where[]; idPrefix?: string; limit: number };

export type StoreOp =
  | { kind: "set"; path: string; data: Data }
  | { kind: "create"; path: string; data: Data }
  /** `data` holds whole top-level fields; `deleteFields` removes fields; `ifUnchangedSince` makes the write fail with code 9 when the document changed since it was read. */
  | { kind: "update"; path: string; data: Data; deleteFields?: readonly string[]; ifUnchangedSince?: string }
  | { kind: "delete"; path: string };

export interface DeletionStore {
  query(q: StoreQuery): Promise<StoredDoc[]>;
  get(path: string): Promise<StoredDoc | null>;
  /** Applies the writes atomically (at most 400). */
  commit(ops: readonly StoreOp[]): Promise<void>;
}

export type AuthRecord = { uid: string; email: string | null; emailVerified: boolean; displayName: string | null; platformOwnerClaim: boolean; disabled: boolean };

export interface AuthPort {
  /** Null when the account does not exist (any more). */
  getUser(uid: string): Promise<AuthRecord | null>;
  disable(uid: string): Promise<void>;
  revokeTokens(uid: string): Promise<void>;
  /** A user that is already gone is a success. */
  deleteUser(uid: string): Promise<void>;
}

export interface BlobPort {
  /** Every avatar blob of the person (the helper lists the prefix, so stray files go too). Returns how many were removed. */
  deleteAvatars(uid: string): Promise<number>;
}

export type Deps = {
  store: DeletionStore;
  auth: AuthPort;
  blobs: BlobPort;
  now: () => number;
  /** 128 random bits as `deleted-<32 hex>`; never derived from the uid or any key. */
  newOpaqueId: () => string;
  /** The kill switch for memberships: while OFF the guards read the user document pointer only. */
  membershipsEnabled: () => Promise<boolean>;
  /** One line in the platform owner's own log. NEVER given a uid, a name or an email of the person being deleted. */
  audit: (action: "start-account-deletion" | "resume-account-deletion" | "stall-account-deletion" | "finish-account-deletion", actor: { uid: string; name: string }, details: Record<string, unknown>) => Promise<void>;
};

/** What one run may spend. */
export type RunBudget = { writes: number; reads: number };
