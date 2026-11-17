// Session 9: the posted and edited times of a platform changelog entry. Pure and shared (the server validates with it, the editor checks with it
// before sending, the Changelog page formats with it) and the same in every program. Times are epoch milliseconds (UTC); the release `date` is a
// separate calendar day and is never derived from them.

/** A time may be at most this far ahead of the server's clock (clock drift between the owner's device and the server). */
export const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

export type EntryTimes = { postedAt: number | null; editedAt: number | null };
/** What a request asks to change: a key that is absent is left alone, `null` clears it, a number sets it. */
export type TimePatch = { postedAt?: number | null; editedAt?: number | null };

const LABEL = { postedAt: "Time posted", editedAt: "Last edited" } as const;
const MAX_MS = 8.64e15;

/** The request's `times` object as a patch, or a clear message. Absent or null means "no change". */
export function parseTimePatch(raw: unknown): { ok: true; value: TimePatch } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: {} };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "The times aren't valid." };
  const src = raw as Record<string, unknown>;
  const value: TimePatch = {};
  for (const key of ["postedAt", "editedAt"] as const) {
    const v = src[key];
    if (v === undefined) continue;
    if (v === null) {
      value[key] = null;
      continue;
    }
    if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v) || v <= 0 || v > MAX_MS) return { ok: false, error: `${LABEL[key]} isn't a valid date and time.` };
    value[key] = v;
  }
  return { ok: true, value };
}

/** Why these two times cannot be stored, or null: not more than 5 minutes ahead of `nowMs`, and last edited not earlier than posted. */
export function checkTimes(t: EntryTimes, nowMs: number): string | null {
  const limit = nowMs + MAX_FUTURE_SKEW_MS;
  if (t.postedAt !== null && t.postedAt > limit) return "Time posted can't be in the future.";
  if (t.editedAt !== null && t.editedAt > limit) return "Last edited can't be in the future.";
  if (t.postedAt !== null && t.editedAt !== null && t.editedAt < t.postedAt) return "Last edited can't be earlier than Time posted.";
  return null;
}

// --- the owner's date-time inputs (the owner's LOCAL time <-> UTC milliseconds) -----------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0");

/** The value of an `<input type="datetime-local">` for a time, in the machine's local zone ("" for none). */
export function msToLocalInput(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The input's value read as local time: `null` for empty, `"invalid"` for anything that is not a real date and time. */
export function localInputToMs(value: string): number | null | "invalid" {
  const v = value.trim();
  if (v === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return "invalid";
  const ms = new Date(v).getTime();
  return Number.isNaN(ms) ? "invalid" : ms;
}

/**
 * The patch to send for the two inputs: only a field the owner changed from what it showed when the editor opened (a cleared field is `null`).
 * Returns an error message for an input that is not a real date and time, or for a combination the server would refuse.
 */
export function timePatchFromInputs(opened: { posted: string; edited: string }, now: { posted: string; edited: string }, nowMs: number, stored: EntryTimes): { ok: true; patch: TimePatch } | { ok: false; error: string } {
  const patch: TimePatch = {};
  const next: EntryTimes = { ...stored };
  for (const [field, key] of [["posted", "postedAt"], ["edited", "editedAt"]] as const) {
    if (now[field] === opened[field]) continue;
    const ms = localInputToMs(now[field]);
    if (ms === "invalid") return { ok: false, error: `${LABEL[key]} isn't a valid date and time.` };
    patch[key] = ms;
    next[key] = ms;
  }
  if (Object.keys(patch).length === 0) return { ok: true, patch };
  const problem = checkTimes(next, nowMs);
  return problem ? { ok: false, error: problem } : { ok: true, patch };
}

// --- display (the viewer's own time zone, locale-aware) -----------------------------------------------------------------------------------------

export type FormatOptions = { locale?: string | string[]; timeZone?: string };

/** "Nov 5, 2026, 3:04 PM" in the viewer's locale and time zone (`timeZone` and `locale` only for tests). */
export const formatDateTime = (ms: number, o: FormatOptions = {}): string => new Intl.DateTimeFormat(o.locale, { dateStyle: "medium", timeStyle: "short", timeZone: o.timeZone }).format(ms);

/** The tooltip: the full date, the time with seconds and the time zone's name. */
export const formatDateTimeFull = (ms: number, o: FormatOptions = {}): string => new Intl.DateTimeFormat(o.locale, { dateStyle: "full", timeStyle: "long", timeZone: o.timeZone }).format(ms);

/** The parts of an entry's "Posted ... · Edited ..." line: only the times that exist, posted first. Empty when neither exists (the app never invents a time). */
export function entryTimeParts(e: { postedAtMs?: number | null; editedAtMs?: number | null }): { label: "Posted" | "Edited"; ms: number }[] {
  const out: { label: "Posted" | "Edited"; ms: number }[] = [];
  if (typeof e.postedAtMs === "number") out.push({ label: "Posted", ms: e.postedAtMs });
  if (typeof e.editedAtMs === "number") out.push({ label: "Edited", ms: e.editedAtMs });
  return out;
}

// --- "Fill from import" (a legacy entry nobody has saved since the import) -----------------------------------------------------------------------

/**
 * What the importer left that can pre-fill the two time inputs: only for a legacy entry at `rev` 1 (never saved since the import, so the old values
 * cannot have been overwritten). Posted from `publishedAt` (the importer stored the old note's creation time there); edited from `updatedAt` only when
 * it is later than `createdAt`. Returns null when the button does not apply. It only fills the form: the owner presses Save.
 */
export function fillFromImport(e: { legacy: boolean; rev: number; publishedAtMs: number | null; createdAtMs: number | null; updatedAtMs: number | null }): EntryTimes | null {
  if (!e.legacy || e.rev !== 1) return null;
  const posted = typeof e.publishedAtMs === "number" ? e.publishedAtMs : null;
  const edited = typeof e.updatedAtMs === "number" && typeof e.createdAtMs === "number" && e.updatedAtMs > e.createdAtMs ? e.updatedAtMs : null;
  return { postedAt: posted, editedAt: edited };
}
