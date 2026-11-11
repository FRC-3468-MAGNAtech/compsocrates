import { describe, expect, it } from "vitest";
import { CS_FORM_FIELD_SPECS, CS_FORM_TYPES, csFormValueKeyNames, csFormValueKeys, type CsFormType } from "@/data/cs/form-field-keys";
import {
  CS_FORM_SPECS,
  csCompletedMatchKeys,
  csDocGame,
  csDocMatchKey,
  csDocToFormEntry,
  csFlagStateDocId,
  csFormTypeForCollection,
  eventCodesMatch,
  formEntryToCsDoc,
  formEntryToCsPatch,
  formEntryToFlagStatePatch,
  formTypeForFormId,
  freshCsMatchFields,
  isLeadFallbackDoc,
  isPracticeScoutedDoc,
  parseTeamNumber,
} from "@/data/cs/forms";
import type { CsRecord } from "@/data/cs/types";
import type { FormEntry } from "@/lib/form-entries-model";

const pit: CsRecord = {
  scoutName: "Ada Lovelace",
  teamNumber: "254",
  robotWeight: "118 lbs",
  rookieTeam: false,
  robotPictureUrl: "https://example.com/r.jpg",
  pitDisposition: true,
  driveDisposition: false,
  fuelPreloadCapacity: "8",
  fuelBallsPerSecond: "10-13",
  fuelCarryingCapacity: "x",
  climbLevel1: true,
  climbLevel2: true,
  climbLevel3: false,
  typicalFuelCycleTime: "6.5",
  typicalClimbTime: "4",
  autoCycleDescription: "Preload then depot",
  notes: "Tidy wiring",
  game: "REBUILT",
  eventKey: "2026arli",
  teamId: "TEAM1",
  submittedBy: "uid-ada",
  createdAt: 1_774_000_000_000,
  submittedAt: 1_774_000_100_000,
  // fields this adapter does not know
  encryptedBlob: "abc",
  imported: true,
};

const strategy: CsRecord = {
  scoutName: "Grace",
  scoutId: "uid-grace",
  teamId: "TEAM1",
  teamNumber: "1678",
  eventKey: "2025lake",
  game: "REBUILT",
  preferredStartingPosition: "depot-side",
  bestAt: "shooting",
  clearsBump: true,
  clearsTrench: false,
  canShootWhileIntaking: true,
  canMoveAndShootSimultaneously: false,
  notes: "Fast",
  createdAt: 1_775_000_000_000,
  submittedAt: 1_775_000_000_000,
  priorityRank: 3,
};

const plan: CsRecord = {
  eventKey: "2026arli",
  matchKey: "2026arli_qm12",
  matchLabel: "Qualification Match 12",
  scoutId: "uid-g",
  scoutName: "Grace",
  teamId: "TEAM1",
  game: "REBUILT",
  robots: [
    { teamNumber: "254", startingPosition: "middle", role: "Offense", autoClimb: true, endgameClimb: "level-3", climbProbability: 80, estimatedPoints: 61, predictionSampleSize: 4, futureField: "keep" },
    { teamNumber: "1678", startingPosition: "depot-side", role: "Feeder", autoClimb: false, endgameClimb: "" },
    { teamNumber: "118", startingPosition: "not-there", role: "Defense", autoClimb: false, endgameClimb: "level-1" },
  ],
  notes: "Plan A",
  createdAt: 1_774_100_000_000,
  submittedAt: 1_774_100_000_000,
};

const drive: CsRecord = {
  eventKey: "2026arli",
  matchKey: "q12",
  matchLabel: "Qualification Match 12",
  scoutId: "uid-g",
  scoutName: "Grace",
  teamId: "TEAM1",
  game: "REBUILT",
  robots: [
    { teamNumber: "254", startingPosition: "middle", role: "Offense", autoClimb: true, endgameClimb: "level-2" },
    { teamNumber: "1678", startingPosition: "depot-side", role: "Feeder", autoClimb: false, endgameClimb: "" },
    { teamNumber: "118", startingPosition: "middle", role: "Defense", autoClimb: false, endgameClimb: "" },
  ],
  notes: "",
  createdAt: 1_774_200_000_000,
  submittedAt: 1_774_200_000_000,
};

const lead: CsRecord = {
  scoutName: "Linus",
  scoutId: "uid-linus",
  teamId: "TEAM1",
  eventKey: "2026arli",
  game: "REBUILT",
  matchKey: "q12",
  matchId: "q12",
  matchType: "qualification",
  matchNumber: "12",
  matchLabel: "Qualification 12",
  alliance: "red",
  isPracticeScouting: false,
  isLeadScouting: true,
  entryType: "lead",
  robots: [
    { teamNumber: "254", notes: "Great", skillLevel: 5 },
    { teamNumber: "1678", notes: "", skillLevel: 3 },
    { teamNumber: "118", notes: "Slow", skillLevel: 2, pickNumber: "1" },
  ],
  overallAlliance: { teams: "RED / 254, 1678, 118", notes: "Strong", skillLevel: 4, extra: 1 },
  createdAt: 1_774_300_000_000,
  submittedAt: 1_774_300_000_000,
  timestamp: 1_774_300_000_000,
};

const helper: CsRecord = {
  helperName: "Pat",
  helperId: "uid-pat",
  teamId: "TEAM1",
  assistedTeamNumber: "9999",
  wasSuccessful: true,
  issueSolved: "Loose battery lead",
  notes: "Zip tied",
  game: "REBUILT",
  createdAt: 1_774_400_000_000,
  submittedAt: 1_774_400_000_000,
};

const SAMPLES: Array<[CsFormType, CsRecord]> = [
  ["pit-scout", pit],
  ["team-strategy", strategy],
  ["match-strategy", plan],
  ["drive-reflection", drive],
  ["lead-scout", lead],
  ["helper", helper],
];

describe("table", () => {
  it("covers the six forms and maps ids both ways", () => {
    expect(CS_FORM_TYPES).toHaveLength(6);
    expect(csFormTypeForCollection("pitScouting")).toBe("pit-scout");
    expect(csFormTypeForCollection("scouting")).toBe("lead-scout");
    expect(formTypeForFormId("helper-v1")).toBe("helper");
    expect(formTypeForFormId("custom-1")).toBeNull();
    for (const t of CS_FORM_TYPES) expect(CS_FORM_FIELD_SPECS[t].collection).toBe(CS_FORM_SPECS[t].collection);
  });

  it("lists the value keys a rebuilt form needs", () => {
    expect(csFormValueKeyNames("helper")).toEqual(["wasSuccessful", "issueSolved", "notes"]);
    expect(csFormValueKeyNames("drive-reflection", 2)).toEqual([
      "notes",
      "robot1_teamNumber",
      "robot1_startingPosition",
      "robot1_role",
      "robot1_autoClimb",
      "robot1_endgameClimb",
      "robot2_teamNumber",
      "robot2_startingPosition",
      "robot2_role",
      "robot2_autoClimb",
      "robot2_endgameClimb",
    ]);
    const lead3 = csFormValueKeys("lead-scout");
    expect(lead3.find((k) => k.key === "robot3_skillLevel")?.path).toBe("robots[2].skillLevel");
    expect(lead3.find((k) => k.key === "overallAlliance_notes")?.path).toBe("overallAlliance.notes");
    expect(csFormValueKeys("team-strategy").find((k) => k.key === "preferredStartingPosition")?.aliases).toEqual(["startingPosition"]);
  });
});

describe("reading", () => {
  it("pit: identity, event, times, team number and values", () => {
    const e = csDocToFormEntry("pit-scout", "p1", pit);
    expect(e).toMatchObject({ id: "p1", teamId: "TEAM1", uid: "uid-ada", scoutName: "Ada Lovelace", eventCode: "2026arli", teamNumber: 254, matchKey: null, alliance: null, createdAtMs: 1_774_000_000_000, updatedAtMs: 1_774_000_100_000, excluded: false, flags: [] });
    expect(e.values).toMatchObject({ robotWeight: "118 lbs", rookieTeam: false, fuelBallsPerSecond: "10-13", climbLevel2: true, notes: "Tidy wiring" });
    expect(e.values).not.toHaveProperty("encryptedBlob");
    expect(e.legacy?.collection).toBe("pitScouting");
  });

  it("resolves the legacy event alias and keeps the raw spelling", () => {
    const e = csDocToFormEntry("team-strategy", "s1", strategy);
    expect(e.eventCode).toBe("2026lake");
    expect(e.legacy?.eventKey).toBe("2025lake");
    expect(eventCodesMatch(e.eventCode, "2025lake")).toBe(true);
    expect(eventCodesMatch("2026arli", "2026lake")).toBe(false);
    expect(eventCodesMatch("", "2026lake")).toBe(false);
    expect(eventCodesMatch("anything", "")).toBe(true);
  });

  it("lead: match from matchId, alliance and flattened robots", () => {
    const e = csDocToFormEntry("lead-scout", "l1", lead);
    expect(e.matchKey).toBe("Q12");
    expect(e.alliance).toBe("red");
    expect(e.values).toMatchObject({ robot1_teamNumber: "254", robot1_skillLevel: 5, robot3_pickNumber: "1", robot3_notes: "Slow", overallAlliance_teams: "RED / 254, 1678, 118", overallAlliance_skillLevel: 4 });
    expect(e.legacy).toMatchObject({ matchId: "q12", matchLabel: "Qualification 12", matchType: "qualification", matchNumber: "12", robotCount: 3 });
  });

  it("plans read the TBA match key; drive reads a short id; playoffs follow D11", () => {
    expect(csDocToFormEntry("match-strategy", "m1", plan).matchKey).toBe("Q12");
    expect(csDocToFormEntry("drive-reflection", "d1", drive).matchKey).toBe("Q12");
    expect(csDocMatchKey({ matchKey: "2026arli_sf5m1" })).toBe("F5");
    expect(csDocMatchKey({ matchKey: "2026arli_f1m2" })).toBe("F15");
    expect(csDocMatchKey({ matchKey: "f1" })).toBe("F14");
    expect(csDocMatchKey({ matchKey: "2026arli_pr3" })).toBe("P3");
    expect(csDocMatchKey({ matchLabel: "Finals 2" })).toBe("F15");
    expect(csDocMatchKey({ matchLabel: "Practice Match 3" })).toBe("P3");
    expect(csDocMatchKey({ matchLabel: "gibberish" })).toBeNull();
    expect(csDocMatchKey({})).toBeNull();
  });

  it("helper reads helperName / helperId / assistedTeamNumber and has no event", () => {
    const e = csDocToFormEntry("helper", "h1", helper);
    expect(e).toMatchObject({ scoutName: "Pat", uid: "uid-pat", teamNumber: 9999, eventCode: "" });
    expect(e.values).toEqual({ wasSuccessful: true, issueSolved: "Loose battery lead", notes: "Zip tied" });
  });

  it("tolerates legacy variants and missing fields", () => {
    const old: CsRecord = { teamId: "T", startingPosition: "middle", teamNumber: " 254B", pitDisposition: "Friendly", timestamp: 5000, robots: "nope", game: undefined };
    const s = csDocToFormEntry("team-strategy", "x", old);
    expect(s.values.preferredStartingPosition).toBe("middle");
    expect(s.legacy?.paths).toEqual({ preferredStartingPosition: "startingPosition" });
    expect(s).toMatchObject({ teamNumber: 254, uid: "", scoutName: "", createdAtMs: 5000, updatedAtMs: 5000 });
    expect(s.legacy?.teamNumber).toBe(" 254B");
    const p = csDocToFormEntry("pit-scout", "y", { pitDisposition: "Friendly", notes: 4 });
    expect(p.values.pitDisposition).toBe("Friendly");
    const h = csDocToFormEntry("helper", "z", { teamNumber: "77", helperName: "A" });
    expect(h.teamNumber).toBe(77);
    expect(h.legacy?.paths?.["@team"]).toBe("teamNumber");
    const l = csDocToFormEntry("lead-scout", "w", { overallAllianceTeams: "RED / 1", robots: [null, { teamNumber: "5" }] });
    expect(l.values).toMatchObject({ overallAlliance_teams: "RED / 1", robot2_teamNumber: "5" });
    expect(l.matchKey).toBeNull();
    expect(l.legacy?.robotCount).toBe(2);
  });

  it("game defaults differ per page as in CS (pit: REEFSCAPE, the rest REBUILT)", () => {
    expect(csDocGame("pit-scout", {})).toBe("REEFSCAPE");
    expect(csDocGame("helper", {})).toBe("REBUILT");
    expect(csDocGame("pit-scout", { game: "rebuilt" })).toBe("REBUILT");
  });

  it("recognises practice-session rows and the lead fallback", () => {
    expect(isPracticeScoutedDoc({ practiceSessionId: "s" })).toBe(true);
    expect(isPracticeScoutedDoc({ isPracticeScouting: true, matchType: "practice" })).toBe(false);
    expect(isPracticeScoutedDoc({ isPracticeScouting: true, matchLabel: "Practice Match 3" })).toBe(false);
    expect(isPracticeScoutedDoc(pit)).toBe(false);
    expect(isLeadFallbackDoc({ entryType: "lead" })).toBe(true);
    expect(isLeadFallbackDoc({ entryType: "sub-in-request", isLeadScouting: true })).toBe(false);
    expect(isLeadFallbackDoc({ entryType: "match" })).toBe(false);
  });

  it("parses team numbers", () => {
    expect(parseTeamNumber("254")).toBe(254);
    expect(parseTeamNumber("frc 1678")).toBe(1678);
    expect(parseTeamNumber("")).toBeNull();
    expect(parseTeamNumber(undefined)).toBeNull();
  });
});

describe("round trip (doc -> entry -> doc)", () => {
  const NOT_MODELLED = ["encryptedBlob", "imported", "priorityRank", "entryType", "isLeadScouting", "isPracticeScouting"];
  const NESTED_UNKNOWN = ["futureField", "extra"];
  const understood = (doc: CsRecord): CsRecord => {
    const out: CsRecord = {};
    for (const [k, v] of Object.entries(doc)) {
      if (NOT_MODELLED.includes(k)) continue;
      if (Array.isArray(v)) out[k] = v.map((r) => Object.fromEntries(Object.entries(r as CsRecord).filter(([n]) => !NESTED_UNKNOWN.includes(n))));
      else if (k === "overallAlliance") out[k] = Object.fromEntries(Object.entries(v as CsRecord).filter(([n]) => !NESTED_UNKNOWN.includes(n)));
      else out[k] = v;
    }
    return out;
  };

  it.each(SAMPLES)("%s: understood fields come back identical without the stored doc", (formType, doc) => {
    const entry = csDocToFormEntry(formType, "id", doc);
    expect(formEntryToCsDoc(entry)).toEqual(understood(doc));
  });

  it.each(SAMPLES)("%s: with the stored doc nothing is lost, unknown fields included", (formType, doc) => {
    const entry = csDocToFormEntry(formType, "id", doc);
    expect(formEntryToCsDoc(entry, doc)).toEqual(doc);
  });

  it("a raw alias event and the CS match strings survive an unchanged rewrite", () => {
    const entry = csDocToFormEntry("team-strategy", "s1", strategy);
    expect(formEntryToCsDoc(entry, strategy).eventKey).toBe("2025lake");
    const l = csDocToFormEntry("lead-scout", "l1", { ...lead, matchKey: "2026arli_qm12", matchId: "q12" });
    const out = formEntryToCsDoc(l, lead);
    expect(out.matchKey).toBe("2026arli_qm12");
  });

  it("does not add a game to a doc that has none", () => {
    const { game, ...noGame } = helper;
    void game;
    const entry = csDocToFormEntry("helper", "h", noGame);
    expect(formEntryToCsPatch(entry, noGame)).not.toHaveProperty("game");
    expect(formEntryToCsDoc(entry, noGame)).toEqual(noGame);
  });

  it("an unparseable match stays untouched", () => {
    const odd = { ...plan, matchKey: "weird", matchLabel: "TBD" };
    const entry = csDocToFormEntry("match-strategy", "m", odd);
    expect(entry.matchKey).toBeNull();
    expect(formEntryToCsDoc(entry, odd)).toEqual(odd);
  });
});

describe("writing", () => {
  it("an edit changes only what changed and merges into robots", () => {
    const entry = csDocToFormEntry("match-strategy", "m1", plan);
    const next = { ...entry, values: { ...entry.values, robot1_role: "Defense", notes: "Plan B" }, updatedAtMs: 1_774_999_000_000 };
    const out = formEntryToCsDoc(next, plan);
    expect((out.robots as CsRecord[])[0]).toMatchObject({ role: "Defense", futureField: "keep", teamNumber: "254" });
    expect(out.notes).toBe("Plan B");
    expect(out.submittedAt).toBe(1_774_999_000_000);
    expect(out.createdAt).toBe(plan.createdAt);
    expect(out.matchKey).toBe("2026arli_qm12");
  });

  it("a changed match writes fresh CS fields in each form's style", () => {
    const e = { ...csDocToFormEntry("match-strategy", "m1", plan), matchKey: "Q20" };
    expect(formEntryToCsDoc(e, plan)).toMatchObject({ matchKey: "2026arli_qm20", matchLabel: "Qualification Match 20" });
    const l = { ...csDocToFormEntry("lead-scout", "l1", lead), matchKey: "F15" };
    expect(formEntryToCsDoc(l, lead)).toMatchObject({ matchKey: "f2", matchId: "f2", matchType: "finals", matchNumber: "2", matchLabel: "Finals 2", isPracticeScouting: false });
    expect(freshCsMatchFields("lead", "F7", "2026arli")).toMatchObject({ matchId: "sf7", matchLabel: "Match 7", matchType: "finals", matchNumber: "7" });
    expect(freshCsMatchFields("plan", "F7", "2026arli")).toMatchObject({ matchKey: "2026arli_sf7m1", matchLabel: "Match 7" });
    expect(freshCsMatchFields("plan", "F14", "2026arli")).toMatchObject({ matchKey: "2026arli_f1m1", matchLabel: "Finals 1" });
    expect(freshCsMatchFields("plan", "P3", "app-testing")).toMatchObject({ matchKey: "p3", matchLabel: "Practice Match 3" });
    expect(freshCsMatchFields("plan", "X", "2026arli")).toEqual({});
  });

  it("a new entry gets CS's shape: game, times, lead markers, uid field per collection", () => {
    const base: Omit<FormEntry, "formType"> = { id: "", teamId: "T", uid: "u1", scoutName: "N", formId: "x", formVersion: 1, eventCode: "2025lake", matchKey: null, alliance: null, teamNumber: 254, values: { robotWeight: "100", climbLevel1: true }, stickyNotes: [], flags: [], excluded: false, createdAtMs: 10, updatedAtMs: 10 };
    const pitDoc = formEntryToCsDoc({ ...base, formType: "pit-scout" });
    expect(pitDoc).toEqual({ teamId: "T", submittedBy: "u1", scoutName: "N", eventKey: "2026lake", game: "REBUILT", teamNumber: "254", robotWeight: "100", climbLevel1: true, createdAt: 10, submittedAt: 10 });
    const leadDoc = formEntryToCsDoc({ ...base, formType: "lead-scout", teamNumber: null, matchKey: "Q5", alliance: "blue", values: { robot1_teamNumber: "1", robot2_teamNumber: 2, overallAlliance_skillLevel: 3 } });
    expect(leadDoc).toMatchObject({ scoutId: "u1", alliance: "blue", matchId: "q5", entryType: "lead", isLeadScouting: true, timestamp: 10, robots: [{ teamNumber: "1" }, { teamNumber: "2" }], overallAlliance: { skillLevel: 3 } });
    const helperDoc = formEntryToCsDoc({ ...base, formType: "helper", eventCode: "", values: { wasSuccessful: false } });
    expect(helperDoc).toMatchObject({ helperId: "u1", helperName: "N", assistedTeamNumber: "254", wasSuccessful: false });
    expect(helperDoc).not.toHaveProperty("eventKey");
    const strat = formEntryToCsDoc({ ...base, formType: "match-strategy", teamNumber: null, matchKey: "Q5", alliance: "red", eventCode: "2026arli", stickyNotes: [{ id: "1", text: "t", color: "y", createdAt: 1 }], values: {} });
    expect(strat).toMatchObject({ matchKey: "2026arli_qm5", alliance: "red", stickyNotes: [{ id: "1", text: "t", color: "y", createdAt: 1 }] });
    expect(strat).not.toHaveProperty("robots");
  });

  it("coerces numbers to the string CS stores, and rejects junk", () => {
    const entry = csDocToFormEntry("pit-scout", "p", pit);
    const out = formEntryToCsPatch({ ...entry, values: { ...entry.values, fuelBallsPerSecond: 12, typicalClimbTime: undefined as never } }, pit);
    expect(out.fuelBallsPerSecond).toBe("12");
    expect(out).not.toHaveProperty("typicalClimbTime");
    expect(formEntryToCsDoc({ ...entry, values: { ...entry.values, typicalClimbTime: undefined as never } }, pit).typicalClimbTime).toBe("4");
    expect(() => formEntryToCsDoc({ ...entry, formType: "custom" })).toThrow();
  });
});

describe("flags and exclusion", () => {
  const state = { teamId: "TEAM1", entityType: "pitScouting", entityId: "p1", dismissed: true, manualFlagged: true, manualReason: "excessive-auto-score", manualFlaggedAt: 1_774_000_000_000, manualFlaggedBy: "uid-lead" };

  it("reads a manual flag and exclusions", () => {
    const e = csDocToFormEntry("pit-scout", "p1", { ...pit, excludeFromStats: true }, state);
    expect(e.flags).toEqual([{ id: "cs-manual", reason: "Excessive auto score", addedAt: new Date(1_774_000_000_000).toISOString() }]);
    expect(e.excluded).toBe(true);
    expect(csDocToFormEntry("pit-scout", "p1", pit, { excludeFromAccuracy: true }).excluded).toBe(true);
    expect(csDocToFormEntry("pit-scout", "p1", pit).excluded).toBe(false);
    expect(csDocToFormEntry("lead-scout", "l", lead, undefined, { collection: "scouting" }).legacy?.collection).toBe("scouting");
  });

  it("builds flag-state doc ids per entity type", () => {
    expect(csFlagStateDocId("matchStrategyPlan", " abc ")).toBe("matchStrategyPlan:abc");
    const e = csDocToFormEntry("match-strategy", "m1", plan);
    expect(formEntryToFlagStatePatch({ ...e, flags: [{ id: "x", reason: "Other", addedAt: new Date(5000).toISOString() }] }, undefined, { now: 9, actorUid: "a" })?.id).toBe("matchStrategyPlan:m1");
    const fallback = csDocToFormEntry("lead-scout", "l1", lead, undefined, { collection: "scouting" });
    expect(formEntryToFlagStatePatch({ ...fallback, flags: [{ id: "x", reason: "Other", addedAt: "2026-01-01T00:00:00.000Z" }] })?.id).toBe("scoutingEntry:l1");
  });

  it("an unchanged flag writes nothing; a removed one is cleared the way CS clears it", () => {
    const e = csDocToFormEntry("pit-scout", "p1", pit, state);
    expect(formEntryToFlagStatePatch(e, state)).toBeNull();
    expect(formEntryToFlagStatePatch({ ...e, flags: [] }, state)?.data).toMatchObject({ manualFlagged: false, manualReason: "", manualFlaggedAt: null, manualFlaggedBy: "", dismissed: true, teamId: "TEAM1", entityType: "pitScouting", entityId: "p1" });
    expect(formEntryToFlagStatePatch({ ...e, flags: [] }, undefined)).toBeNull();
  });

  it("a new app flag maps to a CS reason code, or other plus the additive app fields, keeping dismissed", () => {
    const e = csDocToFormEntry("pit-scout", "p1", pit, { teamId: "TEAM1", dismissed: true });
    const known = formEntryToFlagStatePatch({ ...e, flags: [{ id: "f", reason: "No teleop score", addedAt: new Date(7000).toISOString() }] }, { teamId: "TEAM1", dismissed: true }, { now: 99, actorUid: "adm" })?.data;
    expect(known).toMatchObject({ manualFlagged: true, manualReason: "no-teleop-score", manualFlaggedAt: 7000, manualFlaggedBy: "adm", dismissed: true });
    expect(known).not.toHaveProperty("manualReasonText");
    const ce = formEntryToFlagStatePatch({ ...e, flags: [{ id: "f", reason: "Wrong team scouted", note: "was 254", addedAt: "bad" }] }, undefined, { now: 99, actorUid: "adm" })?.data;
    expect(ce).toMatchObject({ manualReason: "other", manualReasonText: "Wrong team scouted", manualNoteText: "was 254", manualFlaggedAt: 99, dismissed: false });
    // and it reads back as the same app flag
    expect(csDocToFormEntry("pit-scout", "p1", pit, { ...ce, entityType: "pitScouting" }).flags[0]).toMatchObject({ reason: "Wrong team scouted", note: "was 254" });
  });

  it("re-including an entry clears accuracy exclusion and excludeFromStats; an accuracy-only exclusion is not written into the doc", () => {
    const accuracyOnly = csDocToFormEntry("pit-scout", "p1", pit, { excludeFromAccuracy: true });
    expect(accuracyOnly.excluded).toBe(true);
    expect(formEntryToCsPatch(accuracyOnly, pit)).not.toHaveProperty("excludeFromStats");
    expect(formEntryToFlagStatePatch({ ...accuracyOnly, excluded: false }, { excludeFromAccuracy: true })?.data.excludeFromAccuracy).toBe(false);
    const excluded = csDocToFormEntry("pit-scout", "p1", { ...pit, excludeFromStats: true });
    expect(formEntryToCsPatch({ ...excluded, excluded: false }, { ...pit, excludeFromStats: true }).excludeFromStats).toBe(false);
    expect(formEntryToCsPatch({ ...csDocToFormEntry("pit-scout", "p1", pit), excluded: true }, pit).excludeFromStats).toBe(true);
  });
});

describe("completions", () => {
  it("collects match keys of an event across the four collections, skipping sub-ins, practice sessions and other events", () => {
    const rows = [
      { collection: "scouting" as const, doc: { eventKey: "2026arli", matchId: "q3" } },
      { collection: "scouting" as const, doc: { eventKey: "2026arli", matchId: "q4", entryType: "sub-in-request" } },
      { collection: "scouting" as const, doc: { eventKey: "2026arli", matchId: "q9", practiceSessionId: "s1" } },
      { collection: "leadScouting" as const, doc: { eventKey: "2025lake", matchId: "sf7" } },
      { collection: "matchStrategyPlans" as const, doc: { eventKey: "2026lake", matchKey: "2026lake_f1m2" } },
      { collection: "driveScouting" as const, doc: { eventKey: "2026arli", matchKey: "q12" } },
      { collection: "driveScouting" as const, doc: { matchKey: "q13" } },
      { collection: "driveScouting" as const, doc: { eventKey: "2026arli", matchKey: "junk" } },
    ];
    const arli = csCompletedMatchKeys(rows, "2026arli");
    expect([...arli.keys].sort()).toEqual(["Q12", "Q3"]);
    expect(arli.byCollection.driveScouting.has("Q12")).toBe(true);
    const lake = csCompletedMatchKeys(rows, "2025lake");
    expect([...lake.keys].sort()).toEqual(["F15", "F7"]);
    expect(lake.byCollection.leadScouting.has("F7")).toBe(true);
  });
});
