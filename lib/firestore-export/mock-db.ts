import type { DocRow, ReadDb } from "./read-db";

// An in-memory stand-in for Firestore, for tests only. Collections are keyed by path; it records every call and the reads they would cost.

export type MockData = Record<string, { id: string; data: Record<string, unknown> }[]>;

export class MockDb implements ReadDb {
  calls: string[] = [];
  failures: Record<string, unknown[]> = {};
  constructor(public data: MockData) {}

  private fail(op: string) {
    const f = this.failures[op];
    if (f?.length) throw f.shift();
  }

  async getPage(collectionPath: string, { limit, startAfter }: { limit: number; startAfter?: string }): Promise<DocRow[]> {
    this.calls.push(`getPage ${collectionPath}`);
    this.fail("getPage");
    const all = [...(this.data[collectionPath] ?? [])].sort((a, b) => (a.id < b.id ? -1 : 1));
    const from = startAfter ? all.findIndex((d) => d.id > startAfter) : 0;
    const rest = from === -1 ? [] : all.slice(from);
    return rest.slice(0, limit).map((d) => ({ path: `${collectionPath}/${d.id}`, id: d.id, data: d.data }));
  }

  async count(collectionPath: string): Promise<number> {
    this.calls.push(`count ${collectionPath}`);
    this.fail("count");
    return (this.data[collectionPath] ?? []).length;
  }

  async countGroup(collectionId: string): Promise<number> {
    this.calls.push(`countGroup ${collectionId}`);
    return Object.entries(this.data).filter(([p]) => p.split("/").pop() === collectionId).reduce((n, [, docs]) => n + docs.length, 0);
  }

  async listCollections(docPath: string | null): Promise<string[]> {
    this.calls.push(`listCollections ${docPath ?? ""}`);
    this.fail("listCollections");
    const base = docPath ? `${docPath}/` : "";
    const ids = Object.keys(this.data)
      .filter((p) => p.startsWith(base))
      .map((p) => p.slice(base.length).split("/")[0]);
    return [...new Set(ids)];
  }

  get docReads(): number {
    return this.calls.filter((c) => c.startsWith("getPage")).length;
  }
}
