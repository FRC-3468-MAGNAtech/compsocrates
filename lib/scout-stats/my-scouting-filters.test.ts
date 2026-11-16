import { describe, expect, it } from "vitest";
import { deriveMyScoutingFilterOptions, effectiveGame, keepValid, personRoles, storedEventKey, storedEventKeys, type MyScoutingFilterInput } from "./my-scouting-filters";

const SEASONS = [
  { id: "rebuilt", name: "REBUILT" },
  { id: "reefscape", name: "REEFSCAPE" },
];

const base = (over: Partial<MyScoutingFilterInput> = {}): MyScoutingFilterInput => ({
  uid: "me",
  entries: [],
  sessions: [],
  profile: { primaryRole: "match-scout", secondaryRoles: [] },
  attendance: [],
  keyShape: "tba",
  seasons: SEASONS,
  defaultSeasonId: "rebuilt",
  fallbackSeasonId: "reefscape",
  archivedEventCodes: [],
  eventName: (key) => ({ "2026lake": "Bayou Regional", "2025lake": "Bayou Regional", "2026arli": "Arkansas Regional", "2025-USCALAB": "LA Qualifier" })[key] ?? null,
  ...over,
});

const entry = (over: Record<string, unknown> = {}) => ({ uid: "me", source: "event", eventCode: "2026lake", submittedAt: "2026-03-01T00:00:00Z", ...over });
const keys = (o: ReturnType<typeof deriveMyScoutingFilterOptions>) => o.events.map((e) => e.key);

describe("roles", () => {
  it("a single-role person: one role, the filter is hidden", () => {
    const o = deriveMyScoutingFilterOptions(base());
    expect(o.roles.map((r) => r.id)).toEqual(["match-scout"]);
    expect(o.showRole).toBe(false);
  });
  it("a multi-role person: exactly their roles, in canonical order", () => {
    const o = deriveMyScoutingFilterOptions(base({ profile: { primaryRole: "lead-scout", secondaryRoles: ["pit-scout", "match-scout"] } }));
    expect(o.roles.map((r) => r.id)).toEqual(["match-scout", "pit-scout", "lead-scout"]);
    expect(o.showRole).toBe(true);
  });
  it("a historical role found only in entries is offered next to the current role", () => {
    const o = deriveMyScoutingFilterOptions(base({ profile: { primaryRole: "team-coach", secondaryRoles: [] }, entries: [entry()] }));
    expect(o.roles.map((r) => r.id)).toEqual(["match-scout", "team-coach"]);
    expect(o.showRole).toBe(true);
  });
  it("another member's entries never add a role", () => {
    const o = deriveMyScoutingFilterOptions(base({ profile: { primaryRole: "team-coach" }, entries: [entry({ uid: "other" })] }));
    expect(o.roles.map((r) => r.id)).toEqual(["team-coach"]);
  });
  it("no profile and junk role values yield no roles, never an error", () => {
    expect(personRoles(null, false)).toEqual([]);
    expect(personRoles({ primaryRole: 7, secondaryRoles: "x" }, false)).toEqual([]);
  });
  it("FTC data shape (primaryRole and secondaryRoles on the program profile) works the same", () => {
    const o = deriveMyScoutingFilterOptions(base({ keyShape: "season-code", profile: { primaryRole: "drive-team", secondaryRoles: ["media"] } }));
    expect(o.roles.map((r) => r.id)).toEqual(["drive-team", "media"]);
  });
});

describe("events", () => {
  it("an event with attendance and no entries is offered", () => {
    const o = deriveMyScoutingFilterOptions(base({ attendance: [{ eventCode: "2026lake", uids: ["me"] }, { eventCode: "2026arli", uids: ["me"] }] }));
    expect(keys(o).sort()).toEqual(["2026arli", "2026lake"]);
  });
  it("an event with entries and no attendance is offered", () => {
    const o = deriveMyScoutingFilterOptions(base({ entries: [entry({ eventCode: "2026arli" })], attendance: [] }));
    expect(keys(o)).toEqual(["2026arli"]);
  });
  it("practice entries do not name an event", () => {
    const o = deriveMyScoutingFilterOptions(base({ entries: [entry({ source: "practice", eventCode: "2026lake" })] }));
    expect(keys(o)).toEqual([]);
  });
  it("an event they never attended or scouted is absent, even if the team did", () => {
    const o = deriveMyScoutingFilterOptions(base({ entries: [entry({ uid: "other", eventCode: "2026arli" })], attendance: [{ eventCode: "2026arli", uids: ["other"] }, { eventCode: "2026lake", uids: ["me"] }] }));
    expect(keys(o)).toEqual(["2026lake"]);
  });
  it("names carry the year, newest season first", () => {
    const o = deriveMyScoutingFilterOptions(base({ attendance: [{ eventCode: "2025lake", uids: ["me"] }, { eventCode: "2026lake", uids: ["me"] }] }));
    expect(o.events.map((e) => e.label)).toEqual(["Bayou Regional 2026", "Bayou Regional 2025"]);
  });
  it("archived events are included and tagged", () => {
    const o = deriveMyScoutingFilterOptions(base({ attendance: [{ eventCode: "2025lake", uids: ["me"] }, { eventCode: "2026lake", uids: ["me"] }], archivedEventCodes: ["2025lake"] }));
    const old = o.events.find((e) => e.key === "2025lake")!;
    expect(old.archived).toBe(true);
    expect(old.displayLabel).toBe("Bayou Regional 2025 (Archived)");
    expect(o.events.find((e) => e.key === "2026lake")!.displayLabel).toBe("Bayou Regional 2026");
  });
  it("an unconfigured season (no game for it) is still offered when they were there", () => {
    const o = deriveMyScoutingFilterOptions(base({ attendance: [{ eventCode: "2031xyz", uids: ["me"] }], eventName: () => null }));
    expect(keys(o)).toEqual(["2031xyz"]);
    expect(o.events[0].label).toBe("2031xyz");
  });
  it("aliased event keys fold into one option and keep every stored spelling", () => {
    const o = deriveMyScoutingFilterOptions(base({ attendance: [{ eventCode: "2026lake", uids: ["me"] }], entries: [entry({ eventCode: "2026LAKE" }), entry({ eventCode: "2026lake" })] }));
    expect(keys(o)).toEqual(["2026lake"]);
    expect([...o.events[0].rawKeys].sort()).toEqual(["2026LAKE", "2026lake"]);
    expect(storedEventKeys(["2026lake"], o.events).sort()).toEqual(["2026LAKE", "2026lake"]);
    expect(storedEventKey("2026lake", o.events)).toBe("2026lake");
  });
  it("FTC keys (season-code shape) are canonicalized and shown with the two-year label", () => {
    const o = deriveMyScoutingFilterOptions(base({ keyShape: "season-code", attendance: [{ eventCode: "2025-uscalab", uids: ["me"] }], entries: [entry({ eventCode: "2025-USCALAB" })] }));
    expect(keys(o)).toEqual(["2025-USCALAB"]);
    expect(o.events[0].label).toBe("LA Qualifier 2025-26");
  });
  it("two or more events show the filter, one hides it", () => {
    expect(deriveMyScoutingFilterOptions(base({ attendance: [{ eventCode: "2026lake", uids: ["me"] }] })).showEvent).toBe(false);
    expect(deriveMyScoutingFilterOptions(base({ attendance: [{ eventCode: "2026lake", uids: ["me"] }, { eventCode: "2026arli", uids: ["me"] }] })).showEvent).toBe(true);
  });
});

describe("games", () => {
  it("the current game plus the games they scouted", () => {
    const o = deriveMyScoutingFilterOptions(base({ entries: [entry({ game: "REEFSCAPE" })] }));
    expect(o.games.map((g) => g.id)).toEqual(["rebuilt", "reefscape"]);
  });
  it("a person with only current-game data has just that game", () => {
    const o = deriveMyScoutingFilterOptions(base({ entries: [entry({ game: "REBUILT" })] }));
    expect(o.games.map((g) => g.id)).toEqual(["rebuilt"]);
  });
  it("a missing game counts as the fallback game; sessions count too", () => {
    const o = deriveMyScoutingFilterOptions(base({ entries: [entry()], sessions: [{ uid: "me", game: "REBUILT" }] }));
    expect(o.games.map((g) => g.id)).toEqual(["rebuilt", "reefscape"]);
  });
  it("a one-game program has the one game", () => {
    const o = deriveMyScoutingFilterOptions(base({ seasons: [{ id: "biobuzz", name: "BIOBUZZ" }], defaultSeasonId: "biobuzz", fallbackSeasonId: "biobuzz", entries: [entry()] }));
    expect(o.games).toEqual([{ id: "biobuzz", name: "BIOBUZZ" }]);
  });
});

describe("a person with no data", () => {
  it("reports noData and offers no events; the page shows its empty state", () => {
    const o = deriveMyScoutingFilterOptions(base());
    expect(o.noData).toBe(true);
    expect(o.events).toEqual([]);
    expect(o.showEvent).toBe(false);
  });
});

describe("options do not depend on the filtered subset", () => {
  it("the same entries give the same options whatever the game", () => {
    const entries = [entry({ game: "REBUILT", eventCode: "2026lake" }), entry({ game: "REEFSCAPE", eventCode: "2025lake" })];
    expect(keys(deriveMyScoutingFilterOptions(base({ entries })))).toEqual(["2026lake", "2025lake"]);
  });
});

describe("stale selections", () => {
  it("keepValid drops a value that is no longer an option and keeps the array when nothing changes", () => {
    const selected = ["a", "b"];
    expect(keepValid(selected, ["a", "b", "c"])).toBe(selected);
    expect(keepValid(selected, ["b"])).toEqual(["b"]);
    expect(keepValid(selected, [])).toEqual([]);
  });
  it("effectiveGame: a stale game falls back to the current one, all-games stays valid with two games, one game is forced", () => {
    const two = SEASONS;
    expect(effectiveGame("charged_up", two, "rebuilt")).toBe("rebuilt");
    expect(effectiveGame("", two, "rebuilt")).toBe("");
    expect(effectiveGame("reefscape", two, "rebuilt")).toBe("reefscape");
    expect(effectiveGame("", [two[0]], "rebuilt")).toBe("rebuilt");
    expect(effectiveGame("reefscape", [two[0]], "rebuilt")).toBe("rebuilt");
  });
});
