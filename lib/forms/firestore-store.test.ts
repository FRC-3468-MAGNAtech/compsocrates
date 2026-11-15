import { beforeEach, describe, expect, it, vi } from "vitest";

// The Firestore form store builds its paths from the program: the default program reads and writes the root `forms` collection exactly as before, and another
// program's own prefix is used for every read and write (forms, versions, the active-form pointer). firebase/firestore is mocked, so these tests only look at paths.
const calls = vi.hoisted(() => ({ doc: [] as unknown[][], collection: [] as unknown[][], updates: [] as { path: string; data: unknown }[], sets: [] as { path: string; data: unknown }[] }));

vi.mock("@/lib/firebase/client", () => ({ db: { __db: true } }));
vi.mock("firebase/firestore", () => {
  const pathOf = (parts: unknown[]) => parts.slice(1).join("/");
  return {
    doc: (...parts: unknown[]) => {
      calls.doc.push(parts);
      return { path: pathOf(parts) };
    },
    collection: (...parts: unknown[]) => {
      calls.collection.push(parts);
      return { path: pathOf(parts) };
    },
    where: (...args: unknown[]) => ({ where: args }),
    query: (ref: unknown, ...rest: unknown[]) => ({ ref, rest }),
    getDoc: async () => ({ exists: () => false, data: () => undefined, id: "x" }),
    getDocs: async () => ({ docs: [] }),
    onSnapshot: (q: unknown, next: (s: { docs: unknown[] }) => void) => {
      next({ docs: [] });
      return () => {};
    },
    updateDoc: async (ref: { path: string }, data: unknown) => {
      calls.updates.push({ path: ref.path, data });
    },
    runTransaction: async (_db: unknown, fn: (txn: unknown) => Promise<unknown>) =>
      fn({
        get: async () => ({ exists: () => false, data: () => undefined, id: "x" }),
        set: (ref: { path: string }, data: unknown) => {
          calls.sets.push({ path: ref.path, data });
        },
      }),
  };
});

import { createFirestoreFormStore, loadAllVersions, setActiveForm, subscribeFormDocs } from "@/lib/forms/firestore-store";
import { SAMPLE_FORM } from "@/lib/forms/test-fixtures";

const form = { ...SAMPLE_FORM, id: "my-form", name: "My form" };

beforeEach(() => {
  calls.doc.length = 0;
  calls.collection.length = 0;
  calls.updates.length = 0;
  calls.sets.length = 0;
});

describe("setActiveForm", () => {
  it("writes the root team doc for the default program", async () => {
    await setActiveForm("T1", "rebuilt", "my-form");
    expect(calls.updates).toEqual([{ path: "teams/T1", data: { "activeForms.rebuilt": "my-form" } }]);
  });
  it("writes the program's team doc for another program, and still refuses a bad id", async () => {
    await setActiveForm("T1", "biobuzz", "my-form", "ftc");
    expect(calls.updates).toEqual([{ path: "programs/ftc/teams/T1", data: { "activeForms.biobuzz": "my-form" } }]);
    await expect(setActiveForm("T1", "bad season!", "x", "ftc")).rejects.toThrow();
    expect(calls.updates).toHaveLength(1);
  });
});

describe("the form store", () => {
  it("default program: saves a draft under the root forms collection", async () => {
    await createFirestoreFormStore("T1", { uid: "u1" }).saveDraft(form);
    expect(calls.sets.map((s) => s.path)).toEqual(["forms/T1_my-form"]);
  });

  it("another program: saves a draft under that program's forms", async () => {
    await createFirestoreFormStore("T1", { uid: "u1" }, "ftc").saveDraft(form);
    expect(calls.sets.map((s) => s.path)).toEqual(["programs/ftc/forms/T1_my-form"]);
  });

  it("every read follows the program too (subscription and versions)", async () => {
    subscribeFormDocs("T1", () => {}, undefined, "ftc");
    await loadAllVersions("T1", "my-form", "ftc");
    expect(calls.collection.map((c) => c.slice(1).join("/"))).toEqual(["programs/ftc/forms", "programs/ftc/forms/T1_my-form/versions"]);
    calls.collection.length = 0;
    subscribeFormDocs("T1", () => {});
    await loadAllVersions("T1", "my-form");
    expect(calls.collection.map((c) => c.slice(1).join("/"))).toEqual(["forms", "forms/T1_my-form/versions"]);
  });
});
