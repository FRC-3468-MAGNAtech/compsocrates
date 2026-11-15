// CSV import of Match Scout entries for a program with its own data port: who may import, the plan (what will be written, what is skipped, what is wrong, with
// row numbers), stable ids so a second import adds nothing, and the batched write. Pure apart from `runCsvImport`, which writes through the port it is given.

import { dedupeAgainstExisting, type ImportedRow, type ImportResult } from "@/lib/analytics/csv";
import type { RoleId } from "@/lib/roles";
import type { SaveEntryInput, ScoutEntry } from "@/lib/scout-entries";

/** Firestore allows 500 writes in a batch; the import sends at most this many. */
export const IMPORT_BATCH_SIZE = 400;

/** Roles that may import besides admins. */
export const CSV_IMPORT_ROLES: RoleId[] = ["lead-scout"];

export type CsvImporter = { isAdmin: boolean; primaryRole: RoleId; secondaryRoles?: RoleId[] } | null | undefined;

/** Admins, or a member whose primary or secondary role is Lead Scout. Everyone else cannot import (the page hides the button and the import refuses). */
export function canImportCsv(profile: CsvImporter): boolean {
  if (!profile) return false;
  if (profile.isAdmin) return true;
  return [profile.primaryRole, ...(profile.secondaryRoles ?? [])].some((r) => CSV_IMPORT_ROLES.includes(r));
}

// A small stable hash (FNV-1a, base 36) so two scout names that slug alike still get different ids.
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);

/** The stable document id of an imported row: the same team, event, match, robot and scout always give the same id, so importing a file twice writes the same documents. */
export function csvEntryId(teamId: string, eventCode: string, row: Pick<ImportedRow, "matchType" | "matchNumber" | "teamNumber" | "scoutName">): string {
  const match = `${row.matchType.charAt(0).toLowerCase()}${row.matchNumber}`;
  return `csv_${slug(teamId)}_${slug(eventCode)}_${match}_${row.teamNumber}_${slug(row.scoutName)}-${hash(row.scoutName.trim().toLowerCase())}`;
}

export type CsvImportPlan = {
  /** Rows to write, with their stable ids. */
  toWrite: { id: string; row: ImportedRow }[];
  /** Rows already in the table, or repeated in the file. */
  duplicates: number;
  /** Rows that could not be read, by line number and reason. These are never written and never silently dropped. */
  rowErrors: string[];
  /** The file as a whole is unusable (empty, or a column is missing): nothing can be imported. */
  fileError: string | null;
};

const isHeaderProblem = (message: string) => !/^Row \d+:/.test(message);

/** What importing this parsed file would do. `existing` is the event's entries already stored. Nothing is written here. */
export function planCsvImport(parsed: ImportResult, existing: readonly ScoutEntry[], teamId: string, eventCode: string): CsvImportPlan {
  const header = parsed.errors.filter(isHeaderProblem);
  if (header.length > 0) return { toWrite: [], duplicates: 0, rowErrors: parsed.errors.filter((e) => !isHeaderProblem(e)), fileError: header.join(" ") };
  const fresh = dedupeAgainstExisting(parsed.rows, [...existing]);
  const existingIds = new Set(existing.map((e) => e.id));
  const seen = new Set<string>();
  const toWrite: CsvImportPlan["toWrite"] = [];
  let duplicates = fresh.skipped;
  for (const row of fresh.toInsert) {
    const id = csvEntryId(teamId, eventCode, row);
    if (existingIds.has(id) || seen.has(id)) {
      duplicates++;
      continue;
    }
    seen.add(id);
    toWrite.push({ id, row });
  }
  return { toWrite, duplicates, rowErrors: parsed.errors, fileError: null };
}

export type CsvImportResult = {
  written: number;
  /** A batch that did not save: its row numbers and why. The batches after it were still tried. */
  failures: { rows: (number | null)[]; reason: string }[];
};

export type CsvImportPort = {
  importBatch(teamId: string, uid: string, rows: { id: string; input: SaveEntryInput }[]): Promise<string[]>;
};

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Writes a plan in batches of `IMPORT_BATCH_SIZE`, through the program's port. Admins and leads only (refused otherwise, before anything is written). Every entry is
 * marked `importedFrom: "csv"` and written as the importing account. A failed batch is reported with its row numbers; the other batches are still written.
 * An import is not a scout submitting: the team's submission switches do not apply (the shared submit path is not used).
 */
export async function runCsvImport(args: {
  port: CsvImportPort;
  importer: CsvImporter;
  teamId: string;
  uid: string;
  plan: CsvImportPlan;
  buildInput: (row: ImportedRow) => SaveEntryInput;
  batchSize?: number;
}): Promise<CsvImportResult> {
  const { port, importer, teamId, uid, plan, buildInput, batchSize = IMPORT_BATCH_SIZE } = args;
  if (!canImportCsv(importer)) throw new Error("Only an admin or a Lead Scout can import entries.");
  if (plan.fileError) throw new Error(plan.fileError);
  const result: CsvImportResult = { written: 0, failures: [] };
  for (const group of chunk(plan.toWrite, batchSize)) {
    try {
      const ids = await port.importBatch(
        teamId,
        uid,
        group.map(({ id, row }) => ({ id, input: { ...buildInput(row), importedFrom: "csv" as const } }))
      );
      result.written += ids.length;
    } catch (err) {
      result.failures.push({ rows: group.map((g) => g.row.rowNumber ?? null), reason: err instanceof Error && err.message ? err.message : "the write was refused." });
    }
  }
  return result;
}
