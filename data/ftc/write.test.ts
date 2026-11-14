import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ addDoc: vi.fn(), updateDoc: vi.fn(), deleteDoc: vi.fn(), refs: [] as string[] }));

vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, p: string, ...segments: string[]) => {
    const path = [p, ...segments].join("/");
    h.refs.push(path);
    return { kind: "collection", path };
  },
  doc: (_db: unknown, p: string, ...segments: string[]) => {
    const path = [p, ...segments].join("/");
    h.refs.push(path);
    return { kind: "doc", path };
  },
  addDoc: (...args: unknown[]) => h.addDoc(...args),
  updateDoc: (...args: unknown[]) => h.updateDoc(...args),
  deleteDoc: (...args: unknown[]) => h.deleteDoc(...args),
  serverTimestamp: () => "SERVER_TIMESTAMP",
}));
vi.mock("@/lib/firebase/client", () => ({ db: { fake: true } }));

import { deleteScoutEntry, saveScoutEntry, setActiveEvents, updateScoutEntry } from "@/data/ftc/write";
import type { SaveEntryInput } from "@/lib/scout-entries";

const input: SaveEntryInput = {
  scoutName: "Ada",
  eventCode: "EV1",
  matchType: "Qualification",
  matchNumber: 3,
  teamNumber: 100,
  formId: "biobuzz",
  formVersion: 1,
  values: { autoLeave: true },
  score: { auto: 3, teleop: 0, endgame: 0, total: 3 },
  comments: "",
};

let errorSpy: { mockRestore: () => void; mock: { calls: unknown[][] } };
beforeEach(() => {
  h.addDoc.mockReset();
  h.updateDoc.mockReset();
  h.deleteDoc.mockReset();
  h.refs.length = 0;
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errorSpy.mockRestore());

describe("saveScoutEntry", () => {
  it("adds the entry to the program's scoutEntries, as the signed-in scout, with a server timestamp", async () => {
    h.addDoc.mockResolvedValue({ id: "new" });
    await saveScoutEntry("team-a", "uid-ada", input);
    expect(h.refs).toEqual(["programs/ftc/scoutEntries"]);
    const [ref, body] = h.addDoc.mock.calls[0];
    expect(ref).toEqual({ kind: "collection", path: "programs/ftc/scoutEntries" });
    expect(body).toMatchObject({ teamId: "team-a", uid: "uid-ada", source: "event", formId: "biobuzz", createdAt: "SERVER_TIMESTAMP", excluded: false });
  });

  it("reports a failed save with its path and rethrows it, so the caller can say so", async () => {
    const denied = Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" });
    h.addDoc.mockRejectedValue(denied);
    await expect(saveScoutEntry("team-a", "uid-ada", input)).rejects.toBe(denied);
    expect(String(errorSpy.mock.calls[0][0])).toContain("programs/ftc/scoutEntries");
  });
});

describe("updateScoutEntry and deleteScoutEntry", () => {
  it("updates only the editable fields of the entry in the program's collection", async () => {
    h.updateDoc.mockResolvedValue(undefined);
    await updateScoutEntry("e1", { excluded: true, manualFlags: [{ id: "f", reason: "Other", addedAt: "t" }], teamId: "someone-else", uid: "x", id: "ignored", accuracy: null } as never);
    expect(h.refs).toEqual(["programs/ftc/scoutEntries/e1"]);
    const [ref, fields] = h.updateDoc.mock.calls[0];
    expect(ref).toEqual({ kind: "doc", path: "programs/ftc/scoutEntries/e1" });
    expect(fields).toEqual({ excluded: true, manualFlags: [{ id: "f", reason: "Other", addedAt: "t" }], accuracy: null });
  });

  it("writes nothing for a patch with no editable field", async () => {
    await updateScoutEntry("e1", { id: "x", teamId: "t" } as never);
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it("deletes the entry from the program's collection", async () => {
    h.deleteDoc.mockResolvedValue(undefined);
    await deleteScoutEntry("e1");
    expect(h.deleteDoc.mock.calls[0][0]).toEqual({ kind: "doc", path: "programs/ftc/scoutEntries/e1" });
  });

  it("reports a refused edit or delete and rethrows it", async () => {
    const denied = Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" });
    h.updateDoc.mockRejectedValue(denied);
    h.deleteDoc.mockRejectedValue(denied);
    await expect(updateScoutEntry("e1", { excluded: true })).rejects.toBe(denied);
    await expect(deleteScoutEntry("e1")).rejects.toBe(denied);
    expect(errorSpy.mock.calls.length).toBe(2);
  });
});

describe("setActiveEvents", () => {
  const ev = (code: string) => ({ code, season: 2026, name: code, dateStart: "", dateEnd: "", city: null, stateProv: null, country: null, venue: null, website: null, timezone: null, status: "upcoming" as const });

  it("writes the five active-event fields, and only those, to the program's team doc", async () => {
    h.updateDoc.mockResolvedValue(undefined);
    await setActiveEvents("team-a", { events: [ev("EVA"), ev("EVB")], primaryCode: "EVB" });
    const [ref, fields] = h.updateDoc.mock.calls[0];
    expect(ref).toEqual({ kind: "doc", path: "programs/ftc/teams/team-a" });
    expect(Object.keys(fields).sort()).toEqual(["activeEvent", "activeEventCode", "activeEventCodes", "activeEvents", "activeSeasonId"]);
    expect(fields.activeEventCodes).toEqual(["EVB", "EVA"]);
  });

  it("reports a refusal and rethrows it", async () => {
    const denied = Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" });
    h.updateDoc.mockRejectedValue(denied);
    await expect(setActiveEvents("team-a", { events: [], primaryCode: null })).rejects.toBe(denied);
    expect(String(errorSpy.mock.calls[0][0])).toContain("programs/ftc/teams/team-a");
  });
});
