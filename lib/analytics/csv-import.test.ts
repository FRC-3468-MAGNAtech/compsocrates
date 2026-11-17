import { describe, expect, it } from "vitest";
import { FTC_GAME_DEFINITIONS } from "@/config/games/ftc";
import { entriesToCsv, parseCsv, parseImportCsv, serializeCsv } from "@/lib/analytics/csv";
import { buildGameSchema } from "@/lib/analytics/game-schema";

const TEAM_HEADER = "Information - Information - Team";
const MATCH_HEADER = "Information - Information - Match";
import { buildFtcGameForm } from "@/lib/ftc/games";
import { applyAllianceRole } from "@/lib/forms/alliance-role";
import { calculateScore } from "@/lib/forms/scoring";
import { defaultValues, normalizeValues } from "@/lib/forms/values";
import type { FormValues } from "@/lib/forms/types";
import { entryPayloadFor, type SaveEntryInput, type ScoutEntry } from "@/lib/scout-entries";
import { ftcDocToScoutEntry, ftcScoutEntryDoc } from "@/data/ftc/scouting";
import { IMPORT_BATCH_SIZE, canImportCsv, chunk, csvEntryId, planCsvImport, runCsvImport, type CsvImportPort } from "./csv-import";

// CSV import for a program with its own port (FTC, BIOBUZZ): the plan (counts, row errors), stable ids, batches of 400, the marker, the role round trip and who may
// import. An in-memory port stands in for Firestore.

const form = buildFtcGameForm(FTC_GAME_DEFINITIONS.BIOBUZZ);
const schema = buildGameSchema(form);
const admin = { isAdmin: true, primaryRole: "match-scout" as const };
const lead = { isAdmin: false, primaryRole: "match-scout" as const, secondaryRoles: ["lead-scout" as const] };
const scout = { isAdmin: false, primaryRole: "match-scout" as const, secondaryRoles: [] };

function stored(role: string | null, counts: Record<string, number | boolean>, over: Partial<ScoutEntry>): ScoutEntry {
  const values = applyAllianceRole(form, { ...defaultValues(form), ...counts } as FormValues, role);
  const s = calculateScore(form, values);
  return {
    id: "x", teamId: "t1", uid: "u", source: "event", mode: null, formId: form.id, formVersion: form.version, scoutName: "Ada", eventCode: "EVT", matchType: "Qualification", matchNumber: 1, teamNumber: 100,
    values, score: { auto: s.auto, teleop: s.teleop, endgame: s.endgame, total: s.total }, comments: "", submittedAt: "2026-01-01T00:00:00.000Z", excluded: false, autoFlags: [], manualFlags: [], accuracy: null, sessionId: null, libraryMatchId: null,
    ...over,
  };
}

/** An in-memory Firestore: a map of id to stored document, written the way the FTC port writes. */
function memoryPort(opts: { failBatch?: number } = {}) {
  const docs = new Map<string, Record<string, unknown>>();
  const batches: number[] = [];
  const port: CsvImportPort = {
    async importBatch(teamId, uid, rows) {
      if (opts.failBatch === batches.length) {
        batches.push(rows.length);
        throw new Error("Missing or insufficient permissions.");
      }
      batches.push(rows.length);
      for (const r of rows) docs.set(r.id, ftcScoutEntryDoc(teamId, uid, r.input, () => "server-time"));
      return rows.map((r) => r.id);
    },
  };
  return { port, docs, batches };
}

const buildInput = (eventCode = "EVT") => (row: { scoutName: string; matchType: ScoutEntry["matchType"]; matchNumber: number; teamNumber: number; values: FormValues }): SaveEntryInput => {
  const values = normalizeValues(form, row.values);
  return { scoutName: row.scoutName, eventCode, matchType: row.matchType, matchNumber: row.matchNumber, teamNumber: row.teamNumber, ...entryPayloadFor(form, values, calculateScore(form, values)) };
};

const exportOf = (entries: ScoutEntry[]) => entriesToCsv(schema, entries, (s) => s);
const asEntries = (docs: Map<string, Record<string, unknown>>) => [...docs].map(([id, d]) => ftcDocToScoutEntry(id, d));

describe("who may import", () => {
  it("admins and Lead Scouts; nobody else", () => {
    expect(canImportCsv(admin)).toBe(true);
    expect(canImportCsv(lead)).toBe(true);
    expect(canImportCsv(scout)).toBe(false);
    expect(canImportCsv(null)).toBe(false);
  });

  it("a plain scout's import is refused before anything is written", async () => {
    const csv = exportOf([stored("hive", { teleTipHive: 2 }, {})]);
    const plan = planCsvImport(parseImportCsv(schema, csv), [], "t1", "EVT");
    const { port, docs, batches } = memoryPort();
    await expect(runCsvImport({ port, importer: scout, teamId: "t1", uid: "u", plan, buildInput: buildInput() })).rejects.toThrow("Only an admin or a Lead Scout");
    expect(docs.size).toBe(0);
    expect(batches).toEqual([]);
  });
});

describe("a valid file", () => {
  const entries = [
    stored("hive", { teleTipHive: 2, autoLeave: true }, { teamNumber: 100, matchNumber: 1, scoutName: "Ada" }),
    stored("garden", { gardenPollenNectar: 10, flowerPollenNectar: 3 }, { teamNumber: 200, matchNumber: 1, scoutName: "Bo" }),
  ];

  it("previews the counts, writes under stable ids with the marker, and the result summary adds up", async () => {
    const plan = planCsvImport(parseImportCsv(schema, exportOf(entries)), [], "t1", "EVT");
    expect(plan).toMatchObject({ duplicates: 0, rowErrors: [], fileError: null });
    expect(plan.toWrite).toHaveLength(2);
    const { port, docs } = memoryPort();
    const result = await runCsvImport({ port, importer: admin, teamId: "t1", uid: "admin-uid", plan, buildInput: buildInput() });
    expect(result).toEqual({ written: 2, failures: [] });
    expect([...docs.keys()]).toEqual(plan.toWrite.map((w) => w.id));
    for (const d of docs.values()) {
      expect(d).toMatchObject({ teamId: "t1", uid: "admin-uid", source: "event", importedFrom: "csv", eventCode: "EVT", accuracy: null, excluded: false });
    }
    // the marker survives a read, so an imported entry can be told apart (and removed)
    expect(asEntries(docs).every((e) => e.importedFrom === "csv")).toBe(true);
  });

  it("round trip: a role-split entry comes back with the other role's fields ABSENT (not 0), and the same score", async () => {
    const plan = planCsvImport(parseImportCsv(schema, exportOf(entries)), [], "t1", "EVT");
    const { port, docs } = memoryPort();
    await runCsvImport({ port, importer: admin, teamId: "t1", uid: "u", plan, buildInput: buildInput() });
    const [hive, garden] = asEntries(docs);
    const GARDEN = ["flowerBottomNectar", "flowerPollenNectar", "gardenPollenNectar"];
    const HIVE = ["autoTipHive", "teleTipHive"];
    for (const k of GARDEN) expect(k in (hive.values as FormValues)).toBe(false);
    for (const k of HIVE) expect(k in (garden.values as FormValues)).toBe(false);
    expect((hive.values as FormValues).allianceRole).toBe("hive");
    expect(hive.score.total).toBe(entries[0].score.total);
    expect(garden.score.total).toBe(entries[1].score.total);
  });
});

describe("a repeated import", () => {
  it("adds nothing: the stable ids are the same and the existing entries are skipped", async () => {
    const csv = exportOf([stored("hive", { teleTipHive: 2 }, { scoutName: "Ada" }), stored("garden", { gardenPollenNectar: 4 }, { teamNumber: 200, scoutName: "Bo" })]);
    const { port, docs } = memoryPort();
    const first = planCsvImport(parseImportCsv(schema, csv), [], "t1", "EVT");
    await runCsvImport({ port, importer: admin, teamId: "t1", uid: "u", plan: first, buildInput: buildInput() });
    expect(docs.size).toBe(2);
    const second = planCsvImport(parseImportCsv(schema, csv), asEntries(docs), "t1", "EVT");
    expect(second.toWrite).toEqual([]);
    expect(second.duplicates).toBe(2);
    await runCsvImport({ port, importer: admin, teamId: "t1", uid: "u", plan: second, buildInput: buildInput() });
    expect(docs.size).toBe(2);
  });

  it("the same row twice in one file is written once; the same id even before the table is read back", () => {
    const e = stored("hive", { teleTipHive: 2 }, { scoutName: "Ada" });
    const plan = planCsvImport(parseImportCsv(schema, exportOf([e, e])), [], "t1", "EVT");
    expect(plan.toWrite).toHaveLength(1);
    expect(plan.duplicates).toBe(1);
  });

  it("ids are stable and tell scouts and robots apart", () => {
    const row = { matchType: "Qualification" as const, matchNumber: 7, teamNumber: 100, scoutName: "Ada" };
    expect(csvEntryId("t1", "EVT", row)).toBe(csvEntryId("t1", "EVT", { ...row }));
    expect(csvEntryId("t1", "EVT", row)).not.toBe(csvEntryId("t1", "EVT", { ...row, scoutName: "ada b" }));
    expect(csvEntryId("t1", "EVT", { ...row, scoutName: "A B" })).not.toBe(csvEntryId("t1", "EVT", { ...row, scoutName: "a-b" }));
    expect(csvEntryId("t1", "EVT", row)).not.toBe(csvEntryId("t1", "EVT", { ...row, teamNumber: 200 }));
    expect(csvEntryId("t1", "EVT", row)).not.toContain("/");
  });
});

describe("wrong columns and partial rows", () => {
  it("a file with a column missing is refused as a whole, naming the column; nothing is written", async () => {
    const [header, ...rows] = parseCsv(exportOf([stored("hive", { teleTipHive: 2 }, {})]));
    const dropped = header.indexOf(TEAM_HEADER);
    const csv = serializeCsv([header.filter((_, i) => i !== dropped), ...rows.map((r) => r.filter((_, i) => i !== dropped))]);
    const plan = planCsvImport(parseImportCsv(schema, csv), [], "t1", "EVT");
    expect(plan.fileError).toContain(`Missing expected column "${TEAM_HEADER}"`);
    expect(plan.toWrite).toEqual([]);
    const { port, docs } = memoryPort();
    await expect(runCsvImport({ port, importer: admin, teamId: "t1", uid: "u", plan, buildInput: buildInput() })).rejects.toThrow("Missing expected column");
    expect(docs.size).toBe(0);
  });

  it("an empty file is refused", () => {
    expect(planCsvImport(parseImportCsv(schema, ""), [], "t1", "EVT").fileError).toBe("The file is empty.");
  });

  it("a bad row is reported by its line number and reason and never silently skipped; the good rows can still import", async () => {
    const [header, ...rows] = parseCsv(exportOf([stored("hive", { teleTipHive: 2 }, { scoutName: "Ada" }), stored("hive", { teleTipHive: 1 }, { scoutName: "Bo", matchNumber: 2 })]));
    const matchCol = header.indexOf(MATCH_HEADER);
    const bad = [...rows[1]];
    bad[matchCol] = "banana";
    const plan = planCsvImport(parseImportCsv(schema, serializeCsv([header, rows[0], bad])), [], "t1", "EVT");
    expect(plan.fileError).toBeNull();
    expect(plan.toWrite).toHaveLength(1);
    expect(plan.rowErrors).toEqual(["Row 3: couldn't read match/team/scout."]);
    const { port, docs } = memoryPort();
    const result = await runCsvImport({ port, importer: lead, teamId: "t1", uid: "u", plan, buildInput: buildInput() });
    expect(result.written).toBe(1);
    expect(docs.size).toBe(1);
  });
});

describe("empty alliance-role cells", () => {
  it("import as absent, not 0, and stay absent after the form's normalizer", () => {
    const csv = exportOf([stored("garden", { gardenPollenNectar: 4 }, {})]);
    const parsed = parseImportCsv(schema, csv);
    const row = parsed.rows[0];
    expect("teleTipHive" in row.values).toBe(false);
    expect("autoTipHive" in row.values).toBe(false);
    const saved = normalizeValues(form, row.values);
    expect("teleTipHive" in saved).toBe(false);
    expect(saved.gardenPollenNectar).toBe(4);
  });
});

describe("batches", () => {
  it("sends at most 400 rows per batch and reports a failed batch by row numbers while the others still save", async () => {
    expect(IMPORT_BATCH_SIZE).toBe(400);
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    const many = Array.from({ length: 850 }, (_, i) => stored("hive", { teleTipHive: 1 }, { scoutName: "Ada", matchNumber: i + 1 }));
    const plan = planCsvImport(parseImportCsv(schema, exportOf(many)), [], "t1", "EVT");
    expect(plan.toWrite).toHaveLength(850);
    const { port, docs, batches } = memoryPort({ failBatch: 1 });
    const result = await runCsvImport({ port, importer: admin, teamId: "t1", uid: "u", plan, buildInput: buildInput() });
    expect(batches).toEqual([400, 400, 50]);
    expect(result.written).toBe(450);
    expect(docs.size).toBe(450);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].reason).toBe("Missing or insufficient permissions.");
    expect(result.failures[0].rows).toHaveLength(400);
    expect(result.failures[0].rows[0]).toBe(402); // file line numbers: the header is line 1
  });
});
