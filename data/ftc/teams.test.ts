import { describe, expect, it } from "vitest";
import { ftcTeamToTeamDoc, migratedFieldTeamId, readFieldTeams, readStoredEvent, type FtcTeamDoc } from "@/data/ftc/teams";
import { readActiveEvents } from "@/lib/active-events";

const event = (code: string, over: Record<string, unknown> = {}) => ({
  code,
  season: 2025,
  name: `Event ${code}`,
  dateStart: "2026-01-10",
  dateEnd: "2026-01-11",
  city: "Austin",
  stateProv: "TX",
  country: "USA",
  venue: null,
  website: null,
  timezone: "America/Chicago",
  status: "upcoming",
  ...over,
});

const stored = (over: FtcTeamDoc = {}): FtcTeamDoc => ({
  number: 11111,
  name: "Legacy Name",
  fieldTeams: [
    { id: "ft-1", number: 12345, name: "First Team" },
    { id: "fteam_abcd1234", number: 54321, name: "Second Team" },
  ],
  joinCode: "JOIN42",
  ownerUid: "uid-owner",
  accountName: "Robotics Club",
  activeForms: { "2025": "custom-form" },
  activeEventCode: "USTXAUS1",
  activeSeasonId: 2025,
  activeEvent: event("USTXAUS1"),
  activeEventCodes: ["USTXAUS1", "USTXAUS2"],
  activeEvents: [event("USTXAUS1"), event("USTXAUS2")],
  usePlaceholderVideo: true,
  changelogSeeded: true,
  libraryBackfilled: false,
  ...over,
});

describe("readFieldTeams", () => {
  it("returns the stored teams in order", () => {
    expect(readFieldTeams(stored())).toEqual([
      { id: "ft-1", number: 12345, name: "First Team" },
      { id: "fteam_abcd1234", number: 54321, name: "Second Team" },
    ]);
  });

  it("skips entries without an id or a positive number", () => {
    const teams = readFieldTeams({ fieldTeams: [{ id: "", number: 1 }, { id: "a", number: 0 }, "x", { id: "b", number: "77", name: " Ok " }] });
    expect(teams).toEqual([{ id: "b", number: 77, name: "Ok" }]);
  });

  it("falls back to the legacy single number and name", () => {
    expect(readFieldTeams({ number: 9999, name: "Solo" })).toEqual([{ id: migratedFieldTeamId(9999), number: 9999, name: "Solo" }]);
    expect(readFieldTeams({ fieldTeams: [], number: 9999 })[0].id).toBe("ft-9999");
  });

  it("reads nothing when there is no team number at all", () => {
    expect(readFieldTeams({})).toEqual([]);
    expect(readFieldTeams(null)).toEqual([]);
  });
});

describe("readStoredEvent", () => {
  it("reads a stored event", () => {
    expect(readStoredEvent(event("USTXAUS1"))).toMatchObject({ code: "USTXAUS1", season: 2025, name: "Event USTXAUS1", city: "Austin", venue: null, status: "upcoming" });
  });

  it("needs a code; fills the rest neutrally", () => {
    expect(readStoredEvent({ name: "x" })).toBeNull();
    expect(readStoredEvent(null)).toBeNull();
    expect(readStoredEvent({ code: "A", status: "weird" })).toMatchObject({ code: "A", name: "A", season: 0, dateStart: "", status: "upcoming" });
    expect(readStoredEvent({ code: "A", status: "completed" })?.status).toBe("completed");
  });
});

describe("ftcTeamToTeamDoc", () => {
  it("takes the app's team from the first field team", () => {
    expect(ftcTeamToTeamDoc("team-1", stored())).toMatchObject({ number: 12345, name: "First Team", joinCode: "JOIN42", ownerUid: "uid-owner", accountName: "Robotics Club" });
  });

  it("falls back to the legacy number and name, and to the doc id for the join code", () => {
    const team = ftcTeamToTeamDoc("team-1", { number: 4242, name: "Old", activeEvents: [] });
    expect(team).toMatchObject({ number: 4242, name: "Old", joinCode: "team-1" });
  });

  it("a sparse doc does not throw", () => {
    const team = ftcTeamToTeamDoc("t", {});
    expect(team).toMatchObject({ number: 0, name: null, joinCode: "t", activeEventCode: null, activeSeasonId: null, activeEvent: null, activeEventCodes: [], activeEvents: [] });
  });

  it("reads the stored active events as they are", () => {
    const team = ftcTeamToTeamDoc("t", stored());
    expect(team.activeEventCode).toBe("USTXAUS1");
    expect(team.activeSeasonId).toBe(2025);
    expect(team.activeEvent?.code).toBe("USTXAUS1");
    expect(team.activeEventCodes).toEqual(["USTXAUS1", "USTXAUS2"]);
    expect(team.activeEvents?.map((e) => e.code)).toEqual(["USTXAUS1", "USTXAUS2"]);
    // the app's own reader agrees
    expect(readActiveEvents(team).primaryCode).toBe("USTXAUS1");
  });

  it("a team with one pre-multi-event `activeEvent` reads as a one-event list", () => {
    const team = ftcTeamToTeamDoc("t", { activeEvent: event("ONLY1"), activeEventCode: "ONLY1", activeEvents: undefined, activeEventCodes: undefined });
    expect(team.activeEventCodes).toEqual(["ONLY1"]);
    expect(team.activeEvents?.map((e) => e.code)).toEqual(["ONLY1"]);
    expect(team.activeSeasonId).toBe(2025);
  });

  it("the primary is always among the codes", () => {
    const team = ftcTeamToTeamDoc("t", stored({ activeEventCode: "LATE", activeEventCodes: ["USTXAUS1"], activeEvents: [event("USTXAUS1")], activeEvent: null }));
    expect(team.activeEventCode).toBe("LATE");
    expect(team.activeEventCodes).toEqual(["LATE", "USTXAUS1"]);
    // no stored event for the primary code: `activeEvent` stays null rather than naming a different event
    expect(team.activeEvent).toBeNull();
  });

  it("passes the additive fields through only when present and well-typed", () => {
    const team = ftcTeamToTeamDoc("t", stored());
    expect(team).toMatchObject({ activeForms: { "2025": "custom-form" }, usePlaceholderVideo: true, changelogSeeded: true, libraryBackfilled: false });
    const bare = ftcTeamToTeamDoc("t", { activeForms: { a: 1 }, usePlaceholderVideo: "yes", ownerUid: "  ", pendingTransfer: null });
    for (const key of ["activeForms", "usePlaceholderVideo", "ownerUid", "pendingTransfer", "accountName"]) expect(bare).not.toHaveProperty(key);
  });

  it("passes a pending transfer through untouched", () => {
    const pending = { toUid: "u2", expiresAt: 5 };
    expect(ftcTeamToTeamDoc("t", { pendingTransfer: pending }).pendingTransfer).toBe(pending);
  });
});
