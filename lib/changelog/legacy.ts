import { MAX_CHANGE_TEXT, MAX_CHANGES, MAX_TITLE, MAX_VERSION, type ChangeItem, type ChangeType } from "@/lib/changelog";

// The old CompSocrates changelog (Session G), brought into the new changelog's shape. Pure: the import script
// (scripts/import-cs-changelog.ts) is the only thing that touches Firestore, and it never runs from the build or the tests.
//
// What the old app stored: `teams/{id}.versionReleases[]` = `{ id, title, body, createdAt (ms), updatedAt (ms) }` (plus a legacy global
// `versionReleases` collection with the same fields). Free-text title and body, a creation time. NO version label and NO change indicators:
// those do not exist in the old data, so the mapping below is a documented best effort and every guess is flagged in the report.
//
// Rules of the conversion: wording is never rewritten or summarised. A line only loses a leading bullet glyph; a line over the change
// limit is split at a space into consecutive items of the same type, so no text is lost.

export type CsReleaseNote = { id?: unknown; title?: unknown; body?: unknown; createdAt?: unknown; updatedAt?: unknown };

export type LegacyEntry = {
  /** Stable: the same old note always gets the same doc id, so running the import twice writes each entry once. */
  id: string;
  teamId: string;
  version: string;
  title: string;
  date: string;
  summary: string;
  changes: ChangeItem[];
  /** The old note's own times, in ms (the import script turns them into Timestamps). */
  createdAtMs: number;
  updatedAtMs: number;
  /** What the converter had to guess or could not keep intact. Empty means the entry converted cleanly. */
  warnings: string[];
};

export type ConversionResult = { ok: true; entry: LegacyEntry } | { ok: false; reason: string };

export const LEGACY_AUTHOR = "cs-legacy-import";

/** `cs-legacy-{teamId}-{oldId}`: stable, readable in the console, and cannot collide with the starter drafts (`starter-...`). */
export const legacyDocId = (teamId: string, oldId: string): string => `cs-legacy-${teamId}-${oldId}`;

/** Old marker words -> the new categories. "Changed", "updated" and anything unmarked are "improved". */
const MARKERS: { pattern: RegExp; type: ChangeType }[] = [
  { pattern: /^\W*(?:new|added?|adds)\b/i, type: "new" },
  { pattern: /^\W*(?:fix(?:ed|es)?|bug ?fix(?:es)?)\b/i, type: "fixed" },
  { pattern: /^\W*(?:remov(?:ed|es?)|delet(?:ed|es?))\b/i, type: "removed" },
  { pattern: /^\W*(?:chang(?:ed|es?)|updat(?:ed|es?)|improv(?:ed|es?|ement)|tweak(?:ed)?)\b/i, type: "improved" },
];

export const DEFAULT_CHANGE_TYPE: ChangeType = "improved";

/** The category a line's own leading word names, or null when it names none. */
export function markerType(line: string): ChangeType | null {
  for (const m of MARKERS) if (m.pattern.test(line)) return m.type;
  return null;
}

const BULLET = /^\s*(?:[-*•●▪]|\d+[.)])\s+/;

/** Splits a long line at spaces into pieces of at most `max` characters. Nothing is dropped. */
function chunk(text: string, max: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(" ", max);
    if (cut <= 0) cut = max;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

/** YYYY-MM-DD of a millisecond time, in UTC (so the result does not depend on the machine running the import). */
export function isoDateOfMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

const VERSION_IN_TITLE = /^v?\d+(?:\.\d+){1,3}[\w.-]*/i;

/**
 * One old note as a new-format entry. The version label is the one in the title when it starts with one ("v2.1 - Pit form"), else the entry's
 * date (the new changelog accepts any label). Returns a reason instead of throwing so the script can report every skipped note.
 */
export function convertCsReleaseNote(teamId: string, note: CsReleaseNote): ConversionResult {
  const warnings: string[] = [];
  const oldId = typeof note.id === "string" ? note.id.trim() : "";
  const title = typeof note.title === "string" ? note.title.trim() : "";
  const body = typeof note.body === "string" ? note.body.replace(/\r\n?/g, "\n") : "";
  const createdAtMs = Number(note.createdAt);
  const updatedAtMs = Number(note.updatedAt);
  if (!oldId) return { ok: false, reason: "no id (a stable doc id needs one)" };
  if (!title) return { ok: false, reason: "no title" };
  if (!body.trim()) return { ok: false, reason: "no body" };
  // Undated notes cannot be stored: the rules need a YYYY-MM-DD date. The old app dropped such notes itself, so none should exist.
  if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) return { ok: false, reason: "no creation date (the new format needs one; flagged, not imported)" };

  const date = isoDateOfMs(createdAtMs);
  let version = VERSION_IN_TITLE.exec(title)?.[0] ?? date;
  if (version.length > MAX_VERSION) {
    version = date;
    warnings.push("version label in the title was too long: used the date");
  }
  let finalTitle = title;
  if (title.length > MAX_TITLE) {
    finalTitle = title.slice(0, MAX_TITLE).trimEnd();
    warnings.push(`title was ${title.length} characters (limit ${MAX_TITLE}): cut`);
  }

  let changes: ChangeItem[] = [];
  let guessed = 0;
  for (const raw of body.split("\n")) {
    const line = raw.replace(BULLET, "").trim();
    if (!line) continue;
    const marked = markerType(line);
    if (!marked) guessed += 1;
    const type = marked ?? DEFAULT_CHANGE_TYPE;
    for (const piece of chunk(line, MAX_CHANGE_TEXT)) changes.push({ type, text: piece });
  }
  if (guessed > 0) warnings.push(`${guessed} line(s) had no marker word: filed as "${DEFAULT_CHANGE_TYPE}"`);
  if (changes.length > MAX_CHANGES) {
    const kept = changes.slice(0, MAX_CHANGES - 1);
    const rest = changes.slice(MAX_CHANGES - 1);
    // The rest joins the last item (with its limit) so nothing is lost; a very long note is flagged for a manual look.
    const joined = rest.map((c) => c.text).join(" ");
    kept.push({ type: rest[0].type, text: joined.slice(0, MAX_CHANGE_TEXT) });
    if (joined.length > MAX_CHANGE_TEXT) warnings.push("the note has more text than one entry can hold: the tail was cut");
    else warnings.push(`the note had ${changes.length} lines (limit ${MAX_CHANGES}): the last lines were joined`);
    changes = kept;
  }

  return {
    ok: true,
    entry: {
      id: legacyDocId(teamId, oldId),
      teamId,
      version,
      title: finalTitle,
      date,
      summary: "",
      changes,
      createdAtMs,
      updatedAtMs: Number.isFinite(updatedAtMs) && updatedAtMs > 0 ? updatedAtMs : createdAtMs,
      warnings,
    },
  };
}

export type ImportPlan = { entries: LegacyEntry[]; skipped: { teamId: string; id: string; reason: string }[] };

/** The whole export (`{ teamId: notes[] }`) as one plan: converted entries (oldest first) and what was skipped and why. */
export function planLegacyImport(exportData: Record<string, unknown>): ImportPlan {
  const entries: LegacyEntry[] = [];
  const skipped: ImportPlan["skipped"] = [];
  for (const [teamId, notes] of Object.entries(exportData)) {
    if (!Array.isArray(notes)) {
      skipped.push({ teamId, id: "(whole team)", reason: "not a list of notes" });
      continue;
    }
    for (const note of notes) {
      const result = convertCsReleaseNote(teamId, (note ?? {}) as CsReleaseNote);
      if (result.ok) entries.push(result.entry);
      else skipped.push({ teamId, id: String((note as CsReleaseNote | null)?.id ?? "(no id)"), reason: result.reason });
    }
  }
  entries.sort((a, b) => a.createdAtMs - b.createdAtMs);
  return { entries, skipped };
}
