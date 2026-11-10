import { describe, expect, it } from "vitest";
import { buildSelectedEvents, csTeamToTeamDoc, getSubmissionLockout, placeholderEventForKey, readSelectedEvents, selectedEventsPatch } from "@/data/cs/teams";
import type { CsTeamDoc } from "@/data/cs/types";
import { MAX_ACTIVE_EVENTS, readActiveEvents } from "@/lib/active-events";

const csTeam = (over: CsTeamDoc = {}): CsTeamDoc => ({
  teamName: "MAGnatech",
  teamNumber: "2403",
  verifiedOwnerId: "uid-owner",
  selectedEvents: ["2026arli", "2026lake"],
  eventAttendees: { "2026arli": ["uid-ada", "Grace Hopper"] },
  manualTeamListsByEvent: { "2026arli": { red: [1, 2, 3] } },
  formAccessOverrides: { "pit-scout-form": ["uid-ada"] },
  submissionControls: { globalLockout: true, lockoutReason: "Finals prep", updatedAt: 1, updatedBy: "uid-owner" },
  timeOverride: { enabled: false, offsetMs: 0 },
  tbaApiKeyEncrypted: "secret",
  priorityTeamsByEvent: { x: [1] },
  ...over,
});

describe("csTeamToTeamDoc", () => {
  it("maps identity fields", () => {
    const t = csTeamToTeamDoc("MAG2403", csTeam());
    expect(t).toMatchObject({ number: 2403, name: "MAGnatech", joinCode: "MAG2403", ownerUid: "uid-owner" });
  });

  it("derives CE active events from selectedEvents (primary first)", () => {
    const t = csTeamToTeamDoc("MAG2403", csTeam());
    expect(t.selectedEvents).toEqual(["2026arli", "2026lake"]);
    expect(t.activeEventCode).toBe("2026arli");
    expect(t.activeSeasonId).toBe(2026);
    expect(t.activeEventCodes).toEqual(["2026arli", "2026lake"]);
    expect(t.activeEvents?.map((e) => e.code)).toEqual(["2026arli", "2026lake"]);
    expect(t.activeEvents?.[0]).toMatchObject({ name: "2026arli", season: 2026, dateStart: "" });
    // the existing reader works on it unchanged
    expect(readActiveEvents(t)).toMatchObject({ primaryCode: "2026arli" });
    expect(readActiveEvents(t).events).toHaveLength(2);
  });

  it("aliases are normalized and de-duplicated; junk is dropped", () => {
    expect(readSelectedEvents(["2025lake", "2026LAKE", "2026labr", "", 5, "2026arli"])).toEqual(["2026lake", "2026arli"]);
    expect(readSelectedEvents(undefined)).toEqual([]);
    expect(csTeamToTeamDoc("X", { selectedEvents: [] })).toMatchObject({ activeEventCode: null, activeEvent: null, activeEvents: [] });
  });

  it("team with no number or name", () => {
    expect(csTeamToTeamDoc("X", {})).toMatchObject({ number: 0, name: null, joinCode: "X" });
    expect(csTeamToTeamDoc("X", { teamNumber: 254 }).number).toBe(254);
  });

  it("exposes the submission lockout (CS assertSubmissionsOpen)", () => {
    const t = csTeamToTeamDoc("MAG2403", csTeam());
    expect(t.submissionLockout).toEqual({ locked: true, reason: "Finals prep" });
    expect(getSubmissionLockout(t)).toEqual({ locked: true, reason: "Finals prep" });
    expect(getSubmissionLockout(csTeamToTeamDoc("X", { submissionControls: { globalLockout: true } })).reason).toMatch(/temporarily disabled/);
    expect(getSubmissionLockout(csTeamToTeamDoc("X", {})).locked).toBe(false);
    expect(getSubmissionLockout(null).locked).toBe(false);
  });

  it("passes the other CS team fields through", () => {
    const t = csTeamToTeamDoc("MAG2403", csTeam());
    expect(t.eventAttendees).toEqual({ "2026arli": ["uid-ada", "Grace Hopper"] });
    expect(t.manualTeamListsByEvent).toEqual({ "2026arli": { red: [1, 2, 3] } });
    expect(t.formAccessOverrides).toEqual({ "pit-scout-form": ["uid-ada"] });
    expect(t.timeOverride).toEqual({ enabled: false, offsetMs: 0 });
  });
});

describe("selectedEventsPatch", () => {
  const ev = placeholderEventForKey;

  it("writes only selectedEvents: primary first, normalized, de-duplicated", () => {
    const patch = selectedEventsPatch({ events: [ev("2026arli"), ev("2025lake"), ev("2026lake"), ev("2026txhou")], primaryCode: "2026txhou" });
    expect(patch).toEqual({ selectedEvents: ["2026txhou", "2026arli", "2026lake"] });
    expect(Object.keys(patch)).toEqual(["selectedEvents"]);
  });

  it("caps at MAX_ACTIVE_EVENTS", () => {
    const events = Array.from({ length: 14 }, (_, i) => ev(`2026ev${String(i).padStart(2, "0")}`));
    expect(buildSelectedEvents({ events, primaryCode: events[0].code })).toHaveLength(MAX_ACTIVE_EVENTS);
  });

  it("an empty selection clears the list", () => {
    expect(selectedEventsPatch({ events: [], primaryCode: null })).toEqual({ selectedEvents: [] });
  });

  it("round trip: write then read gives the same events", () => {
    const state = { events: [ev("2026lake"), ev("2026arli")], primaryCode: "2026lake" };
    const read = csTeamToTeamDoc("X", { selectedEvents: selectedEventsPatch(state).selectedEvents });
    expect(readActiveEvents(read).events.map((e) => e.code)).toEqual(["2026lake", "2026arli"]);
  });
});
