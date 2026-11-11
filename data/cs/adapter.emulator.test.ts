import { generateKeyPairSync } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { signInWithEmailAndPassword } from "firebase/auth";
import { collection, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";
import { chargedUpDoc, leadDoc, practiceDoc, reefscapeDoc, rebuiltDoc, rebuiltDocWithUnknowns, subInDoc } from "@/data/cs/fixtures";
import type { CsRecord } from "@/data/cs/types";
import { scoreEntryForGame, type ScoringEntry } from "@/lib/games/cs-oracle/analyticsScoring";
import { evaluateScoutingFlags } from "@/lib/games/cs-oracle/scoutingFlags";
import type { ScheduleSlot } from "@/lib/scheduler/types";
import type { FormEntryType, NewFormEntry } from "@/lib/form-entries-model";
import type { AssignmentVersion } from "@/lib/assignments";
import type { TeamAssignVersion } from "@/lib/team-assignments/model";
import type { FormValues } from "@/lib/forms/types";

// Integration tests: the rebuild's REAL adapter functions (lib/scout-entries.ts, lib/form-entries.ts, lib/assignments.ts, lib/sub-ins/store.ts, ...)
// run through the Firebase CLIENT SDK, signed in through the Auth emulator, against the Firestore emulator with the REAL firestore.rules. CS-shaped
// documents are seeded with the Admin SDK (which bypasses the rules) and every write is read back raw through the Admin SDK, so the assertions are
// on the stored documents, not only on the converted objects. Needs the Emulator Suite: `npm run test:rules`. Demo project only (.firebaserc).
//
// Two things to know:
//  - lib/firebase/client.ts exports ONE signed-in user at a time (the `auth` singleton), so "as two different members" means signing in and out
//    between calls (`as(uid)`). The transactions are therefore sequential (the one concurrent case below is the same user twice).
//  - Under Node there is no React renderer (no jsdom / react-test-renderer in this repo), so `react` is replaced by a tiny synchronous hook runtime
//    (`renderHook` below: useState / useEffect / useMemo / useCallback / useRef). That lets the REAL hooks (useTeamScoutEntries, useFormEntries,
//    useTeamDoc, useAssignments, useSubInRequests, usePickList, ...) subscribe through the real SDK; nothing else about them is faked. Only
//    AuthProvider (lib/auth.tsx) is not mounted: its profile path (onSnapshot users/{uid} -> csUserToProfile, updateUserProfile ->
//    profilePatchToCsUser + setDoc merge) is replayed line for line in section 3.

const rt = vi.hoisted(() => {
  type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: (() => void) | void; set?: (next: unknown) => void; ready?: boolean };
  type Instance = { slots: Slot[]; index: number; pending: Array<() => void>; schedule: () => void; unmounted: boolean; scheduled: boolean };
  const state: { current: Instance | null } = { current: null };
  const cur = (): Instance => {
    if (!state.current) throw new Error("A hook ran outside renderHook() in adapter.emulator.test.ts");
    return state.current;
  };
  const take = (): { inst: Instance; slot: Slot } => {
    const inst = cur();
    const slot = (inst.slots[inst.index] ??= {});
    inst.index += 1;
    return { inst, slot };
  };
  const same = (a?: readonly unknown[], b?: readonly unknown[]): boolean => !!a && !!b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));

  function useState<S>(init: S | (() => S)): [S, (next: S | ((prev: S) => S)) => void] {
    const { inst, slot } = take();
    if (!slot.ready) {
      slot.ready = true;
      slot.value = typeof init === "function" ? (init as () => S)() : init;
      slot.set = (next) => {
        const value = typeof next === "function" ? (next as (prev: unknown) => unknown)(slot.value) : next;
        if (Object.is(value, slot.value)) return;
        slot.value = value;
        inst.schedule();
      };
    }
    return [slot.value as S, slot.set as (next: S | ((prev: S) => S)) => void];
  }
  function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void {
    const { inst, slot } = take();
    if (deps !== undefined && same(slot.deps, deps)) return;
    slot.deps = deps;
    inst.pending.push(() => {
      slot.cleanup?.();
      slot.cleanup = effect();
    });
  }
  function useMemo<T>(factory: () => T, deps: readonly unknown[]): T {
    const { slot } = take();
    if (!slot.ready || !same(slot.deps, deps)) {
      slot.ready = true;
      slot.deps = deps;
      slot.value = factory();
    }
    return slot.value as T;
  }
  function useCallback<T>(fn: T, deps: readonly unknown[]): T {
    const { slot } = take();
    if (!slot.ready || !same(slot.deps, deps)) {
      slot.ready = true;
      slot.deps = deps;
      slot.value = fn;
    }
    return slot.value as T;
  }
  function useRef<T>(init: T): { current: T } {
    const { slot } = take();
    if (!slot.ready) {
      slot.ready = true;
      slot.value = { current: init };
    }
    return slot.value as { current: T };
  }
  function useSyncExternalStore<T>(_subscribe: unknown, getSnapshot: () => T): T {
    return getSnapshot();
  }

  function renderHook<T>(fn: () => T) {
    const inst: Instance = { slots: [], index: 0, pending: [], unmounted: false, scheduled: false, schedule: () => {} };
    const result = { current: undefined as T };
    const render = () => {
      state.current = inst;
      inst.index = 0;
      inst.pending = [];
      try {
        result.current = fn();
      } finally {
        state.current = null;
      }
      const run = inst.pending;
      inst.pending = [];
      run.forEach((effect) => effect());
    };
    inst.schedule = () => {
      if (inst.scheduled || inst.unmounted) return;
      inst.scheduled = true;
      queueMicrotask(() => {
        inst.scheduled = false;
        if (!inst.unmounted) render();
      });
    };
    render();
    return {
      result,
      unmount: () => {
        inst.unmounted = true;
        inst.slots.forEach((slot) => slot.cleanup?.());
      },
      /** Polls the hook's latest value until `done` holds (the real listeners deliver asynchronously). */
      async waitFor(done: (value: T) => boolean, timeoutMs = 10000): Promise<T> {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (done(result.current)) return result.current;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error(`renderHook.waitFor timed out; last value: ${JSON.stringify(result.current)?.slice(0, 600)}`);
      },
    };
  }
  return { useState, useEffect, useMemo, useCallback, useRef, useSyncExternalStore, renderHook };
});

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, default: actual, useState: rt.useState, useEffect: rt.useEffect, useMemo: rt.useMemo, useCallback: rt.useCallback, useRef: rt.useRef, useSyncExternalStore: rt.useSyncExternalStore };
});
// useAssignments asks the event facade for the match schedule (TBA over the network). The tests have no schedule: slot positions fall back to
// "first free slot" (documented in data/cs/assignments.ts), which is what the stored rows are matched by anyway.
vi.mock("@/lib/events/use-event-query", () => ({ useEventQuery: () => ({ data: [], error: null, loading: false }) }));
vi.mock("@/lib/events/actions", () => ({ getMatchesForEvent: async () => ({ ok: true, data: [] }) }));

const { renderHook } = rt;

const PROJECT_ID = process.env.GCLOUD_PROJECT || "demo-compsocrates-rebuild";
if (!PROJECT_ID.startsWith("demo-")) throw new Error(`Refusing to run against a non-demo project: ${PROJECT_ID}`);

const { privateKey: THROWAWAY_PRIVATE_KEY } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR = "1";
process.env.NEXT_PUBLIC_FIREBASE_API_KEY = "fake-api-key";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = PROJECT_ID;
process.env.NEXT_PUBLIC_FIREBASE_APP_ID = "1:1:web:demo";
process.env.FIREBASE_ADMIN_PROJECT_ID = PROJECT_ID;
process.env.FIREBASE_ADMIN_CLIENT_EMAIL = "test@example.com";
process.env.FIREBASE_ADMIN_PRIVATE_KEY = THROWAWAY_PRIVATE_KEY;

const { auth, db } = await import("@/lib/firebase/client");
const { getAdminAuth, getAdminFirestore } = await import("@/lib/firebase/admin");
const { normalizeEventKey } = await import("@/config/event");
const scoutEntries = await import("@/lib/scout-entries");
const formEntries = await import("@/lib/form-entries");
const assignments = await import("@/lib/assignments");
const teamAssignments = await import("@/lib/team-assignments/store");
const eventAttendance = await import("@/lib/event-attendance");
const pickList = await import("@/lib/pick-list/store");
const subIns = await import("@/lib/sub-ins/store");
const subInModel = await import("@/lib/sub-ins/model");
const teamLib = await import("@/lib/team");
const teamMembers = await import("@/lib/team-members");
const practiceSessions = await import("@/lib/practice-sessions");
const csScouting = await import("@/data/cs/scouting");
const csUsers = await import("@/data/cs/users");
const csTeams = await import("@/data/cs/teams");
const { rebuiltPlugin } = await import("@/lib/games/rebuilt");
const { REBUILT_FORM } = await import("@/lib/forms/builtin-rebuilt");
const { calculateScore } = await import("@/lib/forms/scoring");
const { BUILTIN_FORMS } = await import("@/lib/forms/builtin");
const { defaultValues: formDefaultValues } = await import("@/lib/forms/values");

const admin = () => getAdminFirestore()!;
const PASSWORD = "password123";
const emailOf = (uid: string) => `${uid.toLowerCase()}@example.com`;

/** Wipes every Firestore document and Auth account of the emulator project (the emulators' own REST endpoints). */
async function wipeEmulators(): Promise<void> {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: "DELETE" });
}

let teamCounter = 0;
/** A fresh upper-case team code per test: lib/scout-entries.ts caches its legacy-row fallback (and the flag listeners) per team for the session. */
const newTeamCode = (): string => `TC${Date.now().toString(36).toUpperCase()}${teamCounter++}`;

type SeedUser = { role?: string; isTeamAdmin?: boolean; extra?: CsRecord };

/** A CS `users/{uid}` doc (Admin SDK) plus its Auth emulator account, so the client can sign in as it. The uid is `${team}-${key}`. */
async function seedUser(teamId: string, key: string, opts: SeedUser = {}): Promise<string> {
  const uid = `${teamId}-${key}`;
  await getAdminAuth()!.createUser({ uid, email: emailOf(uid), password: PASSWORD });
  await admin()
    .doc(`users/${uid}`)
    .set({ uid, email: emailOf(uid), displayName: `${key} of ${teamId}`, role: opts.role ?? "match-scout", isTeamAdmin: opts.isTeamAdmin ?? false, teamId, ...opts.extra });
  return uid;
}

/** Signs the `auth` singleton in as `uid` (no-op when already). Every adapter call after this is subject to the rules as that user. */
async function as(uid: string): Promise<string> {
  if (auth.currentUser?.uid !== uid) await signInWithEmailAndPassword(auth, emailOf(uid), PASSWORD);
  return uid;
}

/** The stored document, straight from the Admin SDK (no converters, no rules). */
async function raw(path: string): Promise<CsRecord | undefined> {
  return (await admin().doc(path).get()).data();
}
async function seed(path: string, data: CsRecord): Promise<void> {
  await admin().doc(path).set(data);
}
const without = (data: CsRecord, ...keys: string[]): CsRecord => Object.fromEntries(Object.entries(data).filter(([key]) => !keys.includes(key)));
const rec = (value: unknown): CsRecord => value as CsRecord;

/** Every doc of one team in a collection, with its server `updateTime` (to prove a doc was not rewritten). */
async function rowsOf(collectionName: string, teamId: string): Promise<Array<{ id: string; data: CsRecord; stamp: string }>> {
  const snap = await admin().collection(collectionName).where("teamId", "==", teamId).get();
  return snap.docs.map((d) => ({ id: d.id, data: d.data(), stamp: `${d.updateTime.seconds}.${d.updateTime.nanoseconds}` }));
}
const stampsOf = (rows: Array<{ id: string; stamp: string }>): Record<string, string> => Object.fromEntries(rows.map((r) => [r.id, r.stamp]));

/** The promise rejects with Firestore's permission-denied (the real rules said no). */
async function denied(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code: "permission-denied" });
}

beforeAll(() => {
  expect(auth, "lib/firebase/client.ts must be configured for the emulator (NEXT_PUBLIC_USE_FIREBASE_EMULATOR=1)").toBeTruthy();
  expect(db).toBeTruthy();
});

beforeEach(async () => {
  await wipeEmulators();
  await auth.signOut();
});

type OracleGame = "REBUILT" | "REEFSCAPE" | "CHARGED_UP";
const oracleTotal = (data: CsRecord, game: OracleGame): number => scoreEntryForGame(data as ScoringEntry, game);

// ---------------------------------------------------------------------------------------------------------------------
// 1. Reading a seeded CS `scouting` collection
// ---------------------------------------------------------------------------------------------------------------------

async function seedScouting() {
  const team = newTeamCode();
  const ada = await seedUser(team, "ada");
  const grace = await seedUser(team, "grace");
  const other = newTeamCode();
  const stranger = await seedUser(other, "stranger");
  const docs: Record<string, CsRecord> = {
    rebuilt: rebuiltDoc({ teamId: team, scoutId: ada }),
    reefscape: reefscapeDoc({ teamId: team, scoutId: grace, excludeFromStats: true }),
    chargedUp: chargedUpDoc({ teamId: team }),
    practice: practiceDoc({ teamId: team, scoutId: grace }),
    zero: rebuiltDoc({ teamId: team, scoutId: ada, matchId: "q40", matchNumber: "40", auto: {}, teleop: {}, endgame: {}, incidents: [] }),
    // CS rows the rebuild must skip
    subIn: { ...subInDoc(), teamId: team, scoutId: ada, matchId: "q99", matchKey: "q99", matchNumber: "99" },
    lead: { ...leadDoc(), teamId: team, scoutId: ada },
    unknownGame: rebuiltDoc({ teamId: team, game: "SOME_FUTURE_GAME" }),
    // a legacy row with no teamId written by a member (found through scoutId), and one by somebody unknown
    legacyMember: without(rebuiltDoc({ scoutId: ada, matchId: "q30", matchNumber: "30", teamNumber: "999" }), "teamId"),
    legacyStranger: without(rebuiltDoc({ scoutId: "someone-else", scoutName: "Nobody Known", matchId: "q31" }), "teamId"),
    // another team's rows: stamped with its teamId, they belong to that team even when the scout is also on this roster
    otherTeam: rebuiltDoc({ teamId: other, scoutId: stranger }),
    otherTeamBySameScout: rebuiltDoc({ teamId: other, scoutId: ada, matchId: "q32" }),
  };
  for (const [id, data] of Object.entries(docs)) await seed(`scouting/${id}`, data);
  return { team, ada, grace, other, stranger, docs };
}

describe("1. scouting reads (getEntries, the query behind useTeamScoutEntries)", () => {
  it("returns exactly the official and practice rows (plus the member's teamId-less row), scored like the CS oracle", async () => {
    const { team, ada, docs } = await seedScouting();
    await as(ada);
    const entries = await scoutEntries.getEntries(team);

    expect(entries.map((e) => e.id).sort()).toEqual(["chargedUp", "legacyMember", "practice", "rebuilt", "reefscape", "zero"]);
    const byId = new Map(entries.map((e) => [e.id, e]));

    expect(byId.get("rebuilt")!.score.total).toBe(oracleTotal(docs.rebuilt, "REBUILT"));
    expect(byId.get("rebuilt")!.score).toEqual({ auto: 106, teleop: 77, endgame: 38, total: 221 });
    expect(byId.get("reefscape")!.score.total).toBe(oracleTotal(docs.reefscape, "REEFSCAPE"));
    expect(byId.get("chargedUp")!.score.total).toBe(oracleTotal(docs.chargedUp, "CHARGED_UP"));
    expect(byId.get("practice")!.score.total).toBe(oracleTotal(docs.practice, "REBUILT"));
    expect(byId.get("legacyMember")!.score.total).toBe(oracleTotal(docs.legacyMember, "REBUILT"));
    expect(byId.get("zero")!.score.total).toBe(oracleTotal(docs.zero, "REBUILT"));

    expect(byId.get("rebuilt")).toMatchObject({ teamId: team, uid: ada, game: "REBUILT", source: "event", eventCode: "2026arli", matchType: "Qualification", matchNumber: 12, teamNumber: 1234 });
    // an older REEFSCAPE row has no `game`: it reads as REEFSCAPE (alias event key, `sf5` parsed as bracket slot 5, " 254 " as 254)
    expect(byId.get("reefscape")).toMatchObject({ game: "REEFSCAPE", source: "event", matchType: "Playoff", matchNumber: 5, teamNumber: 254, excluded: true });
    expect(byId.get("chargedUp")).toMatchObject({ game: "CHARGED_UP", matchType: "Playoff", matchNumber: 14 });
    expect(byId.get("practice")).toMatchObject({ source: "practice", mode: "trial", sessionId: "session-1" });
    // the teamId-less row was reached through the member's scoutId and adopted into the team
    expect(byId.get("legacyMember")).toMatchObject({ teamId: team, uid: ada, matchNumber: 30, teamNumber: 999 });
  });

  it("applies scoutingFlagStates (manual flag, dismissal, exclude-from-accuracy)", async () => {
    const { team, ada, docs } = await seedScouting();
    await seed("scoutingFlagStates/scoutingEntry:rebuilt", { teamId: team, entityType: "scoutingEntry", entityId: "rebuilt", dismissed: false, manualFlagged: true, manualReason: "no-teleop-score", manualFlaggedAt: 1_776_000_500_000, excludeFromAccuracy: true });
    await seed("scoutingFlagStates/scoutingEntry:zero", { teamId: team, entityType: "scoutingEntry", entityId: "zero", dismissed: true, dismissedBy: ada });
    // a state stamped with another team is invisible to this team (the rules scope the list query), so it never lands on this team's entry
    await seed("scoutingFlagStates/scoutingEntry:practice", { teamId: "SOMEONEELSE", entityType: "scoutingEntry", entityId: "practice", manualFlagged: true, manualReason: "other" });
    await as(ada);
    const byId = new Map((await scoutEntries.getEntries(team)).map((e) => [e.id, e]));

    expect(byId.get("rebuilt")!.manualFlags).toEqual([{ id: "cs-manual", reason: "No teleop score", addedAt: new Date(1_776_000_500_000).toISOString() }]);
    expect(byId.get("rebuilt")!.excludeFromAccuracy).toBe(true);
    expect(byId.get("rebuilt")!.excluded).toBe(false);
    const expectedFlags = evaluateScoutingFlags(docs.zero as never).map((f) => f.code);
    expect(expectedFlags).toContain("zero-main-scoring");
    expect(byId.get("zero")!.autoFlags).toEqual(expectedFlags.map((ruleId) => ({ ruleId, dismissed: true })));
    expect(byId.get("rebuilt")!.autoFlags.every((f) => !f.dismissed)).toBe(true);
    expect(byId.get("practice")!.manualFlags).toEqual([]);
  });

  it("the real useTeamScoutEntries hook streams the same entries (rows + legacy fallback + flag states)", async () => {
    const { team, ada, docs } = await seedScouting();
    await seed("scoutingFlagStates/scoutingEntry:rebuilt", { teamId: team, entityType: "scoutingEntry", entityId: "rebuilt", manualFlagged: true, manualReason: "other" });
    await as(ada);
    const hook = renderHook(() => scoutEntries.useTeamScoutEntries(team));
    const state = await hook.waitFor((s) => s.loaded && s.entries.some((e) => e.id === "legacyMember") && (s.entries.find((e) => e.id === "rebuilt")?.manualFlags.length ?? 0) === 1);
    expect(state.entries.map((e) => e.id).sort()).toEqual(["chargedUp", "legacyMember", "practice", "rebuilt", "reefscape", "zero"]);
    for (const e of state.entries) {
      const game = e.game as OracleGame;
      const stored = docs[e.id];
      expect(e.score.total).toBe(oracleTotal(stored, game));
    }
    hook.unmount();
  });

  it("getEntriesForEvent / subscribeEntries return only the event-sourced rows of that event (aliases included)", async () => {
    const { team, ada } = await seedScouting();
    await as(ada);
    // rebuilt + zero are the event rows of 2026arli; the practice row carries the same event key but is a practice session; legacyMember has no teamId
    const forEvent = await scoutEntries.getEntriesForEvent(team, "2026arli");
    expect(forEvent.map((e) => e.id).sort()).toEqual(["rebuilt", "zero"]);
    expect(forEvent.every((e) => e.source === "event")).toBe(true);
    // the reefscape row is stored with the legacy alias `2025lake`: asking for either spelling of the event finds it
    expect((await scoutEntries.getEntriesForEvent(team, "2025lake")).map((e) => e.id)).toContain("reefscape");
    expect((await scoutEntries.getEntriesForEvent(team, normalizeEventKey("2025lake"))).map((e) => e.id)).toContain("reefscape");

    const live = await new Promise<string[]>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("subscribeEntries timed out")), 8000);
      const stop = scoutEntries.subscribeEntries(team, "2026arli", (entries) => {
        clearTimeout(timer);
        stop();
        resolve(entries.map((e) => e.id).sort());
      });
    });
    expect(live).toEqual(["rebuilt", "zero"]);
  });

  it("getEntriesForSession finds the practice session's rows", async () => {
    const { team, grace } = await seedScouting();
    await as(grace);
    expect((await scoutEntries.getEntriesForSession(team, "session-1")).map((e) => e.id)).toEqual(["practice"]);
  });

  it("fetchCompletedMatchKeys counts official, lead, plan and drive rows of the event, never sub-in or practice-session rows", async () => {
    const { team, ada } = await seedScouting();
    await seed("leadScouting/l1", { teamId: team, eventKey: "2026arli", game: "REBUILT", matchKey: "q15", matchId: "q15", matchType: "qualification", matchNumber: "15", entryType: "lead", scoutId: ada });
    await seed("matchStrategyPlans/m1", { teamId: team, eventKey: "2026arli", game: "REBUILT", matchKey: "2026arli_qm16", scoutId: ada, robots: [] });
    await as(ada);
    const done = await formEntries.fetchCompletedMatchKeys(team, "2026arli");
    expect([...done.byCollection.scouting].sort()).toEqual(["Q12", "Q40"]);
    expect([...done.byCollection.leadScouting]).toContain("Q15");
    expect([...done.byCollection.matchStrategyPlans]).toEqual(["Q16"]);
    expect(done.keys.has("Q99")).toBe(false); // the sub-in request row
    expect(done.keys.has("Q7")).toBe(false); // the practice-session row
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// 2. Writes: saveEntry / updateEntry / deleteEntry
// ---------------------------------------------------------------------------------------------------------------------

describe("2. scouting writes", () => {
  function rebuiltInput(overrides: Partial<Parameters<typeof scoutEntries.saveEntry>[2]> = {}): Parameters<typeof scoutEntries.saveEntry>[2] {
    const values = csScouting.docToFormValues(rebuiltPlugin, rebuiltDoc()) as FormValues; // same flat keys as the form (lib/games/types.ts KEY CONVENTION)
    const score = calculateScore(REBUILT_FORM, values);
    return { scoutName: "Ada Lovelace", eventCode: "2026arli", matchType: "Qualification", matchNumber: 12, teamNumber: 1234, ...scoutEntries.entryPayloadFor(REBUILT_FORM, values, score), ...overrides };
  }

  it("saveEntry of a REBUILT submission stores exactly the document CS's scout form writes", async () => {
    const team = newTeamCode();
    const ada = await seedUser(team, "ada");
    await as(ada);
    const before = Date.now();
    await scoutEntries.saveEntry(team, ada, rebuiltInput());
    const stored = await rowsOf("scouting", team);
    expect(stored).toHaveLength(1);
    const data = stored[0].data;

    const csForm = rebuiltDoc({ teamId: team, scoutId: ada, submittedAt: expect.any(Number), timestamp: expect.any(Number) });
    // the one deliberate addition over today's CS scout form: D8's per-shift human-player split (additive; `teleop.humanPlayerFuel` stays the CS counter)
    const expected = { ...csForm, teleop: { ...rec(csForm.teleop), humanPlayerFuelByShift: { transition: 7, shift1: 0, shift2: 0, shift3: 0, shift4: 0 } } };
    expect(data).toEqual(expected);
    expect(data.submittedAt).toBe(data.timestamp);
    expect(data.submittedAt as number).toBeGreaterThanOrEqual(before);
    // the app-only fields never reach the CS document
    for (const key of ["values", "formId", "formVersion", "source", "score", "excluded", "autoFlags", "manualFlags", "legacy", "uid"]) expect(data).not.toHaveProperty(key);
    expect(typeof data.matchNumber).toBe("string");
    expect(typeof data.teamNumber).toBe("string");

    // and CS (the oracle) reads the same number off the stored document
    const [entry] = await scoutEntries.getEntries(team);
    expect(entry.score.total).toBe(oracleTotal(data, "REBUILT"));
    expect(entry.score.total).toBe(221);
  });

  it("saveEntry of a practice-scouting row adds the practice markers CS reads", async () => {
    const team = newTeamCode();
    const ada = await seedUser(team, "ada");
    await as(ada);
    await scoutEntries.saveEntry(team, ada, rebuiltInput({ source: "practice", mode: "competitive", sessionId: "PS-ABC234", libraryMatchId: "cs:2026arli_Q7", matchType: "Qualification", matchNumber: 7 }));
    const [row] = await rowsOf("scouting", team);
    expect(row.data).toMatchObject({ isPracticeScouting: true, practiceMode: "competitive", practiceSessionId: "PS-ABC234", practiceMatchId: "cs:2026arli_Q7", matchId: "q7", matchType: "qualification", matchNumber: "7" });
    const [entry] = await scoutEntries.getEntriesForSession(team, "PS-ABC234");
    expect(entry).toMatchObject({ id: row.id, source: "practice", mode: "competitive", sessionId: "PS-ABC234" });
  });

  it("saveEntry refuses a form CS cannot store and writes nothing", async () => {
    const team = newTeamCode();
    const ada = await seedUser(team, "ada");
    await as(ada);
    await expect(scoutEntries.saveEntry(team, ada, rebuiltInput({ formId: "some-custom-form" }))).rejects.toThrow(/cannot be stored/);
    expect(await rowsOf("scouting", team)).toHaveLength(0);
  });

  // Per game: a submission of the game's own generated form goes through saveEntry (the same conversion as the pure data/cs/per-game.test.ts), is read back
  // from the stored document, and scores what CS's own scoring gives that document. REEFSCAPE and CHARGED UP are writable like REBUILT.
  describe.each([
    {
      game: "REEFSCAPE" as const,
      formId: "reefscape",
      entered: { startingPosition: "middle", leftStartingZone: true, autoCoralL4: 2, teleopCoralL2: 3, teleopNetHumanScored: 1, stageStatus: "deep", penaltyPoints: 5, incidents_tipped: true, notes: "fast" },
      raw: { game: "REEFSCAPE", leftStartingZone: true, autoCoralL4: 2, teleopCoralL2: 3, teleopNetHumanScored: 1, stageStatus: "deep", penaltyPoints: 5, incidents: ["tipped"], notes: "fast" },
      total: 47,
    },
    {
      game: "CHARGED_UP" as const,
      formId: "charged_up",
      entered: { startingPosition: "Middle", mobility: true, auto_gridTop: 2, auto_chargeStation: "engaged", teleop_gridMiddle: 3, teleop_links: 1, endgame_chargeStation: "docked", penaltyPoints: 4, incidents_died: true, notes: "late" },
      raw: {
        game: "CHARGED_UP",
        mobility: true,
        auto: { mobility: true, gridTop: 2, chargeStation: "engaged" },
        teleop: { gridMiddle: 3, links: 1 },
        endgame: { chargeStation: "docked" },
        penaltyPoints: 4,
        incidents: ["died"],
        notes: "late",
      },
      total: 51,
    },
  ])("saveEntry of a $game submission", ({ game, formId, entered, raw, total }) => {
    it("stores the raw CS document, reads back with the oracle score, and a practice row carries the markers", async () => {
      const form = BUILTIN_FORMS[formId];
      const team = newTeamCode();
      const ada = await seedUser(team, "ada");
      await as(ada);
      const values: FormValues = { ...formDefaultValues(form), ...(entered as unknown as FormValues) };
      const input = { scoutName: "Ada Lovelace", eventCode: "2026arli", matchType: "Qualification" as const, matchNumber: 12, teamNumber: 1234, ...scoutEntries.entryPayloadFor(form, values, calculateScore(form, values)) };
      await scoutEntries.saveEntry(team, ada, input);
      await scoutEntries.saveEntry(team, ada, { ...input, matchNumber: 7, source: "practice", mode: "trial", sessionId: "PS-GAME01", libraryMatchId: "cs:2026arli_Q7" });

      const stored = await rowsOf("scouting", team);
      expect(stored).toHaveLength(2);
      const official = stored.find((r) => r.data.matchNumber === "12")!.data;
      expect(official).toMatchObject({ teamId: team, scoutId: ada, teamNumber: "1234", matchType: "qualification", ...raw });
      for (const key of ["values", "formId", "formVersion", "source", "score", "uid"]) expect(official).not.toHaveProperty(key);
      expect(oracleTotal(official, game)).toBe(total);

      const entries = await scoutEntries.getEntries(team);
      const entry = entries.find((e) => e.matchNumber === 12)!;
      expect(entry).toMatchObject({ game, formId, source: "event", teamNumber: 1234, comments: entered.notes });
      expect(entry.score.total).toBe(total);
      for (const [key, value] of Object.entries(entered)) expect(entry.values?.[key], key).toEqual(value);

      const [practice] = await scoutEntries.getEntriesForSession(team, "PS-GAME01");
      expect(practice).toMatchObject({ game, source: "practice", mode: "trial", sessionId: "PS-GAME01" });
      expect(stored.find((r) => r.id === practice.id)!.data).toMatchObject({ isPracticeScouting: true, practiceMode: "trial", practiceSessionId: "PS-GAME01", game });

      // the admin editor path: an edit merge-writes only what changed and keeps the CS shape
      await scoutEntries.updateEntry(entry.id, { values: { ...entry.values, notes: "edited" }, comments: "edited" }, { teamId: team });
      const edited = (await rowsOf("scouting", team)).find((r) => r.id === entry.id)!.data;
      expect(edited).toMatchObject({ ...raw, notes: "edited" });
      expect(oracleTotal(edited, game)).toBe(total);
    });
  });

  async function seeded(extra: CsRecord = {}) {
    const team = newTeamCode();
    const ada = await seedUser(team, "ada");
    const grace = await seedUser(team, "grace");
    const lead = await seedUser(team, "lead", { role: "lead-scout" });
    await seed("scouting/e1", { ...rebuiltDocWithUnknowns(), teamId: team, scoutId: ada, ...extra });
    return { team, ada, grace, lead };
  }

  it("updateEntry exclude writes only the excludeFromStats* fields and leaves unknown fields untouched", async () => {
    const { team, grace } = await seeded();
    const before = (await raw("scouting/e1"))!;
    await as(grace);
    await scoutEntries.updateEntry("e1", { excluded: true }, { teamId: team });
    const after = (await raw("scouting/e1"))!;
    expect(after).toEqual({ ...before, excludeFromStats: true, excludeFromStatsAt: expect.any(Number), excludeFromStatsBy: grace });
    expect(after.someFutureField).toEqual({ nested: [1, 2, 3] });
    expect(rec(after.auto).futureAutoField).toBe("keep me");
    expect(await raw("scoutingFlagStates/scoutingEntry:e1")).toBeUndefined();
    // including it again flips the flag back
    await scoutEntries.updateEntry("e1", { excluded: false }, { teamId: team });
    expect((await raw("scouting/e1"))!.excludeFromStats).toBe(false);
  });

  it("updateEntry manual flag / exclude-from-accuracy / dismissal go to scoutingFlagStates, not the scouting doc", async () => {
    const { team, lead } = await seeded({ auto: {}, teleop: {}, endgame: {}, incidents: [] });
    const before = (await raw("scouting/e1"))!;
    await as(lead);
    const [entry] = await scoutEntries.getEntries(team);
    expect(entry.autoFlags.length).toBeGreaterThan(0);

    await scoutEntries.updateEntry("e1", { manualFlags: [{ id: "m1", reason: "No teleop score", addedAt: new Date().toISOString() }] }, { teamId: team });
    expect(await raw("scouting/e1")).toEqual(before);
    expect(await raw("scoutingFlagStates/scoutingEntry:e1")).toEqual({
      teamId: team,
      entityType: "scoutingEntry",
      entityId: "e1",
      manualFlagged: true,
      manualReason: "no-teleop-score",
      manualReasonText: "No teleop score",
      manualNoteText: "",
      manualFlaggedAt: expect.any(Number),
      manualFlaggedBy: lead,
    });
    expect((await scoutEntries.getEntries(team))[0].manualFlags[0]).toMatchObject({ reason: "No teleop score" });

    await scoutEntries.updateEntry("e1", { excludeFromAccuracy: true, autoFlags: entry.autoFlags.map((f) => ({ ...f, dismissed: true })) }, { teamId: team });
    expect(await raw("scoutingFlagStates/scoutingEntry:e1")).toMatchObject({ manualFlagged: true, excludeFromAccuracy: true, excludedBy: lead, dismissed: true, dismissedBy: lead });
    const [reread] = await scoutEntries.getEntries(team);
    expect(reread.excludeFromAccuracy).toBe(true);
    expect(reread.autoFlags.every((f) => f.dismissed)).toBe(true);

    await scoutEntries.updateEntry("e1", { manualFlags: [] }, { teamId: team });
    expect(await raw("scoutingFlagStates/scoutingEntry:e1")).toMatchObject({ manualFlagged: false, manualReason: "", excludeFromAccuracy: true });
    expect(await raw("scouting/e1")).toEqual(before);
  });

  it("a plain match scout is denied flag writes by the rules (flag states need the Scout Accuracy page's roles)", async () => {
    const { team, grace } = await seeded();
    const before = (await raw("scouting/e1"))!;
    await as(grace);
    await denied(scoutEntries.updateEntry("e1", { manualFlags: [{ id: "m1", reason: "Other", addedAt: new Date().toISOString() }] }, { teamId: team }));
    expect(await raw("scoutingFlagStates/scoutingEntry:e1")).toBeUndefined();
    expect(await raw("scouting/e1")).toEqual(before);
  });

  it("updateEntry values: only the edited game fields change; unknown top-level and nested fields survive, identity strings stay as stored", async () => {
    const { team, grace } = await seeded();
    const before = (await raw("scouting/e1"))!;
    await as(grace);
    const [entry] = await scoutEntries.getEntries(team);
    await scoutEntries.updateEntry("e1", { values: { ...entry.values, auto_humanPlayerFuel: 9 } }, { teamId: team });
    const after = (await raw("scouting/e1"))!;

    expect(rec(after.auto).humanPlayerFuel).toBe(9);
    expect(rec(after.auto).futureAutoField).toBe("keep me");
    expect(after.priorityTeamsByEvent).toEqual({ "2026arli": ["254"] });
    expect(after.deviceType).toBe("tablet");
    expect(after.someFutureField).toEqual({ nested: [1, 2, 3] });
    for (const key of ["teamId", "scoutId", "scoutName", "eventKey", "game", "matchId", "matchType", "matchNumber", "teamNumber", "scoringWeights", "submittedAt", "timestamp", "notes", "incidents", "startingPosition"]) {
      expect(after[key]).toEqual(before[key]);
    }
    // every other key of the auto phase is as stored, except the derived total CS keeps next to it (88 robot fuel + the new human-player 9)
    expect(rec(after.auto).estimatedFuel).toBe(97);
    expect(without(rec(after.auto), "humanPlayerFuel", "estimatedFuel")).toEqual(without(rec(before.auto), "humanPlayerFuel", "estimatedFuel"));
    expect(without(rec(after.endgame))).toEqual(rec(before.endgame));
    // the only keys the edit added anywhere: D8's per-shift human-player map
    expect(without(rec(after.teleop), "humanPlayerFuelByShift")).toEqual(rec(before.teleop));
  });

  it("deleteEntry removes the doc (and its flag state when the caller may); a plain scout's flag-state delete is denied and swallowed", async () => {
    const { team, grace, lead } = await seeded();
    await seed("scoutingFlagStates/scoutingEntry:e1", { teamId: team, entityType: "scoutingEntry", entityId: "e1", manualFlagged: true });
    await as(grace);
    await scoutEntries.deleteEntry("e1");
    expect(await raw("scouting/e1")).toBeUndefined();
    expect(await raw("scoutingFlagStates/scoutingEntry:e1")).toBeDefined();

    await seed("scouting/e2", { ...rebuiltDoc({ teamId: team }), scoutId: grace });
    await seed("scoutingFlagStates/scoutingEntry:e2", { teamId: team, entityType: "scoutingEntry", entityId: "e2", manualFlagged: true });
    await as(lead);
    await scoutEntries.deleteEntry("e2");
    expect(await raw("scouting/e2")).toBeUndefined();
    expect(await raw("scoutingFlagStates/scoutingEntry:e2")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// 3. Users and teams
// ---------------------------------------------------------------------------------------------------------------------

describe("3. users and teams", () => {
  const userExtras = { encryptedUserData: "ENCRYPTED-BLOB", userDataEncryptedAt: 1_700_000_000_123, bio: "hello", accountThemeId: "dark-compsocrates", createdAt: 1_700_000_000_000, futureProfileField: { a: [1, 2] } };

  it("reads a CS user doc as the profile (the AuthProvider path) and a patch (role/theme) preserves encryptedUserData and unknown fields", async () => {
    const team = newTeamCode();
    const ada = await seedUser(team, "ada", { role: "lead-scout", extra: userExtras });
    await as(ada);
    // lib/auth.tsx: onSnapshot(doc(db, "users", uid)) -> csUserToProfile(uid, snap.data())
    const stored = (await getDoc(doc(db, "users", ada))).data()!;
    const profile = csUsers.csUserToProfile(ada, stored);
    expect(profile).toMatchObject({ name: `ada of ${team}`, email: emailOf(ada), teamId: team, primaryRole: "lead-scout", isAdmin: false, themeId: "compsocrates", colorMode: "dark", bio: "hello" });

    const before = (await raw(`users/${ada}`))!;
    // lib/auth.tsx updateUserProfile: setDoc(doc(db, "users", uid), profilePatchToCsUser(patch, rawUserDoc), { merge: true })
    const patch = csUsers.profilePatchToCsUser({ colorMode: "light", primaryRole: "drive-team" }, stored);
    await setDoc(doc(db, "users", ada), patch, { merge: true });
    const after = (await raw(`users/${ada}`))!;
    expect(after).toEqual({ ...before, ...patch });
    expect(after).toMatchObject({ role: "drive-team", roles: ["drive-team"], accountThemeId: "light-compsocrates", colorMode: "light", encryptedUserData: "ENCRYPTED-BLOB", userDataEncryptedAt: 1_700_000_000_123, futureProfileField: { a: [1, 2] }, teamId: team, displayName: `ada of ${team}` });
    expect(csUsers.csUserToProfile(ada, (await getDoc(doc(db, "users", ada))).data()!)).toMatchObject({ primaryRole: "drive-team", colorMode: "light" });
  });

  it("useTeamMembers reads the team's CS user docs (and only the team's)", async () => {
    const team = newTeamCode();
    const ada = await seedUser(team, "ada", { role: "coach" });
    const grace = await seedUser(team, "grace", { extra: { role: "match-scout", roles: ["match-scout", "pit-scout"], secondaryRoles: ["pit-scout"] } });
    const other = newTeamCode();
    await seedUser(other, "zed");
    await as(grace);
    const hook = renderHook(() => teamMembers.useTeamMembers(team));
    const { members } = await hook.waitFor((s) => s.loaded && s.members.length === 2);
    expect(members.map((m) => m.uid).sort()).toEqual([ada, grace].sort());
    expect(members.find((m) => m.uid === ada)).toMatchObject({ isAdmin: true, legacyRole: "coach", primaryRole: "team-coach" });
    expect(members.find((m) => m.uid === grace)).toMatchObject({ isAdmin: false, primaryRole: "match-scout", secondaryRoles: ["pit-scout"] });
    hook.unmount();
  });

  it("updateMemberAccess (admin) writes CS role fields + the audit entry in one batch and keeps encryptedUserData; a member is denied everything", async () => {
    const team = newTeamCode();
    const admin1 = await seedUser(team, "admin", { isTeamAdmin: true, role: "team-coach" });
    const ada = await seedUser(team, "ada", { extra: userExtras });
    const grace = await seedUser(team, "grace");
    const before = (await raw(`users/${ada}`))!;
    const member = csUsers.csUserToMember(ada, before);

    await as(grace);
    await denied(teamMembers.updateMemberAccess({ teamId: team, uid: grace, name: "Grace" }, member, { primaryRole: "pit-scout", isAdmin: true }));
    expect(await raw(`users/${ada}`)).toEqual(before);
    expect((await admin().collection("auditLog").get()).size).toBe(0);

    await as(admin1);
    await teamMembers.updateMemberAccess({ teamId: team, uid: admin1, name: "Admin" }, member, { primaryRole: "pit-scout", secondaryRoles: ["drive-team"], isAdmin: true });
    const after = (await raw(`users/${ada}`))!;
    expect(after).toEqual({ ...before, role: "pit-scout", roles: ["pit-scout", "drive-team"], secondaryRoles: ["drive-team"], isTeamAdmin: true });
    expect(after.encryptedUserData).toBe("ENCRYPTED-BLOB");
    const logs = await admin().collection("auditLog").get();
    expect(logs.size).toBe(1);
    expect(logs.docs[0].data()).toMatchObject({ teamId: team, uid: admin1, action: "edit-member-roles", actorName: "Admin", target: { targetUid: ada } });
  });

  async function seedTeam() {
    const team = newTeamCode();
    const admin1 = await seedUser(team, "admin", { isTeamAdmin: true });
    const ada = await seedUser(team, "ada");
    const grace = await seedUser(team, "grace", { extra: { displayName: "Grace Hopper" } });
    const teamDoc: CsRecord = {
      teamName: "MAGNAtech",
      teamNumber: "2403",
      verifiedOwnerId: admin1,
      selectedEvents: ["2026arli", "2025lake"],
      eventAttendees: { "2025lake": ["Grace Hopper", "Guest Person"], "2026arli": [ada] },
      tbaApiKeyEncrypted: "ENCRYPTED-TBA",
      manualTeamListsByEvent: { "2026arli": [254, 971] },
      formAccessOverrides: { "pit-scout": [ada] },
      submissionControls: { globalLockout: true, lockoutReason: "Lunch break", updatedAt: 1, updatedBy: admin1 },
      timeOverride: { enabled: false, offsetMs: 0 },
      pickList: { picks: [{ teamNumber: "254", pickOrder: 1, scoutNote: "keep me" }], updatedAt: 5, updatedBy: admin1, futurePickField: true },
      judgeBookCards: [{ id: "card-1" }],
      futureTeamField: { n: [1] },
    };
    await seed(`teams/${team}`, teamDoc);
    return { team, admin1, ada, grace, teamDoc };
  }

  it("reads a CS team doc through the useTeamDoc path", async () => {
    const { team, admin1, ada, teamDoc } = await seedTeam();
    await as(ada);
    const hook = renderHook(() => teamLib.useTeamDoc(team));
    const { team: read } = await hook.waitFor((s) => s.loaded && s.team !== null);
    expect(read).toMatchObject({
      number: 2403,
      name: "MAGNAtech",
      joinCode: team,
      ownerUid: admin1,
      selectedEvents: ["2026arli", normalizeEventKey("2025lake")],
      eventAttendees: teamDoc.eventAttendees,
      manualTeamListsByEvent: teamDoc.manualTeamListsByEvent,
      formAccessOverrides: teamDoc.formAccessOverrides,
      submissionLockout: { locked: true, reason: "Lunch break" },
      activeEventCode: "2026arli",
    });
    hook.unmount();
  });

  it("setActiveEvents writes only selectedEvents and preserves every other team field; a non-admin is denied", async () => {
    const { team, admin1, ada } = await seedTeam();
    const before = (await raw(`teams/${team}`))!;
    const state = { events: [csTeams.placeholderEventForKey("2026txdr"), csTeams.placeholderEventForKey("2026arli")], primaryCode: "2026arli" };

    await as(ada);
    await denied(teamLib.setActiveEvents(team, state));
    expect(await raw(`teams/${team}`)).toEqual(before);

    await as(admin1);
    await teamLib.setActiveEvents(team, state);
    const after = (await raw(`teams/${team}`))!;
    expect(after.selectedEvents).toEqual(["2026arli", "2026txdr"]);
    expect(after).toEqual({ ...before, selectedEvents: ["2026arli", "2026txdr"] });
    for (const key of ["tbaApiKeyEncrypted", "eventAttendees", "pickList", "manualTeamListsByEvent", "formAccessOverrides", "submissionControls", "timeOverride", "judgeBookCards", "futureTeamField", "verifiedOwnerId"]) {
      expect(after[key]).toEqual(before[key]);
    }
    await teamLib.setActiveEvent(team, null);
    expect((await raw(`teams/${team}`))!.selectedEvents).toEqual([]);
  });

  it("setEventAttendance merges one event's list (uids written, names resolved, unknown entries kept, legacy alias key folded) and nothing else", async () => {
    const { team, admin1, ada, grace } = await seedTeam();
    const before = (await raw(`teams/${team}`))!;
    const canonical = normalizeEventKey("2025lake");

    await as(ada);
    await denied(eventAttendance.setEventAttendance(team, "2025lake", [ada]));
    expect(await raw(`teams/${team}`)).toEqual(before);

    await as(admin1);
    await eventAttendance.setEventAttendance(team, "2025lake", [grace, ada]);
    const after = (await raw(`teams/${team}`))!;
    const attendees = rec(after.eventAttendees);
    // "Grace Hopper" (a display name) is replaced by her uid, "Guest Person" is neither a uid nor a member name so it stays
    expect(attendees[canonical]).toEqual([grace, ada, "Guest Person"]);
    if (canonical !== "2025lake") expect(attendees).not.toHaveProperty("2025lake");
    expect(attendees["2026arli"]).toEqual(canonical === "2026arli" ? [grace, ada, "Guest Person"] : [ada]);
    expect({ ...after, eventAttendees: undefined }).toEqual({ ...before, eventAttendees: undefined });

    const hook = renderHook(() => eventAttendance.useTeamEventAttendance(team));
    const { attendance } = await hook.waitFor((s) => s.loaded && s.attendance.some((a) => a.eventCode === canonical && a.uids.length === 2));
    expect(attendance.find((a) => a.eventCode === canonical)!.uids).toEqual([grace, ada]);
    hook.unmount();
  });

  it("pick list: read through usePickList, edited in a transaction (+audit entry), unknown pick fields kept, no-op writes nothing", async () => {
    const { team, admin1, ada } = await seedTeam();
    const before = (await raw(`teams/${team}`))!;
    await as(admin1);
    const hook = renderHook(() => pickList.usePickList(team, "2026arli", null));
    const first = await hook.waitFor((s) => s.loaded && s.list !== null);
    expect(first.picked).toEqual([254]);
    expect(first.list).toMatchObject({ updatedBy: admin1, updatedAtMs: 5 });

    expect(await pickList.editPickList({ teamId: team, eventCode: "2026arli", uid: admin1, name: "Admin" }, { type: "place", team: 971, before: null })).toBe(true);
    const after = (await raw(`teams/${team}`))!;
    expect(after.pickList).toEqual({ picks: [{ teamNumber: "254", pickOrder: 1, scoutNote: "keep me" }, { teamNumber: "971", pickOrder: 2 }], updatedAt: expect.any(Number), updatedBy: admin1, futurePickField: true });
    expect({ ...after, pickList: undefined }).toEqual({ ...before, pickList: undefined });
    const logs = await admin().collection("auditLog").get();
    expect(logs.size).toBe(1);
    expect(logs.docs[0].data()).toMatchObject({ action: "edit-pick-list", teamId: team, uid: admin1, before: { picked: [254] }, after: { picked: [254, 971] } });

    const stamp = (await admin().doc(`teams/${team}`).get()).updateTime!.toMillis();
    expect(await pickList.editPickList({ teamId: team, eventCode: "2026arli", uid: admin1, name: "Admin" }, { type: "place", team: 971, before: null })).toBe(false);
    expect((await admin().doc(`teams/${team}`).get()).updateTime!.toMillis()).toBe(stamp);
    expect((await admin().collection("auditLog").get()).size).toBe(1);
    await hook.waitFor((s) => s.picked.length === 2);

    // FINDING (documented, not changed): CS's production rules let only team admins write teams/{id}, so a lead scout / strategist / coach /
    // drive-team member, whom lib/pick-list/permissions.ts and canEditPickList() in the rules both call an editor, cannot persist an edit.
    await as(ada);
    await seed(`users/${ada}`, { ...(await raw(`users/${ada}`))!, role: "lead-strategist" });
    await denied(pickList.editPickList({ teamId: team, eventCode: "2026arli", uid: ada, name: "Ada" }, { type: "remove", team: 254 }));
    expect(rec((await raw(`teams/${team}`))!.pickList).picks).toHaveLength(2);
    hook.unmount();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// 4. Form entries: the six CS collections
// ---------------------------------------------------------------------------------------------------------------------

type FormCase = {
  type: FormEntryType;
  collection: string;
  /** The seeded CS doc (with fields the adapter does not know, nested ones included). */
  seedDoc: (team: string, uid: string) => CsRecord;
  /** A new submission (what the form's page hands to saveFormEntry) and the CS doc that must be stored for it. */
  input: NewFormEntry;
  stored: (team: string, uid: string) => CsRecord;
  /** An edit of one value key, and the same edit as a change to the raw doc. */
  edit: { key: string; value: string | number | boolean; apply: (d: CsRecord) => void };
  /** Unknown paths in `seedDoc` that must survive the edit. */
  survivors: Array<[path: string, value: unknown]>;
};

const NOW = expect.any(Number);
const baseInput = { scoutName: "Ada", formVersion: 1, eventCode: "2026arli" };

const FORM_CASES: FormCase[] = [
  {
    type: "pit-scout",
    collection: "pitScouting",
    seedDoc: (team, uid) => ({ scoutName: "Ada", teamNumber: "254", robotWeight: "118 lbs", rookieTeam: false, climbLevel1: true, fuelBallsPerSecond: "10-13", notes: "Tidy wiring", game: "REBUILT", eventKey: "2026arli", teamId: team, submittedBy: uid, createdAt: 1_774_000_000_000, submittedAt: 1_774_000_100_000, encryptedBlob: "abc", imported: true }),
    input: { ...baseInput, formId: "pit-scout-v1", formType: "pit-scout", teamNumber: 254, values: { robotWeight: "118 lbs", rookieTeam: false, climbLevel1: true, fuelBallsPerSecond: "10-13", notes: "tidy" } },
    stored: (team, uid) => ({ teamId: team, submittedBy: uid, scoutName: "Ada", eventKey: "2026arli", game: "REBUILT", teamNumber: "254", robotWeight: "118 lbs", rookieTeam: false, fuelBallsPerSecond: "10-13", climbLevel1: true, notes: "tidy", createdAt: NOW, submittedAt: NOW }),
    edit: { key: "notes", value: "Edited note", apply: (d) => (d.notes = "Edited note") },
    survivors: [["encryptedBlob", "abc"], ["imported", true], ["robotWeight", "118 lbs"]],
  },
  {
    type: "team-strategy",
    collection: "strategyScouting",
    seedDoc: (team, uid) => ({ scoutName: "Grace", scoutId: uid, teamId: team, teamNumber: "1678", eventKey: "2025lake", game: "REBUILT", preferredStartingPosition: "depot-side", bestAt: "shooting", clearsBump: true, notes: "Fast", createdAt: 1_775_000_000_000, submittedAt: 1_775_000_000_000, priorityRank: 3 }),
    input: { ...baseInput, formId: "team-strategy-v1", formType: "team-strategy", teamNumber: 254, values: { preferredStartingPosition: "middle", bestAt: "shooting", clearsBump: true, notes: "n" } },
    stored: (team, uid) => ({ teamId: team, scoutId: uid, scoutName: "Ada", eventKey: "2026arli", game: "REBUILT", teamNumber: "254", preferredStartingPosition: "middle", bestAt: "shooting", clearsBump: true, notes: "n", createdAt: NOW, submittedAt: NOW }),
    edit: { key: "bestAt", value: "passing", apply: (d) => (d.bestAt = "passing") },
    survivors: [["priorityRank", 3], ["eventKey", "2025lake"], ["teamNumber", "1678"]],
  },
  {
    type: "lead-scout",
    collection: "leadScouting",
    seedDoc: (team, uid) => ({ scoutName: "Linus", scoutId: uid, teamId: team, eventKey: "2026arli", game: "REBUILT", matchKey: "q12", matchId: "q12", matchType: "qualification", matchNumber: "12", matchLabel: "Qualification 12", alliance: "red", isPracticeScouting: false, isLeadScouting: true, entryType: "lead", robots: [{ teamNumber: "254", notes: "Great", skillLevel: 5 }, { teamNumber: "1678", notes: "", skillLevel: 3 }, { teamNumber: "118", notes: "Slow", skillLevel: 2, pickNumber: "1" }], overallAlliance: { teams: "RED / 254, 1678, 118", notes: "Strong", skillLevel: 4, extra: 1 }, createdAt: 1_774_300_000_000, submittedAt: 1_774_300_000_000, timestamp: 1_774_300_000_000 }),
    input: { ...baseInput, formId: "lead-scout-v1", formType: "lead-scout", matchKey: "Q12", alliance: "red", values: { robot1_teamNumber: "254", robot1_notes: "Great", robot1_skillLevel: 5, robot2_teamNumber: "1678", overallAlliance_skillLevel: 4, overallAlliance_notes: "Strong" } },
    stored: (team, uid) => ({ teamId: team, scoutId: uid, scoutName: "Ada", eventKey: "2026arli", game: "REBUILT", matchKey: "q12", matchId: "q12", matchType: "qualification", matchNumber: "12", matchLabel: "Qualification 12", isPracticeScouting: false, alliance: "red", overallAlliance: { notes: "Strong", skillLevel: 4 }, robots: [{ teamNumber: "254", notes: "Great", skillLevel: 5 }, { teamNumber: "1678" }], createdAt: NOW, submittedAt: NOW, timestamp: NOW, entryType: "lead", isLeadScouting: true }),
    edit: { key: "robot2_notes", value: "Edited", apply: (d) => ((d.robots as CsRecord[])[1].notes = "Edited") },
    survivors: [["robots.2.pickNumber", "1"], ["overallAlliance.extra", 1], ["robots.0.notes", "Great"]],
  },
  {
    type: "match-strategy",
    collection: "matchStrategyPlans",
    seedDoc: (team, uid) => ({ eventKey: "2026arli", matchKey: "2026arli_qm12", matchLabel: "Qualification Match 12", scoutId: uid, scoutName: "Grace", teamId: team, game: "REBUILT", robots: [{ teamNumber: "254", startingPosition: "middle", role: "Offense", autoClimb: true, endgameClimb: "level-3", climbProbability: 80, estimatedPoints: 61, predictionSampleSize: 4, futureField: "keep" }, { teamNumber: "1678", startingPosition: "depot-side", role: "Feeder", autoClimb: false, endgameClimb: "" }, { teamNumber: "118", startingPosition: "middle", role: "Defense", autoClimb: false, endgameClimb: "level-1" }], notes: "Plan A", createdAt: 1_774_100_000_000, submittedAt: 1_774_100_000_000 }),
    input: { ...baseInput, formId: "match-strategy-v1", formType: "match-strategy", matchKey: "Q12", alliance: "blue", values: { notes: "plan", robot1_teamNumber: "254", robot1_startingPosition: "middle", robot1_role: "Offense", robot1_autoClimb: true, robot1_endgameClimb: "level-2" } },
    stored: (team, uid) => ({ teamId: team, scoutId: uid, scoutName: "Ada", eventKey: "2026arli", game: "REBUILT", matchKey: "2026arli_qm12", matchLabel: "Qualification Match 12", alliance: "blue", notes: "plan", robots: [{ teamNumber: "254", startingPosition: "middle", role: "Offense", autoClimb: true, endgameClimb: "level-2" }], createdAt: NOW, submittedAt: NOW }),
    edit: { key: "robot2_role", value: "Defense", apply: (d) => ((d.robots as CsRecord[])[1].role = "Defense") },
    survivors: [["robots.0.futureField", "keep"], ["robots.0.climbProbability", 80], ["robots.0.estimatedPoints", 61], ["robots.0.predictionSampleSize", 4]],
  },
  {
    type: "drive-reflection",
    collection: "driveScouting",
    seedDoc: (team, uid) => ({ eventKey: "2026arli", matchKey: "q12", matchLabel: "Qualification Match 12", scoutId: uid, scoutName: "Grace", teamId: team, game: "REBUILT", robots: [{ teamNumber: "254", startingPosition: "middle", role: "Offense", autoClimb: true, endgameClimb: "level-2", driverNote: "keep" }, { teamNumber: "1678", startingPosition: "depot-side", role: "Feeder", autoClimb: false, endgameClimb: "" }, { teamNumber: "118", startingPosition: "middle", role: "Defense", autoClimb: false, endgameClimb: "" }], notes: "", createdAt: 1_774_200_000_000, submittedAt: 1_774_200_000_000 }),
    input: { ...baseInput, formId: "drive-reflection-v1", formType: "drive-reflection", matchKey: "F14", values: { notes: "d", robot1_teamNumber: "254" } },
    stored: (team, uid) => ({ teamId: team, scoutId: uid, scoutName: "Ada", eventKey: "2026arli", game: "REBUILT", matchKey: "2026arli_f1m1", matchLabel: "Finals 1", notes: "d", robots: [{ teamNumber: "254" }], createdAt: NOW, submittedAt: NOW }),
    edit: { key: "notes", value: "After the match", apply: (d) => (d.notes = "After the match") },
    survivors: [["robots.0.driverNote", "keep"], ["robots.2.role", "Defense"]],
  },
  {
    type: "helper",
    collection: "helperReports",
    seedDoc: (team, uid) => ({ helperName: "Pat", helperId: uid, teamId: team, assistedTeamNumber: "9999", wasSuccessful: true, issueSolved: "Loose battery lead", notes: "Zip tied", game: "REBUILT", createdAt: 1_774_400_000_000, submittedAt: 1_774_400_000_000, ticketNumber: 77 }),
    input: { ...baseInput, formId: "helper-v1", formType: "helper", eventCode: "", teamNumber: 9999, values: { wasSuccessful: true, issueSolved: "lead", notes: "zip" } },
    stored: (team, uid) => ({ teamId: team, helperId: uid, helperName: "Ada", game: "REBUILT", assistedTeamNumber: "9999", wasSuccessful: true, issueSolved: "lead", notes: "zip", createdAt: NOW, submittedAt: NOW }),
    edit: { key: "notes", value: "Re-tied", apply: (d) => (d.notes = "Re-tied") },
    survivors: [["ticketNumber", 77], ["assistedTeamNumber", "9999"]],
  },
];

const pathGet = (data: unknown, path: string): unknown => path.split(".").reduce<unknown>((acc, part) => (acc as Record<string, unknown> | undefined)?.[part], data);

describe("4. form entries (the six CS collections)", () => {
  for (const c of FORM_CASES) {
    it(`${c.collection}: reads a seeded doc, saves a new entry in CS's shape, and an edit keeps unknown (nested) keys`, async () => {
      const team = newTeamCode();
      const ada = await seedUser(team, "ada");
      await seed(`${c.collection}/seeded`, c.seedDoc(team, ada));
      // another team's doc in the same collection never shows up in this team's feed
      await seed(`${c.collection}/foreign`, c.seedDoc("SOMEONEELSE", "someone"));
      await as(ada);

      const hook = renderHook(() => formEntries.useFormEntries(team, { formType: c.type, game: "all" }));
      const { entries } = await hook.waitFor((s) => s.entries.length >= 1);
      expect(entries.map((e) => e.id)).toEqual(["seeded"]);
      const entry = entries[0];
      expect(entry).toMatchObject({ id: "seeded", teamId: team, uid: ada, formType: c.type, legacy: { collection: c.collection } });

      // new entry
      const newId = await formEntries.saveFormEntry(team, ada, c.input);
      expect(await raw(`${c.collection}/${newId}`)).toEqual(c.stored(team, ada));
      await hook.waitFor((s) => s.entries.length === 2);

      // edit the seeded one: only the edited path (and CS's reset submittedAt) changes, unknown keys survive
      const before = (await raw(`${c.collection}/seeded`))!;
      await formEntries.updateFormEntry("seeded", { values: { ...entry.values, [c.edit.key]: c.edit.value } });
      const after = (await raw(`${c.collection}/seeded`))!;
      const expected = structuredClone(before);
      c.edit.apply(expected);
      // CS resets `submittedAt` on every edit, and a lead row's `timestamp` follows it (data/cs/forms.ts)
      expect(after).toEqual({ ...expected, submittedAt: NOW, ...(c.type === "lead-scout" ? { timestamp: NOW } : {}) });
      for (const [path, value] of c.survivors) expect(pathGet(after, path), path).toEqual(value);
      hook.unmount();
    });
  }

  it("the same id-only handle works in a fresh session (a deep link): the doc is found by probing the collections", async () => {
    const team = newTeamCode();
    const ada = await seedUser(team, "ada");
    const helper = FORM_CASES.find((c) => c.type === "helper")!;
    await seed("helperReports/deep", helper.seedDoc(team, ada));
    await as(ada);
    await formEntries.updateFormEntry("deep", { values: { notes: "linked" } });
    expect((await raw("helperReports/deep"))!.notes).toBe("linked");
    expect((await raw("helperReports/deep"))!.ticketNumber).toBe(77);
    // regression: a stale / unknown id used to surface the `formEntries` rule's permission error (the rule reads a missing doc's teamId) instead of "not found"
    await expect(formEntries.updateFormEntry("does-not-exist", { values: {} })).rejects.toThrow(/was not found/);
    await expect(formEntries.deleteFormEntry("does-not-exist")).rejects.toThrow(/was not found/);
  });

  it("adminUpdateFormEntry (admin) excludes and flags in one batch: excludeFromStats* on the doc, the flag state in scoutingFlagStates", async () => {
    const team = newTeamCode();
    const admin1 = await seedUser(team, "admin", { isTeamAdmin: true });
    const ada = await seedUser(team, "ada");
    const pit = FORM_CASES[0];
    await seed("pitScouting/p1", pit.seedDoc(team, ada));
    const before = (await raw("pitScouting/p1"))!;
    await as(admin1);
    await formEntries.adminUpdateFormEntry("p1", { excluded: true, flags: [{ id: "f1", reason: "Other", note: "blurry", addedAt: new Date().toISOString() }] });
    const after = (await raw("pitScouting/p1"))!;
    expect(after).toEqual({ ...before, excludeFromStats: true, excludeFromStatsAt: NOW, excludeFromStatsBy: admin1 });
    expect(await raw("scoutingFlagStates/pitScouting:p1")).toMatchObject({ teamId: team, entityType: "pitScouting", entityId: "p1", manualFlagged: true });

    await as(ada);
    // a plain member: the flag-state half of the batch is refused, so the whole batch (the doc write too) is
    await denied(formEntries.adminUpdateFormEntry("p1", { excluded: false, flags: [] }));
    expect(await raw("pitScouting/p1")).toEqual(after);
    await as(admin1);
    await formEntries.deleteFormEntry("p1");
    expect(await raw("pitScouting/p1")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// 5. Assignments (+ pit / team strategy)
// ---------------------------------------------------------------------------------------------------------------------

function assignmentRow(team: string, matchNumber: number, scoutId: string, scoutName: string, teamNumber: number, assignedAt: number, extra: CsRecord = {}): CsRecord {
  return { teamId: team, eventKey: "2026arli", matchKey: `2026arli_qm${matchNumber}`, matchLabel: `Qualification ${matchNumber}`, scoutId, scoutName, teamNumber, scoutHumanPlayer: false, assignedBy: "seed-admin", assignedAt, ...extra };
}

async function seedAssignments() {
  const team = newTeamCode();
  const admin1 = await seedUser(team, "admin", { isTeamAdmin: true });
  const ada = await seedUser(team, "ada");
  const grace = await seedUser(team, "grace");
  const hank = await seedUser(team, "hank");
  const other = newTeamCode();
  await seedUser(other, "zed");
  await seed("matchAssignments/r1", assignmentRow(team, 1, ada, "Ada", 254, 1000));
  await seed("matchAssignments/r2", assignmentRow(team, 1, grace, "Grace", 971, 1001, { legacyNote: "keep me" }));
  await seed("matchAssignments/r3", assignmentRow(team, 2, ada, "Ada", 1678, 1002, { futureField: { deep: [1] } }));
  await seed("matchAssignments/r4", assignmentRow(team, 3, grace, "Grace", 118, 1003));
  // a team-strategy mirror row and another team's row live in the same collection and must be left alone
  await seed("matchAssignments/mirror1", { teamId: team, eventKey: "2026arli", teamNumber: 254, scoutId: ada, scoutName: "Ada", assignedBy: "seed-admin", assignedAt: 900, assignmentType: "team", matchKey: "team", matchLabel: "Team Strategy", scoutHumanPlayer: false });
  await seed("matchAssignments/foreign1", assignmentRow(other, 1, "someone", "Someone", 254, 1000));
  return { team, admin1, ada, grace, hank, other };
}

function versionOf(slots: ScheduleSlot[], generatedBy: string, base: AssignmentVersion): AssignmentVersion {
  return { ...base, generatedBy, generatedAt: new Date().toISOString(), slots };
}

describe("5. assignments", () => {
  it("useAssignments reads matchAssignments (mirror rows and other teams excluded) with the rows' scouts and teams", async () => {
    const { team, ada, grace } = await seedAssignments();
    await as(ada);
    const hook = renderHook(() => assignments.useAssignments(team, "2026arli"));
    const { assignments: doc } = await hook.waitFor((s) => s.loaded && s.assignments !== null);
    const slots = doc!.current!.slots;
    expect(slots.map((s) => `${s.matchType}${s.matchNumber}:${s.teamNumber}:${s.scoutUid}`).sort()).toEqual([`Qualification1:254:${ada}`, `Qualification1:971:${grace}`, `Qualification2:1678:${ada}`, `Qualification3:118:${grace}`].sort());
    expect(doc!.current!.counts).toEqual({ [ada]: 2, [grace]: 2 });
    hook.unmount();
  });

  async function readSlots(team: string): Promise<{ slots: ScheduleSlot[]; base: AssignmentVersion }> {
    const hook = renderHook(() => assignments.useAssignments(team, "2026arli"));
    const { assignments: doc } = await hook.waitFor((s) => s.loaded && s.assignments !== null);
    hook.unmount();
    return { slots: doc!.current!.slots, base: doc!.current! };
  }

  it("publishAssignments applies a minimal diff: unchanged rows are not rewritten, a changed scout patches the same doc, removed rows go, new rows are CS-shaped", async () => {
    const { team, admin1, ada, grace, hank } = await seedAssignments();
    await as(admin1);
    const { slots, base } = await readSlots(team);
    const before = await rowsOf("matchAssignments", team);
    const beforeById = new Map(before.map((r) => [r.id, r]));

    const edited = slots.map((s): ScheduleSlot => {
      if (s.matchNumber === 1 && s.teamNumber === 971) return { ...s, scoutUid: hank }; // r2: scout changes
      if (s.matchNumber === 2) return { ...s, scoutUid: null }; // r3: cleared
      return s;
    });
    edited.push({ matchType: "Qualification", matchNumber: 4, slot: "red1", teamNumber: 1114, scoutUid: ada }); // new
    await assignments.publishAssignments(team, "2026arli", versionOf(edited, admin1, base));

    const after = await rowsOf("matchAssignments", team);
    const afterById = new Map(after.map((r) => [r.id, r]));
    // untouched: r1, r4 (same updateTime), the team mirror, and the other team's row
    for (const id of ["r1", "r4", "mirror1"]) expect(afterById.get(id)!.stamp, id).toBe(beforeById.get(id)!.stamp);
    expect((await raw("matchAssignments/foreign1"))!.scoutId).toBe("someone");
    // r2: same document, only scout fields patched; its other fields (known or not) stay
    expect(afterById.get("r2")!.data).toEqual({ ...beforeById.get("r2")!.data, scoutId: hank, scoutName: `hank of ${team}`, assignedBy: admin1, assignedAt: NOW });
    expect(afterById.get("r2")!.data.legacyNote).toBe("keep me");
    // r3 removed, one new row in CS's shape
    expect(afterById.has("r3")).toBe(false);
    const created = after.filter((r) => !beforeById.has(r.id));
    expect(created).toHaveLength(1);
    expect(created[0].data).toEqual({ teamId: team, eventKey: "2026arli", matchKey: "2026arli_qm4", matchLabel: "Qualification 4", scoutId: ada, scoutName: `ada of ${team}`, teamNumber: 1114, scoutHumanPlayer: true, assignedBy: admin1, assignedAt: NOW });
    expect(after).toHaveLength(before.length); // -1 removed, +1 created

    // publishing the same schedule again writes nothing at all
    const settled = stampsOf(await rowsOf("matchAssignments", team));
    await assignments.publishAssignments(team, "2026arli", versionOf(edited, admin1, base));
    expect(stampsOf(await rowsOf("matchAssignments", team))).toEqual(settled);
    void grace;
  });

  it("undoAssignments restores the rows from before this tab's last publish (removed row back with its unknown fields)", async () => {
    const { team, admin1, ada, grace } = await seedAssignments();
    await as(admin1);
    const { slots, base } = await readSlots(team);
    const keyOf = (rows: Array<{ data: CsRecord }>) => rows.filter((r) => r.data.matchKey !== "team").map((r) => `${r.data.matchKey}|${r.data.teamNumber}|${r.data.scoutId}`).sort();
    const original = keyOf(await rowsOf("matchAssignments", team));
    const edited = slots.map((s): ScheduleSlot => (s.matchNumber === 2 ? { ...s, scoutUid: null } : s.matchNumber === 3 ? { ...s, scoutUid: ada } : s));
    await assignments.publishAssignments(team, "2026arli", versionOf(edited, admin1, base));
    expect(keyOf(await rowsOf("matchAssignments", team))).not.toEqual(original);
    await assignments.undoAssignments(team, "2026arli");
    const restored = await rowsOf("matchAssignments", team);
    expect(keyOf(restored)).toEqual(original);
    expect(restored.find((r) => r.data.matchKey === "2026arli_qm2")!.data.futureField).toEqual({ deep: [1] });
    void grace;
  });

  it("swapAssignmentSlot re-points one row at another scout, or deletes it when cleared", async () => {
    const { team, admin1, hank } = await seedAssignments();
    await as(admin1);
    const { slots } = await readSlots(team);
    const slot = slots.find((s) => s.matchNumber === 3)!;
    const r4 = (await raw("matchAssignments/r4"))!;
    await assignments.swapAssignmentSlot(team, "2026arli", "Qualification", 3, slot.slot, hank, slots);
    expect(await raw("matchAssignments/r4")).toEqual({ ...r4, scoutId: hank, scoutName: `hank of ${team}`, assignedAt: NOW });
    await assignments.swapAssignmentSlot(team, "2026arli", "Qualification", 3, slot.slot, null, slots);
    expect(await raw("matchAssignments/r4")).toBeUndefined();
  });

  it("practice-library publishes land in practiceAssignments, not matchAssignments", async () => {
    const { team, admin1, ada, base } = await (async () => {
      const s = await seedAssignments();
      await as(s.admin1);
      const { base } = await readSlots(s.team);
      return { ...s, base };
    })();
    const matchBefore = stampsOf(await rowsOf("matchAssignments", team));
    const version: AssignmentVersion = { ...versionOf([{ matchType: "Qualification", matchNumber: 7, slot: "blue2", teamNumber: 3000, scoutUid: ada }], admin1, base), settings: { ...base.settings, matchSource: "practice" } };
    await assignments.publishAssignments(team, "2026arli", version);
    const practice = await rowsOf("practiceAssignments", team);
    expect(practice).toHaveLength(1);
    expect(practice[0].data).toMatchObject({ teamId: team, eventKey: "2026arli", matchKey: "2026arli_qm7", scoutId: ada, teamNumber: 3000, practiceMatchId: "practice_2026arli_7" });
    expect(stampsOf(await rowsOf("matchAssignments", team))).toEqual(matchBefore);
  });

  describe("pit scouting / team strategy", () => {
    async function seedTeamRows() {
      const s = await seedAssignments();
      const row = (n: number, scoutId: string, name: string, at: number): CsRecord => ({ teamId: s.team, eventKey: "2026arli", teamNumber: n, scoutId, scoutName: name, assignedBy: "seed-admin", assignedAt: at, scoutHumanPlayer: false });
      await seed("pitAssignments/p254", row(254, s.ada, "Ada", 2000));
      await seed("pitAssignments/p971", { ...row(971, s.grace, "Grace", 2001), futureField: "keep" });
      await seed("pitAssignments/p118", row(118, s.grace, "Grace", 2002));
      await seed("teamAssignments/t254", row(254, s.ada, "Ada", 2100)); // not readable by clients: see the rules test below
      return s;
    }
    const pitVersion = (generatedBy: string, teams: TeamAssignVersion["teams"]): TeamAssignVersion => ({
      generatedBy,
      generatedAt: new Date().toISOString(),
      settings: { scoutUids: [], priorityTeams: [], priorityCoverage: 2, mode: "balanced-random", includeOurs: false, seed: 0 },
      teams,
      counts: {},
      uneven: false,
      warning: null,
    });

    it("useTeamAssignmentDocs reads pit rows and the team-strategy mirror; the teamAssignments listener is denied by the rules and counts as answered", async () => {
      const { team, ada, grace } = await seedTeamRows();
      await as(ada);
      const hook = renderHook(() => teamAssignments.useTeamAssignmentDocs(team));
      const { docs, loaded } = await hook.waitFor((s) => s.loaded && s.docs.length === 2);
      expect(loaded).toBe(true);
      const pit = docs.find((d) => d.kind === "pit")!;
      expect(pit.eventCode).toBe("2026arli");
      expect(pit.current!.teams.map((t) => `${t.teamNumber}:${t.scoutUids.join(",")}`)).toEqual([`118:${grace}`, `254:${ada}`, `971:${grace}`]);
      const strategy = docs.find((d) => d.kind === "teamStrategy")!;
      expect(strategy.current!.teams).toEqual([{ teamNumber: 254, scoutUids: [ada], locked: false }]);
      // CS's production rules have no match for teamAssignments (it falls to the catch-all deny): clients cannot read it at all
      await denied(getDocs(query(collection(db, "teamAssignments"), where("teamId", "==", team))));
      hook.unmount();
    });

    it("publishTeamAssignments (pit) is a minimal diff against pitAssignments", async () => {
      const { team, admin1, ada, grace, hank } = await seedTeamRows();
      await as(admin1);
      const before = await rowsOf("pitAssignments", team);
      const beforeById = new Map(before.map((r) => [r.id, r]));
      await teamAssignments.publishTeamAssignments(team, "2026arli", "pit", pitVersion(admin1, [{ teamNumber: 254, scoutUids: [ada], locked: false }, { teamNumber: 971, scoutUids: [hank], locked: false }, { teamNumber: 1114, scoutUids: [grace], locked: false }]), null);
      const after = await rowsOf("pitAssignments", team);
      const afterById = new Map(after.map((r) => [r.id, r]));
      expect(afterById.get("p254")!.stamp).toBe(beforeById.get("p254")!.stamp);
      expect(afterById.get("p971")!.data).toEqual({ ...beforeById.get("p971")!.data, scoutId: hank, scoutName: `hank of ${team}`, assignedBy: admin1, assignedAt: NOW });
      expect(afterById.get("p971")!.data.futureField).toBe("keep");
      expect(afterById.has("p118")).toBe(false);
      const created = after.filter((r) => !beforeById.has(r.id));
      expect(created.map((r) => r.data)).toEqual([{ teamId: team, eventKey: "2026arli", teamNumber: 1114, scoutId: grace, scoutName: `grace of ${team}`, assignedBy: admin1, assignedAt: NOW }]);
      // the same publish again changes nothing
      const settled = stampsOf(await rowsOf("pitAssignments", team));
      await teamAssignments.publishTeamAssignments(team, "2026arli", "pit", pitVersion(admin1, [{ teamNumber: 254, scoutUids: [ada], locked: false }, { teamNumber: 971, scoutUids: [hank], locked: false }, { teamNumber: 1114, scoutUids: [grace], locked: false }]), null);
      expect(stampsOf(await rowsOf("pitAssignments", team))).toEqual(settled);
    });

    it("publishTeamAssignments (team strategy): the denied teamAssignments write falls back to the matchAssignments mirror, as CS does", async () => {
      const { team, admin1, ada, grace } = await seedTeamRows();
      await as(admin1);
      const mirrorBefore = (await rowsOf("matchAssignments", team)).find((r) => r.id === "mirror1")!;
      const teamDocsBefore = await rowsOf("teamAssignments", team);
      await teamAssignments.publishTeamAssignments(team, "2026arli", "teamStrategy", pitVersion(admin1, [{ teamNumber: 254, scoutUids: [ada], locked: false }, { teamNumber: 1678, scoutUids: [grace], locked: false }]), null);
      // nothing could be written to teamAssignments (no rule for it) ...
      expect(stampsOf(await rowsOf("teamAssignments", team))).toEqual(stampsOf(teamDocsBefore));
      // ... the mirror carries it: the existing 254 row is kept as is, 1678 is created in the mirror shape
      const mirror = (await rowsOf("matchAssignments", team)).filter((r) => r.data.assignmentType === "team");
      expect(mirror.find((r) => r.id === "mirror1")!.stamp).toBe(mirrorBefore.stamp);
      const created = mirror.find((r) => r.data.teamNumber === 1678)!;
      expect(created.data).toEqual({ teamId: team, eventKey: "2026arli", teamNumber: 1678, scoutId: grace, scoutName: `grace of ${team}`, assignedBy: admin1, assignedAt: NOW, assignmentType: "team", matchKey: "team", matchLabel: "Team Strategy", scoutHumanPlayer: false });
      expect(mirror).toHaveLength(2);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// 6. Sub-ins
// ---------------------------------------------------------------------------------------------------------------------

describe("6. sub-in requests", () => {
  const target = { matchType: "Qualification", matchNumber: 12, teamNumber: 1234 } as const;
  async function setup() {
    const team = newTeamCode();
    const admin1 = await seedUser(team, "admin", { isTeamAdmin: true });
    const ada = await seedUser(team, "ada");
    const grace = await seedUser(team, "grace");
    const hank = await seedUser(team, "hank");
    const other = newTeamCode();
    const zed = await seedUser(other, "zed");
    const actor = (uid: string) => ({ uid, name: uid.split("-")[1] });
    return { team, admin1, ada, grace, hank, zed, actor };
  }
  const feed = (team: string) => renderHook(() => subIns.useSubInRequests(team));

  it("request -> visible to teammates -> claimed by another member -> visible as claimed", async () => {
    const { team, ada, grace, actor } = await setup();
    await as(ada);
    const res = await subIns.requestSubIn({ teamId: team, eventKey: "2026arli", actor: actor(ada), target, existing: [] });
    expect(res).toEqual({ ok: true });
    const [stored] = await rowsOf("subInRequests", team);
    expect(stored.data).toEqual({ teamId: team, eventKey: "2026arli", matchKey: "Q12", matchLabel: "Qualification 12", teamNumber: 1234, requestedById: ada, requestedByName: "ada", requestedAt: NOW, status: "open", claimedById: null, claimedByName: null, claimedAt: null, expiresAt: NOW });
    expect(stored.data.expiresAt).toBe((stored.data.requestedAt as number) + subInModel.SUB_IN_TTL_MS);

    await as(grace);
    const hook = feed(team);
    const { requests } = await hook.waitFor((s) => s.loaded && s.requests.length === 1);
    expect(requests[0]).toMatchObject({ id: stored.id, status: "open", requestedById: ada });

    // asking again for the same robot is refused client-side (existing request) and nothing more is written
    await as(ada);
    expect(await subIns.requestSubIn({ teamId: team, eventKey: "2026arli", actor: actor(ada), target, existing: requests })).toMatchObject({ ok: false, reason: expect.stringContaining("already been requested") });
    expect(await rowsOf("subInRequests", team)).toHaveLength(1);
    // the requester cannot take their own request
    expect(await subIns.claimSubIn(stored.id, actor(ada))).toMatchObject({ ok: false, reason: expect.stringContaining("own request") });

    await as(grace);
    expect(await subIns.claimSubIn(stored.id, actor(grace))).toEqual({ ok: true });
    expect((await raw(`subInRequests/${stored.id}`))!).toEqual({ ...stored.data, status: "claimed", claimedById: grace, claimedByName: "grace", claimedAt: NOW });
    await hook.waitFor((s) => s.requests[0]?.status === "claimed");
    expect(subInModel.claimedAssignments(hook.result.current.requests, "2026arli", grace)).toEqual([{ matchType: "Qualification", matchNumber: 12, teamNumber: 1234, requestId: stored.id }]);
    // a third member is told it is gone
    const { hank } = { hank: `${team}-hank` };
    await as(hank);
    expect(await subIns.claimSubIn(stored.id, actor(hank))).toMatchObject({ ok: false, reason: expect.stringContaining("already took") });
    hook.unmount();
  });

  it("two simultaneous claims: the transaction lets exactly one win", async () => {
    const { team, ada, grace, actor } = await setup();
    await as(ada);
    await subIns.requestSubIn({ teamId: team, eventKey: "2026arli", actor: actor(ada), target, existing: [] });
    const [{ id }] = await rowsOf("subInRequests", team);
    await as(grace);
    const results = await Promise.all([subIns.claimSubIn(id, actor(grace)), subIns.claimSubIn(id, actor(grace))]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
    expect((await raw(`subInRequests/${id}`))!.status).toBe("claimed");
  });

  it("cancel: only the requester, only while open; the doc stays as `cancelled` and is hidden from the dashboard list", async () => {
    const { team, ada, grace, actor } = await setup();
    await as(ada);
    await subIns.requestSubIn({ teamId: team, eventKey: "2026arli", actor: actor(ada), target, existing: [] });
    const [{ id, data }] = await rowsOf("subInRequests", team);
    await as(grace);
    expect(await subIns.cancelSubIn(id)).toMatchObject({ ok: false }); // the rules: only the requester cancels
    expect((await raw(`subInRequests/${id}`))!.status).toBe("open");
    await as(ada);
    expect(await subIns.cancelSubIn(id)).toEqual({ ok: true });
    expect(await raw(`subInRequests/${id}`)).toEqual({ ...data, status: "cancelled" });
    const hook = feed(team);
    const { requests } = await hook.waitFor((s) => s.requests.length === 1);
    expect(subInModel.visibleRequests(requests, "2026arli", Date.now())).toEqual([]);
    hook.unmount();
  });

  it("expiry: an open request past its 6 h window is stored as open but reads as expired, drops off the list and cannot be claimed", async () => {
    const { team, ada, grace, actor } = await setup();
    const longAgo = Date.now() - 7 * 60 * 60 * 1000;
    await seed("subInRequests/old", subInModel.buildSubInRequest({ teamId: team, eventKey: "2026arli", actor: actor(ada), target, now: longAgo }) as unknown as CsRecord);
    await seed("subInRequests/fresh", subInModel.buildSubInRequest({ teamId: team, eventKey: "2026arli", actor: actor(ada), target: { ...target, matchNumber: 13 }, now: Date.now() }) as unknown as CsRecord);
    await as(grace);
    const hook = feed(team);
    const { requests } = await hook.waitFor((s) => s.requests.length === 2);
    const old = requests.find((r) => r.id === "old")!;
    expect(old.status).toBe("open");
    expect(subInModel.effectiveStatus(old, Date.now())).toBe("expired");
    expect(subInModel.visibleRequests(requests, "2026arli", Date.now()).map((r) => r.id)).toEqual(["fresh"]);
    expect(subInModel.claimableFor(requests, "2026arli", grace, Date.now()).map((r) => r.id)).toEqual(["fresh"]);
    const before = (await raw("subInRequests/old"))!;
    expect(await subIns.claimSubIn("old", actor(grace))).toMatchObject({ ok: false, reason: expect.stringContaining("expired") });
    expect(await raw("subInRequests/old")).toEqual(before);
    // an expired request no longer blocks a new one for the same robot
    await as(ada);
    expect(await subIns.requestSubIn({ teamId: team, eventKey: "2026arli", actor: actor(ada), target, existing: requests })).toEqual({ ok: true });
    hook.unmount();
  });

  it("a member of ANOTHER team is denied: reading, requesting into, claiming, cancelling and deleting", async () => {
    const { team, ada, zed, actor } = await setup();
    await as(ada);
    await subIns.requestSubIn({ teamId: team, eventKey: "2026arli", actor: actor(ada), target, existing: [] });
    const [{ id, data }] = await rowsOf("subInRequests", team);

    await as(zed);
    const hook = feed(team);
    await hook.waitFor((s) => s.loaded);
    expect(hook.result.current.requests).toEqual([]); // the team-scoped query is refused
    await denied(getDocs(query(collection(db, "subInRequests"), where("teamId", "==", team))));
    await denied(getDoc(doc(db, "subInRequests", id)));
    expect(await subIns.requestSubIn({ teamId: team, eventKey: "2026arli", actor: actor(zed), target: { ...target, matchNumber: 20 }, existing: [] })).toMatchObject({ ok: false });
    expect(await subIns.claimSubIn(id, actor(zed))).toMatchObject({ ok: false });
    expect(await subIns.cancelSubIn(id)).toMatchObject({ ok: false });
    expect(await subIns.deleteSubIn(id)).toMatchObject({ ok: false });
    expect(await raw(`subInRequests/${id}`)).toEqual(data);
    expect(await rowsOf("subInRequests", team)).toHaveLength(1);
    hook.unmount();
  });

  it("delete and clear-all are for team admins only", async () => {
    const { team, admin1, ada, actor } = await setup();
    await as(ada);
    for (const n of [12, 13, 14]) await subIns.requestSubIn({ teamId: team, eventKey: "2026arli", actor: actor(ada), target: { ...target, matchNumber: n }, existing: [] });
    const stored = await rowsOf("subInRequests", team);
    expect(stored).toHaveLength(3);
    const parsed = stored.map((r) => subInModel.parseSubInRequest(r.id, r.data));
    expect(await subIns.deleteSubIn(parsed[0].id)).toMatchObject({ ok: false });
    expect(await subIns.clearAllSubIns(parsed)).toMatchObject({ ok: false });
    expect(await rowsOf("subInRequests", team)).toHaveLength(3);
    await as(admin1);
    expect(await subIns.deleteSubIn(parsed[0].id)).toEqual({ ok: true });
    expect(await subIns.clearAllSubIns(parsed.slice(1))).toEqual({ ok: true });
    expect(await rowsOf("subInRequests", team)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// 7. Negative: another team, and what CS's production rules leave open
// ---------------------------------------------------------------------------------------------------------------------

describe("7. other teams and the open CS collections", () => {
  async function twoTeams() {
    const team = newTeamCode();
    const admin1 = await seedUser(team, "admin", { isTeamAdmin: true });
    const ada = await seedUser(team, "ada");
    const other = newTeamCode();
    const zed = await seedUser(other, "zed");
    await seed(`teams/${team}`, { teamName: "Home", selectedEvents: ["2026arli"], verifiedOwnerId: admin1 });
    await seed(`teams/${other}`, { teamName: "Away", selectedEvents: [] });
    await seed("formPresets/fp1", { teamId: team, name: "Reef form", formType: "match", game: "REEFSCAPE", fields: [] });
    await seed("accuracyRescouts/ar1", { teamId: team, eventKey: "2026arli", status: "open" });
    await seed("subInRequests/s1", subInModel.buildSubInRequest({ teamId: team, eventKey: "2026arli", actor: { uid: ada, name: "ada" }, target: { matchType: "Qualification", matchNumber: 1, teamNumber: 5 }, now: Date.now() }) as unknown as CsRecord);
    await seed("scoutingFlagStates/scoutingEntry:x", { teamId: team, entityType: "scoutingEntry", entityId: "x", manualFlagged: true });
    await seed("scouting/s1", rebuiltDoc({ teamId: team, scoutId: ada }));
    await seed("pitScouting/p1", { teamId: team, teamNumber: "254", submittedBy: ada, game: "REBUILT" });
    return { team, admin1, ada, other, zed };
  }

  it("team-scoped data (teams, users, formPresets, accuracyRescouts, subInRequests, flag states) is denied to another team's member and open to the team", async () => {
    const { team, ada, other, zed } = await twoTeams();
    await as(zed);
    await denied(getDoc(doc(db, "teams", team)));
    await denied(getDoc(doc(db, "users", ada)));
    await denied(getDocs(query(collection(db, "users"), where("teamId", "==", team))));
    await denied(getDocs(query(collection(db, "formPresets"), where("teamId", "==", team))));
    await denied(getDoc(doc(db, "formPresets", "fp1")));
    await denied(getDocs(query(collection(db, "accuracyRescouts"), where("teamId", "==", team))));
    await denied(getDocs(query(collection(db, "subInRequests"), where("teamId", "==", team))));
    await denied(getDocs(query(collection(db, "scoutingFlagStates"), where("teamId", "==", team))));
    await denied(setDoc(doc(db, "teams", team), { selectedEvents: ["hacked"] }, { merge: true }));
    await denied(setDoc(doc(db, "formPresets", "fp1"), { name: "x" }, { merge: true }));
    await denied(setDoc(doc(db, "formPresets", "fp2"), { teamId: team, name: "planted" }));
    await denied(setDoc(doc(db, "users", ada), { isTeamAdmin: true, teamId: other }, { merge: true }));
    expect((await raw(`teams/${team}`))!.selectedEvents).toEqual(["2026arli"]);
    // ... while the same user reads and writes their own team's data
    expect((await getDoc(doc(db, "teams", other))).data()!.teamName).toBe("Away");
    await setDoc(doc(db, "formPresets", "mine"), { teamId: other, name: "Mine", formType: "match", game: "REEFSCAPE", fields: [] });
    expect((await getDocs(query(collection(db, "formPresets"), where("teamId", "==", other)))).size).toBe(1);

    await as(ada);
    expect((await getDoc(doc(db, "teams", team))).exists()).toBe(true);
    expect((await getDocs(query(collection(db, "formPresets"), where("teamId", "==", team)))).size).toBe(1);
    expect((await getDocs(query(collection(db, "accuracyRescouts"), where("teamId", "==", team)))).size).toBe(1);
    expect((await getDocs(query(collection(db, "subInRequests"), where("teamId", "==", team)))).size).toBe(1);
    expect((await getDocs(query(collection(db, "scoutingFlagStates"), where("teamId", "==", team)))).size).toBe(1);
    // the same rules also scope the team's own rows: a signed-in user with no user doc reads nothing team-scoped
    const nodoc = "no-user-doc";
    await getAdminAuth()!.createUser({ uid: nodoc, email: emailOf(nodoc), password: PASSWORD });
    await as(nodoc);
    await denied(getDoc(doc(db, "teams", team)));
    await denied(getDocs(query(collection(db, "formPresets"), where("teamId", "==", team))));
  });

  it("CS-OPEN (documented, not fixed): scouting, pit, assignment, strategy, drive, helper, lead and practice collections are read/write for ANY signed-in user of ANY team", async () => {
    const { team, zed } = await twoTeams();
    await as(zed);
    // reads: another team's scouting rows, by teamId and as a whole-collection scan
    const theirs = await getDocs(query(collection(db, "scouting"), where("teamId", "==", team)));
    expect(theirs.size).toBe(1);
    expect((await getDocs(collection(db, "scouting"))).size).toBeGreaterThanOrEqual(1);
    // the adapter itself therefore returns another team's data when asked for it
    expect((await scoutEntries.getEntries(team)).map((e) => e.id)).toContain("s1");
    // writes: overwrite and delete another team's pit doc, plant rows in another team's assignment collection
    await setDoc(doc(db, "pitScouting", "p1"), { robotWeight: "tampered" }, { merge: true });
    expect((await raw("pitScouting/p1"))!.robotWeight).toBe("tampered");
    await setDoc(doc(db, "matchAssignments", "planted"), { teamId: team, eventKey: "2026arli", scoutId: zed, teamNumber: 1 });
    expect(await raw("matchAssignments/planted")).toBeDefined();
    for (const name of ["leadScouting", "strategyScouting", "matchStrategyPlans", "driveScouting", "helperReports", "pitAssignments", "practiceAssignments", "practiceSessions"]) {
      await setDoc(doc(db, name, "open-doc"), { teamId: team, planted: true });
      expect((await raw(`${name}/open-doc`))!.planted, name).toBe(true);
    }
    await scoutEntries.deleteEntry("s1");
    expect(await raw("scouting/s1")).toBeUndefined();
    // practiceMatches: readable by anyone signed in, writable only by the CS owner's import
    await seed("practiceMatches/m1", { matchKey: "2026arli_qm1", eventKey: "2026arli" });
    expect((await getDoc(doc(db, "practiceMatches", "m1"))).exists()).toBe(true);
    await denied(setDoc(doc(db, "practiceMatches", "m2"), { eventKey: "2026arli" }));
  });

  it("CS-OPEN (documented, not fixed): any member may write any field of their OWN user doc (self-promotion) and any signed-in user may create a team doc; updating someone else's existing team is still denied", async () => {
    const { team, ada, zed } = await twoTeams();
    await as(ada);
    await setDoc(doc(db, "users", ada), { isTeamAdmin: true }, { merge: true });
    expect((await raw(`users/${ada}`))!.isTeamAdmin).toBe(true);
    await as(zed);
    await setDoc(doc(db, "teams", "BRANDNEW1"), { teamName: "Fresh", selectedEvents: [] });
    expect((await raw("teams/BRANDNEW1"))!.teamName).toBe("Fresh");
    await denied(setDoc(doc(db, "teams", team), { teamName: "Hijacked" })); // a create over an existing id is an update
  });

  it("signed-out clients get nothing from any CS collection", async () => {
    const { team } = await twoTeams();
    await auth.signOut();
    await denied(getDocs(query(collection(db, "scouting"), where("teamId", "==", team))));
    await denied(getDoc(doc(db, "pitScouting", "p1")));
    await denied(getDoc(doc(db, "teams", team)));
    await denied(setDoc(doc(db, "scouting", "anon"), { teamId: team }));
    expect(await scoutEntries.getEntries(team).catch(() => "rejected")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// 8. Practice sessions
// ---------------------------------------------------------------------------------------------------------------------

describe("8. practice sessions", () => {
  it("claimSessionId reserves a CS-readable session doc; updatePracticeSession writes app fields with their CS counterparts; getPracticeSession reads app and CS docs; delete works", async () => {
    const team = newTeamCode();
    const ada = await seedUser(team, "ada");
    await as(ada);
    const id = await practiceSessions.claimSessionId(team, ada, "solo");
    expect(id).toMatch(/^PS-[A-Z2-9]{6}$/);
    expect(await raw(`practiceSessions/${id}`)).toMatchObject({ teamId: team, uid: ada, scoutId: ada, kind: "solo", status: "in-progress", isLivePracticeScouting: false, startedAt: NOW, timestamp: NOW, createdAt: expect.anything() });
    // a second claim of the same id is refused (create-only reservation): the next candidate id differs
    const second = await practiceSessions.claimSessionId(team, ada, "solo");
    expect(second).not.toBe(id);

    await practiceSessions.updatePracticeSession(id, { status: "completed", mode: "trial", difficulty: "easy", eventCode: "2026arli", alliance: "red", robots: [254], accuracy: 82, officialScore: 100, scoutName: "Ada" });
    const stored = (await raw(`practiceSessions/${id}`))!;
    expect(stored).toMatchObject({ status: "completed", mode: "trial", difficulty: "easy", accuracy: 82, scoutId: ada, scoutName: "Ada", teamId: team });
    expect(await practiceSessions.getPracticeSession(id)).toMatchObject({ id, teamId: team, uid: ada, status: "completed", mode: "trial", alliance: "red", accuracy: 82 });

    // a snapshot written by CS (no kind / status / uid) reads as a completed solo session; a CS live-lobby doc is not a session
    await seed("practiceSessions/cs-snap", { teamId: team, scoutId: ada, scoutName: "Ada", eventKey: "2026arli", matchKey: "2026arli_qm7", matchType: "qualification", matchNumber: "7", alliance: "red", mode: "competitive", accuracy: 91, officialScore: 120, timestamp: 1_776_000_000_000 });
    await seed("practiceSessions/cs-lobby", { code: "ABCD", hostId: ada, status: "open", playersByUid: {} });
    expect(await practiceSessions.getPracticeSession("cs-snap")).toMatchObject({ uid: ada, kind: "solo", status: "completed", mode: "competitive", matchNumber: 7, matchType: "Qualification", accuracy: 91 });
    expect(await practiceSessions.getPracticeSession("cs-lobby")).toBeNull();
    expect(await practiceSessions.getPracticeSession("missing")).toBeNull();

    await practiceSessions.deletePracticeSession(second);
    expect(await raw(`practiceSessions/${second}`)).toBeUndefined();
  });
});
