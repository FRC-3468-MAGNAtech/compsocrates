// C3: the shell's ScoresReadyWatcher only ever uses the signed-in person's own live sessions, so it reads only those. The narrowed hook must hand it exactly what the
// full-feed filter handed it (same pending ids, same resolved popups), and the full feed (no uid) must be unchanged for the pages that show the whole team.
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => (await import("@/test-stubs/hook-runtime")).hookMock(await vi.importActual<typeof import("react")>("react")));
vi.mock("firebase/firestore", async () => (await import("@/test-stubs/fake-firestore")).fakeFirestoreModule);
vi.mock("@/lib/firebase/client", () => ({ db: { fake: true }, auth: { currentUser: { uid: "u1" } }, isFirebaseConfigured: () => true }));
vi.mock("@/lib/program/data", () => ({ useProgramData: () => null, programData: () => null }));
vi.mock("@/lib/program/context", () => ({ useProgram: () => "frc", useProgramConfig: () => ({ connection: { features: { live: true, practice: true } } }) }));

import * as fake from "@/test-stubs/fake-firestore";
import * as rt from "@/test-stubs/hook-runtime";
import * as fx from "@/test-stubs/read-fixtures";
import { useTeamLiveSessions } from "@/lib/practice-sessions";

const mineOf = (sessions: { id: string; uid: string; status: string; accuracy: number | null }[], uid: string) => sessions.filter((s) => s.uid === uid && s.status === "completed");
const watcherView = (sessions: { id: string; uid: string; status: string; accuracy: number | null }[], uid: string) => {
  const mine = mineOf(sessions, uid);
  return { pending: mine.filter((s) => s.accuracy === null).map((s) => s.id).sort(), resolved: mine.filter((s) => s.accuracy !== null).map((s) => s.id).sort() };
};

describe("useTeamLiveSessions with an owner uid", () => {
  it("gives the watcher the same pending and resolved sessions as the whole-team feed, reading far fewer documents", async () => {
    fake.resetFake();
    fx.seedDataset({ members: 5, entries: 0, liveSessions: 40, soloSessions: 10 }, "T-own");
    const full = rt.renderHook(() => useTeamLiveSessions("T-own"));
    await rt.settle();
    const fullBilled = fake.billing.total;
    const wanted = watcherView(full.result.current.sessions as never, "u2");
    full.unmount();

    fake.resetBilling();
    const own = rt.renderHook(() => useTeamLiveSessions("T-own", "u2"));
    await rt.settle();
    expect(watcherView(own.result.current.sessions as never, "u2")).toEqual(wanted);
    expect(own.result.current.sessions.every((s) => s.uid === "u2")).toBe(true);
    expect(fake.billing.total).toBe(8);
    expect(fullBilled).toBe(40);
    own.unmount();
  });

  it("without a uid it is still the whole team's live sessions (Pending Robots, the presence panel and Practice Scouting)", async () => {
    fake.resetFake();
    fx.seedDataset({ members: 5, entries: 0, liveSessions: 12 }, "T-all");
    const h = rt.renderHook(() => useTeamLiveSessions("T-all"));
    await rt.settle();
    expect(h.result.current.sessions).toHaveLength(12);
    h.unmount();
  });
});
