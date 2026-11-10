import { describe, expect, it } from "vitest";
import { chargedUpDoc, leadDoc, practiceDoc, rebuiltDoc, rebuiltDocWithUnknowns, reefscapeDoc, SUBMITTED, subInDoc } from "@/data/cs/fixtures";
import {
  canWriteToCs,
  classifyCsRow,
  csAccuracyToEntry,
  csDocsToScoutEntries,
  csDocToScoutEntry,
  entryAccuracyToCsPatch,
  entryFlagStatePatch,
  flagStateDocId,
  indexFlagStates,
  scoutEntryToCsDoc,
  scoutEntryToCsPatch,
} from "@/data/cs/scouting";
import type { CsFlagState, CsRecord } from "@/data/cs/types";
import { REBUILT_CONFIG } from "@/config/games/rebuilt";
import { scoreEntryForGame, type ScoringEntry } from "@/lib/games/cs-oracle/analyticsScoring";
import { evaluateScoutingFlags } from "@/lib/games/cs-oracle/scoutingFlags";
import { rebuiltPlugin } from "@/lib/games/rebuilt";
import { incidentValuesFromList } from "@/lib/forms/builtin-rebuilt";
import type { ScoutEntry } from "@/lib/scout-entries";

const NOW = 1_777_000_000_000;

function entryOf(doc: CsRecord, state?: CsFlagState | null, id = "doc1"): ScoutEntry {
  const entry = csDocToScoutEntry(id, doc, state);
  if (!entry) throw new Error("not an entry row");
  return entry;
}

describe("classifyCsRow (CS entryMatchesAnalyticsFilters + isPracticeScoutedEntry)", () => {
  it("official rows of all three games", () => {
    expect(classifyCsRow(rebuiltDoc())).toBe("official");
    expect(classifyCsRow(reefscapeDoc())).toBe("official");
    expect(classifyCsRow(chargedUpDoc())).toBe("official");
  });

  it("practice-scouting session rows (isPracticeScouting / practiceMode / practiceSessionId)", () => {
    expect(classifyCsRow(practiceDoc())).toBe("practice");
    expect(classifyCsRow(rebuiltDoc({ practiceMode: "competitive" }))).toBe("practice");
    expect(classifyCsRow(rebuiltDoc({ practiceSessionId: "s9" }))).toBe("practice");
    expect(classifyCsRow(rebuiltDoc({ isPracticeScouting: true }))).toBe("practice");
  });

  it("an event practice MATCH (matchType practice / p3) is official, as CS counts it", () => {
    expect(classifyCsRow(rebuiltDoc({ matchId: "p3", matchType: "practice", matchNumber: "3" }))).toBe("official");
    // CS quirk kept exactly: a practice-session row of a practice-stage match is not "practice scouted" to CS either.
    expect(classifyCsRow(practiceDoc({ matchId: "p3", matchType: "practice" }))).toBe("official");
  });

  it("sub-in requests and claims, lead rows, and unknown games", () => {
    expect(classifyCsRow(subInDoc())).toBe("sub-in");
    expect(classifyCsRow({ ...subInDoc(), entryType: "sub-in-claim" })).toBe("sub-in");
    expect(classifyCsRow({ formType: "sub-in" })).toBe("sub-in");
    expect(classifyCsRow(leadDoc())).toBe("lead");
    expect(classifyCsRow({ entryType: "lead-scout" })).toBe("lead");
    expect(classifyCsRow(rebuiltDoc({ game: "CRESCENDO" }))).toBe("other");
  });

  it("sub-in beats lead beats everything", () => {
    expect(classifyCsRow({ ...leadDoc(), entryType: "sub-in-request", isLeadScouting: true })).toBe("sub-in");
  });

  it("only official and practice rows become entries", () => {
    expect(csDocToScoutEntry("a", subInDoc())).toBeNull();
    expect(csDocToScoutEntry("b", leadDoc())).toBeNull();
    expect(csDocToScoutEntry("c", rebuiltDoc({ game: "CRESCENDO" }))).toBeNull();
    const entries = csDocsToScoutEntries(
      [
        { id: "1", data: rebuiltDoc() },
        { id: "2", data: subInDoc() },
        { id: "3", data: practiceDoc() },
        { id: "4", data: leadDoc() },
      ],
      new Map()
    );
    expect(entries.map((e) => e.id)).toEqual(["1", "3"]);
    expect(entries.map((e) => e.source)).toEqual(["event", "practice"]);
  });
});

describe("csDocToScoutEntry: identity mapping", () => {
  it("maps a REBUILT official entry", () => {
    const e = entryOf(rebuiltDoc());
    expect(e).toMatchObject({
      id: "doc1",
      teamId: "MAG2403",
      uid: "uid-ada",
      scoutName: "Ada Lovelace",
      eventCode: "2026arli",
      matchType: "Qualification",
      matchNumber: 12,
      teamNumber: 1234,
      comments: "Fast cycler, tipped once",
      source: "event",
      mode: null,
      formId: "rebuilt",
      game: "REBUILT",
      sessionId: null,
      libraryMatchId: null,
      excluded: false,
      submittedAt: new Date(SUBMITTED).toISOString(),
    });
    expect(e.legacy).toEqual({ kind: "official", matchId: "q12", matchType: "qualification", matchNumber: "12", teamNumber: "1234", eventKey: "2026arli" });
  });

  it("incidents become the seven boolean form values (not the plugin's list)", () => {
    const values = entryOf(rebuiltDoc()).values as Record<string, unknown>;
    expect(values.incidents).toBeUndefined();
    expect(values).toMatchObject(incidentValuesFromList(["died", "tipped"]));
  });

  it("REEFSCAPE (no game field): alias event key, padded team number, bracket slot", () => {
    const e = entryOf(reefscapeDoc());
    expect(e.game).toBe("REEFSCAPE");
    expect(e.formId).toBe("reefscape");
    expect(e.eventCode).toBe("2026lake");
    expect(e.legacy?.eventKey).toBe("2025lake");
    expect(e.teamNumber).toBe(254);
    expect(e.matchType).toBe("Playoff");
    expect(e.matchNumber).toBe(5);
  });

  it("CHARGED_UP finals game f1 is playoff 14", () => {
    const e = entryOf(chargedUpDoc());
    expect(e.game).toBe("CHARGED_UP");
    expect(e.formId).toBe("charged_up");
    expect(e.matchType).toBe("Playoff");
    expect(e.matchNumber).toBe(14);
  });

  it("practice rows: source, mode, session, alliance", () => {
    const e = entryOf(practiceDoc());
    expect(e).toMatchObject({ source: "practice", mode: "trial", sessionId: "session-1", alliance: "red", legacy: { kind: "practice" } });
    expect(e.accuracy).toEqual({ status: "complete", value: 0.82, scoutedTotal: null, penaltyPoints: 6, officialScore: null });
  });

  it("missing teamId falls back to the queried team; missing eventKey/teamNumber/scoutId read as empty/0", () => {
    const doc = rebuiltDoc();
    delete doc.teamId;
    delete doc.eventKey;
    delete doc.scoutId;
    delete doc.teamNumber;
    const e = csDocToScoutEntry("x", doc, null, { fallbackTeamId: "MAG2403" });
    expect(e).toMatchObject({ teamId: "MAG2403", eventCode: "", uid: "", teamNumber: 0 });
    expect(csDocToScoutEntry("y", rebuiltDoc({ teamId: "" }))?.teamId).toBe("");
  });

  it("missing matchId falls back to matchKey, then matchType + matchNumber", () => {
    const viaKey = rebuiltDoc({ matchKey: "2026arli_qm9" });
    delete viaKey.matchId;
    expect(entryOf(viaKey)).toMatchObject({ matchType: "Qualification", matchNumber: 9 });
    const viaType = rebuiltDoc({ matchType: "practice", matchNumber: "4" });
    delete viaType.matchId;
    expect(entryOf(viaType)).toMatchObject({ matchType: "Practice", matchNumber: 4 });
  });

  it("time falls back submittedAt -> timestamp -> createdAt", () => {
    const doc = rebuiltDoc({ timestamp: 5000, createdAt: 9000 });
    delete doc.submittedAt;
    expect(entryOf(doc).submittedAt).toBe(new Date(5000).toISOString());
    delete doc.timestamp;
    expect(entryOf(doc).submittedAt).toBe(new Date(9000).toISOString());
  });
});

describe("score parity with CS (oracle)", () => {
  it.each([
    ["REBUILT", rebuiltDoc()],
    ["REBUILT old doc without game parity flag", rebuiltDoc({ teleop: { ...(rebuiltDoc().teleop as CsRecord), shiftParityFromWonAuto: undefined } })],
    ["REEFSCAPE", reefscapeDoc()],
    ["CHARGED_UP", chargedUpDoc()],
  ] as const)("%s: entry.score.total equals CS scoreEntryForGame", (_name, doc) => {
    const e = entryOf(doc);
    expect(e.score.total).toBe(scoreEntryForGame(doc as ScoringEntry, e.game as "REBUILT" | "REEFSCAPE" | "CHARGED_UP"));
    expect(e.score.total).toBe(e.score.auto + e.score.teleop + e.score.endgame + (e.game === "REBUILT" ? 0 : Number(doc.penaltyPoints ?? 0)));
  });

  it("the REBUILT golden doc scores 221", () => {
    expect(entryOf(rebuiltDoc()).score).toEqual({ auto: 106, teleop: 77, endgame: 38, total: 221 });
  });
});

describe("flags", () => {
  const zeroDoc = rebuiltDoc({ auto: {}, teleop: {}, endgame: {} });

  it("auto flags come from the plugin (equal CS evaluateScoutingFlags), dismissal from the flag state", () => {
    const expected = evaluateScoutingFlags(zeroDoc as never).map((f) => f.code);
    expect(expected).toContain("zero-main-scoring");
    expect(entryOf(zeroDoc).autoFlags).toEqual(expected.map((ruleId) => ({ ruleId, dismissed: false })));
    const dismissed = entryOf(zeroDoc, { dismissed: true });
    expect(dismissed.autoFlags.every((f) => f.dismissed)).toBe(true);
  });

  it("legacy per-doc fields are used when there is no flag-state doc", () => {
    const e = entryOf({ ...zeroDoc, flagDismissed: true, manualFlagged: true, manualReason: "no-teleop-score", manualFlaggedAt: 4242 });
    expect(e.autoFlags.every((f) => f.dismissed)).toBe(true);
    expect(e.manualFlags).toEqual([{ id: "cs-manual", reason: "No teleop score", addedAt: new Date(4242).toISOString() }]);
  });

  it("a flag-state doc wins over legacy fields; CS reasons map to CE reasons", () => {
    const e = entryOf({ ...zeroDoc, flagDismissed: true }, { manualFlagged: true, manualReason: "excessive-human-player-score", manualFlaggedAt: 100 });
    expect(e.autoFlags.every((f) => !f.dismissed)).toBe(true);
    expect(e.manualFlags[0]).toMatchObject({ reason: "Unrealistic scoring", note: "Excessive human player score" });
    expect(entryOf(zeroDoc, { manualFlagged: true, manualReason: "other" }).manualFlags[0]).toMatchObject({ reason: "Other" });
    expect(entryOf(zeroDoc, { manualFlagged: true, manualReason: "free text" }).manualFlags[0]).toMatchObject({ reason: "Other", note: "free text" });
  });

  it("excludeFromStats -> excluded; excludeFromAccuracy -> its own field", () => {
    expect(entryOf(rebuiltDoc({ excludeFromStats: true })).excluded).toBe(true);
    expect(entryOf(rebuiltDoc()).excluded).toBe(false);
    expect(entryOf(rebuiltDoc(), { excludeFromAccuracy: true }).excludeFromAccuracy).toBe(true);
  });

  it("indexFlagStates keeps scoutingEntry rows only, keyed by entity id", () => {
    const map = indexFlagStates([
      { entityType: "scoutingEntry", entityId: "a", dismissed: true },
      { entityType: "practiceSession", entityId: "b", dismissed: true },
      { entityId: "c", manualFlagged: true },
      { entityType: "scoutingEntry" },
    ]);
    expect([...map.keys()].sort()).toEqual(["a", "c"]);
    expect(flagStateDocId(" abc ")).toBe("scoutingEntry:abc");
  });

  describe("entryFlagStatePatch", () => {
    const base = rebuiltDoc({ teamId: "MAG2403" });

    it("writes nothing for an unchanged entry (all rows, with or without state)", () => {
      for (const state of [null, { dismissed: true, manualFlagged: true, manualReason: "no-teleop-score", excludeFromAccuracy: true } as CsFlagState]) {
        const e = entryOf(zeroDoc, state, "d");
        expect(entryFlagStatePatch(e, zeroDoc, state, { now: NOW })).toBeNull();
      }
    });

    it("dismissing all auto flags writes dismissed + audit stamps with the team id", () => {
      const e = entryOf(zeroDoc, null, "d");
      const patch = entryFlagStatePatch({ ...e, autoFlags: e.autoFlags.map((f) => ({ ...f, dismissed: true })) }, zeroDoc, null, { now: NOW, actorUid: "u1" });
      expect(patch).toEqual({ teamId: "MAG2403", entityType: "scoutingEntry", entityId: "d", dismissed: true, dismissedAt: NOW, dismissedBy: "u1" });
    });

    it("adding a CE manual flag writes the CS reason and keeps the CE reason; removing clears it", () => {
      const e = entryOf(base, null, "d");
      const flagged = { ...e, manualFlags: [{ id: "mf-1", reason: "Wrong team scouted" as const, note: "was 254", addedAt: "2026-01-01T00:00:00.000Z" }] };
      const patch = entryFlagStatePatch(flagged, base, null, { now: NOW, actorUid: "u1" });
      expect(patch).toMatchObject({ manualFlagged: true, manualReason: "other", ceManualReason: "Wrong team scouted", ceManualNote: "was 254", manualFlaggedAt: NOW });
      // read back through the converter: the CE reason survives
      const readBack = entryOf(base, patch as CsFlagState, "d");
      expect(readBack.manualFlags[0]).toMatchObject({ reason: "Wrong team scouted", note: "was 254" });
      // and writing it again is a no-op
      expect(entryFlagStatePatch(readBack, base, patch as CsFlagState, { now: NOW })).toBeNull();
      const cleared = entryFlagStatePatch({ ...readBack, manualFlags: [] }, base, patch as CsFlagState, { now: NOW });
      expect(cleared).toMatchObject({ manualFlagged: false, manualReason: "", manualFlaggedAt: null });
    });

    it("a CE reason with a CS equivalent writes the CS code", () => {
      const e = entryOf(base, null, "d");
      const p = entryFlagStatePatch({ ...e, manualFlags: [{ id: "x", reason: "No teleop score", addedAt: "" }] }, base, null, { now: NOW });
      expect(p).toMatchObject({ manualReason: "no-teleop-score" });
    });

    it("exclude-from-accuracy toggles", () => {
      const e = entryOf(base, null, "d");
      expect(entryFlagStatePatch({ ...e, excludeFromAccuracy: true }, base, null, { now: NOW })).toMatchObject({ excludeFromAccuracy: true, excludedAt: NOW });
    });

    it("uses the doc's own team id when given one and falls back to the option otherwise", () => {
      const e = entryOf(base, null, "d");
      const patch = entryFlagStatePatch({ ...e, excludeFromAccuracy: true, teamId: "" }, base, null, { now: NOW, teamId: "OTHER" });
      expect(patch?.teamId).toBe("OTHER");
    });
  });
});

describe("accuracy mapping", () => {
  it("accuracyDetails with all robots scouted is a complete result; value is CS's totals-based accuracy", () => {
    const doc = rebuiltDoc({
      accuracy: 90,
      accuracyScriptStatus: "complete",
      accuracyDetails: { scoutedPoints: 90, actualPoints: 100, penaltyPoints: 6, allRobotsScouted: "yes", eventKeyUsed: "2026arli", matchLabelUsed: "Q12" },
    });
    expect(csAccuracyToEntry(doc)).toEqual({ status: "complete", value: 0.9, scoutedTotal: 90, penaltyPoints: 6, officialScore: 100 });
  });

  it("missing robots, awaiting results, and no accuracy at all", () => {
    const details = { scoutedPoints: 50, actualPoints: 100, penaltyPoints: 0, allRobotsScouted: "no" };
    expect(csAccuracyToEntry(rebuiltDoc({ accuracyDetails: details }))?.status).toBe("needs-robots");
    expect(csAccuracyToEntry(rebuiltDoc({ accuracyDetails: { ...details, actualPoints: null } }))).toMatchObject({ status: "awaiting-results", value: null, officialScore: null });
    expect(csAccuracyToEntry(rebuiltDoc())).toBeNull();
    expect(csAccuracyToEntry(rebuiltDoc({ accuracy: 70, accuracyScriptStatus: "missing robots" }))).toMatchObject({ status: "needs-robots", value: 0.7 });
  });

  it("entry accuracy -> CS fields (rounded percent, details, script status), keeping unknown detail fields", () => {
    const patch = entryAccuracyToCsPatch(
      { status: "complete", value: 0.876, scoutedTotal: 88, penaltyPoints: 2, officialScore: 100 },
      { accuracyDetails: { futureField: 1 } },
      "q12",
      "2026arli",
      NOW
    );
    expect(patch).toMatchObject({ accuracy: 88, accuracyScriptStatus: "complete", accuracyUpdatedAt: NOW });
    expect(patch.accuracyDetails).toEqual({ futureField: 1, scoutedPoints: 88, actualPoints: 100, penaltyPoints: 2, allRobotsScouted: "yes", eventKeyUsed: "2026arli", matchLabelUsed: "q12" });
    expect(entryAccuracyToCsPatch(null, {}, "", "", NOW)).toEqual({});
    expect(entryAccuracyToCsPatch({ status: "not-applicable", value: null, scoutedTotal: null, penaltyPoints: null, officialScore: null }, {}, "", "", NOW)).toEqual({});
  });
});

describe("round trip: csDoc -> entry -> csDoc", () => {
  const docs: Array<[string, CsRecord]> = [
    ["REBUILT", rebuiltDoc()],
    ["REBUILT with unknown fields", rebuiltDocWithUnknowns()],
    ["REEFSCAPE (alias event, padded team number, no game)", reefscapeDoc()],
    ["CHARGED_UP", chargedUpDoc()],
    ["practice row", practiceDoc()],
    ["REBUILT with accuracy", rebuiltDoc({ accuracy: 88, accuracyScriptStatus: "complete", accuracyDetails: { scoutedPoints: 88, actualPoints: 100, penaltyPoints: 0, allRobotsScouted: "yes", eventKeyUsed: "2026arli", matchLabelUsed: "Q12", futureField: 1 } })],
    ["REBUILT excluded", rebuiltDoc({ excludeFromStats: true, excludeFromStatsAt: 5 })],
    ["old doc: no teamId, no scoutId", (() => { const d = rebuiltDoc(); delete d.teamId; delete d.scoutId; return d; })()],
    ["matchId with a set suffix (qf2m1)", rebuiltDoc({ matchId: "qf2m1", matchType: "finals", matchNumber: "2" })],
    ["matchNumber stored as a number", rebuiltDoc({ matchNumber: 12 })],
  ];

  it.each(docs)("%s: an unchanged entry rewrites to the identical doc (existing doc given)", (_n, doc) => {
    const entry = entryOf(doc);
    expect(scoutEntryToCsDoc(entry, doc, { now: NOW })).toEqual(doc);
    expect(scoutEntryToCsPatch(entry, doc, { now: NOW })).toEqual({});
  });

  it("does not mutate the existing doc", () => {
    const doc = rebuiltDocWithUnknowns();
    const frozen = structuredClone(doc);
    scoutEntryToCsDoc({ ...entryOf(doc), teamNumber: 99, scoutName: "Z" }, doc, { now: NOW });
    expect(doc).toEqual(frozen);
  });

  it("a canonical REBUILT doc survives entry -> doc with NO existing doc (legacy strings are kept)", () => {
    const base = rebuiltDoc();
    const values = rebuiltPlugin.docToValues(base);
    const canonical = {
      ...base,
      ...rebuiltPlugin.valuesToDoc(values),
      // identity strings that need the `legacy` slot to survive:
      matchId: "qf2m1",
      matchType: "finals",
      matchNumber: "2",
      teamNumber: " 1234",
      eventKey: "2025lake",
    } as CsRecord;
    const entry = entryOf(canonical);
    expect(entry.legacy).toMatchObject({ matchId: "qf2m1", teamNumber: " 1234", eventKey: "2025lake" });
    expect(scoutEntryToCsDoc(entry, undefined, { now: NOW })).toEqual(canonical);
  });

  it("unknown fields (top level and nested) survive an edit", () => {
    const doc = rebuiltDocWithUnknowns();
    const entry = entryOf(doc);
    const values = { ...(entry.values as Record<string, unknown>), auto_humanPlayerFuel: 9, notes: "edited" };
    const out = scoutEntryToCsDoc({ ...entry, values: values as ScoutEntry["values"], comments: "edited" }, doc, { now: NOW });
    expect(out.priorityTeamsByEvent).toEqual(doc.priorityTeamsByEvent);
    expect(out.deviceType).toBe("tablet");
    expect(out.someFutureField).toEqual(doc.someFutureField);
    expect((out.auto as CsRecord).futureAutoField).toBe("keep me");
    expect((out.auto as CsRecord).humanPlayerFuel).toBe(9);
    expect(out.notes).toBe("edited");
    // identity and the original scoring weights untouched
    expect(out.teamId).toBe(doc.teamId);
    expect(out.scoringWeights).toEqual(doc.scoringWeights);
    expect(out.matchId).toBe("q12");
  });
});

describe("scoutEntryToCsDoc: edits", () => {
  it("changing the match rewrites matchId/matchType/matchNumber; changing the team rewrites teamNumber as a string", () => {
    const doc = rebuiltDoc({ matchKey: "q12" });
    const e = entryOf(doc);
    const out = scoutEntryToCsDoc({ ...e, matchType: "Playoff", matchNumber: 15, teamNumber: 254 }, doc, { now: NOW });
    expect(out).toMatchObject({ matchId: "f2", matchType: "finals", matchNumber: "2", teamNumber: "254", matchKey: "f2" });
  });

  it("D11 reverse mapping", () => {
    const e = entryOf(rebuiltDoc());
    const id = (matchType: ScoutEntry["matchType"], matchNumber: number) => {
      const out = scoutEntryToCsDoc({ ...e, matchType, matchNumber }, rebuiltDoc(), { now: NOW });
      return [out.matchId, out.matchType, out.matchNumber];
    };
    expect(id("Practice", 3)).toEqual(["p3", "practice", "3"]);
    expect(id("Qualification", 40)).toEqual(["q40", "qualification", "40"]);
    expect(id("Playoff", 5)).toEqual(["sf5", "finals", "5"]);
    expect(id("Playoff", 13)).toEqual(["sf13", "finals", "13"]);
    expect(id("Playoff", 14)).toEqual(["f1", "finals", "1"]);
    expect(id("Playoff", 16)).toEqual(["f3", "finals", "3"]);
  });

  it("excluding writes excludeFromStats (+ stamps) and nothing else changes", () => {
    const doc = rebuiltDoc();
    const patch = scoutEntryToCsPatch({ ...entryOf(doc), excluded: true }, doc, { now: NOW, actorUid: "u1" });
    expect(patch).toEqual({ excludeFromStats: true, excludeFromStatsAt: NOW, excludeFromStatsBy: "u1" });
  });

  it("an accuracy recompute writes accuracy fields only", () => {
    const doc = rebuiltDoc();
    const patch = scoutEntryToCsPatch(
      { ...entryOf(doc), accuracy: { status: "complete", value: 0.5, scoutedTotal: 110, penaltyPoints: 0, officialScore: 220 } },
      doc,
      { now: NOW }
    );
    expect(Object.keys(patch).sort()).toEqual(["accuracy", "accuracyDetails", "accuracyScriptStatus", "accuracyUpdatedAt"]);
    expect(patch.accuracy).toBe(50);
  });

  it("the stored score is never written", () => {
    const doc = rebuiltDoc();
    const out = scoutEntryToCsDoc({ ...entryOf(doc), score: { auto: 1, teleop: 1, endgame: 1, total: 3 } }, doc, { now: NOW });
    expect(out).toEqual(doc);
    expect("score" in out).toBe(false);
  });

  it("a changed REBUILT value rewrites the game part and keeps parity with the plugin score", () => {
    const doc = rebuiltDoc();
    const e = entryOf(doc);
    const values = { ...(e.values as Record<string, unknown>), endgame_status: "level-3", incidents_died: false };
    const out = scoutEntryToCsDoc({ ...e, values: values as ScoutEntry["values"] }, doc, { now: NOW });
    expect((out.endgame as CsRecord).status).toBe("level-3");
    expect(out.incidents).toEqual(["tipped"]);
    expect(entryOf(out).score.total).toBe(e.score.total + 10);
  });

  it("sticky notes ride along in `notes` and an additive field", () => {
    const doc = rebuiltDoc();
    const notes = [{ id: "n1", text: "watch the intake", color: "yellow", createdAt: 1 }];
    const out = scoutEntryToCsDoc({ ...entryOf(doc), stickyNotes: notes, comments: "Fast cycler, tipped once | watch the intake" }, doc, { now: NOW });
    expect(out.notes).toBe("Fast cycler, tipped once | watch the intake");
    expect(out.stickyNotes).toEqual(notes);
  });
});

describe("scoutEntryToCsDoc: new docs", () => {
  const draft = (over: Partial<ScoutEntry> = {}): ScoutEntry => {
    const base = entryOf(rebuiltDoc());
    const { legacy: _legacy, ...rest } = base;
    void _legacy;
    return { ...rest, id: "", ...over };
  };

  it("builds the shape CS writes: identity strings, epoch ms, game part from the plugin", () => {
    const out = scoutEntryToCsDoc(draft({ matchType: "Playoff", matchNumber: 7, teamNumber: 254, eventCode: "2026arli", submittedAt: new Date(SUBMITTED).toISOString() }), undefined, { now: NOW });
    expect(out).toMatchObject({
      teamId: "MAG2403",
      scoutId: "uid-ada",
      scoutName: "Ada Lovelace",
      eventKey: "2026arli",
      game: "REBUILT",
      matchId: "sf7",
      matchType: "finals",
      matchNumber: "7",
      teamNumber: "254",
      submittedAt: SUBMITTED,
      timestamp: SUBMITTED,
    });
    expect(out.auto).toBeDefined();
    expect(out.scoringWeights).toEqual(REBUILT_CONFIG.points.scoringWeightsSnapshot);
    expect("accuracy" in out).toBe(false);
    expect("score" in out).toBe(false);
    expect(entryOf(out).score.total).toBe(221);
  });

  it("practice-source entries carry the CS practice markers (and read back as practice)", () => {
    const out = scoutEntryToCsDoc(draft({ source: "practice", mode: "competitive", sessionId: "s1", libraryMatchId: "lib-1", alliance: "blue", matchNumber: 3 }), undefined, { now: NOW });
    expect(out).toMatchObject({ isPracticeScouting: true, practiceMode: "competitive", practiceSessionId: "s1", practiceMatchId: "lib-1", alliance: "blue" });
    expect(entryOf(out)).toMatchObject({ source: "practice", mode: "competitive", sessionId: "s1", libraryMatchId: "lib-1" });
  });

  it("refuses forms CS cannot store", () => {
    expect(() => scoutEntryToCsDoc(draft({ formId: "biobuzz", game: undefined }), undefined)).toThrow(/does not belong/);
    expect(() => scoutEntryToCsDoc(draft({ formId: "reefscape", game: "REEFSCAPE" }), undefined)).toThrow(/read-only/);
    expect(canWriteToCs({ formId: "rebuilt", game: "REBUILT" })).toBe(true);
    expect(canWriteToCs({ formId: "reefscape", game: "REEFSCAPE" })).toBe(false);
    expect(canWriteToCs({ formId: "biobuzz", game: undefined })).toBe(false);
  });
});
