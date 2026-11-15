// Characterization of what the FRC Match Library panel SHOWS today (first render of each state), BEFORE the library merge.
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  events: { events: [] as unknown[], loaded: true },
  matches: { matches: [] as unknown[], loaded: true, error: null as unknown, unreadable: 0, retry: () => {} },
}));

vi.mock("@/lib/firebase/client", () => ({ db: { fake: true }, auth: { currentUser: { uid: "u1" } }, isFirebaseConfigured: () => false }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { uid: "u1" }, profile: { teamId: "T1", name: "Ada", isAdmin: true } }) }));
vi.mock("@/lib/program/data", () => ({ useProgramData: () => null }));
vi.mock("@/lib/team", () => ({ useTeamDoc: () => ({ team: { usePlaceholderVideo: false } }), setUsePlaceholderVideo: vi.fn() }));
vi.mock("@/lib/library/store", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/library/store")>()), useLibraryEvents: () => h.events }));
vi.mock("@/lib/match-library", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/match-library")>()), useLibraryMatches: () => h.matches }));

import { MatchLibraryPanel } from "@/components/admin/match-library-panel";
import { ManualLibraryPanel } from "@/components/admin/library/manual-library-panel";

const text = (node: React.ReactNode) => renderToString(node).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const event = { eventCode: "MAN-DEMO-AAAA", eventName: "Demo", seasonId: "reefscape", origin: "manual", date: "2026-03-01", sourceUrl: null, defaultVideoUrl: null, createdBy: "u1" };
const match = (n: number, over: Record<string, unknown> = {}) => ({
  id: `MAN-DEMO-AAAA_Q${n}`,
  eventCode: event.eventCode,
  matchType: "Qualification",
  matchNumber: n,
  alliances: { red: { teams: [254, 1114, 2056], score: 90, penaltyPoints: 5, difficulty: "medium" }, blue: { teams: [1678, 971, 118], score: 70, penaltyPoints: 0, difficulty: "easy" } },
  video: null,
  origin: "manual",
  published: true,
  ...over,
});

beforeEach(() => {
  h.events = { events: [], loaded: true };
  h.matches = { matches: [], loaded: true, error: null, unreadable: 0, retry: () => {} };
});

describe("FRC Match Library panel: first render", () => {
  it("opens on the Imported tab: heading, copy, both tabs, season, event code, import, Update library, placeholder switch, video CSV import", () => {
    const out = text(<MatchLibraryPanel onOpenRescore={() => {}} />);
    for (const s of ["Match Library", "Import real events for practice scouting, or enter matches by hand", "Imported (FIRST API)", "Manual events", "Season", "Event code", "Import event", "Update library", "Use placeholder video for testing", "Bulk import video CSV", "Columns: matchKey, url, startSec, endSec"]) {
      expect(out, s).toContain(s);
    }
    expect(out).not.toContain("Refresh scores");
    expect(out).not.toContain("<table");
  });
});

describe("FRC Manual events tab", () => {
  const panel = () => text(<ManualLibraryPanel onOpenRescore={() => {}} />);

  it("loading events: a skeleton and nothing else", () => {
    h.events = { events: [], loaded: false };
    const out = panel();
    expect(out).toContain("animate-pulse");
    expect(out).not.toContain("Add manual event");
  });

  it("no manual events: the empty copy, a disabled dropdown, Add manual event, no Edit or Delete event", () => {
    const out = panel();
    expect(out).toContain("No manual events yet");
    expect(out).toContain("For events whose scores aren't in the FIRST API. Add a manual event, then enter its matches by hand or in bulk.");
    expect(out).toContain("Add manual event");
    expect(out).not.toContain("Edit event");
    expect(out).not.toContain("Delete event");
  });

  it("an event with no matches: the empty-matches sentence and the three entry buttons", () => {
    h.events = { events: [event], loaded: true };
    const out = panel();
    expect(out).toContain("Demo (MAN-DEMO-AAAA)");
    expect(out).toContain("No default video");
    expect(out).toContain("No matches in this event yet — add one, use fast entry, or bulk import.");
    for (const s of ["Add match", "Fast entry", "Bulk import", "Edit event", "Delete event"]) expect(out, s).toContain(s);
  });

  it("matches still loading: a skeleton in place of the table", () => {
    h.events = { events: [event], loaded: true };
    h.matches = { ...h.matches, loaded: false };
    const out = panel();
    expect(out).toContain("animate-pulse");
    expect(out).not.toContain("<table");
  });

  it("matches: the table headers, a row per match (label, origin, teams, score, penalty, difficulty, video, status), search and status filters, review banner", () => {
    h.events = { events: [event], loaded: true };
    h.matches = { ...h.matches, matches: [match(1), match(2, { published: false, needsReview: true })] };
    const out = panel();
    for (const s of ["Match", "Origin", "Red", "Blue", "Video", "Status"]) expect(out, s).toContain(`>${s}</th>`);
    for (const s of ["Q1", "Q2", "Manual", "254 & 1114 & 2056", "(5 pen.)", "None", "Published", "Needs review", "Search match or team", "Unpublished"]) expect(out, s).toContain(s);
    expect(out).toContain("1 imported match need");
    expect(out).toContain("Publish all (1)");
    expect(out).toContain("2 missing video");
    expect(out).toContain('aria-label="Edit Q1"');
    expect(out).toContain('aria-label="Duplicate Q1"');
    expect(out).toContain('aria-label="Delete Q1"');
    expect(out).toMatch(/Delete event<\/button>/);
    expect(out).toMatch(/disabled=""[^>]*title="Delete this event&#x27;s matches first\."|title="Delete this event's matches first\."/);
  });
});

describe("FRC fast entry and bulk template (3 robots per alliance)", () => {
  it("fast entry has Red 1-3 and Blue 1-3 columns, scores, penalties, video link and optional times", async () => {
    const { FastEntry } = await import("@/components/admin/library/fast-entry");
    const out = text(<FastEntry event={event as never} eventMatches={[]} actor={{ teamId: "T1", uid: "u1", name: "Ada" }} />);
    for (const s of ["Red 1", "Red 2", "Red 3", "Blue 1", "Blue 2", "Blue 3", "Red score", "Blue score", "Red pen.", "Blue pen.", "YouTube link", "Start (opt.)", "End (opt.)"]) expect(out, s).toContain(s);
  });

  it("the bulk template lists red1..red3 and blue1..blue3", async () => {
    const { bulkTemplateCsv } = await import("@/lib/library/bulk");
    const header = bulkTemplateCsv().split("\n")[0];
    for (const c of ["red1", "red2", "red3", "blue1", "blue2", "blue3", "redScore", "blueScore"]) expect(header).toContain(c);
  });
});
