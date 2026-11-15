import { beforeEach, describe, expect, it, vi } from "vitest";

type Constraint = { field: string; op: string; value: unknown };
type Op = { kind: "set" | "update" | "delete"; path: string; data?: Record<string, unknown>; options?: unknown };

const h = vi.hoisted(() => ({
  commits: [] as Op[][],
  watchers: [] as { target: unknown; next: (snap: unknown) => void; error: (err: unknown) => void }[],
  getDocs: vi.fn(),
  getDoc: vi.fn(),
  commitError: null as unknown,
}));

vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, p: string, ...s: string[]) => ({ kind: "collection", path: [p, ...s].join("/") }),
  doc: (first: { path?: string } | unknown, p?: string, ...s: string[]) => ({ kind: "doc", path: typeof p === "string" ? [p, ...s].join("/") : `${(first as { path: string }).path}/auto-id` }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  query: (ref: unknown, ...constraints: unknown[]) => ({ kind: "query", ref, constraints }),
  getDocs: (...a: unknown[]) => h.getDocs(...a),
  getDoc: (...a: unknown[]) => h.getDoc(...a),
  serverTimestamp: () => ({ serverTimestamp: true }),
  onSnapshot: (target: unknown, next: (snap: unknown) => void, error: (err: unknown) => void) => {
    h.watchers.push({ target, next, error });
    return vi.fn();
  },
  writeBatch: () => {
    const ops: Op[] = [];
    return {
      set: (ref: { path: string }, data: Record<string, unknown>, options?: unknown) => ops.push({ kind: "set", path: ref.path, data, options }),
      update: (ref: { path: string }, data: Record<string, unknown>) => ops.push({ kind: "update", path: ref.path, data }),
      delete: (ref: { path: string }) => ops.push({ kind: "delete", path: ref.path }),
      commit: async () => {
        if (h.commitError) throw h.commitError;
        h.commits.push(ops);
      },
    };
  },
}));
vi.mock("@/lib/firebase/client", () => ({ db: { fake: true }, auth: { currentUser: { uid: "u1" } }, isFirebaseConfigured: () => true }));

import { createManualEvent, deleteManualEvent, deleteManualMatches, importSchedule, setMatchesPublished, setMatchesVideoLink, setMatchVideo, subscribeLibraryEvents, subscribeLibraryMatches, updateManualEvent, upsertManualMatches } from "@/data/ftc/library";
import { setMatchesPublished as frcSetMatchesPublished } from "@/lib/library/store";
import { libraryAllQuery, libraryEventQuery, librarySeasonQuery } from "@/lib/practice-queries";
import { programData } from "@/lib/program/data";
import { emptyRawMatch, validateRawMatch } from "@/lib/library/manual-match";
import type { EventMatch } from "@/lib/events/types";
import type { LibraryEvent } from "@/lib/library/store";

const actor = { teamId: "TEAM1", uid: "u1", name: "Ada" };
const ids = (n: number) => Array.from({ length: n }, (_, i) => `EV_Q${i + 1}`);
const constraintsOf = (q: unknown) => (q as { constraints: Constraint[] }).constraints.map((c) => `${c.field}${c.op}${String(c.value)}`);
const pathOf = (q: unknown) => ((q as { ref: { path: string } }).ref).path;
const manualEvent: LibraryEvent = { eventCode: "MAN-X-AAAA", eventName: "X", seasonId: "biobuzz", origin: "manual", date: null, sourceUrl: null, defaultVideoUrl: null, createdBy: "u1", teamId: "TEAM1" };

beforeEach(() => {
  h.commits.length = 0;
  h.watchers.length = 0;
  h.commitError = null;
  h.getDocs.mockReset();
  h.getDoc.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("FTC library reads", () => {
  it("events: two queries (shared API events, the team's own), under programs/ftc, equality only", () => {
    subscribeLibraryEvents("TEAM1", "biobuzz", () => {}, () => {});
    expect(h.watchers).toHaveLength(2);
    const [api, own] = h.watchers.map((w) => w.target);
    expect(pathOf(api)).toBe("programs/ftc/libraryEvents");
    expect(constraintsOf(api)).toEqual(["seasonId==biobuzz", "origin==api"]);
    expect(constraintsOf(own)).toEqual(["seasonId==biobuzz", "teamId==TEAM1"]);
  });

  it("matches of an event for a scout: both queries ask for published == true", () => {
    subscribeLibraryMatches("TEAM1", { eventCode: "EV", includeUnpublished: false }, () => {}, () => {});
    const [api, own] = h.watchers.map((w) => w.target);
    expect(pathOf(api)).toBe("programs/ftc/libraryMatches");
    expect(constraintsOf(api)).toEqual(["eventCode==EV", "published==true", "origin==api"]);
    expect(constraintsOf(own)).toEqual(["eventCode==EV", "published==true", "teamId==TEAM1"]);
  });

  it("matches by season for scouts, and an admin's drafts view has no published filter; never an orderBy or a collection group", () => {
    subscribeLibraryMatches("TEAM1", { seasonId: "biobuzz", includeUnpublished: false }, () => {}, () => {});
    expect(constraintsOf(h.watchers[0].target)).toEqual(["seasonId==biobuzz", "published==true", "origin==api"]);
    h.watchers.length = 0;
    subscribeLibraryMatches("TEAM1", { eventCode: "EV", includeUnpublished: true }, () => {}, () => {});
    expect(constraintsOf(h.watchers[0].target)).toEqual(["eventCode==EV", "origin==api"]);
    for (const w of h.watchers) expect(JSON.stringify(w.target)).not.toMatch(/orderBy|collectionGroup/);
  });

  it("delivers once both queries answered, mapping partial docs; a failed read goes to onError and never to onData", () => {
    const got: unknown[] = [];
    const errors: unknown[] = [];
    subscribeLibraryMatches("TEAM1", { eventCode: "EV", includeUnpublished: true }, (m, bad) => got.push([m.map((x) => x.id), bad]), (e) => errors.push(e));
    const snap = (docs: [string, Record<string, unknown>][]) => ({ docs: docs.map(([id, data]) => ({ id, data: () => data })) });
    h.watchers[0].next(snap([["EV_Q1", { matchType: "Qualification", matchNumber: 1, alliances: { red: { teams: [1] } } }]]));
    expect(got).toEqual([]);
    h.watchers[1].next(snap([["EV_Q2", { matchType: "Qualification", matchNumber: 2 }], ["junk", {}]]));
    expect(got).toEqual([[["EV_Q1", "EV_Q2"], 1]]);

    const failing: unknown[] = [];
    subscribeLibraryEvents("TEAM1", null, (e) => failing.push(e), (f) => errors.push(f));
    h.watchers[3].error({ code: "permission-denied", message: "no" });
    expect(failing).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: "permission-denied" });
  });
});

describe("FTC library writes", () => {
  it("publish 1000 matches: batches of 400, 400, 200; the audit entry (FTC path) rides in the first", async () => {
    const n = await setMatchesPublished(actor, ids(1000), true);
    expect(n).toBe(3);
    const matchOps = h.commits.map((c) => c.filter((o) => o.path.startsWith("programs/ftc/libraryMatches/")).length);
    expect(matchOps).toEqual([400, 400, 200]);
    const audits = h.commits.map((c) => c.filter((o) => o.path.startsWith("programs/ftc/auditLog/")).length);
    expect(audits).toEqual([1, 0, 0]);
    expect(Math.max(...h.commits.map((c) => c.length))).toBeLessThanOrEqual(401);
    expect(h.commits[0].find((o) => o.path.startsWith("programs/ftc/auditLog/"))?.data).toMatchObject({ teamId: "TEAM1", uid: "u1", action: "edit-match-library", target: { op: "publish-matches", count: 1000 } });
  });

  it("delete writes only under programs/ftc/libraryMatches", async () => {
    await deleteManualMatches(actor, ["EV_Q1"]);
    expect(h.commits[0].map((o) => o.path)).toEqual(expect.arrayContaining(["programs/ftc/libraryMatches/EV_Q1"]));
    expect(h.commits.flat().every((o) => o.path.startsWith("programs/ftc/"))).toBe(true);
  });

  it("creating a manual event stamps the team and writes an audit entry; it needs no network or key", async () => {
    const r = await createManualEvent(actor, { name: "Scrimmage", code: "", date: "", sourceUrl: "", defaultVideoUrl: "" }, "biobuzz", []);
    expect(r.ok).toBe(true);
    const ops = h.commits[0];
    const event = ops.find((o) => o.path.startsWith("programs/ftc/libraryEvents/"));
    expect(event?.data).toMatchObject({ origin: "manual", teamId: "TEAM1", seasonId: "biobuzz", createdBy: "u1" });
    expect(ops.some((o) => o.path.startsWith("programs/ftc/auditLog/") && (o.data?.target as { op: string }).op === "create-event")).toBe(true);
  });

  it("creating an event with a bad name or a taken code is refused with field errors, writing nothing", async () => {
    expect(await createManualEvent(actor, { name: " ", code: "", date: "", sourceUrl: "", defaultVideoUrl: "" }, "biobuzz", [])).toMatchObject({ ok: false });
    expect(await createManualEvent(actor, { name: "Ok", code: "MAN-X-AAAA", date: "", sourceUrl: "", defaultVideoUrl: "" }, "biobuzz", [manualEvent])).toMatchObject({ ok: false });
    expect(h.commits).toHaveLength(0);
  });

  it("a failed save surfaces an error result", async () => {
    h.commitError = { code: "permission-denied", message: "no" };
    const r = await createManualEvent(actor, { name: "Scrimmage", code: "", date: "", sourceUrl: "", defaultVideoUrl: "" }, "biobuzz", []);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("Couldn't save") });
    await expect(setMatchesPublished(actor, ["EV_Q1"], true)).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("manual create/edit: a new match is an unpublished draft, an edit keeps published", async () => {
    h.getDocs.mockResolvedValue({ docs: [{ id: "MAN-X-AAAA_Q2", data: () => ({ origin: "manual", published: true, createdBy: "first", createdAt: "2026-01-01T00:00:00.000Z" }) }] });
    const m = (n: number) => ({ matchType: "Qualification" as const, matchNumber: n, red: [1, 2], blue: [3, 4], scheduledTime: null });
    const r = await upsertManualMatches(actor, manualEvent, [m(1), m(2)]);
    expect(r).toMatchObject({ created: 1, updated: 1 });
    const sets = h.commits[0].filter((o) => o.path.startsWith("programs/ftc/libraryMatches/"));
    expect(sets.find((o) => o.path.endsWith("_Q1"))?.data).toMatchObject({ published: false, teamId: "TEAM1", origin: "manual" });
    expect(sets.find((o) => o.path.endsWith("_Q2"))?.data).toMatchObject({ published: true, createdBy: "first" });
  });

  it("typed entry publishes new matches at once; a bulk import starts them unpublished and needing review; publishing clears the review flag", async () => {
    h.getDocs.mockResolvedValue({ docs: [] });
    const m = { matchType: "Qualification" as const, matchNumber: 1, red: [1, 2], blue: [3, 4], scheduledTime: null };
    await upsertManualMatches(actor, manualEvent, [m], { newPublished: true, newNeedsReview: false });
    expect(h.commits[0].find((o) => o.path.endsWith("_Q1"))?.data).toMatchObject({ published: true });
    h.commits.length = 0;
    await upsertManualMatches(actor, manualEvent, [m], { newPublished: false, newNeedsReview: true });
    expect(h.commits[0].find((o) => o.path.endsWith("_Q1"))?.data).toMatchObject({ published: false, needsReview: true });
    h.commits.length = 0;
    await setMatchesPublished(actor, ["EV_Q1"], true);
    expect(h.commits[0].find((o) => o.path.endsWith("EV_Q1"))?.data).toMatchObject({ published: true, needsReview: false });
  });

  it("deleting a manual event follows the default program: refused while it has matches, then only the event doc goes; an imported event cannot be deleted", async () => {
    h.getDocs.mockResolvedValue({ docs: ids(3).map((id) => ({ id, data: () => ({ origin: "manual" }) })) });
    await expect(deleteManualEvent(actor, manualEvent)).rejects.toThrow("Delete this event's matches first.");
    expect(h.commits).toHaveLength(0);
    h.getDocs.mockResolvedValue({ docs: [] });
    await deleteManualEvent(actor, manualEvent);
    expect(h.commits.flat().filter((o) => o.kind === "delete").map((o) => o.path)).toEqual(["programs/ftc/libraryEvents/MAN-X-AAAA"]);
    await expect(deleteManualEvent(actor, { ...manualEvent, origin: "api" })).rejects.toThrow(/Only hand-made/);
  });

  it("edits an event and copies a new name onto its matches (400 per batch); videos are set under programs/ftc only", async () => {
    await updateManualEvent(actor, manualEvent, { name: " New ", date: "", sourceUrl: "", defaultVideoUrl: "https://youtu.be/dQw4w9WgXcQ" }, ids(450));
    const ops = h.commits.map((c) => c.filter((o) => o.kind === "update").map((o) => o.path));
    expect(ops[0]).toEqual(["programs/ftc/libraryEvents/MAN-X-AAAA"]);
    expect(h.commits[0].find((o) => o.kind === "update")?.data).toMatchObject({ eventName: "New", defaultVideoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
    expect(ops.slice(1).map((d) => d.length)).toEqual([400, 50]);
    h.commits.length = 0;
    await setMatchesVideoLink(actor, [{ id: "EV_Q1", video: { youtubeUrl: "x", startSec: 3, endSec: null } }], "dQw4w9WgXcQ");
    await setMatchVideo(actor, "EV_Q2", null);
    const writes = h.commits.flat().filter((o) => o.kind === "update");
    expect(writes.map((o) => o.path)).toEqual(["programs/ftc/libraryMatches/EV_Q1", "programs/ftc/libraryMatches/EV_Q2"]);
    expect(writes[0].data).toMatchObject({ video: { youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", startSec: 3, endSec: null } });
    expect(writes[1].data).toMatchObject({ video: null });
  });
});

/** Routes the three reads an import makes: the shared-event query, the own-event query and the event's matches. */
function routeImportReads(opts: { sharedEvent?: boolean; ownEvent?: boolean; matches?: { id: string | undefined; data: () => unknown }[]; eventsError?: unknown }) {
  h.getDocs.mockImplementation(async (q: { ref: { path: string }; constraints: Constraint[] }) => {
    if (q.ref.path.endsWith("/libraryEvents")) {
      if (opts.eventsError) throw opts.eventsError;
      const field = q.constraints.some((c) => c.field === "origin") ? "shared" : "own";
      const has = field === "shared" ? opts.sharedEvent : opts.ownEvent;
      return { empty: !has, docs: has ? [{ id: "x", data: () => ({}) }] : [] };
    }
    return { empty: !opts.matches?.length, docs: opts.matches ?? [] };
  });
}

describe("FTC schedule import writes", () => {
  const sched = (n: number): EventMatch => ({ id: `Q-${n}`, matchNumber: n, type: "Qualification", description: null, series: null, played: false, redTeams: [1, 2], blueTeams: [3, 4], redScore: null, blueScore: null, redPenaltyPoints: null, bluePenaltyPoints: null, startTime: null });
  const event = { eventCode: "USWASEAQ", eventName: "Seattle", seasonId: "biobuzz" };

  it("creates the event and matches under stable ids, then a second run writes the same ids and creates nothing new", async () => {
    routeImportReads({});
    const first = await importSchedule(actor, { event, matches: [sched(1), sched(2)] });
    expect(first).toMatchObject({ created: 2, updated: 0 });
    const written = h.commits[0].filter((o) => o.path.startsWith("programs/ftc/libraryMatches/"));
    expect(written.map((o) => o.path)).toEqual(["programs/ftc/libraryMatches/USWASEAQ_Q1", "programs/ftc/libraryMatches/USWASEAQ_Q2"]);
    expect(h.commits[0].find((o) => o.path === "programs/ftc/libraryEvents/USWASEAQ")?.data).toMatchObject({ origin: "api", seasonId: "biobuzz" });
    expect(h.commits[0].find((o) => o.path === "programs/ftc/libraryEvents/USWASEAQ")?.data).not.toHaveProperty("teamId");

    h.commits.length = 0;
    routeImportReads({ sharedEvent: true, matches: written.map((o) => ({ id: o.path.split("/").pop(), data: () => o.data })) });
    const second = await importSchedule(actor, { event, matches: [sched(1), sched(2)] });
    expect(second).toMatchObject({ created: 0, updated: 2 });
    expect(h.commits[0].filter((o) => o.path.startsWith("programs/ftc/libraryMatches/")).map((o) => o.path)).toEqual(written.map((o) => o.path));
    expect(h.commits[0].find((o) => o.path === "programs/ftc/libraryEvents/USWASEAQ")?.kind).toBe("update");
  });

  it("splits a big schedule 400 per batch", async () => {
    routeImportReads({});
    const r = await importSchedule(actor, { event, matches: Array.from({ length: 850 }, (_, i) => sched(i + 1)) });
    expect(r.batches).toBe(3);
    expect(h.commits.map((c) => c.filter((o) => o.path.startsWith("programs/ftc/libraryMatches/")).length)).toEqual([400, 400, 50]);
  });

  it("refuses a code that belongs to a hand-made event", async () => {
    routeImportReads({ ownEvent: true });
    await expect(importSchedule(actor, { event, matches: [sched(1)] })).rejects.toThrow(/hand-made/);
    expect(h.commits).toHaveLength(0);
  });

  it("never reads the event doc by id (a missing doc is unreadable under the rules); a denied write names the likely cause", async () => {
    routeImportReads({});
    await importSchedule(actor, { event, matches: [sched(1)] });
    expect(h.getDoc).not.toHaveBeenCalled();
    h.commitError = { code: "permission-denied", message: "no" };
    await expect(importSchedule(actor, { event, matches: [sched(1)] })).rejects.toThrow(/Permission denied.*another team/);
  });
});

describe("FRC still reads and writes the root collections", () => {
  it("has no library port, so its hooks keep their own reads; FTC has one", () => {
    expect(programData("frc")).toBeNull();
    expect(programData("ftc")?.library).toBeDefined();
  });

  it("its query builders are the root collections, unchanged", () => {
    const db = {} as never;
    expect(pathOf(librarySeasonQuery(db, "reefscape"))).toBe("libraryMatches");
    expect(constraintsOf(librarySeasonQuery(db, "reefscape"))).toEqual(["seasonId==reefscape", "published==true"]);
    expect(pathOf(libraryEventQuery(db, "2025wasno", false))).toBe("libraryMatches");
    expect(constraintsOf(libraryEventQuery(db, "2025wasno", true))).toEqual(["eventCode==2025wasno"]);
    expect((libraryAllQuery(db, true) as unknown as { path: string }).path).toBe("libraryMatches");
  });

  it("its store writes root libraryMatches and root auditLog (not programs/ftc)", async () => {
    await frcSetMatchesPublished({ teamId: "T", uid: "u", name: "n" }, ["2025wasno_Q1"], true);
    const paths = h.commits[0].map((o) => o.path);
    expect(paths).toContain("libraryMatches/2025wasno_Q1");
    expect(paths.some((p) => p.startsWith("auditLog/"))).toBe(true);
    expect(paths.some((p) => p.startsWith("programs/"))).toBe(false);
  });
});

describe("the shared panel's writes through the FTC port", () => {
  it("every write stays under programs/ftc (no root collection), and a match keeps its typed score, video and time", async () => {
    const lib = programData("ftc")!.library;
    h.getDocs.mockResolvedValue({ empty: true, docs: [] });
    const valid = validateRawMatch({ ...emptyRawMatch(), matchNumber: "1", red1: "1", red2: "2", blue1: "3", blue2: "4", redScore: "30", youtubeUrl: "https://youtu.be/dQw4w9WgXcQ", scheduledTime: "2026-11-15T09:30" }, { allianceSize: 2, scoresRequired: false }).match!;
    await lib.upsertMatches(actor, manualEvent, [valid], { newPublished: true, newNeedsReview: false });
    await lib.setPublished(actor, ["EV_Q1"], true);
    await lib.setScores(actor, "EV_Q1", { red: { score: 1, penaltyPoints: 0 }, blue: { score: 2, penaltyPoints: 0 } });
    await lib.setVideoLink(actor, [{ id: "EV_Q1", video: null }], "dQw4w9WgXcQ");
    await lib.setMatchVideo(actor, "EV_Q1", null);
    await lib.updateEvent(actor, manualEvent, { name: "Renamed", date: "", sourceUrl: "", defaultVideoUrl: "" }, ["EV_Q1"]);
    await lib.deleteMatches(actor, ["EV_Q1"]);
    const ops = h.commits.flat();
    expect(ops.length).toBeGreaterThan(8);
    for (const o of ops) expect(o.path, o.path).toMatch(/^programs\/ftc\//);
    const written = ops.find((o) => o.kind === "set" && o.path === "programs/ftc/libraryMatches/MAN-X-AAAA_Q1")!;
    expect(written.data).toMatchObject({ alliances: { red: { teams: [1, 2], score: 30, penaltyPoints: 0 }, blue: { teams: [3, 4] } }, video: { youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }, published: true });
    expect((written.data as { alliances: { blue: object } }).alliances.blue).not.toHaveProperty("score");
    expect(written.data?.scheduledTime).toMatch(/^2026-11-15T/);
  });
});
