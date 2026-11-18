import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("firebase/firestore", async () => (await import("@/test-stubs/fake-firestore")).fakeFirestoreModule);

import * as fake from "@/test-stubs/fake-firestore";
import { collection, getDoc, getDocs, doc, onSnapshot, query, where } from "@/lib/firebase/metered";
import { pageLoadCounts, resetMeterForTests, setLocalMeterOn, setServerMeterOn, takePending } from "@/lib/read-meter/client";
import { totalOf } from "@/lib/read-meter/model";

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  fake.resetFake();
  resetMeterForTests();
  vi.stubGlobal("window", { location: { pathname: "/frc/analytics/teams/254" } });
  for (let i = 0; i < 5; i += 1) fake.seed(`scouting/e${i}`, { teamId: "T", n: i });
  fake.seed("users/u1", { teamId: "T" });
});

describe("the metered read wrappers", () => {
  it("OFF: reads pass through and nothing is counted", async () => {
    const snap = await getDocs(query(collection({} as never, "scouting"), where("teamId", "==", "T")));
    expect(snap.size).toBe(5);
    await getDoc(doc({} as never, "users", "u1"));
    expect(totalOf(takePending())).toBe(0);
    expect(totalOf(pageLoadCounts())).toBe(0);
  });

  it("ON: a one-time read counts its documents per collection and page; an empty one counts 1", async () => {
    setServerMeterOn(true);
    await getDocs(query(collection({} as never, "scouting"), where("teamId", "==", "T")));
    await getDoc(doc({} as never, "users", "u1"));
    await getDocs(query(collection({} as never, "scouting"), where("teamId", "==", "nobody")));
    expect(takePending()).toEqual({ "analytics~teams~[id]": { scouting: 5, users: 1, "(empty result)": 1 } });
    expect(takePending()).toEqual({}); // taking resets
  });

  it("ON: a listener counts its first snapshot and then only added or modified documents", async () => {
    setServerMeterOn(true);
    const seen: number[] = [];
    const stop = onSnapshot(query(collection({} as never, "scouting"), where("teamId", "==", "T")), (s) => seen.push(s.size));
    await settle();
    fake.write("scouting/e9", { teamId: "T", n: 9 });
    fake.write("scouting/e1", { teamId: "T", n: 100 });
    stop();
    expect(seen.length).toBe(3);
    expect(takePending()).toEqual({ "analytics~teams~[id]": { scouting: 5 + 1 + 1 } });
  });

  it("skips snapshots served from the cache", async () => {
    setServerMeterOn(true);
    const snapshot = { metadata: { fromCache: true }, docChanges: () => [{ type: "added", doc: { ref: { parent: { path: "scouting" } } } }] };
    const spy = vi.spyOn(fake.fakeFirestoreModule, "onSnapshot").mockImplementation(((_t: unknown, next: (s: unknown) => void) => (next(snapshot), () => {})) as never);
    onSnapshot(collection({} as never, "scouting"), () => {});
    spy.mockRestore();
    expect(totalOf(takePending())).toBe(0);
  });

  it("the local counter keeps this page load's counts without feeding the flush", async () => {
    setLocalMeterOn(true);
    await getDocs(collection({} as never, "scouting"));
    expect(totalOf(pageLoadCounts())).toBe(5);
    expect(totalOf(takePending())).toBe(0);
  });

  it("a counting error never breaks the read", async () => {
    setServerMeterOn(true);
    const spy = vi.spyOn(fake.fakeFirestoreModule, "getDocs").mockResolvedValue({ docs: [{ ref: null }], size: 1, metadata: {} } as never);
    await expect(getDocs(collection({} as never, "scouting"))).resolves.toBeTruthy();
    spy.mockRestore();
  });
});
