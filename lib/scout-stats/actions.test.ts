import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PracticeSession } from "@/lib/practice-sessions";

// The Scout Accuracy actions write through the program they are given: the default program as before, FTC through its own store. Mocked: no network.

const mocks = vi.hoisted(() => ({
  logAuditEvent: vi.fn(async () => {}),
  updatePracticeSession: vi.fn(async () => {}),
  deletePracticeSession: vi.fn(async () => {}),
  deleteEntry: vi.fn(async () => {}),
  getEntriesForSession: vi.fn(async () => [] as { id: string }[]),
  programData: vi.fn((program: string) => (program === "ftc" ? { practice: {} } : null)),
}));

vi.mock("@/lib/audit-log", () => ({ logAuditEvent: mocks.logAuditEvent }));
vi.mock("@/lib/practice-sessions", () => ({ updatePracticeSession: mocks.updatePracticeSession, deletePracticeSession: mocks.deletePracticeSession }));
vi.mock("@/lib/scout-entries", () => ({ deleteEntry: mocks.deleteEntry, getEntriesForSession: mocks.getEntriesForSession }));
vi.mock("@/lib/program/data", () => ({ programData: mocks.programData }));

import { dismissSessionFlag, hardResetScoutData, setSessionExcluded } from "./actions";

const session = (over: Partial<PracticeSession> = {}): PracticeSession =>
  ({ id: "s1", uid: "u1", kind: "solo", mode: "trial", flags: [{ type: "low", title: "Low", detail: "", dismissed: false }], excluded: false, entryIds: ["a", "b"], ...over }) as unknown as PracticeSession;

beforeEach(() => vi.clearAllMocks());

describe("dismiss and exclude", () => {
  it("FTC: the flag and the exclusion are written on the session in its program, with an audit entry in its program", async () => {
    await dismissSessionFlag("t1", "admin", "Admin", session(), "low", "ftc");
    expect(mocks.updatePracticeSession).toHaveBeenCalledWith("s1", { flags: [expect.objectContaining({ type: "low", dismissed: true })] }, undefined, "ftc");
    expect(mocks.logAuditEvent).toHaveBeenLastCalledWith("t1", "admin", "Admin", "dismiss-flag", expect.anything(), expect.anything(), expect.anything(), "ftc");
    await setSessionExcluded("t1", "admin", "Admin", session(), true, "ftc");
    expect(mocks.updatePracticeSession).toHaveBeenLastCalledWith("s1", { excluded: true }, undefined, "ftc");
    expect(mocks.logAuditEvent).toHaveBeenLastCalledWith("t1", "admin", "Admin", "exclude-session", expect.anything(), { excluded: false }, { excluded: true }, "ftc");
  });

  it("the default program: the same calls, defaulting to the default program", async () => {
    await setSessionExcluded("t1", "admin", "Admin", session({ excluded: true }), false);
    expect(mocks.updatePracticeSession).toHaveBeenCalledWith("s1", { excluded: false }, undefined, "frc");
    expect(mocks.logAuditEvent).toHaveBeenLastCalledWith("t1", "admin", "Admin", "include-session", expect.anything(), { excluded: true }, { excluded: false }, "frc");
  });

  it("a failed write is thrown to the caller (and no audit entry is written for it)", async () => {
    mocks.updatePracticeSession.mockRejectedValueOnce(new Error("Missing or insufficient permissions."));
    await expect(setSessionExcluded("t1", "scout", "Scout", session(), true, "ftc")).rejects.toThrow("Missing or insufficient permissions.");
    expect(mocks.logAuditEvent).not.toHaveBeenCalled();
  });
});

describe("hard reset", () => {
  it("FTC: deletes the entries it reads for each session, then the session, then audits the counts", async () => {
    mocks.getEntriesForSession.mockResolvedValueOnce([{ id: "e1" }, { id: "e2" }, { id: "e3" }]).mockResolvedValueOnce([]);
    const sessions = [session({ id: "s1" }), session({ id: "s2" }), session({ id: "s3", uid: "someone-else" }), session({ id: "s4", mode: "competitive" })];
    await hardResetScoutData("t1", "admin", "Admin", "u1", "Ann", "trial", sessions, "ftc");
    expect(mocks.getEntriesForSession).toHaveBeenCalledTimes(2); // only this scout's trial sessions
    expect(mocks.deleteEntry.mock.calls).toEqual([["e1", "ftc"], ["e2", "ftc"], ["e3", "ftc"]]);
    expect(mocks.deletePracticeSession.mock.calls).toEqual([["s1", "ftc"], ["s2", "ftc"]]);
    expect(mocks.logAuditEvent).toHaveBeenCalledWith("t1", "admin", "Admin", "hard-reset-scout-data", { targetUid: "u1", targetName: "Ann", category: "trial" }, { sessionCount: 2, entryCount: 3 }, { sessionCount: 0, entryCount: 0 }, "ftc");
  });

  it("the default program: uses the entry ids listed on the session, as before", async () => {
    await hardResetScoutData("t1", "admin", "Admin", "u1", "Ann", "trial", [session()]);
    expect(mocks.getEntriesForSession).not.toHaveBeenCalled();
    expect(mocks.deleteEntry.mock.calls).toEqual([["a", "frc"], ["b", "frc"]]);
    expect(mocks.logAuditEvent).toHaveBeenCalledWith("t1", "admin", "Admin", "hard-reset-scout-data", expect.anything(), { sessionCount: 1, entryCount: 2 }, expect.anything(), "frc");
  });

  it("stops and throws when a delete is refused, without the audit entry", async () => {
    mocks.getEntriesForSession.mockResolvedValueOnce([{ id: "e1" }]);
    mocks.deleteEntry.mockRejectedValueOnce(new Error("denied"));
    await expect(hardResetScoutData("t1", "scout", "Scout", "u1", "Ann", "trial", [session()], "ftc")).rejects.toThrow("denied");
    expect(mocks.deletePracticeSession).not.toHaveBeenCalled();
    expect(mocks.logAuditEvent).not.toHaveBeenCalled();
  });
});
