// Characterization of the FRC (root) import from the events API, BEFORE the library merge: same input, same documents and ids.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sets: [] as { path: string; data: Record<string, unknown>; options?: unknown }[],
  updates: [] as { path: string; data: Record<string, unknown> }[],
  docs: new Map<string, Record<string, unknown>>(),
  getEvent: vi.fn(),
  getMatches: vi.fn(),
}));

vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, p: string) => ({ kind: "collection", path: p }),
  doc: (_db: unknown, p: string, id: string) => ({ kind: "doc", path: `${p}/${id}` }),
  getDoc: async (ref: { path: string }) => ({ exists: () => h.docs.has(ref.path), data: () => h.docs.get(ref.path) }),
  getDocs: async () => ({ docs: [] }),
  setDoc: async (ref: { path: string }, data: Record<string, unknown>, options?: unknown) => {
    h.sets.push({ path: ref.path, data, options });
    h.docs.set(ref.path, { ...(options ? h.docs.get(ref.path) : {}), ...data });
  },
  updateDoc: async (ref: { path: string }, data: Record<string, unknown>) => void h.updates.push({ path: ref.path, data }),
  onSnapshot: () => () => {},
}));
vi.mock("@/lib/firebase/client", () => ({ db: { fake: true }, auth: { currentUser: { uid: "u1" } }, isFirebaseConfigured: () => true }));
vi.mock("@/lib/events/actions", () => ({ getEvent: (...a: unknown[]) => h.getEvent(...a), getMatchesForEvent: (...a: unknown[]) => h.getMatches(...a) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ profile: null, user: null }) }));
vi.mock("@/lib/program/data", () => ({ useProgramData: () => null }));

import { importLibraryEvent } from "@/lib/match-library";

const NOW = "2026-03-01T12:00:00.000Z";
const played = (n: number, over: Record<string, unknown> = {}) => ({ matchNumber: n, redTeams: [254, 1114, 2056], blueTeams: [1678, 971, 118], redScore: 90, blueScore: 70, redPenaltyPoints: 4, bluePenaltyPoints: null, ...over });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  h.sets.length = 0;
  h.updates.length = 0;
  h.docs.clear();
  h.getEvent.mockReset();
  h.getMatches.mockReset();
  h.getEvent.mockResolvedValue({ ok: true, data: { name: "Bonney Lake" } });
  h.getMatches.mockImplementation(async (_code: string, type: string) => ({
    ok: true,
    data: type === "Qualification" ? [played(1), played(2, { redScore: null }), played(3, { redTeams: [1] })] : type === "Playoff" ? [played(1)] : [],
  }));
});
afterEach(() => vi.useRealTimers());

describe("FRC import (importLibraryEvent)", () => {
  it("writes the event doc (origin api) and each PLAYED, valid match at libraryMatches/<code>_<type><n>, published, with difficulty", async () => {
    const summary = await importLibraryEvent("reefscape", "USWABON");
    expect(summary).toEqual({ eventName: "Bonney Lake", imported: 2, skipped: 2, skippedManual: [] });
    const event = h.sets.find((s) => s.path === "libraryEvents/USWABON");
    expect(event?.data).toEqual({ eventCode: "USWABON", eventName: "Bonney Lake", seasonId: "reefscape", origin: "api", date: null, sourceUrl: null, defaultVideoUrl: null, createdBy: "u1", createdAt: NOW, updatedAt: NOW });
    const matches = h.sets.filter((s) => s.path.startsWith("libraryMatches/"));
    expect(matches.map((m) => m.path)).toEqual(["libraryMatches/USWABON_Q1", "libraryMatches/USWABON_F1"]);
    expect(matches[0].options).toEqual({ merge: true });
    expect(matches[0].data).toEqual({
      seasonId: "reefscape",
      eventCode: "USWABON",
      eventName: "Bonney Lake",
      matchType: "Qualification",
      matchNumber: 1,
      alliances: {
        red: { teams: [254, 1114, 2056], score: 90, penaltyPoints: 4, difficulty: expect.any(String) },
        blue: { teams: [1678, 971, 118], score: 70, penaltyPoints: 0, difficulty: expect.any(String) },
      },
      scoresUpdatedAt: NOW,
      origin: "api",
      video: null,
      importedAt: NOW,
      published: true,
    });
    expect(matches[1].data).toMatchObject({ matchType: "Playoff", matchNumber: 1 });
  });

  it("running it twice rewrites the same ids (no duplicates) and keeps an admin's published choice, video and first-import time", async () => {
    await importLibraryEvent("reefscape", "USWABON");
    h.docs.set("libraryMatches/USWABON_Q1", { ...h.docs.get("libraryMatches/USWABON_Q1"), published: false, video: { youtubeUrl: "u" } });
    h.sets.length = 0;
    h.updates.length = 0;
    await importLibraryEvent("reefscape", "USWABON");
    expect(h.updates).toEqual([{ path: "libraryEvents/USWABON", data: { eventName: "Bonney Lake", updatedAt: NOW } }]);
    const again = h.sets.filter((s) => s.path.startsWith("libraryMatches/"));
    expect(again.map((m) => m.path)).toEqual(["libraryMatches/USWABON_Q1", "libraryMatches/USWABON_F1"]);
    expect(again[0].data).not.toHaveProperty("published");
    expect(again[0].data).not.toHaveProperty("video");
    expect(again[0].data).not.toHaveProperty("importedAt");
  });

  it("never overwrites a manual match, and refuses an event code that belongs to a manual event", async () => {
    h.docs.set("libraryMatches/USWABON_Q1", { origin: "manual" });
    const summary = await importLibraryEvent("reefscape", "USWABON");
    expect(summary.skippedManual).toEqual(["USWABON_Q1"]);
    expect(h.sets.map((s) => s.path)).not.toContain("libraryMatches/USWABON_Q1");

    h.docs.set("libraryEvents/MAN-X", { origin: "manual" });
    await expect(importLibraryEvent("reefscape", "MAN-X")).rejects.toThrow("MAN-X is a manual event");
  });

  it("an API failure or an unknown event is an error and writes nothing", async () => {
    h.getEvent.mockResolvedValueOnce({ ok: false, error: { message: "API down" } });
    await expect(importLibraryEvent("reefscape", "USWABON")).rejects.toThrow("API down");
    h.getEvent.mockResolvedValueOnce({ ok: true, data: null });
    await expect(importLibraryEvent("reefscape", "NOPE")).rejects.toThrow('No event found with code "NOPE"');
    expect(h.sets).toHaveLength(0);
  });
});
