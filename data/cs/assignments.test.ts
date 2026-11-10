import { describe, expect, it } from "vitest";
import {
  applyAssignmentPlan,
  appMatchToCsKey,
  appMatchToCsLabel,
  attendanceRecordsFromTeam,
  attendeesPatch,
  attendeeUidsForEvent,
  buildScheduleLookup,
  csAssignmentMatchRef,
  csRowsToSlots,
  csRowsToVersion,
  csTeamRowsToDocs,
  deriveSlot,
  isHumanPlayerSlot,
  manualTeamList,
  planAssignmentWrite,
  slotsToCsRows,
  staleAttendeeKeys,
  summarizeSlots,
  teamsToCsRows,
  type CsAssignmentDoc,
  type CsAssignmentRow,
} from "@/data/cs/assignments";
import { normalizeCsMatchId } from "@/data/cs/match-id";
import type { ScheduleSlot } from "@/lib/scheduler/types";

const EVENT = "2026arli";
const row = (id: string, data: CsAssignmentDoc): CsAssignmentRow => ({ id, data });

/** A `matchAssignments` doc as CS's page writes it. */
const csMatch = (matchKey: string, teamNumber: number, scoutId: string, over: CsAssignmentDoc = {}): CsAssignmentDoc => ({
  teamId: "MAG2403",
  eventKey: EVENT,
  matchKey,
  matchLabel: "Qualification 12",
  scoutId,
  scoutName: `Name of ${scoutId}`,
  teamNumber,
  scoutHumanPlayer: false,
  assignedBy: "uid-lead",
  assignedAt: 1_700_000_000_000,
  ...over,
});

const SCHEDULE = buildScheduleLookup([
  { matchType: "Qualification", matchNumber: 12, red: [254, 971, 1678], blue: [118, 148, 2056] },
  { matchType: "Qualification", matchNumber: 13, red: [1, 2, 3], blue: [4, 5, 6] },
]);

describe("match keys", () => {
  it("parses the keys CS's assignments page writes", () => {
    expect(csAssignmentMatchRef({ matchKey: "2026arli_qm12" })).toEqual({ matchType: "Qualification", matchNumber: 12 });
    expect(csAssignmentMatchRef({ matchKey: "p3", assignmentType: "event-practice" })).toEqual({ matchType: "Practice", matchNumber: 3 });
    expect(csAssignmentMatchRef({ matchKey: "2026arli_sf5m1" })).toEqual({ matchType: "Playoff", matchNumber: 5 });
    expect(csAssignmentMatchRef({ matchKey: "2026arli_f1m2" })).toEqual({ matchType: "Playoff", matchNumber: 15 });
    // falls back to the label
    expect(csAssignmentMatchRef({ matchKey: "weird", matchLabel: "Qualification 7" })).toEqual({ matchType: "Qualification", matchNumber: 7 });
  });

  it("a team-strategy mirror or unparsable row is not a match", () => {
    expect(csAssignmentMatchRef({ matchKey: "team", assignmentType: "team", matchLabel: "Team Strategy" })).toBeNull();
    expect(csAssignmentMatchRef({ matchKey: "garbage" })).toBeNull();
  });

  it("builds keys that parse back to the same match (round trip over every match type)", () => {
    const cases: Array<["Practice" | "Qualification" | "Playoff", number]> = [
      ["Practice", 3],
      ["Qualification", 1],
      ["Qualification", 88],
      ["Playoff", 1],
      ["Playoff", 13],
      ["Playoff", 14],
      ["Playoff", 16],
    ];
    for (const [type, n] of cases) {
      const key = appMatchToCsKey(EVENT, type, n);
      expect(csAssignmentMatchRef({ matchKey: key }), key).toEqual({ matchType: type, matchNumber: n });
      expect(csAssignmentMatchRef({ matchLabel: appMatchToCsLabel(type, n) }), appMatchToCsLabel(type, n)).toEqual({ matchType: type, matchNumber: n });
    }
    expect(appMatchToCsKey("2025LAKE", "Qualification", 4)).toBe("2026lake_qm4");
    expect(normalizeCsMatchId(appMatchToCsKey(EVENT, "Qualification", 12))).toBe("q12");
    expect(appMatchToCsLabel("Playoff", 15)).toBe("Finals 2");
  });
});

describe("slot derivation", () => {
  it("deriveSlot is the team's position in its alliance", () => {
    const teams = SCHEDULE("Qualification", 12)!;
    expect(deriveSlot(teams, 254)).toBe("red1");
    expect(deriveSlot(teams, 1678)).toBe("red3");
    expect(deriveSlot(teams, 148)).toBe("blue2");
    expect(deriveSlot(teams, 9999)).toBeNull();
  });

  it("maps rows to slot ids red1..blue3 from the schedule", () => {
    const rows = [
      row("a", csMatch("2026arli_qm12", 2056, "u6")),
      row("b", csMatch("2026arli_qm12", 254, "u1")),
      row("c", csMatch("2026arli_qm12", 118, "u4")),
      row("d", csMatch("2026arli_qm12", 971, "u2")),
    ];
    const slots = csRowsToSlots(rows, SCHEDULE);
    expect(slots.map((s) => [s.slot, s.teamNumber, s.scoutUid])).toEqual([
      ["red1", 254, "u1"],
      ["red2", 971, "u2"],
      ["blue1", 118, "u4"],
      ["blue3", 2056, "u6"],
    ]);
    expect(slots.every((s) => s.matchType === "Qualification" && s.matchNumber === 12)).toBe(true);
  });

  it("fallback: with no schedule, rows take free slots in assignedAt, team order", () => {
    const rows = [row("a", csMatch("2026arli_qm12", 900, "u1", { assignedAt: 2 })), row("b", csMatch("2026arli_qm12", 100, "u2", { assignedAt: 1 })), row("c", csMatch("2026arli_qm12", 500, "u3", { assignedAt: 1 }))];
    const slots = csRowsToSlots(rows);
    expect(slots.map((s) => [s.slot, s.teamNumber])).toEqual([
      ["red1", 100],
      ["red2", 500],
      ["red3", 900],
    ]);
  });

  it("fallback: a team missing from the schedule takes a slot the schedule did not use", () => {
    const slots = csRowsToSlots([row("a", csMatch("2026arli_qm12", 254, "u1")), row("b", csMatch("2026arli_qm12", 7777, "u2"))], SCHEDULE);
    expect(slots.find((s) => s.teamNumber === 254)?.slot).toBe("red1");
    expect(slots.find((s) => s.teamNumber === 7777)?.slot).toBe("red2");
  });

  it("two scouts on one team in a match are both kept, in different slots; exact duplicates collapse", () => {
    const slots = csRowsToSlots([row("a", csMatch("2026arli_qm12", 254, "u1")), row("b", csMatch("2026arli_qm12", 254, "u2")), row("c", csMatch("2026arli_qm12", 254, "u1"))], SCHEDULE);
    expect(slots).toHaveLength(2);
    expect(new Set(slots.map((s) => s.slot)).size).toBe(2);
  });

  it("skips team mirrors and unparsable rows; reads a numeric string team number; sorts by match", () => {
    const rows = [
      row("m", csMatch("team", 254, "u1", { assignmentType: "team", matchLabel: "Team Strategy" })),
      row("x", csMatch("nope", 254, "u1", { matchLabel: "" })),
      row("p", csMatch("p2", 254, "u1", { assignmentType: "event-practice", matchLabel: "Practice 2" })),
      row("q", csMatch("2026arli_qm13", 4, "u2", { teamNumber: "4" })),
      row("r", csMatch("2026arli_qm12", 254, "u1")),
    ];
    const slots = csRowsToSlots(rows, SCHEDULE);
    expect(slots.map((s) => `${s.matchType}${s.matchNumber}`)).toEqual(["Practice2", "Qualification12", "Qualification13"]);
    expect(slots[2]).toMatchObject({ teamNumber: 4, slot: "blue1", scoutUid: "u2" });
  });

  it("a row from a legacy alias event still reads (event filtering is the caller's)", () => {
    expect(csRowsToSlots([row("a", csMatch("2025lake_qm3", 5, "u1", { eventKey: "2025lake" }))])).toHaveLength(1);
  });

  it("buildScheduleLookup treats an excluded alliance as empty", () => {
    const lookup = buildScheduleLookup([{ matchType: "Practice", matchNumber: 1, red: [1, 2, 3], blue: null }]);
    expect(lookup("Practice", 1)).toEqual({ red: [1, 2, 3], blue: [] });
    expect(lookup("Practice", 2)).toBeNull();
  });
});

describe("csRowsToVersion", () => {
  it("is null with no slot rows", () => {
    expect(csRowsToVersion([])).toBeNull();
    expect(csRowsToVersion([row("m", csMatch("team", 1, "u", { assignmentType: "team" }))])).toBeNull();
  });

  it("synthesises version metadata and recomputes counts", () => {
    const v = csRowsToVersion(
      [row("a", csMatch("2026arli_qm12", 254, "u1", { assignedAt: 100, assignedBy: "x" })), row("b", csMatch("2026arli_qm12", 971, "u1", { assignedAt: 300, assignedBy: "y" })), row("c", csMatch("2026arli_qm13", 1, "u2", { assignedAt: 200 }))],
      SCHEDULE
    )!;
    expect(v.generatedBy).toBe("y");
    expect(v.generatedAt).toBe(new Date(300).toISOString());
    expect(v.counts).toEqual({ u1: 2, u2: 1 });
    expect(v.fair).toBe(true);
    expect(v.settings).toMatchObject({ matchSource: "event", categories: ["Qualification"], scoutUids: ["u1", "u2"] });
  });

  it("flags unfair counts", () => {
    const rows = ["a", "b", "c"].map((id, i) => row(id, csMatch("2026arli_qm12", [254, 971, 1678][i], "u1")));
    rows.push(row("d", csMatch("2026arli_qm13", 1, "u2")));
    const v = csRowsToVersion(rows, SCHEDULE)!;
    expect(v.fair).toBe(false);
    expect(v.warning).toMatch(/range from 1 to 3/);
  });

  it("summarizeSlots counts only assigned slots and includes zero-count scouts", () => {
    const slots: ScheduleSlot[] = [
      { matchType: "Qualification", matchNumber: 1, slot: "red1", teamNumber: 1, scoutUid: "a" },
      { matchType: "Qualification", matchNumber: 1, slot: "red2", teamNumber: 2, scoutUid: null },
    ];
    expect(summarizeSlots(slots, ["a", "b"]).counts).toEqual({ a: 1, b: 0 });
    expect(summarizeSlots(slots, ["a", "b"]).fair).toBe(true);
  });
});

describe("slotsToCsRows", () => {
  const slots: ScheduleSlot[] = [
    { matchType: "Qualification", matchNumber: 12, slot: "red1", teamNumber: 254, scoutUid: "u1" },
    { matchType: "Qualification", matchNumber: 12, slot: "red2", teamNumber: 971, scoutUid: null },
    { matchType: "Qualification", matchNumber: 12, slot: "blue1", teamNumber: 118, scoutUid: "u2" },
    { matchType: "Practice", matchNumber: 2, slot: "red3", teamNumber: 7, scoutUid: "u1" },
  ];
  const ctx = { teamId: "MAG2403", eventKey: "2026ARLI", actorUid: "uid-lead", now: 1000, scoutNames: new Map([["u1", "Ada"], ["u2", "Grace"]]) };

  it("writes CS's flat shape: one doc per scouted slot", () => {
    const rows = slotsToCsRows(slots, ctx);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ teamId: "MAG2403", eventKey: EVENT, matchKey: "p2", matchLabel: "Practice 2", scoutId: "u1", scoutName: "Ada", teamNumber: 7, assignedBy: "uid-lead", assignedAt: 1000, scoutHumanPlayer: false, assignmentType: "event-practice" });
    expect(rows[1]).toMatchObject({ matchKey: "2026arli_qm12", matchLabel: "Qualification 12", teamNumber: 254, scoutHumanPlayer: true, assignedAt: 1001 });
    expect(rows[1]).not.toHaveProperty("assignmentType");
    expect(rows[2]).toMatchObject({ teamNumber: 118, scoutName: "Grace", scoutHumanPlayer: true });
  });

  it("human-player flag follows CS (first robot of each alliance)", () => {
    expect([isHumanPlayerSlot("red1"), isHumanPlayerSlot("red2"), isHumanPlayerSlot("blue1"), isHumanPlayerSlot("blue3")]).toEqual([true, false, true, false]);
  });

  it("practice-library target adds practiceMatchId and no human-player flag", () => {
    const [first] = slotsToCsRows([slots[0]], ctx, "practice");
    expect(first).toMatchObject({ practiceMatchId: "practice_2026arli_12", matchKey: "2026arli_qm12" });
    expect(first).not.toHaveProperty("scoutHumanPlayer");
  });

  it("round trip: rows -> slots -> rows -> same teams, scouts and matches", () => {
    const written = slotsToCsRows(slots, ctx);
    const back = csRowsToSlots(written.map((d, i) => row(`r${i}`, d)), SCHEDULE);
    const norm = (s: readonly ScheduleSlot[]) => s.filter((x) => x.scoutUid).map((x) => `${x.matchType}${x.matchNumber}:${x.teamNumber}:${x.scoutUid}`).sort();
    expect(norm(back)).toEqual(norm(slots));
    // positions come back from the schedule for scheduled matches
    expect(back.find((s) => s.teamNumber === 254)?.slot).toBe("red1");
    expect(back.find((s) => s.teamNumber === 118)?.slot).toBe("blue1");
  });
});

describe("planAssignmentWrite", () => {
  const existing = [
    row("keep", csMatch("2026arli_qm12", 254, "u1", { scoutHumanPlayer: true, encryptedNote: "x", legacyField: 7 })),
    row("swap", csMatch("2026arli_qm12", 971, "u1")),
    row("gone", csMatch("2026arli_qm13", 1, "u2")),
    row("dup", csMatch("2026arli_qm12", 254, "u1")),
  ];
  const desired: CsAssignmentDoc[] = [
    csMatch("2026arli_qm12", 254, "u1", { assignedAt: 5 }),
    csMatch("2026arli_qm12", 971, "u3", { assignedAt: 6, scoutName: "Third" }),
    csMatch("2026arli_qm14", 9, "u4"),
  ];

  it("keeps unchanged rows, patches a changed scout, creates new rows, removes the rest", () => {
    const plan = planAssignmentWrite(existing, desired);
    expect(plan.update).toEqual([{ id: "swap", patch: { scoutId: "u3", scoutName: "Third", assignedBy: "uid-lead", assignedAt: 6 } }]);
    expect(plan.create.map((d) => d.teamNumber)).toEqual([9]);
    expect(plan.remove.sort()).toEqual(["dup", "gone"]);
  });

  it("an unchanged row is never rewritten, so its unknown fields survive (D10)", () => {
    const after = applyAssignmentPlan(existing, planAssignmentWrite(existing, desired));
    const kept = after.find((r) => r.id === "keep")!;
    expect(kept.data).toMatchObject({ encryptedNote: "x", legacyField: 7, scoutHumanPlayer: true });
    expect(after.find((r) => r.id === "swap")!.data).toMatchObject({ scoutId: "u3", matchLabel: "Qualification 12" });
  });

  it("publishing the same schedule again is a no-op", () => {
    const same = existing.slice(0, 3).map((r) => r.data);
    const plan = planAssignmentWrite(existing.slice(0, 3), same);
    expect(plan).toEqual({ create: [], update: [], remove: [] });
  });

  it("matches an existing row spelled with a different but equivalent matchKey", () => {
    const plan = planAssignmentWrite([row("x", csMatch("q12", 254, "u1"))], [csMatch("2026arli_qm12", 254, "u1")]);
    expect(plan).toEqual({ create: [], update: [], remove: [] });
  });

  it("two scouts on one team pair by scout id", () => {
    const ex = [row("a", csMatch("2026arli_qm12", 254, "u1")), row("b", csMatch("2026arli_qm12", 254, "u2"))];
    const plan = planAssignmentWrite(ex, [csMatch("2026arli_qm12", 254, "u2"), csMatch("2026arli_qm12", 254, "u9")]);
    expect(plan.remove).toEqual([]);
    expect(plan.update).toEqual([{ id: "a", patch: expect.objectContaining({ scoutId: "u9" }) }]);
  });
});

describe("team (pit / team strategy) assignments", () => {
  const pit = (id: string, team: number, scout: string, at = 1, event = EVENT) => row(id, { teamId: "MAG2403", eventKey: event, teamNumber: team, scoutId: scout, scoutName: scout, assignedBy: "lead", assignedAt: at });

  it("groups rows per event into CE docs, one scout list per team", () => {
    const docs = csTeamRowsToDocs("pit", [pit("a", 254, "u1"), pit("b", 254, "u2", 2), pit("c", 971, "u1", 3), pit("d", 5, "u1", 4, "2026lake")], "MAG2403");
    expect(docs.map((d) => d.eventCode)).toEqual([EVENT, "2026lake"]);
    const arli = docs[0];
    expect(arli).toMatchObject({ id: `MAG2403_${EVENT}_pit`, kind: "pit", teamId: "MAG2403", previous: null });
    expect(arli.current?.teams).toEqual([
      { teamNumber: 254, scoutUids: ["u1", "u2"], locked: false },
      { teamNumber: 971, scoutUids: ["u1"], locked: false },
    ]);
    expect(arli.current?.counts).toEqual({ u1: 2, u2: 1 });
    expect(arli.current?.generatedAt).toBe(new Date(3).toISOString());
  });

  it("team strategy merges teamAssignments with its matchAssignments mirror without duplicating", () => {
    const primary = pit("a", 254, "u1");
    const mirror = row("m", { ...pit("m", 254, "u1").data, assignmentType: "team", matchKey: "team", matchLabel: "Team Strategy" });
    const mirrorOnly = row("n", { ...pit("n", 971, "u2").data, assignmentType: "team", matchKey: "team" });
    const [doc] = csTeamRowsToDocs("teamStrategy", [primary, mirror, mirrorOnly], "MAG2403");
    expect(doc.kind).toBe("teamStrategy");
    expect(doc.current?.teams.map((t) => [t.teamNumber, t.scoutUids])).toEqual([[254, ["u1"]], [971, ["u2"]]]);
  });

  it("drops rows without a team, scout or event; reads a string team number and an aliased event", () => {
    const docs = csTeamRowsToDocs("pit", [pit("a", 0, "u1"), pit("b", 3, ""), row("c", { teamId: "T", teamNumber: "2403B", scoutId: "u1", eventKey: "2025lake" })], "T");
    expect(docs).toHaveLength(1);
    expect(docs[0].eventCode).toBe("2026lake");
    expect(docs[0].current?.teams[0].teamNumber).toBe(2403);
  });

  it("teamsToCsRows writes one doc per team x scout and a mirror shape for team strategy", () => {
    const ctx = { teamId: "MAG2403", eventKey: EVENT, actorUid: "lead", now: 10, scoutNames: new Map([["u1", "Ada"]]) };
    const teams = [{ teamNumber: 971, scoutUids: ["u1", "u2"], locked: false }, { teamNumber: 254, scoutUids: ["u1"], locked: true }];
    const rows = teamsToCsRows(teams, ctx);
    expect(rows.map((r) => [r.teamNumber, r.scoutId, r.scoutName])).toEqual([[254, "u1", "Ada"], [971, "u1", "Ada"], [971, "u2", ""]]);
    expect(rows[0]).not.toHaveProperty("matchKey");
    const mirror = teamsToCsRows(teams, ctx, true);
    expect(mirror[0]).toMatchObject({ assignmentType: "team", matchKey: "team", matchLabel: "Team Strategy", scoutHumanPlayer: false });
  });

  it("plan for team rows pairs by team and scout (a team's mirror has matchKey team)", () => {
    const ctx = { teamId: "T", eventKey: EVENT, actorUid: "lead", now: 10, scoutNames: new Map<string, string>() };
    const existing = [row("m1", { ...teamsToCsRows([{ teamNumber: 254, scoutUids: ["u1"], locked: false }], ctx, true)[0] })];
    const plan = planAssignmentWrite(existing, teamsToCsRows([{ teamNumber: 254, scoutUids: ["u1"], locked: false }, { teamNumber: 971, scoutUids: ["u2"], locked: false }], ctx, true));
    expect(plan.create).toHaveLength(1);
    expect(plan.remove).toEqual([]);
    expect(plan.update).toEqual([]);
  });
});

describe("event attendance (teams.eventAttendees)", () => {
  const members = [
    { uid: "uid-ada", name: "Ada Lovelace" },
    { uid: "uid-grace", name: "Grace Hopper" },
  ];

  it("reads uids and display names (CS wrote both) as uids", () => {
    const attendees = { [EVENT]: ["uid-ada", "grace hopper", "Stranger", "uid-ada"] };
    expect(attendeeUidsForEvent(attendees, EVENT, members)).toEqual(["uid-ada", "uid-grace"]);
    expect(attendeeUidsForEvent(attendees, "2026lake", members)).toEqual([]);
    expect(attendeeUidsForEvent(undefined, EVENT, members)).toEqual([]);
  });

  it("reads a legacy alias key under the canonical event", () => {
    expect(attendeeUidsForEvent({ "2025lake": ["uid-ada"] }, "2026lake", members)).toEqual(["uid-ada"]);
  });

  it("writes uids, replaces member names by uid, keeps unknown entries, leaves other events alone", () => {
    const existing = { [EVENT]: ["Grace Hopper", "Stranger", "uid-gone"], "2026lake": ["uid-ada"] };
    const patch = attendeesPatch(existing, EVENT, ["uid-ada", "uid-grace"], members);
    // a stranger is not a member name or uid: kept (so is a uid of someone who left the team)
    expect(patch).toEqual({ eventAttendees: { [EVENT]: ["uid-ada", "uid-grace", "Stranger", "uid-gone"] } });
    expect(patch.eventAttendees).not.toHaveProperty("2026lake");
  });

  it("deselecting a member removes both their uid and their name", () => {
    const patch = attendeesPatch({ [EVENT]: ["uid-ada", "Grace Hopper"] }, EVENT, ["uid-ada"], members);
    expect(patch.eventAttendees[EVENT]).toEqual(["uid-ada"]);
  });

  it("writes under the canonical key and reports the alias key to drop", () => {
    const existing = { "2025lake": ["uid-ada"] };
    expect(attendeesPatch(existing, "2025LAKE", ["uid-grace"], members).eventAttendees).toEqual({ "2026lake": ["uid-grace"] });
    expect(staleAttendeeKeys(existing, "2026lake")).toEqual(["2025lake"]);
    expect(staleAttendeeKeys({ "2026lake": [] }, "2026lake")).toEqual([]);
    expect(staleAttendeeKeys(null, "2026lake")).toEqual([]);
  });

  it("lists recorded events as CE attendance records", () => {
    const records = attendanceRecordsFromTeam("MAG2403", { [EVENT]: ["Ada Lovelace"], "2026lake": [], "2025lake": ["uid-grace"] }, members);
    expect(records).toEqual([
      { id: `MAG2403_${EVENT}`, teamId: "MAG2403", eventCode: EVENT, uids: ["uid-ada"], updatedAt: null },
      { id: "MAG2403_2026lake", teamId: "MAG2403", eventCode: "2026lake", uids: ["uid-grace"], updatedAt: null },
    ]);
    expect(attendanceRecordsFromTeam("T", null, members)).toEqual([]);
  });
});

describe("manualTeamList", () => {
  it("reads numbers, strings and csv text", () => {
    expect(manualTeamList({ [EVENT]: [254, "971", "frc118"] }, EVENT)).toEqual([254, 971, 118]);
    expect(manualTeamList({ [EVENT]: "254, 971;254" }, EVENT)).toEqual([254, 971]);
    expect(manualTeamList({ "2025lake": [1] }, "2026lake")).toEqual([1]);
    expect(manualTeamList({}, EVENT)).toEqual([]);
    // CS fixtures sometimes hold an object; it reads as no list rather than throwing
    expect(manualTeamList({ [EVENT]: { red: [1, 2, 3] } }, EVENT)).toEqual([]);
  });
});
