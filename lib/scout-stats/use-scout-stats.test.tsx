import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FirestoreFailure } from "@/lib/firestore-errors";

// Every source of Scout Accuracy answers on its own: a failing source says which one failed, and `loaded` still flips once every source has answered, so the
// page never hangs on "loading". The five source hooks are replaced; what is under test is how the page's hook combines them.

const failure = (context: string, code = "permission-denied"): FirestoreFailure => ({ context, code, message: "Missing or insufficient permissions.", path: "x", at: "2026-01-01T00:00:00.000Z" });

const state = vi.hoisted(() => ({
  members: { members: [] as unknown[], loaded: true, error: null as unknown },
  sessions: { sessions: [] as unknown[], loaded: true, error: null as unknown, retry: () => {} },
  entries: { entries: [] as unknown[], loaded: true, error: null as unknown },
  library: { matches: [] as unknown[], loaded: true, error: null as unknown, retry: () => {} },
  attendance: { attendance: [] as unknown[], loaded: true, error: null as unknown },
}));

vi.mock("@/lib/team-members", () => ({ useTeamMembers: () => state.members }));
vi.mock("@/lib/practice-sessions", () => ({ useTeamPracticeSessions: () => state.sessions }));
vi.mock("@/lib/scout-entries", () => ({ useTeamScoutEntries: () => state.entries }));
vi.mock("@/lib/match-library", () => ({ useAllLibraryMatches: () => state.library }));
vi.mock("@/lib/event-attendance", () => ({ useTeamEventAttendance: () => state.attendance }));
vi.mock("@/lib/program/context", () => ({ useProgramConfig: () => ({ connection: { features: { practice: true, library: true } } }) }));
vi.mock("@/lib/program/data", () => ({ useProgramData: () => null }));
vi.mock("@/lib/events/use-event-names", () => ({ useEventNames: () => ({}) }));

import { collectSourceErrors, useScoutStatsSources } from "./use-scout-stats";

function sourcesNow() {
  let out: ReturnType<typeof useScoutStatsSources> | null = null;
  function Probe() {
    out = useScoutStatsSources("team1");
    return createElement("span");
  }
  renderToStaticMarkup(createElement(Probe));
  return out!;
}

describe("Scout Accuracy sources", () => {
  it("no errors: loaded, nothing to show", () => {
    const s = sourcesNow();
    expect(s.loaded).toBe(true);
    expect(s.sourceErrors).toEqual([]);
  });

  it("one source errors: loaded still flips, and the failure names that source", () => {
    state.sessions = { sessions: [], loaded: true, error: failure("Couldn't load practice sessions"), retry: () => {} };
    const s = sourcesNow();
    expect(s.loaded).toBe(true);
    expect(s.sourceErrors.map((e) => e.title)).toEqual(["Could not load practice sessions"]);
    expect(s.sourceErrors[0].failure.code).toBe("permission-denied");
    state.sessions = { sessions: [], loaded: true, error: null, retry: () => {} };
  });

  it("every source can fail on its own and each is named", () => {
    state.members = { members: [], loaded: true, error: failure("m") };
    state.entries = { entries: [], loaded: true, error: failure("e") };
    state.library = { matches: [], loaded: true, error: failure("l"), retry: () => {} };
    state.attendance = { attendance: [], loaded: true, error: failure("a") };
    const s = sourcesNow();
    expect(s.loaded).toBe(true);
    expect(s.sourceErrors.map((e) => e.title)).toEqual([
      "Could not load team members",
      "Could not load scout entries",
      "Could not load library matches",
      "Could not load event attendance",
    ]);
  });

  it("a source that has not answered yet keeps the page loading", () => {
    state.members = { members: [], loaded: true, error: null };
    state.entries = { entries: [], loaded: false, error: null };
    state.library = { matches: [], loaded: true, error: null, retry: () => {} };
    state.attendance = { attendance: [], loaded: true, error: null };
    expect(sourcesNow().loaded).toBe(false);
  });
});

describe("collectSourceErrors", () => {
  it("lists only the sources that failed, in a fixed order", () => {
    const none = { members: null, sessions: null, entries: null, library: null, attendance: null };
    expect(collectSourceErrors(none)).toEqual([]);
    const out = collectSourceErrors({ ...none, attendance: failure("a"), members: failure("m") });
    expect(out.map((e) => e.source)).toEqual(["members", "attendance"]);
  });
});
