import { FieldPath, type Firestore } from "firebase-admin/firestore";

// The ONLY way the export talks to Firestore: this small read-only interface. The real implementation also wraps the Firestore object so that any
// method outside the read list throws before anything is sent.

export type DocRow = { path: string; id: string; data: Record<string, unknown> };

export interface ReadDb {
  /** One page of a collection, ordered by document name, after `startAfter` (a document id) when given. */
  getPage(collectionPath: string, opts: { limit: number; startAfter?: string }): Promise<DocRow[]>;
  count(collectionPath: string): Promise<number>;
  countGroup(collectionId: string): Promise<number>;
  /** Collection ids under a document path, or at the root when `docPath` is null. */
  listCollections(docPath: string | null): Promise<string[]>;
}

const ALLOWED = new Set(["collection", "collectionGroup", "doc", "orderBy", "limit", "startAfter", "get", "count", "listCollections"]);

/** Wraps a Firestore object (and every ref or query it returns) so only the read methods above can be called. */
export function guardReadOnly<T extends object>(target: T): T {
  return new Proxy(target, {
    get(obj, prop) {
      const value = Reflect.get(obj, prop);
      if (typeof value !== "function") return value;
      const name = String(prop);
      if (!ALLOWED.has(name)) {
        return () => {
          throw new Error(`The export is read-only: "${name}" is not allowed.`);
        };
      }
      return (...args: unknown[]) => {
        const result = (value as (...a: unknown[]) => unknown).apply(obj, args);
        if (result && typeof result === "object" && !("then" in result) && !Array.isArray(result)) return guardReadOnly(result as object);
        return result;
      };
    },
  });
}

export function makeReadDb(firestore: Firestore): ReadDb {
  const fs = guardReadOnly(firestore);
  return {
    async getPage(collectionPath, { limit, startAfter }) {
      let q = fs.collection(collectionPath).orderBy(FieldPath.documentId()).limit(limit);
      if (startAfter) q = q.startAfter(startAfter);
      const snap = await q.get();
      return snap.docs.map((d) => ({ path: d.ref.path, id: d.id, data: d.data() as Record<string, unknown> }));
    },
    async count(collectionPath) {
      const snap = await fs.collection(collectionPath).count().get();
      return snap.data().count;
    },
    async countGroup(collectionId) {
      const snap = await fs.collectionGroup(collectionId).count().get();
      return snap.data().count;
    },
    async listCollections(docPath) {
      const refs = docPath ? await fs.doc(docPath).listCollections() : await fs.listCollections();
      return refs.map((r) => r.id);
    },
  };
}
