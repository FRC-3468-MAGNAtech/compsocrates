// The default program's adapter writes the root collections only, and never anything under programs/.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ paths: [] as string[], getDocs: vi.fn(), getDoc: vi.fn() }));

vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, p: string, ...s: string[]) => ({ kind: "collection", path: [p, ...s].join("/") }),
  doc: (first: { path?: string } | unknown, p?: string, ...s: string[]) => ({ kind: "doc", path: typeof p === "string" ? [p, ...s].join("/") : `${(first as { path: string }).path}/auto-id` }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  query: (ref: unknown, ...constraints: unknown[]) => ({ kind: "query", ref, constraints }),
  getDocs: (...a: unknown[]) => h.getDocs(...a),
  getDoc: (...a: unknown[]) => h.getDoc(...a),
  setDoc: async (ref: { path: string }) => void h.paths.push(ref.path),
  updateDoc: async (ref: { path: string }) => void h.paths.push(ref.path),
  serverTimestamp: () => ({}),
  onSnapshot: () => () => {},
  writeBatch: () => {
    const note = (ref: { path: string }) => void h.paths.push(ref.path);
    return { set: note, update: note, delete: note, commit: async () => {} };
  },
}));
vi.mock("@/lib/firebase/client", () => ({ db: { fake: true }, auth: { currentUser: { uid: "u1" } }, isFirebaseConfigured: () => true }));
vi.mock("@/lib/events/actions", () => ({ getEvent: vi.fn().mockResolvedValue({ ok: true, data: { name: "E" } }), getMatchesForEvent: vi.fn().mockResolvedValue({ ok: true, data: [] }) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ profile: null, user: null }) }));
vi.mock("@/lib/program/data", () => ({ useProgramData: () => null }));

import { rootLibraryAdapter } from "@/lib/library/adapter";
import { emptyRawMatch, validateRawMatch } from "@/lib/library/manual-match";

const actor = { teamId: "T1", uid: "u1", name: "Ada" };
const event = { eventCode: "MAN-DEMO-AAAA", eventName: "Demo", seasonId: "reefscape", origin: "manual" as const, date: null, sourceUrl: null, defaultVideoUrl: null, createdBy: "u1" };

beforeEach(() => {
  h.paths.length = 0;
  h.getDocs.mockResolvedValue({ empty: true, docs: [] });
  h.getDoc.mockResolvedValue({ exists: () => false });
});

describe("rootLibraryAdapter", () => {
  it("touches only root collections (libraryEvents, libraryMatches, auditLog): no programs/ftc path", async () => {
    const m = validateRawMatch({ ...emptyRawMatch(), matchNumber: "1", red1: "1", red2: "2", red3: "3", blue1: "4", blue2: "5", blue3: "6", redScore: "1", blueScore: "2" }).match!;
    await rootLibraryAdapter.createEvent(actor, { name: "Demo", code: "", date: "", sourceUrl: "", defaultVideoUrl: "" }, "reefscape", []);
    await rootLibraryAdapter.updateEvent(actor, event, { name: "Renamed", date: "", sourceUrl: "", defaultVideoUrl: "" }, ["a"]);
    await rootLibraryAdapter.upsertMatches(actor, event, [m], { newPublished: true, newNeedsReview: false, keepScores: true });
    await rootLibraryAdapter.setPublished(actor, ["a"], true);
    await rootLibraryAdapter.setVideoLink(actor, [{ id: "a", video: null }], "dQw4w9WgXcQ");
    await rootLibraryAdapter.setMatchVideo(actor, "a", null);
    await rootLibraryAdapter.deleteMatches(actor, ["a"]);
    await rootLibraryAdapter.deleteEvent(actor, event);
    await rootLibraryAdapter.importEvent(actor, { eventCode: "USWABON", seasonId: "reefscape" });
    expect(h.paths.length).toBeGreaterThan(8);
    for (const p of h.paths) expect(p, p).toMatch(/^(libraryEvents|libraryMatches|auditLog)\//);
  });

  it("an import failure comes back as a message, with nothing written", async () => {
    h.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ origin: "manual" }) });
    const outcome = await rootLibraryAdapter.importEvent(actor, { eventCode: "MAN-X", seasonId: "reefscape" });
    expect(outcome).toMatchObject({ ok: false, message: expect.stringContaining("is a manual event") });
    expect(h.paths).toHaveLength(0);
  });

  it("scores come from the API: setScores refuses for the default program", async () => {
    await expect(rootLibraryAdapter.setScores(actor, "a", null)).rejects.toThrow();
  });
});
