import { FieldValue } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { FakeFirestore } from "./fake-firestore";

// The fake's transaction model (memberships build 1): atomic commit, rollback, failure injection, FieldValue.delete() in update.

const seeded = () => new FakeFirestore().seed("a/1", { n: 1, keep: true }).seed("b/1", { n: 1 });

describe("FakeFirestore transactions are atomic", () => {
  it("applies every write together when the callback returns", async () => {
    const f = seeded();
    const db = f.asFirestore();
    await db.runTransaction(async (txn) => {
      await txn.get(db.doc("a/1"));
      txn.update(db.doc("a/1"), { n: 2 });
      txn.set(db.doc("b/1"), { n: 2 });
      txn.create(db.doc("c/1"), { n: 2 });
    });
    expect(f.read("a/1")).toEqual({ n: 2, keep: true });
    expect(f.read("b/1")).toEqual({ n: 2 });
    expect(f.read("c/1")).toEqual({ n: 2 });
  });

  it("applies nothing when the callback throws", async () => {
    const f = seeded();
    const db = f.asFirestore();
    await expect(
      db.runTransaction(async (txn) => {
        txn.update(db.doc("a/1"), { n: 99 });
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(f.read("a/1")).toEqual({ n: 1, keep: true });
  });

  it("rolls back every write when a commit fails after the first one (injected)", async () => {
    const f = seeded();
    f.injectCommitFailure({ afterWrites: 1, error: Object.assign(new Error("8 RESOURCE_EXHAUSTED"), { code: 8 }) });
    const db = f.asFirestore();
    await expect(
      db.runTransaction(async (txn) => {
        txn.update(db.doc("a/1"), { n: 2 });
        txn.update(db.doc("b/1"), { n: 2 });
      })
    ).rejects.toMatchObject({ code: 8 });
    expect(f.read("a/1")).toEqual({ n: 1, keep: true });
    expect(f.read("b/1")).toEqual({ n: 1 });
    // The failure was one-shot: the same transaction now succeeds.
    await db.runTransaction(async (txn) => {
      txn.update(db.doc("a/1"), { n: 2 });
    });
    expect(f.read("a/1")).toEqual({ n: 2, keep: true });
  });

  it("can target a commit by the paths it writes", async () => {
    const f = seeded();
    f.injectCommitFailure({ when: (paths) => paths.includes("b/1") });
    const db = f.asFirestore();
    await db.runTransaction(async (txn) => void txn.update(db.doc("a/1"), { n: 2 })); // not targeted
    await expect(db.runTransaction(async (txn) => void txn.update(db.doc("b/1"), { n: 2 }))).rejects.toThrow("injected");
    expect(f.read("a/1")).toEqual({ n: 2, keep: true });
    expect(f.read("b/1")).toEqual({ n: 1 });
  });

  it("a create over an existing document fails the whole commit with ALREADY_EXISTS", async () => {
    const f = seeded();
    const db = f.asFirestore();
    await expect(
      db.runTransaction(async (txn) => {
        txn.update(db.doc("a/1"), { n: 2 });
        txn.create(db.doc("b/1"), { n: 5 });
      })
    ).rejects.toMatchObject({ code: 6 });
    expect(f.read("a/1")).toEqual({ n: 1, keep: true });
  });

  it("refuses a read after a write, like the Admin SDK", async () => {
    const f = seeded();
    const db = f.asFirestore();
    await expect(
      db.runTransaction(async (txn) => {
        txn.update(db.doc("a/1"), { n: 2 });
        await txn.get(db.doc("b/1"));
      })
    ).rejects.toThrow("reads to be executed before all writes");
  });
});

describe("FakeFirestore update with FieldValue.delete()", () => {
  it("removes the field and keeps the rest", async () => {
    const f = seeded();
    await f.asFirestore().doc("a/1").update({ keep: FieldValue.delete(), n: 3 });
    expect(f.read("a/1")).toEqual({ n: 3 });
  });
  it("removes a field inside a transaction update, and deleting an absent field is fine", async () => {
    const f = seeded();
    const db = f.asFirestore();
    await db.runTransaction(async (txn) => void txn.update(db.doc("a/1"), { keep: FieldValue.delete(), nope: FieldValue.delete() }));
    expect(f.read("a/1")).toEqual({ n: 1 });
  });
});
