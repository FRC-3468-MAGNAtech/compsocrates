// Characterization of the FRC (root) Match Library writes, BEFORE the library merge. These pin what is stored today (collections, ids, fields,
// batching, audit entries). They must keep passing unchanged after the shared panel and the adapters are in place.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

type Constraint = { field: string; op: string; value: unknown };
type Op = { kind: "set" | "update" | "delete"; path: string; data?: Record<string, unknown> };

const h = vi.hoisted(() => ({
  commits: [] as Op[][],
  direct: [] as Op[],
  getDocs: vi.fn(),
  getDoc: vi.fn(),
  getEvent: vi.fn(),
}));

vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, p: string, ...s: string[]) => ({ kind: "collection", path: [p, ...s].join("/") }),
  doc: (first: { path?: string } | unknown, p?: string, ...s: string[]) => ({ kind: "doc", path: typeof p === "string" ? [p, ...s].join("/") : `${(first as { path: string }).path}/auto-id` }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  query: (ref: unknown, ...constraints: unknown[]) => ({ kind: "query", ref, constraints }),
  getDocs: (...a: unknown[]) => h.getDocs(...a),
  getDoc: (...a: unknown[]) => h.getDoc(...a),
  setDoc: async (ref: { path: string }, data: Record<string, unknown>) => void h.direct.push({ kind: "set", path: ref.path, data }),
  updateDoc: async (ref: { path: string }, data: Record<string, unknown>) => void h.direct.push({ kind: "update", path: ref.path, data }),
  serverTimestamp: () => ({ serverTimestamp: true }),
  onSnapshot: () => () => {},
  writeBatch: () => {
    const ops: Op[] = [];
    return {
      set: (ref: { path: string }, data: Record<string, unknown>) => ops.push({ kind: "set", path: ref.path, data }),
      update: (ref: { path: string }, data: Record<string, unknown>) => ops.push({ kind: "update", path: ref.path, data }),
      delete: (ref: { path: string }) => ops.push({ kind: "delete", path: ref.path }),
      commit: async () => void h.commits.push(ops),
    };
  },
}));
vi.mock("@/lib/firebase/client", () => ({ db: { fake: true }, auth: { currentUser: { uid: "u1" } }, isFirebaseConfigured: () => true }));
vi.mock("@/lib/events/actions", () => ({ getEvent: (...a: unknown[]) => h.getEvent(...a), getMatchesForEvent: vi.fn() }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ profile: null, user: null }) }));
vi.mock("@/lib/program/data", () => ({ useProgramData: () => null }));

import {
  backfillLibraryMetadata,
  createManualEvent,
  deleteManualEvent,
  deleteManualMatches,
  setMatchesPublished,
  setMatchesVideoLink,
  updateManualEvent,
  upsertManualMatches,
  type LibraryEvent,
} from "@/lib/library/store";
import { emptyRawMatch, validateRawMatch, type RawMatch } from "@/lib/library/manual-match";

const NOW = "2026-03-01T12:00:00.000Z";
const actor = { teamId: "T1", uid: "u1", name: "Ada" };
const event: LibraryEvent = { eventCode: "MAN-DEMO-AAAA", eventName: "Demo", seasonId: "reefscape", origin: "manual", date: null, sourceUrl: null, defaultVideoUrl: null, createdBy: "u1" };
const snap = (docs: [string, Record<string, unknown>][]) => ({ empty: docs.length === 0, docs: docs.map(([id, data]) => ({ id, data: () => data, ref: { path: `libraryMatches/${id}` } })) });

const raw = (over: Partial<RawMatch> = {}): RawMatch => ({ ...emptyRawMatch(), matchNumber: "1", red1: "254", red2: "1114", red3: "2056", blue1: "1678", blue2: "971", blue3: "118", redScore: "90", blueScore: "70", redPenalty: "5", bluePenalty: "0", ...over });
const valid = (over: Partial<RawMatch> = {}) => {
  const r = validateRawMatch(raw(over));
  if (!r.match) throw new Error(JSON.stringify(r.errors));
  return r.match;
};
const writes = () => h.commits.flat();
const auditOps = () => writes().filter((o) => o.path.startsWith("auditLog/"));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  h.commits.length = 0;
  h.direct.length = 0;
  h.getDocs.mockReset();
  h.getDoc.mockReset();
  h.getEvent.mockReset();
  h.getDocs.mockResolvedValue(snap([]));
  h.getDoc.mockResolvedValue({ exists: () => false });
  h.getEvent.mockResolvedValue({ ok: true, data: null });
});
afterEach(() => vi.useRealTimers());

describe("FRC library: events", () => {
  it("creates a manual event at libraryEvents/<code> with a generated MAN- code, and one audit entry in the same batch", async () => {
    const result = await createManualEvent(actor, { name: "Demo Event", code: "", date: "2026-03-01", sourceUrl: "https://x.test/r", defaultVideoUrl: "https://youtu.be/dQw4w9WgXcQ" }, "reefscape", []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.eventCode).toMatch(/^MAN-/);
    expect(h.commits).toHaveLength(1);
    const [eventOp, auditOp] = h.commits[0];
    expect(eventOp).toMatchObject({ kind: "set", path: `libraryEvents/${result.event.eventCode}` });
    expect(eventOp.data).toEqual({
      eventCode: result.event.eventCode,
      eventName: "Demo Event",
      seasonId: "reefscape",
      origin: "manual",
      date: "2026-03-01",
      sourceUrl: "https://x.test/r",
      defaultVideoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      createdBy: "u1",
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(auditOp.path).toBe("auditLog/auto-id");
    expect(auditOp.data).toMatchObject({ teamId: "T1", uid: "u1", action: "edit-match-library", target: { op: "create-event", eventCode: result.event.eventCode } });
  });

  it("validation errors write nothing; a typed code that is taken or is a real API event is refused", async () => {
    const bad = await createManualEvent(actor, { name: "", code: "", date: "", sourceUrl: "", defaultVideoUrl: "" }, "reefscape", []);
    expect(bad).toMatchObject({ ok: false, fieldErrors: { name: expect.any(String) } });

    h.getDocs.mockResolvedValueOnce(snap([])).mockResolvedValue(snap([]));
    h.getDoc.mockResolvedValueOnce({ exists: () => true });
    const taken = await createManualEvent(actor, { name: "X", code: "MYCODE", date: "", sourceUrl: "", defaultVideoUrl: "" }, "reefscape", []);
    expect(taken).toMatchObject({ ok: false, error: "The code MYCODE is already used by another event." });

    h.getDoc.mockResolvedValue({ exists: () => false });
    h.getEvent.mockResolvedValue({ ok: true, data: { name: "Real Event" } });
    const real = await createManualEvent(actor, { name: "X", code: "USWABON", date: "", sourceUrl: "", defaultVideoUrl: "" }, "reefscape", []);
    expect(real).toMatchObject({ ok: false });
    expect(h.commits).toHaveLength(0);
  });

  it("edits event details and copies a new name onto every match (400 per batch), audit in the first batch", async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `${event.eventCode}_Q${i + 1}`);
    await updateManualEvent(actor, event, { name: " Renamed ", date: "", sourceUrl: "", defaultVideoUrl: "" }, ids);
    expect(h.commits.map((c) => c.length)).toEqual([2, 400, 50]);
    expect(h.commits[0][0]).toMatchObject({ kind: "update", path: `libraryEvents/${event.eventCode}`, data: { eventName: "Renamed", date: null, sourceUrl: null, defaultVideoUrl: null, updatedAt: NOW } });
    expect(h.commits[1][0]).toEqual({ kind: "update", path: `libraryMatches/${ids[0]}`, data: { eventName: "Renamed", updatedAt: NOW } });
  });

  it("deletes an event only when it has no matches", async () => {
    h.getDocs.mockResolvedValueOnce(snap([["MAN-DEMO-AAAA_Q1", {}]]));
    await expect(deleteManualEvent(actor, event)).rejects.toThrow("Delete this event's matches first.");
    expect(h.commits).toHaveLength(0);
    h.getDocs.mockResolvedValueOnce(snap([]));
    await deleteManualEvent(actor, event);
    expect(h.commits[0][0]).toEqual({ kind: "delete", path: `libraryEvents/${event.eventCode}` });
    expect(h.commits[0][1].data).toMatchObject({ target: { op: "delete-event", eventCode: event.eventCode } });
  });
});

describe("FRC library: matches", () => {
  it("creates a match under libraryMatches/<code>_<type><number> with difficulty computed, then edits keep published, needsReview, creator and first-import time", async () => {
    const created = await upsertManualMatches(actor, event, [valid()], { newPublished: false, newNeedsReview: true });
    expect(created).toMatchObject({ created: 1, updated: 0, skipped: [], ids: [`${event.eventCode}_Q1`] });
    const [put, audit] = h.commits[0];
    expect(put).toMatchObject({ kind: "set", path: `libraryMatches/${event.eventCode}_Q1` });
    expect(put.data).toEqual({
      seasonId: "reefscape",
      eventCode: event.eventCode,
      eventName: "Demo",
      matchType: "Qualification",
      matchNumber: 1,
      alliances: {
        red: { teams: [254, 1114, 2056], score: 90, penaltyPoints: 5, difficulty: expect.any(String) },
        blue: { teams: [1678, 971, 118], score: 70, penaltyPoints: 0, difficulty: expect.any(String) },
      },
      video: null,
      notes: "",
      origin: "manual",
      published: false,
      needsReview: true,
      createdBy: "u1",
      importedAt: NOW,
      scoresUpdatedAt: NOW,
      updatedAt: NOW,
    });
    expect(audit.data).toMatchObject({ target: { op: "upsert-matches", eventCode: event.eventCode }, after: { created: 1, updated: 0, skipped: 0 } });

    h.commits.length = 0;
    h.getDocs.mockResolvedValueOnce(snap([[`${event.eventCode}_Q1`, { origin: "manual", published: true, needsReview: false, createdBy: "other", importedAt: "2026-01-01T00:00:00.000Z" }]]));
    const edited = await upsertManualMatches(actor, event, [valid({ redScore: "100" })], { newPublished: false, newNeedsReview: true });
    expect(edited).toMatchObject({ created: 0, updated: 1 });
    expect(h.commits[0][0].data).toMatchObject({ published: true, needsReview: false, createdBy: "other", importedAt: "2026-01-01T00:00:00.000Z", alliances: { red: { score: 100 } } });
  });

  it("reads the event's existing matches with one equality query, never overwrites an API match, and keeps the last of a duplicated number", async () => {
    h.getDocs.mockResolvedValueOnce(snap([[`${event.eventCode}_Q2`, { origin: "api", published: true }]]));
    const result = await upsertManualMatches(actor, event, [valid({ matchNumber: "1", redScore: "10" }), valid({ matchNumber: "1", redScore: "20" }), valid({ matchNumber: "2" })], { newPublished: true, newNeedsReview: false });
    const q = h.getDocs.mock.calls[0][0] as { ref: { path: string }; constraints: Constraint[] };
    expect(q.ref.path).toBe("libraryMatches");
    expect(q.constraints).toEqual([{ field: "eventCode", op: "==", value: event.eventCode }]);
    expect(result.created).toBe(1);
    expect(result.skipped).toEqual([{ id: `${event.eventCode}_Q2`, reason: expect.stringContaining("imported (API) match") }]);
    expect(writes().filter((o) => o.path.startsWith("libraryMatches/"))).toHaveLength(1);
    expect(writes()[0].data).toMatchObject({ alliances: { red: { score: 20 } }, published: true, needsReview: false });
  });

  it("writes in batches of 400 with the audit entry in the first batch only", async () => {
    const many = Array.from({ length: 850 }, (_, i) => valid({ matchNumber: String(i + 1) }));
    // 850 distinct numbers exceed the form's range only above 9999: fine.
    const result = await upsertManualMatches(actor, event, many, { newPublished: true, newNeedsReview: false });
    expect(result.created).toBe(850);
    expect(h.commits.map((c) => c.length)).toEqual([401, 400, 50]);
    expect(auditOps()).toHaveLength(1);
  });

  it("publish and unpublish patch published and clear needsReview, with updatedAt, in 400s; the audit names the operation", async () => {
    const ids = Array.from({ length: 401 }, (_, i) => `E_Q${i + 1}`);
    await setMatchesPublished(actor, ids, true);
    expect(h.commits.map((c) => c.length)).toEqual([401, 1]);
    expect(h.commits[0][0]).toEqual({ kind: "update", path: "libraryMatches/E_Q1", data: { published: true, needsReview: false, updatedAt: NOW } });
    expect(h.commits[0][400].data).toMatchObject({ target: { op: "publish-matches", count: 401 }, after: { published: true, needsReview: false } });
    h.commits.length = 0;
    await setMatchesPublished(actor, ["E_Q1"], false);
    expect(h.commits[0][0].data).toEqual({ published: false, needsReview: false, updatedAt: NOW });
    expect(h.commits[0][1].data).toMatchObject({ target: { op: "unpublish-matches" } });
  });

  it("sets one video link on many matches, each keeping its own start and end", async () => {
    await setMatchesVideoLink(actor, [{ id: "E_Q1", video: { youtubeUrl: "x", startSec: 5, endSec: 60 } }, { id: "E_Q2", video: null }], "dQw4w9WgXcQ");
    expect(h.commits[0][0].data).toEqual({ video: { youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", startSec: 5, endSec: 60 }, updatedAt: NOW });
    expect(h.commits[0][1].data).toEqual({ video: { youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", startSec: null, endSec: null }, updatedAt: NOW });
    expect(h.commits[0][2].data).toMatchObject({ target: { op: "set-video", count: 2 } });
  });

  it("deletes matches in 400s with the audit entry first", async () => {
    await deleteManualMatches(actor, ["E_Q1", "E_Q2"]);
    expect(h.commits[0].map((o) => `${o.kind}:${o.path}`)).toEqual(["delete:libraryMatches/E_Q1", "delete:libraryMatches/E_Q2", "set:auditLog/auto-id"]);
    expect(h.commits[0][2].data).toMatchObject({ target: { op: "delete-matches", count: 2, matchIds: ["E_Q1", "E_Q2"] } });
  });

  it("the Update library backfill stamps origin and published on old docs and creates the missing event doc; idempotent", async () => {
    const matches = snap([
      ["OLD_Q1", { eventCode: "OLD", eventName: "Old", seasonId: "reefscape" }],
      ["NEW_Q1", { eventCode: "NEW", origin: "api", published: false }],
    ]);
    h.getDocs.mockResolvedValueOnce(matches).mockResolvedValueOnce(snap([]));
    const result = await backfillLibraryMetadata({ uid: "u1" });
    expect(result).toEqual({ matchesStamped: 1, eventsCreated: 2 });
    expect(h.commits[0]).toEqual([{ kind: "update", path: "libraryMatches/OLD_Q1", data: { origin: "api", published: true } }]);
    expect(h.direct[0]).toMatchObject({ kind: "set", path: "libraryEvents/OLD", data: { origin: "api", eventName: "Old", seasonId: "reefscape" } });
  });
});
