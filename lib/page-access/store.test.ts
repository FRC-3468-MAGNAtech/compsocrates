import { beforeEach, describe, expect, it, vi } from "vitest";

// The page-access save path against a mocked Firestore: each edit is a transaction on the LATEST stored doc, with one audit entry. No emulator, no network.
type Ref = { path: string };
const h = vi.hoisted(() => {
  const state = { stored: undefined as Record<string, unknown> | undefined, fail: null as unknown, version: 0 };
  const sets: { path: string; data: Record<string, unknown> }[] = [];
  let auto = 0;
  return {
    state,
    sets,
    doc: vi.fn((a: unknown, ...segs: string[]) => {
      if (a && typeof a === "object" && "path" in a && segs.length === 0) return { path: `${(a as { path: string }).path}/auto${++auto}` };
      return { path: (a && typeof a === "object" && "path" in a ? [(a as { path: string }).path, ...segs] : segs).join("/") };
    }),
    collection: vi.fn((_db: unknown, ...segs: string[]) => ({ path: segs.join("/") })),
    serverTimestamp: vi.fn(() => "SERVER_TIME"),
    // Optimistic concurrency like Firestore's: if the doc changed between the transaction's read and its commit, the whole function runs again on the new doc.
    runTransaction: vi.fn(async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) => {
      if (state.fail) throw state.fail;
      for (;;) {
        const pending: { path: string; data: Record<string, unknown> }[] = [];
        const readAt = state.version;
        const result = await fn({
          get: async () => ({ exists: () => state.stored !== undefined, data: () => state.stored }),
          set: (ref: Ref, data: Record<string, unknown>) => pending.push({ path: ref.path, data }),
        });
        if (state.version !== readAt) continue;
        for (const w of pending) {
          sets.push(w);
          if (w.path.endsWith("/settings/pageAccess")) {
            state.stored = w.data;
            state.version++;
          }
        }
        return result;
      }
    }),
  };
});
vi.mock("firebase/firestore", () => ({ doc: h.doc, collection: h.collection, serverTimestamp: h.serverTimestamp, runTransaction: h.runTransaction, onSnapshot: vi.fn(), query: vi.fn(), setDoc: vi.fn(), where: vi.fn(), addDoc: vi.fn() }));
vi.mock("@/lib/firebase/client", () => ({ db: { fake: true }, isFirebaseConfigured: () => true }));
vi.mock("@/lib/program/context", () => ({ useProgram: () => "frc" }));
vi.mock("@/lib/program/data", () => ({ useProgramData: () => null, programData: () => null }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: null, profile: null }) }));

import { describeSaveFailure, isPermissionDenied, pageAccessDocData, updatePageAccess } from "@/lib/page-access/store";
import { defaultPageAccessConfig, setMemberPageState, setOpenRestriction, setRoleGrant } from "@/lib/page-access/access";

const actor = { teamId: "T1", uid: "admin1", name: "Ada Admin" };
const settingsWrites = () => h.sets.filter((w) => w.path.endsWith("/settings/pageAccess"));
const auditWrites = () => h.sets.filter((w) => !w.path.endsWith("/settings/pageAccess"));

beforeEach(() => {
  h.state.stored = undefined;
  h.state.fail = null;
  h.sets.length = 0;
});

describe("pageAccessDocData", () => {
  it("writes the field ONLY when something is restricted (so a save that doesn't use it passes the old rules too), and always cleaned", () => {
    expect("openRestrictions" in pageAccessDocData(defaultPageAccessConfig(), "u")).toBe(false);
    const withField = pageAccessDocData(setOpenRestriction(defaultPageAccessConfig(), "media", "match-list", true), "u");
    expect(withField.openRestrictions).toEqual({ media: ["match-list"] });
    const dirty = pageAccessDocData({ ...defaultPageAccessConfig(), openRestrictions: { media: ["match-list", "dashboard", "admin-panel"], admin: ["x"] } as never }, "u");
    expect((dirty as { openRestrictions: unknown }).openRestrictions).toEqual({ media: ["match-list"] });
  });
  it("keeps the exact set of keys the rules allow", () => {
    expect(Object.keys(pageAccessDocData(defaultPageAccessConfig(), "u")).sort()).toEqual(["memberOverrides", "pageRoles", "roleGrants", "updatedAt", "updatedBy"]);
  });
});

describe("updatePageAccess", () => {
  it("writes the minimal change plus one audit entry with before and after", async () => {
    const wrote = await updatePageAccess(actor, (c) => setMemberPageState(c, "m1", "assignments", "grant"), { kind: "member", targetUid: "m1", pageId: "assignments", state: "grant" });
    expect(wrote).toBe(true);
    expect(settingsWrites()).toHaveLength(1);
    expect((settingsWrites()[0].data.memberOverrides as Record<string, unknown>).m1).toEqual({ grant: ["assignments"], deny: [] });
    expect(auditWrites()).toHaveLength(1);
    expect(auditWrites()[0].path.startsWith("auditLog")).toBe(true);
    expect(auditWrites()[0].data).toMatchObject({ action: "edit-page-access", teamId: "T1", uid: "admin1", actorName: "Ada Admin", target: { kind: "member", pageId: "assignments" } });
    expect((auditWrites()[0].data.before as { memberOverrides: unknown }).memberOverrides).toEqual({});
    expect((auditWrites()[0].data.after as { memberOverrides: Record<string, unknown> }).memberOverrides.m1).toEqual({ grant: ["assignments"], deny: [] });
  });
  it("two admins editing at once compose: the second applies to the doc the first wrote, nothing is overwritten", async () => {
    await Promise.all([
      updatePageAccess(actor, (c) => setMemberPageState(c, "m1", "assignments", "grant"), { kind: "member" }),
      updatePageAccess({ ...actor, uid: "admin2" }, (c) => setOpenRestriction(c, "media", "match-list", true), { kind: "open-restriction" }),
      updatePageAccess(actor, (c) => setRoleGrant(c, "pit-team", "assignments", true), { kind: "role" }),
    ]);
    const final = h.state.stored as { memberOverrides: Record<string, unknown>; openRestrictions: unknown; roleGrants: Record<string, string[]> };
    expect(final.memberOverrides.m1).toEqual({ grant: ["assignments"], deny: [] });
    expect(final.openRestrictions).toEqual({ media: ["match-list"] });
    expect(final.roleGrants["pit-team"]).toContain("assignments");
  });
  it("writes nothing (no doc, no audit) when the edit changes nothing, e.g. restricting an always-on page", async () => {
    expect(await updatePageAccess(actor, (c) => setOpenRestriction(c, "media", "dashboard", true), { kind: "open-restriction" })).toBe(false);
    expect(h.sets).toHaveLength(0);
  });
  it("a namespaced program writes to its own prefix, including the audit log", async () => {
    await updatePageAccess(actor, (c) => setOpenRestriction(c, "media", "match-list", true), { kind: "open-restriction" }, "ftc");
    expect(settingsWrites()[0].path).toBe("programs/ftc/teams/T1/settings/pageAccess");
    expect(auditWrites()[0].path.startsWith("programs/ftc/auditLog")).toBe(true);
  });
  it("preserves an existing restriction when another kind of edit is saved", async () => {
    h.state.stored = { roleGrants: {}, memberOverrides: {}, openRestrictions: { media: ["match-list"] } };
    await updatePageAccess(actor, (c) => setMemberPageState(c, "m1", "assignments", "grant"), { kind: "member" });
    expect((h.state.stored as { openRestrictions: unknown }).openRestrictions).toEqual({ media: ["match-list"] });
  });
});

describe("a rejected save is never silent", () => {
  it("rejects the promise on permission-denied, and the message names the rules for a restriction", async () => {
    h.state.fail = Object.assign(new Error("denied"), { code: "permission-denied" });
    await expect(updatePageAccess(actor, (c) => setOpenRestriction(c, "media", "match-list", true), { kind: "open-restriction" })).rejects.toMatchObject({ code: "permission-denied" });
    expect(isPermissionDenied(h.state.fail)).toBe(true);
    expect(describeSaveFailure("open-restriction", h.state.fail)).toMatch(/rules .* deployed/);
    expect(describeSaveFailure("role", h.state.fail)).toMatch(/offline, or no longer allowed/);
    expect(describeSaveFailure("open-restriction", new Error("network"))).toMatch(/offline/);
  });
});
