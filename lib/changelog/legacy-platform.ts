import { DEFAULT_PROGRAM } from "@/config/programs/types";
import { LEGACY_AUTHOR, planLegacyImport, type ImportPlan, type LegacyEntry } from "@/lib/changelog/legacy";
import { describeErrors, parseEntryInput } from "@/lib/platform-changelog/model";

// The old CompSocrates notes as PLATFORM changelog entries (Session 7). Pure: scripts/import-cs-changelog.ts is the only thing that touches
// Firestore, and it never runs from the build or the tests. The conversion itself is lib/changelog/legacy.ts (wording kept, marker words
// mapped to categories, unmarked lines flagged); this file only reshapes the result for `platformChangelog/{id}`.

/** The collection the importer writes (the platform changelog; the old per-team collections are never written). */
export const PLATFORM_CHANGELOG_COLLECTION = "platformChangelog";

/** The program every imported entry and item is tagged with: the old notes describe the old app, which is the default program's data. */
export const LEGACY_PROGRAMS = [DEFAULT_PROGRAM] as const;

/** The stored document of an imported entry (times are epoch milliseconds, like every platform entry). */
export type PlatformImportDoc = {
  title: string;
  version: string;
  date: string;
  status: "published";
  programs: string[];
  items: { category: string; text: string; programs: string[] }[];
  legacy: true;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  publishedAt: number;
  rev: 1;
};

export type PlatformImportEntry = { id: string; doc: PlatformImportDoc; warnings: string[] };
export type PlatformImportPlan = { entries: PlatformImportEntry[]; skipped: ImportPlan["skipped"] };

/** A note id from a starter draft (`starter-...`): never imported, whatever the input holds. */
const STARTER_ID = /^starter-/i;

/** One converted note as a platform entry, or the reason it cannot be stored as it is (its wording is never edited to make it pass). */
export function toPlatformEntry(e: LegacyEntry): { ok: true; entry: PlatformImportEntry } | { ok: false; reason: string } {
  const programs = [...LEGACY_PROGRAMS];
  const items = e.changes.map((c) => ({ category: c.type, text: c.text, programs: [...programs] }));
  // A version label that is only the date (the old notes had none) is left empty: the card already shows the date.
  const version = e.version === e.date ? "" : e.version;
  const check = parseEntryInput({ title: e.title, version, date: e.date, programs, items });
  if (!check.ok) return { ok: false, reason: `not valid as a platform entry: ${describeErrors(check.errors)} (the wording is not changed to fit; fix or skip it by hand)` };
  const doc: PlatformImportDoc = {
    title: check.value.title,
    version: check.value.version,
    date: check.value.date,
    status: "published",
    programs,
    items,
    legacy: true,
    createdBy: LEGACY_AUTHOR,
    createdAt: e.createdAtMs,
    updatedAt: e.updatedAtMs,
    publishedAt: e.createdAtMs,
    rev: 1,
  };
  return { ok: true, entry: { id: e.id, doc, warnings: e.warnings } };
}

/** The whole export (`{ teamId: notes[] }`) as one plan of platform entries (oldest first) plus what was skipped and why. */
export function planPlatformImport(exportData: Record<string, unknown>): PlatformImportPlan {
  // A starter draft (its own id starts with `starter-`) is dropped before conversion: the starter wording is never imported from any input.
  const starters: ImportPlan["skipped"] = [];
  const cleaned: Record<string, unknown> = {};
  for (const [teamId, notes] of Object.entries(exportData)) {
    if (!Array.isArray(notes)) {
      cleaned[teamId] = notes;
      continue;
    }
    cleaned[teamId] = notes.filter((n) => {
      const id = n && typeof n === "object" ? String((n as { id?: unknown }).id ?? "") : "";
      if (!STARTER_ID.test(id)) return true;
      starters.push({ teamId, id, reason: "a starter draft, never imported" });
      return false;
    });
  }
  const legacy = planLegacyImport(cleaned);
  const skipped = [...legacy.skipped, ...starters];
  const entries: PlatformImportEntry[] = [];
  for (const e of legacy.entries) {
    const r = toPlatformEntry(e);
    if (r.ok) entries.push(r.entry);
    else skipped.push({ teamId: e.teamId, id: e.id, reason: r.reason });
  }
  return { entries, skipped };
}

/** The part of the Admin SDK's Firestore the importer uses: read the ids that exist, then create the missing ones in batches (create fails on an existing id). */
export type ImportDb = {
  doc(path: string): { path: string };
  getAll(...refs: { path: string }[]): Promise<{ exists: boolean; ref: { path: string } }[]>;
  batch(): { create(ref: { path: string }, data: unknown): unknown; commit(): Promise<unknown> };
};

export const IMPORT_BATCH_SIZE = 400;

/** Creates every entry that does not exist yet, `batchSize` per batch. Never overwrites: an id that exists is counted and left alone. Returns the counts. */
export async function applyPlatformImport(db: ImportDb, plan: PlatformImportPlan, batchSize: number = IMPORT_BATCH_SIZE): Promise<{ created: number; existing: number }> {
  const refs = plan.entries.map((e) => db.doc(`${PLATFORM_CHANGELOG_COLLECTION}/${e.id}`));
  const have = new Set<string>();
  for (let i = 0; i < refs.length; i += batchSize) {
    for (const snap of await db.getAll(...refs.slice(i, i + batchSize))) if (snap.exists) have.add(snap.ref.path);
  }
  const todo = plan.entries.filter((_, i) => !have.has(refs[i].path));
  let created = 0;
  for (let i = 0; i < todo.length; i += batchSize) {
    const batch = db.batch();
    for (const e of todo.slice(i, i + batchSize)) batch.create(db.doc(`${PLATFORM_CHANGELOG_COLLECTION}/${e.id}`), e.doc);
    await batch.commit();
    created += Math.min(batchSize, todo.length - i);
  }
  return { created, existing: plan.entries.length - todo.length };
}
