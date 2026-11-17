import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventMatch } from "@/lib/events/types";
import type { ScoutEntry } from "@/lib/scout-entries";
import { canRecalculateAccuracy, recomputeQuietly, shouldRecomputeAfterSave } from "./recompute-policy";

// Post-save accuracy. A scout's save never shows an error because of the recompute; in a program whose entries only an admin may update, only an admin writes
// the derived fields; the Recalculate button is admin-only there; the recompute reads and writes the program it is in. Mocked: no network.

const mocks = vi.hoisted(() => ({
  getMatchesForEvent: vi.fn(),
  getEventEntries: vi.fn(),
  updateEntry: vi.fn(async () => {}),
}));

vi.mock("@/lib/events/actions", () => ({ getMatchesForEvent: mocks.getMatchesForEvent }));
vi.mock("@/lib/scout-entries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scout-entries")>()),
  getEventEntries: mocks.getEventEntries,
  updateEntry: mocks.updateEntry,
}));
// The built-in form resolver is not under test: every entry resolves to a scored form.
const form = { id: "biobuzz", version: 1, scoringEnabled: true, sections: [] };
vi.mock("@/lib/forms/resolver", () => ({ builtinFormResolver: () => form }));

import { computeEventRescorePlan, recomputeAfterSave, recomputeForEvent } from "./recompute";

const entry = (id: string, teamNumber: number, total: number): ScoutEntry =>
  ({
    id, teamId: "t1", uid: "u", source: "event", mode: null, formId: "biobuzz", formVersion: 1, scoutName: "S", eventCode: "EVT", matchType: "Qualification", matchNumber: 1, teamNumber,
    values: {}, score: { auto: 0, teleop: total, endgame: 0, total }, comments: "", submittedAt: "2026-01-01T00:00:00.000Z", excluded: false, autoFlags: [], manualFlags: [], accuracy: null, sessionId: null, libraryMatchId: null,
  }) as ScoutEntry;

const match = { type: "Qualification", matchNumber: 1, redTeams: [100, 200], blueTeams: [300, 400], redScore: 50, blueScore: 10, redPenaltyPoints: 0, bluePenaltyPoints: 0 } as unknown as EventMatch;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateEntry.mockReset();
  mocks.updateEntry.mockResolvedValue(undefined);
  mocks.getMatchesForEvent.mockImplementation(async (_code: string, type: string) => ({ ok: true, data: type === "Qualification" ? [match] : [] }));
  mocks.getEventEntries.mockResolvedValue([entry("e1", 100, 30), entry("e2", 200, 20)]);
});

describe("who recomputes", () => {
  it("the default program: everyone, as before", () => {
    expect(shouldRecomputeAfterSave({ ownEntryStore: false, isAdmin: false })).toBe(true);
    expect(canRecalculateAccuracy({ ownEntryStore: false, isAdmin: false })).toBe(true);
  });
  it("a program with its own entry store: admins only, for the save and for the button", () => {
    expect(shouldRecomputeAfterSave({ ownEntryStore: true, isAdmin: false })).toBe(false);
    expect(shouldRecomputeAfterSave({ ownEntryStore: true, isAdmin: true })).toBe(true);
    expect(canRecalculateAccuracy({ ownEntryStore: true, isAdmin: false })).toBe(false);
    expect(canRecalculateAccuracy({ ownEntryStore: true, isAdmin: true })).toBe(true);
  });
});

describe("a scout saves an entry in FTC", () => {
  const args = { teamId: "t1", eventCode: "EVT", season: 2025, resolveForm: (() => form) as never, program: "ftc" as const, ownEntryStore: true };

  it("a plain scout's save triggers no read and no write, so nothing can be denied", async () => {
    recomputeAfterSave({ ...args, isAdmin: false });
    await Promise.resolve();
    expect(mocks.getEventEntries).not.toHaveBeenCalled();
    expect(mocks.getMatchesForEvent).not.toHaveBeenCalled();
    expect(mocks.updateEntry).not.toHaveBeenCalled();
  });

  it("an admin's save recomputes the event in the FTC program", async () => {
    recomputeAfterSave({ ...args, isAdmin: true });
    await vi.waitFor(() => expect(mocks.updateEntry).toHaveBeenCalledTimes(2));
    expect(mocks.getEventEntries).toHaveBeenCalledWith("t1", "EVT", "ftc");
    expect(mocks.getMatchesForEvent).toHaveBeenCalledWith("EVT", "Qualification", 2025, "ftc");
    expect(mocks.updateEntry).toHaveBeenCalledWith("e1", expect.objectContaining({ accuracy: expect.objectContaining({ status: "complete", value: 1 }) }), {}, "ftc");
  });

  it("a denied write after an admin save is swallowed (never thrown), reported quietly", async () => {
    vi.useFakeTimers(); // the retries wait 2s and 8s: do not leave timers behind
    mocks.updateEntry.mockRejectedValue(Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => recomputeAfterSave({ ...args, isAdmin: true })).not.toThrow();
    await vi.advanceTimersByTimeAsync(20000);
    expect(warn).toHaveBeenCalledTimes(3); // the first try and two retries, each reported quietly
    expect(mocks.updateEntry).toHaveBeenCalledTimes(6); // two entries, three tries
    warn.mockRestore();
    vi.useRealTimers();
  });
});

describe("the default program is unchanged", () => {
  it("every save recomputes, with the default program's reads", async () => {
    recomputeAfterSave({ teamId: "t1", eventCode: "EVT", season: 2026, resolveForm: (() => form) as never, program: "frc", ownEntryStore: false, isAdmin: false });
    await vi.waitFor(() => expect(mocks.updateEntry).toHaveBeenCalledTimes(2));
    expect(mocks.getEventEntries).toHaveBeenCalledWith("t1", "EVT", "frc");
    expect(mocks.updateEntry).toHaveBeenCalledWith("e1", expect.anything(), {}, "frc");
  });
});

describe("Recalculate Accuracy", () => {
  it("computes accuracy from the role-split entries (absent role fields are 0 in each robot's total) and writes it for both", async () => {
    const plan = await computeEventRescorePlan("t1", "EVT", 2025, (() => form) as never, "ftc");
    expect(plan.map((p) => p.after.status)).toEqual(["complete", "complete"]);
    expect(plan[0].after.value).toBe(1); // 30 + 20 = the official 50
  });

  it("an admin's recalculation that is denied throws, so the button can say so", async () => {
    mocks.updateEntry.mockRejectedValue(new Error("denied"));
    await expect(recomputeForEvent("t1", "EVT", 2025, (() => form) as never, "ftc")).rejects.toThrow("denied");
  });
});

describe("recomputeQuietly", () => {
  const instant = { wait: async () => {}, onFailure: () => {} };

  it("resolves true when the run succeeds, false after the retries are used up, and never throws", async () => {
    const ok = vi.fn(async () => {});
    expect(await recomputeQuietly(ok, instant)).toBe(true);
    const bad = vi.fn(async () => {
      throw new Error("nope");
    });
    expect(await recomputeQuietly(bad, instant)).toBe(false);
    expect(bad).toHaveBeenCalledTimes(3); // the first try and two retries
  });

  it("retries until a later attempt works", async () => {
    let n = 0;
    const flaky = vi.fn(async () => {
      if (++n < 2) throw new Error("later");
    });
    expect(await recomputeQuietly(flaky, instant)).toBe(true);
    expect(flaky).toHaveBeenCalledTimes(2);
  });

  it("a reporter that throws cannot break the save", async () => {
    const onFailure = () => {
      throw new Error("reporter");
    };
    expect(await recomputeQuietly(async () => { throw new Error("x"); }, { wait: async () => {}, onFailure, retries: 1 })).toBe(false);
  });
});
