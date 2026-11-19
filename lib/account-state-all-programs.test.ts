// useAllProgramMemberships: NOTHING is read for the other program until `load` turns true (a page load costs no extra read); then one read per program, kept for the session,
// and read again after refreshAccountState() while load stays true. Firestore is a mock.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDocs: vi.fn() }));
vi.mock("react", async () => (await import("@/test-stubs/hook-runtime")).hookMock(await vi.importActual<typeof import("react")>("react")));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { uid: "u1" }, profile: null, loading: false }) }));
vi.mock("@/lib/program/context", () => ({ useProgram: () => "frc" }));
vi.mock("@/lib/firebase/client", () => ({ db: {} }));
vi.mock("@/lib/firestore-errors", () => ({ reportFirestoreError: () => {} }));
vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, path: string) => ({ path }),
  query: (c: { path: string }) => ({ path: c.path }),
  where: () => ({}),
  getDocs: mocks.getDocs,
}));

import * as rt from "@/test-stubs/hook-runtime";
import { refreshAccountState, resetAccountStateForTests, useAllProgramMemberships } from "@/lib/account-state";

const doc = (teamId: string) => ({ data: () => ({ uid: "u1", teamId, status: "active", teamNumber: "1", teamName: "X" }) });

beforeEach(() => {
  resetAccountStateForTests();
  mocks.getDocs.mockReset().mockImplementation(async (q: { path: string }) => ({ docs: q.path.startsWith("programs/ftc") ? [doc("F1")] : [doc("R1")] }));
});

describe("useAllProgramMemberships", () => {
  it("reads nothing while load is false, then one query per program (at most one read each per session)", async () => {
    let load = false;
    const h = rt.renderHook(() => useAllProgramMemberships(load));
    await rt.settle();
    expect(mocks.getDocs).not.toHaveBeenCalled();
    expect(h.result.current.ftc.status).toBe("idle");
    load = true;
    h.rerender();
    await rt.settle();
    expect(mocks.getDocs).toHaveBeenCalledTimes(2);
    expect(h.result.current.ftc).toMatchObject({ status: "ready", memberships: [{ teamId: "F1", teamNumber: "1" }] });
    expect(h.result.current.frc.memberships[0].teamId).toBe("R1");
    h.rerender();
    await rt.settle();
    expect(mocks.getDocs).toHaveBeenCalledTimes(2);
  });

  it("reads again after a switch, a leave or a join (refreshAccountState), and a refused read is an empty list", async () => {
    const h = rt.renderHook(() => useAllProgramMemberships(true));
    await rt.settle();
    expect(mocks.getDocs).toHaveBeenCalledTimes(2);
    mocks.getDocs.mockRejectedValue(Object.assign(new Error("denied"), { code: "permission-denied" }));
    refreshAccountState("u1");
    await rt.settle();
    expect(mocks.getDocs).toHaveBeenCalledTimes(4);
    expect(h.result.current.ftc).toEqual({ status: "ready", memberships: [] });
  });
});
