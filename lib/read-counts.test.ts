// QUERY-COUNT HARNESS (read-reduction session, step A). Counts the documents Firestore would BILL for each page's reads, with a mocked Firestore and a
// SYNTHETIC dataset (see DATASET: stand-in sizes, not production data; the entry count is the owner's 1,234). The point is the BEFORE/AFTER difference per
// reduction, not the absolute number. These expectations are the only tests a reduction is allowed to change (the characterization tests may not move).
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => (await import("@/test-stubs/hook-runtime")).hookMock(await vi.importActual<typeof import("react")>("react")));
vi.mock("firebase/firestore", async () => (await import("@/test-stubs/fake-firestore")).fakeFirestoreModule);
vi.mock("@/lib/firebase/client", () => ({ db: { fake: true }, auth: { currentUser: { uid: "u1" } }, isFirebaseConfigured: () => true }));
vi.mock("@/lib/program/data", () => ({ useProgramData: () => null, programData: () => null }));
vi.mock("@/lib/program/context", () => ({ useProgram: () => "frc", useProgramConfig: () => ({ connection: { features: { live: true, practice: true } } }) }));
vi.mock("@/lib/team-roster", async (orig) => ({ ...(await orig<typeof import("@/lib/team-roster")>()), loadRosterExtras: async () => ({ members: [], denied: false }), useRosterExtras: () => [] }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ profile: null, user: { uid: "u1" } }) }));
const api = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/api-client", () => ({ ApiError: class extends Error {}, authedApi: async () => ((api.calls += 1), { entries: [], isOwner: false }) }));
vi.mock("@/lib/personal/scope", () => ({ personalScopeUid: () => null }));
vi.mock("@/lib/memberships/client", () => ({ membershipsEnabled: async () => false, useMembershipsEnabled: () => false, membershipApi: {} }));

import * as fake from "@/test-stubs/fake-firestore";
import * as rt from "@/test-stubs/hook-runtime";
import * as fx from "@/test-stubs/read-fixtures";
import { useTeamScoutEntries } from "@/lib/scout-entries";
import { useAllTeamPracticeSessions, useTeamLiveSessions } from "@/lib/practice-sessions";
import { useTeamActiveLiveScouts } from "@/lib/live-presence";
import { useAllLibraryMatches } from "@/lib/match-library";
import { useTeamMembers } from "@/lib/team-members";

/** The synthetic team behind every number below. */
export const DATASET: fx.Scale = { members: 20, entries: 1234, legacyRows: 40, otherTeamRows: 150, flagStates: 60, liveSessions: 160, soloSessions: 90, libraryMatches: 500 };

let n = 0;
async function measure(page: (team: string) => void): Promise<{ total: number; by: Record<string, number> }> {
  n += 1;
  const team = `HT-${n}`;
  fake.resetFake();
  fx.seedDataset(DATASET, team);
  const h = rt.renderHook(() => page(team));
  await rt.settle(12);
  const out = { total: fake.billing.total, by: { ...fake.billing.byCollection } };
  h.unmount();
  return out;
}

// The shell's two watchers, mounted on every page of the signed-in app.
function useShellPage(t: string) {
  useTeamLiveSessions(t);
  useTeamActiveLiveScouts(t);
}
function useScoutPage(t: string) {
  useTeamScoutEntries(t);
}
function useAnalyticsPage(t: string) {
  useTeamScoutEntries(t);
  useAllTeamPracticeSessions(t);
  useAllLibraryMatches(true);
}
function useCoachDashboard(t: string) {
  useTeamScoutEntries(t);
  useTeamMembers(t);
  useTeamMembers(t);
  useAllTeamPracticeSessions(t);
}
const pages: Record<string, (team: string) => void> = {
  "app shell (live sessions + live presence listeners)": useShellPage,
  "Scout page (team entries feed)": useScoutPage,
  "Analytics (entries + all sessions + all library matches)": useAnalyticsPage,
  "Team Coach dashboard (entries, members x2, all sessions)": useCoachDashboard,
};

const BEFORE: Record<string, number> = {
  "app shell (live sessions + live presence listeners)": 161,
  "Scout page (team entries feed)": 4162,
  "Analytics (entries + all sessions + all library matches)": 5493,
  "Team Coach dashboard (entries, members x2, all sessions)": 5032,
};

describe("documents billed per page, on the synthetic dataset", () => {
  for (const [name, page] of Object.entries(pages)) {
    it(name, async () => {
      const r = await measure(page);
      console.info(`[read-counts] ${name}: ${r.total}  ${JSON.stringify(r.by)}`);
      expect(r.total).toBe(BEFORE[name] ?? -1);
    });
  }
});

// ---- the server and sign-in reads (fake Admin SDK: it only counts get() calls) ----
const server = vi.hoisted(() => ({ reads: 0, settings: {} as Record<string, unknown>, changelogDocs: 0 }));
vi.mock("@/lib/firebase/admin", () => ({
  getAdminFirestore: () => ({
    doc: () => ({ get: async () => ((server.reads += 1), { exists: true, data: () => server.settings }) }),
    collection: () => ({ get: async () => ((server.reads += server.changelogDocs), { docs: Array.from({ length: server.changelogDocs }, (_, i) => ({ id: "c" + i, data: () => ({ status: "published", title: "t" + i, items: [], programs: ["frc"], publishedAt: 1 + i, version: "1", legacy: false, rev: 1 }) })) }) }),
  }),
}));
vi.mock("@/lib/server/avatar-blobs", () => ({ avatarStoreHost: () => null }));

describe("server reads, on a synthetic changelog of 60 entries", () => {
  it("public config: Firestore reads for two calls in a row", async () => {
    const { GET } = await import("@/app/api/public/config/route");
    const { resetMembershipsEnabledCache, resetAccountDeletionSettingsCache } = await import("@/lib/server/team-settings");
    resetMembershipsEnabledCache();
    resetAccountDeletionSettingsCache();
    server.reads = 0;
    await GET();
    const first = server.reads;
    await GET();
    console.info("[read-counts] public config: first call " + first + ", second call " + (server.reads - first));
    expect([first, server.reads - first]).toEqual(BEFORE_CONFIG);
  });

  it("changelog feed: documents read per call, and calls for one mount plus five tab refocuses", async () => {
    server.changelogDocs = 60;
    server.reads = 0;
    const { listFeed } = await import("@/lib/server/platform-changelog");
    const { getAdminFirestore } = await import("@/lib/firebase/admin");
    await listFeed(getAdminFirestore() as never, { uid: "u", name: "n", isOwner: false } as never, false);
    expect(server.reads).toBe(BEFORE_FEED_DOCS);
  });
});
// Before the shared snapshot (step B) these were [5, 3]: five reads of appSettings/global on a cold call, three on the next (the uncached getters).
const BEFORE_CONFIG: [number, number] = [1, 0];
const BEFORE_FEED_DOCS = 60;

describe("the sidebar changelog unread dot: feed fetches for one mount plus five tab refocuses inside two minutes", () => {
  it("calls", async () => {
    const listeners: (() => void)[] = [];
    const doc = { visibilityState: "visible", addEventListener: (_: string, l: () => void) => void listeners.push(l), removeEventListener: () => {} };
    vi.stubGlobal("document", doc);
    const { usePlatformChangelogUnread } = await import("@/lib/platform-changelog/client");
    api.calls = 0;
    const h = rt.renderHook(() => usePlatformChangelogUnread(true, null));
    await rt.settle();
    for (let i = 0; i < 5; i += 1) listeners.forEach((l) => l());
    await rt.settle();
    console.info("[read-counts] changelog dot fetches: " + api.calls);
    expect(api.calls).toBe(BEFORE_DOT_FETCHES);
    h.unmount();
    vi.unstubAllGlobals();
  });
});
const BEFORE_DOT_FETCHES = 6;
