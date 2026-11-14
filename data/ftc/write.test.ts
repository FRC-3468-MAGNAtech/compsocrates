import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ addDoc: vi.fn(), refs: [] as string[] }));

vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, p: string, ...segments: string[]) => {
    const path = [p, ...segments].join("/");
    h.refs.push(path);
    return { kind: "collection", path };
  },
  addDoc: (...args: unknown[]) => h.addDoc(...args),
  serverTimestamp: () => "SERVER_TIMESTAMP",
}));
vi.mock("@/lib/firebase/client", () => ({ db: { fake: true } }));

import { saveScoutEntry } from "@/data/ftc/write";
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

let errorSpy: { mockRestore: () => void };
beforeEach(() => {
  h.addDoc.mockReset();
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
    expect(String((errorSpy as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0])).toContain("programs/ftc/scoutEntries");
  });
});
