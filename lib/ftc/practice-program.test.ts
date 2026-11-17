import { beforeEach, describe, expect, it, vi } from "vitest";

type Ref = { path: string };
const h = vi.hoisted(() => ({
  updateDoc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  deleteDoc: vi.fn(),
  addDoc: vi.fn(),
  tryClaimDoc: vi.fn(),
  port: {
    claimSession: vi.fn(),
    updateSession: vi.fn(),
    getSession: vi.fn(),
    deleteSession: vi.fn(),
    hasCompletedAttempt: vi.fn(),
    subscribeTeamSessions: vi.fn(),
    subscribeOwnPausedSession: vi.fn(),
    subscribeSession: vi.fn(),
    subscribeTeamLiveSessions: vi.fn(),
    subscribeLobbySessions: vi.fn(),
  },
}));

vi.mock("firebase/firestore", async (importOriginal) => {
  const real = await importOriginal<typeof import("firebase/firestore")>();
  return {
    ...real,
    collection: (_db: unknown, p: string) => ({ kind: "collection", path: p }),
    doc: (_db: unknown, p: string, ...s: string[]) => ({ kind: "doc", path: [p, ...s].join("/") }),
    where: (field: string, op: string, value: unknown) => ({ field, op, value }),
    limit: (n: number) => ({ limit: n }),
    query: (ref: unknown, ...constraints: unknown[]) => ({ kind: "query", ref, constraints }),
    updateDoc: (...a: unknown[]) => h.updateDoc(...a),
    getDoc: (...a: unknown[]) => h.getDoc(...a),
    getDocs: (...a: unknown[]) => h.getDocs(...a),
    deleteDoc: (...a: unknown[]) => h.deleteDoc(...a),
    addDoc: (...a: unknown[]) => h.addDoc(...a),
    serverTimestamp: () => "SERVER_TIME",
  };
});
vi.mock("@/lib/firebase/client", () => ({ db: { fake: true }, isFirebaseConfigured: () => false }));
vi.mock("@/lib/claim-doc", () => ({ tryClaimDoc: (...a: unknown[]) => h.tryClaimDoc(...a) }));
vi.mock("@/data/ftc/practice", () => h.port);

import { claimSessionId, deletePracticeSession, getPracticeSession, hasCompletedAttemptBefore, updatePracticeSession } from "@/lib/practice-sessions";
import { getEntriesForSession, saveEntry, type SaveEntryInput } from "@/lib/scout-entries";
import { clearRememberedSubmissionSettings, rememberSubmissionSettings } from "@/lib/forms/submission-guard";
import { SubmissionClosedError } from "@/lib/forms/submission-settings";
import { ftcProgramData } from "@/lib/ftc/program-data";

beforeEach(() => {
  for (const fn of [h.updateDoc, h.getDoc, h.getDocs, h.deleteDoc, h.addDoc, h.tryClaimDoc, ...Object.values(h.port)]) fn.mockReset();
  clearRememberedSubmissionSettings();
});

describe("the default program reads and writes exactly the root collections it always did", () => {
  it("start reserves the id in the root practiceSessions with the CS fields beside the app ones", async () => {
    h.tryClaimDoc.mockResolvedValue(true);
    const id = await claimSessionId("T1", "u1", "solo");
    const [, collectionName, claimed, stub] = h.tryClaimDoc.mock.calls[0];
    expect(collectionName).toBe("practiceSessions");
    expect(claimed).toBe(id);
    expect(stub).toMatchObject({ teamId: "T1", uid: "u1", kind: "solo", status: "in-progress", scoutId: "u1", isLivePracticeScouting: false });
    expect(h.port.claimSession).not.toHaveBeenCalled();
    h.tryClaimDoc.mockClear();
    await claimSessionId("T1", "u1", "solo", 5, "frc");
    expect(h.tryClaimDoc.mock.calls[0][1]).toBe("practiceSessions");
  });

  it("update, read and discard hit practiceSessions/{id} at the root, and the update still carries the CS-named twins", async () => {
    h.updateDoc.mockResolvedValue(undefined);
    await updatePracticeSession("PS-A", { status: "paused", completedRobots: [1], scoutName: "Ada", eventCode: "EV" });
    const [ref, fields] = h.updateDoc.mock.calls[0] as [Ref, Record<string, unknown>];
    expect(ref.path).toBe("practiceSessions/PS-A");
    expect(fields).toMatchObject({ status: "paused", completedRobots: [1], scoutName: "Ada", eventCode: "EV", eventKey: expect.any(String) });
    // eventKey is the CS-named twin of eventCode (practicePatchToCsFields)

    h.getDoc.mockResolvedValue({ exists: () => false, data: () => undefined, id: "PS-A" });
    expect(await getPracticeSession("PS-A", "frc")).toBeNull();
    expect((h.getDoc.mock.calls[0][0] as Ref).path).toBe("practiceSessions/PS-A");

    h.deleteDoc.mockResolvedValue(undefined);
    await deletePracticeSession("PS-A");
    expect((h.deleteDoc.mock.calls[0][0] as Ref).path).toBe("practiceSessions/PS-A");
    expect(Object.values(h.port).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it("the repeat-attempt check is the root query with the same five equalities and limit 1 (then the scoutId fallback), never the other program", async () => {
    h.getDocs.mockResolvedValue({ empty: false, docs: [] });
    expect(await hasCompletedAttemptBefore("T1", "u1", "EV_Q1", "red")).toBe(true);
    const query = h.getDocs.mock.calls[0][0] as { ref: Ref; constraints: { field?: string; value?: unknown; limit?: number }[] };
    expect(query.ref.path).toBe("practiceSessions");
    expect(query.constraints.map((c) => c.field ?? `limit ${c.limit}`)).toEqual(["teamId", "uid", "libraryMatchId", "alliance", "status", "limit 1"]);
    expect(h.port.hasCompletedAttempt).not.toHaveBeenCalled();
  });
});

describe("the other program goes through its own session store, and never touches the root", () => {
  it("each lifecycle call is handed to the port", async () => {
    h.port.claimSession.mockResolvedValue("PS-NEW");
    h.port.getSession.mockResolvedValue(null);
    h.port.hasCompletedAttempt.mockResolvedValue(true);
    expect(await claimSessionId("T1", "u1", "solo", 5, "ftc")).toBe("PS-NEW");
    expect(h.port.claimSession).toHaveBeenCalledWith("T1", "u1", "solo");
    await updatePracticeSession("PS-A", { status: "completed", accuracy: null }, undefined, "ftc");
    expect(h.port.updateSession).toHaveBeenCalledWith("PS-A", { status: "completed", accuracy: null });
    await getPracticeSession("PS-A", "ftc");
    expect(h.port.getSession).toHaveBeenCalledWith("PS-A");
    expect(await hasCompletedAttemptBefore("T1", "u1", "EV_Q1", "blue", "ftc")).toBe(true);
    expect(h.port.hasCompletedAttempt).toHaveBeenCalledWith("T1", "u1", "EV_Q1", "blue");
    await deletePracticeSession("PS-A", "ftc");
    expect(h.port.deleteSession).toHaveBeenCalledWith("PS-A");
    for (const fn of [h.updateDoc, h.getDoc, h.getDocs, h.deleteDoc, h.tryClaimDoc]) expect(fn).not.toHaveBeenCalled();
  });

  it("the entries of a session are read from the program's own entries", async () => {
    const spy = vi.spyOn(ftcProgramData.practice, "entriesForSession").mockResolvedValue([]);
    await getEntriesForSession("T1", "PS-A", "ftc");
    expect(spy).toHaveBeenCalledWith("T1", "PS-A");
    expect(h.getDocs).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("submissions turned off (Session E): practice is never closed, in either program", () => {
  const practiceEntry: SaveEntryInput = {
    scoutName: "Ada",
    eventCode: "EV",
    matchType: "Qualification",
    matchNumber: 1,
    teamNumber: 111,
    formId: "biobuzz",
    formVersion: 1,
    values: {},
    score: { auto: 0, teleop: 0, endgame: 0, total: 0 },
    comments: "",
    source: "practice",
    mode: "trial",
    sessionId: "PS-A",
    libraryMatchId: "EV_Q1",
  };

  it("with the master switch off a practice entry is still saved, and a real-event entry is still refused", async () => {
    const save = vi.spyOn(ftcProgramData.scoutEntries, "save").mockResolvedValue(undefined);
    rememberSubmissionSettings("ftc", "T1", { enabled: false, seasons: { biobuzz: false } });
    await saveEntry("T1", "u1", { ...practiceEntry, gate: { seasonId: "biobuzz" } }, "ftc");
    await saveEntry("T1", "u1", { ...practiceEntry, source: "live", gate: { seasonId: "biobuzz" } }, "ftc");
    expect(save).toHaveBeenCalledTimes(2);
    await expect(saveEntry("T1", "u1", { ...practiceEntry, source: "event", gate: { seasonId: "biobuzz" } }, "ftc")).rejects.toBeInstanceOf(SubmissionClosedError);
    expect(save).toHaveBeenCalledTimes(2);
    save.mockRestore();
  });

  it("with only the season switch off a practice entry of that season is still saved", async () => {
    const save = vi.spyOn(ftcProgramData.scoutEntries, "save").mockResolvedValue(undefined);
    rememberSubmissionSettings("ftc", "T1", { enabled: true, seasons: { biobuzz: false } });
    await saveEntry("T1", "u1", { ...practiceEntry, gate: { seasonId: "biobuzz" } }, "ftc");
    expect(save).toHaveBeenCalledTimes(1);
    save.mockRestore();
  });

  it("an entry handed over to the offline queue is the same call as online: it is not held back by the switches either way", async () => {
    const save = vi.spyOn(ftcProgramData.scoutEntries, "save").mockReturnValue(new Promise<void>(() => undefined)); // never resolves: waiting for the server
    void saveEntry("T1", "u1", practiceEntry, "ftc");
    rememberSubmissionSettings("ftc", "T1", { enabled: false, seasons: {} });
    expect(save).toHaveBeenCalledTimes(1);
    save.mockRestore();
  });

  it("the default program keeps practice exempt as before: a closed switch does not refuse a practice entry there", async () => {
    h.addDoc.mockResolvedValue({ id: "x" });
    rememberSubmissionSettings("frc", "T1", { enabled: false, seasons: {} });
    const outcome = await saveEntry("T1", "u1", { ...practiceEntry, formId: "rebuilt", gate: { seasonId: "rebuilt" } }).catch((e: unknown) => e);
    expect(outcome).not.toBeInstanceOf(SubmissionClosedError);
  });
});
