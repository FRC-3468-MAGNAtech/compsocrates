// CHARACTERIZATION (read reduction 2a, step 1): pins what the roster and library hooks DELIVER, and what the practice-session exclusions (flag states) resolve to, on
// fixed fixtures and a mocked Firestore. These tests must pass UNCHANGED after the shared roster listener, the flag-state dedupe and the snapshot data-source swap
// (flags OFF, and flags ON with the route answering the same rows). Only document COUNTS (read-counts.test.ts) may move. Hooks run through test-stubs/hook-runtime.ts.
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => (await import("@/test-stubs/hook-runtime")).hookMock(await vi.importActual<typeof import("react")>("react")));
vi.mock("firebase/firestore", async () => (await import("@/test-stubs/fake-firestore")).fakeFirestoreModule);
vi.mock("@/lib/firebase/client", () => ({ db: { fake: true }, auth: { currentUser: { uid: "u1" } }, isFirebaseConfigured: () => true }));
vi.mock("@/lib/program/data", () => ({ useProgramData: () => null, programData: () => null }));
vi.mock("@/lib/program/context", () => ({ useProgram: () => "frc", useProgramConfig: () => ({ connection: { features: { live: true, practice: true } } }) }));
vi.mock("@/lib/team-roster", async (orig) => ({ ...(await orig<typeof import("@/lib/team-roster")>()), loadRosterExtras: async () => ({ members: [], denied: false }), useRosterExtras: () => [] }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ profile: null, user: { uid: "u1" } }) }));
vi.mock("@/lib/personal/scope", () => ({ personalScopeUid: () => null }));
vi.mock("@/lib/memberships/client", () => ({ membershipsEnabled: async () => false, useMembershipsEnabled: () => false, membershipApi: {}, publicConfigOnce: async () => null }));

import * as fake from "@/test-stubs/fake-firestore";
import * as rt from "@/test-stubs/hook-runtime";
import { useTeamMembers } from "@/lib/team-members";
import { useAllLibraryMatches } from "@/lib/match-library";
import { clearPracticeExtrasCache, loadPracticeExtras } from "@/lib/practice-extras";

let counter = 0;
const freshTeam = () => {
  counter += 1;
  fake.resetFake();
  clearPracticeExtrasCache();
  return `RS-${counter}`;
};

/** A small roster: an admin owner, a lead with secondary roles and an avatar, a legacy "coach", a plain scout, and a member of ANOTHER team (never delivered). */
function seedRoster(team: string) {
  fake.seed("users/u-owner", { teamId: team, displayName: "Olive Owner", email: "olive@example.org", role: "lead-scout", isTeamAdmin: true, isOwner: true, createdAt: 1_700_000_000_000 });
  fake.seed("users/u-lead", { teamId: team, displayName: "Lee Lead", email: "lee@example.org", role: "lead-scout", roles: ["lead-scout", "pit-scout"], secondaryRoles: ["pit-scout"], avatar: { kind: "color", color: "#336699" }, createdAt: 1_710_000_000_000 });
  fake.seed("users/u-coach", { teamId: team, displayName: "Casey Coach", email: "casey@example.org", role: "coach" });
  fake.seed("users/u-scout", { teamId: team, displayName: "Sam Scout", email: "sam@example.org", role: "match-scout" });
  fake.seed("users/u-other", { teamId: `${team}-other`, displayName: "Not Ours", email: "no@example.org", role: "match-scout" });
}

async function loadMembers(team: string) {
  const h = rt.renderHook(() => useTeamMembers(team));
  await rt.settle();
  const out = { members: h.result.current.members, loaded: h.result.current.loaded, error: h.result.current.error };
  h.unmount();
  return out;
}

const byUid = <T extends { uid: string }>(xs: T[]) => [...xs].sort((a, b) => a.uid.localeCompare(b.uid));

describe("useTeamMembers: what the roster delivers", () => {
  it("delivers the team's members with their mapped roles, flags, avatar and joined time, and no one from another team", async () => {
    const team = freshTeam();
    seedRoster(team);
    const out = await loadMembers(team);
    expect(out.loaded).toBe(true);
    expect(out.error).toBeNull();
    expect(byUid(out.members)).toMatchSnapshot();
  });

  it("two call sites for the same team deliver the same members", async () => {
    const team = freshTeam();
    seedRoster(team);
    const a = rt.renderHook(() => useTeamMembers(team));
    const b = rt.renderHook(() => useTeamMembers(team));
    await rt.settle();
    expect(byUid(a.result.current.members)).toEqual(byUid(b.result.current.members));
    expect(a.result.current.members).toHaveLength(4);
    a.unmount();
    b.unmount();
  });

  it("a member added after the first snapshot reaches every mounted call site", async () => {
    const team = freshTeam();
    seedRoster(team);
    const a = rt.renderHook(() => useTeamMembers(team));
    const b = rt.renderHook(() => useTeamMembers(team));
    await rt.settle();
    fake.write("users/u-new", { teamId: team, displayName: "New Nia", email: "nia@example.org", role: "match-scout" });
    await rt.settle();
    expect(a.result.current.members.map((m) => m.uid)).toContain("u-new");
    expect(b.result.current.members.map((m) => m.uid)).toContain("u-new");
    a.unmount();
    b.unmount();
  });

  it("a failed read says so and leaves no members (never a silent success)", async () => {
    const team = freshTeam();
    seedRoster(team);
    fake.failNext("permission-denied");
    const out = await loadMembers(team);
    expect(out.members).toEqual([]);
    expect(out.loaded).toBe(true);
    expect(out.error).not.toBeNull();
  });

  it("no team: nothing is read and the roster is empty and loaded", async () => {
    freshTeam();
    const h = rt.renderHook(() => useTeamMembers(null));
    await rt.settle();
    expect(h.result.current.members).toEqual([]);
    expect(h.result.current.loaded).toBe(true);
    expect(fake.billing.total).toBe(0);
    h.unmount();
  });
});

function seedLibrary() {
  fake.seed("libraryMatches/m1", { eventCode: "2026arli", seasonId: "rebuilt", matchType: "qualification", matchNumber: 1, published: true, origin: "api", red: [254, 971, 118], blue: [1678, 148, 111] });
  fake.seed("libraryMatches/m2", { eventCode: "2026arli", seasonId: "rebuilt", matchType: "qualification", matchNumber: 2, published: true, origin: "api" });
  fake.seed("libraryMatches/m3", { eventCode: "2026lake", seasonId: "rebuilt", matchType: "playoff", matchNumber: 3, published: true, origin: "manual", teamId: "T-X", video: { youtubeUrl: "https://youtu.be/x", startSec: 5, endSec: 60 } });
  fake.seed("libraryMatches/draft", { eventCode: "2026arli", seasonId: "rebuilt", matchType: "qualification", matchNumber: 9, published: false, origin: "api" });
}

describe("useAllLibraryMatches: what the library delivers", () => {
  it("delivers every published match with its stored fields and id, never a draft", async () => {
    freshTeam();
    seedLibrary();
    const h = rt.renderHook(() => useAllLibraryMatches(true));
    await rt.settle();
    expect(h.result.current.loaded).toBe(true);
    expect([...h.result.current.matches].sort((a, b) => a.id.localeCompare(b.id))).toMatchSnapshot();
    expect(h.result.current.matches.map((m) => m.id)).not.toContain("draft");
    h.unmount();
  });

  it("an admin screen that asks for drafts gets them", async () => {
    freshTeam();
    seedLibrary();
    const h = rt.renderHook(() => useAllLibraryMatches(true, { includeUnpublished: true }));
    await rt.settle();
    expect(h.result.current.matches.map((m) => m.id).sort()).toEqual(["draft", "m1", "m2", "m3"]);
    h.unmount();
  });

  it("disabled: no read, no matches, loaded", async () => {
    freshTeam();
    seedLibrary();
    const h = rt.renderHook(() => useAllLibraryMatches(false));
    await rt.settle();
    expect(h.result.current.matches).toEqual([]);
    expect(h.result.current.loaded).toBe(true);
    expect(fake.billing.byCollection.libraryMatches ?? 0).toBe(0);
    h.unmount();
  });
});

describe("the practice-session exclusions (flag states) the extras resolve to", () => {
  it("excludes exactly the sessions a flag state marks, read for this team only", async () => {
    const team = freshTeam();
    fake.seed("users/u1", { teamId: team, displayName: "Scout 1", role: "match-scout" });
    fake.seed("practiceSessions/s1", { teamId: team, uid: "u1", scoutId: "u1", scoutName: "Scout 1", kind: "solo", status: "completed", accuracy: 80, startedAt: 1_700_000_000_000 });
    fake.seed("practiceSessions/s2", { teamId: team, uid: "u1", scoutId: "u1", scoutName: "Scout 1", kind: "solo", status: "completed", accuracy: 70, startedAt: 1_700_000_100_000 });
    fake.seed("scoutingFlagStates/practiceSession:s2", { teamId: team, entityType: "practiceSession", entityId: "s2", excludeFromAccuracy: true });
    fake.seed("scoutingFlagStates/practiceSession:s1", { teamId: `${team}-other`, entityType: "practiceSession", entityId: "s1", excludeFromAccuracy: true });
    const { extras, error } = await loadPracticeExtras(team, [{ uid: "u1", name: "Scout 1" }]);
    expect(error).toBeNull();
    expect([...extras.excluded].sort()).toMatchSnapshot();
    // the same session can arrive from both member queries; the merge with the team query (finalizeSessions) is what de-duplicates, so pin the distinct ids
    expect([...new Set(extras.sessions.map((s) => s.id))].sort()).toEqual(["s1", "s2"]);
  });
});
