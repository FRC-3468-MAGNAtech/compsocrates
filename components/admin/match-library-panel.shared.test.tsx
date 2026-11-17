// The ONE Match Library panel, rendered for both programs: same layout and wording, differences only where the program config says so.
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProgramId } from "@/config/programs/types";

const h = vi.hoisted(() => ({
  data: null as unknown,
  events: { events: [] as unknown[], loaded: true, error: null as unknown, retry: () => {} },
  matches: { matches: [] as unknown[], loaded: true, error: null as unknown, unreadable: 0, retry: () => {} },
}));

vi.mock("@/lib/firebase/client", () => ({ db: { fake: true }, auth: { currentUser: { uid: "u1" } }, isFirebaseConfigured: () => false }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { uid: "u1" }, profile: { teamId: "T1", name: "Ada", isAdmin: true } }) }));
vi.mock("@/lib/program/data", () => ({ useProgramData: () => h.data }));
vi.mock("@/lib/team", () => ({ useTeamDoc: () => ({ team: { usePlaceholderVideo: false } }), setUsePlaceholderVideo: vi.fn() }));
vi.mock("@/lib/library/store", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/library/store")>()), useLibraryEvents: () => h.events }));
vi.mock("@/lib/match-library", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/match-library")>()), useLibraryMatches: () => h.matches }));

import { MatchLibraryPanel } from "@/components/admin/match-library-panel";
import { ManualLibraryPanel } from "@/components/admin/library/manual-library-panel";
import { ImportedMatchRow } from "@/components/admin/library/imported-library-panel";
import { FastEntry } from "@/components/admin/library/fast-entry";
import { ProgramProvider } from "@/lib/program/context";
import { rootLibraryAdapter, useLibraryAdapter } from "@/lib/library/adapter";

const text = (node: React.ReactNode) => renderToString(node).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const portStub = { subscribeEvents: vi.fn(), subscribeMatches: vi.fn(), createEvent: vi.fn() };
const ftcData = { library: portStub, games: { seasons: [{ id: "biobuzz", name: "BIOBUZZ", enabled: true }], defaultSeasonId: "biobuzz" } };
const actor = { teamId: "T1", uid: "u1", name: "Ada" };
const event = { eventCode: "MAN-DEMO-AAAA", eventName: "Demo", seasonId: "x", origin: "manual", date: null, sourceUrl: null, defaultVideoUrl: null, createdBy: "u1" };
const match = (n: number, over: Record<string, unknown> = {}) => ({
  id: `MAN-DEMO-AAAA_Q${n}`,
  eventCode: event.eventCode,
  matchType: "Qualification",
  matchNumber: n,
  alliances: { red: { teams: [254, 1114], score: 90, penaltyPoints: 0, difficulty: "medium" }, blue: { teams: [1678, 971], score: 70, penaltyPoints: 0, difficulty: "easy" } },
  video: null,
  origin: "manual",
  published: true,
  ...over,
});
const unscored = { teams: [1, 2], score: 0, penaltyPoints: 0, difficulty: "easy", scoreKnown: false };

const PROGRAMS: [ProgramId, unknown][] = [
  ["frc", null],
  ["ftc", ftcData],
];

beforeEach(() => {
  h.events = { events: [], loaded: true, error: null, retry: () => {} };
  h.matches = { matches: [], loaded: true, error: null, unreadable: 0, retry: () => {} };
});

describe.each(PROGRAMS)("the shared Match Library panel (%s)", (program, data) => {
  const render = (node: React.ReactNode) => {
    h.data = data;
    return text(<ProgramProvider program={program}>{node}</ProgramProvider>);
  };

  it("has the same heading, copy, tabs and import controls", () => {
    const out = render(<MatchLibraryPanel onOpenRescore={() => {}} />);
    for (const s of ["Match Library", "Imported (FIRST API)", "Manual events", "Season", "Event code", "Import event"]) expect(out, s).toContain(s);
  });

  it("manual tab, loading: a skeleton only", () => {
    h.events = { ...h.events, loaded: false };
    const out = render(<ManualLibraryPanel onOpenRescore={() => {}} />);
    expect(out).toContain("animate-pulse");
    expect(out).not.toContain("Add manual event");
  });

  it("manual tab, empty: the same copy and buttons", () => {
    const out = render(<ManualLibraryPanel onOpenRescore={() => {}} />);
    expect(out).toContain("No manual events yet");
    expect(out).toContain("Add manual event");
  });

  it("a failed events read says so with Try again, never an empty list", () => {
    h.events = { ...h.events, error: { code: "permission-denied" } };
    const out = render(<ManualLibraryPanel onOpenRescore={() => {}} />);
    expect(out).toContain("Couldn't load the library events (permission-denied)");
    expect(out).toContain("this is not an empty list");
    expect(out).toContain("Try again");
    expect(out).not.toContain("No manual events yet");
  });

  it("a failed matches read says so; unreadable documents are reported", () => {
    h.events = { ...h.events, events: [event] };
    h.matches = { ...h.matches, error: { code: "unavailable" } };
    expect(render(<ManualLibraryPanel onOpenRescore={() => {}} />)).toContain("Couldn't load this event's matches (unavailable)");
    h.matches = { ...h.matches, error: null, matches: [match(1)], unreadable: 2 };
    expect(render(<ManualLibraryPanel onOpenRescore={() => {}} />)).toContain("2 stored matches could not be read and are not listed.");
  });

  it("an event with matches: the same table, status and row actions", () => {
    h.events = { ...h.events, events: [event] };
    h.matches = { ...h.matches, matches: [match(1), match(2, { published: false, needsReview: true })] };
    const out = render(<ManualLibraryPanel onOpenRescore={() => {}} />);
    for (const s of ["Match", "Origin", "Red", "Blue", "Video", "Status"]) expect(out, s).toContain(`>${s}</th>`);
    for (const s of ["Q1", "Q2", "Published", "Needs review", "Publish all (1)", 'aria-label="Edit Q1"', 'aria-label="Delete Q1"', "Fast entry", "Bulk import"]) expect(out, s).toContain(s);
  });

  it("an alliance with no official score reads No score, never 0", () => {
    h.events = { ...h.events, events: [event] };
    h.matches = { ...h.matches, matches: [match(1, { alliances: { red: unscored, blue: unscored } })] };
    expect(render(<ManualLibraryPanel onOpenRescore={() => {}} />)).toContain("No score");
  });

  it("fast entry has one team column per robot: 3 for FRC, 2 for FTC, and the same other columns", () => {
    const out = render(<FastEntry event={event as never} eventMatches={[]} actor={actor} />);
    expect(out.includes("Red 3")).toBe(program === "frc");
    expect(out.includes("Blue 3")).toBe(program === "frc");
    for (const s of ["Red 1", "Red 2", "Blue 1", "Blue 2", "Red score", "Blue score", "YouTube link"]) expect(out, s).toContain(s);
  });

  it("an imported match row: Publish for both, the official Score action only where the config allows it, missing slots read TBD", () => {
    const row = (m: unknown) =>
      render(
        <table>
          <tbody>
            <ImportedMatchRow match={m as never} actor={actor} busy={false} showTime={false} onPublish={() => {}} onScore={program === "ftc" ? () => {} : undefined} />
          </tbody>
        </table>
      );
    const out = row(match(1, { origin: "api", published: false, needsReview: true, alliances: { red: { ...unscored, teams: [] }, blue: unscored } }));
    expect(out).toContain('aria-label="Publish Q1"');
    expect(out).toContain("Needs review");
    expect(out).toContain("TBD");
    expect(out.includes('aria-label="Official score for Q1"')).toBe(program === "ftc");
  });

  it("the program-only tools are hidden entirely, not greyed: Update library, placeholder video and the video CSV exist for FRC only", () => {
    const out = render(<MatchLibraryPanel onOpenRescore={() => {}} />);
    for (const s of ["Update library", "Use placeholder video for testing", "Bulk import video CSV"]) expect(out.includes(s), s).toBe(program === "frc");
  });
});

describe("the adapter", () => {
  const which = (data: unknown) => {
    h.data = data;
    let adapter: unknown;
    const Probe = () => {
      adapter = useLibraryAdapter();
      return null;
    };
    renderToString(<Probe />);
    return adapter;
  };
  it("is the root adapter without a program port and the port's own with one", () => {
    expect(which(null)).toBe(rootLibraryAdapter);
    expect(which(ftcData)).toBe(portStub);
  });
});
