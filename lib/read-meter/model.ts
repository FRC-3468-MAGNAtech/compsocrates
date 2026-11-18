// The read meter's pure part, shared by the browser wrapper, the server routes and the Admin Panel tab. No Firebase, no React.
//
// WHAT IT COUNTS: documents returned to the app by one-time reads and by realtime listeners (first server snapshot plus later added or modified documents;
// cache-sourced snapshots are skipped). WHAT IT DOES NOT SEE: reads Firestore bills for evaluating security rules (get()/exists() inside a rule), index or
// aggregation overhead, and anything another client or script reads. Compare its daily total with the Firebase console's Usage number.
import { isProgramId } from "@/config/programs/types";

/** The free (Spark) plan's daily read allowance: the line drawn on the Read usage tab. */
export const DAILY_FREE_READS = 50_000;

/** Page route -> collection -> documents. */
export type Counts = Record<string, Record<string, number>>;

const MAX_KEY = 60;
const MAX_KEYS = 200;
const MAX_VALUE = 1_000_000;

/** The meter's day: Pacific time, because the free quota resets about midnight Pacific. `YYYY-MM-DD`. */
export function pacificDayKey(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The `days` Pacific day keys ending at `at` (inclusive), newest first. */
export function recentDayKeys(at: Date, days: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < days; i += 1) out.push(pacificDayKey(new Date(at.getTime() - i * 24 * 60 * 60 * 1000)));
  return [...new Set(out)];
}

/** A map key that is safe as a Firestore field name: no dots or slashes, bounded, never empty. */
export function sanitizeKey(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9 _:()[\]{}@#$&+=,-]/g, "~").trim().slice(0, MAX_KEY);
  return cleaned === "" || /^__.*__$/.test(cleaned) ? "unknown" : cleaned;
}

/** A key as a person reads it: the slashes sanitizeKey replaced come back. */
export const displayKey = (key: string): string => key.replace(/~/g, "/");

const looksLikeId =(seg: string) => /^\d+$/.test(seg) || /^[A-Za-z0-9_-]{16,}$/.test(seg);

/** A page route as the meter names it: no program prefix, ids collapsed, at most three segments. `/frc/analytics/teams/254` -> `analytics/teams/[id]`. */
export function pageKeyOf(pathname: string): string {
  const segs = pathname.split("?")[0].split("/").filter(Boolean);
  if (segs.length > 0 && isProgramId(segs[0])) segs.shift();
  if (segs.length === 0) return "home";
  return sanitizeKey(segs.slice(0, 3).map((s) => (looksLikeId(s) ? "[id]" : s)).join("/"));
}

/** A collection path as the meter names it: ids at the odd positions collapse (`liveMatches/2026x_q1/scouts` -> `liveMatches/{id}/scouts`). */
export function collectionKeyOf(path: string): string {
  return sanitizeKey(path.split("/").map((seg, i) => (i % 2 === 1 ? "{id}" : seg)).join("/"));
}

export function addCount(counts: Counts, page: string, collection: string, n: number): void {
  if (!(n > 0)) return;
  const byCollection = (counts[page] ??= {});
  byCollection[collection] = (byCollection[collection] ?? 0) + n;
}

export const totalOf = (counts: Counts): number => Object.values(counts).reduce((sum, byCollection) => sum + Object.values(byCollection).reduce((a, b) => a + b, 0), 0);

/** Validates what a browser sends to the flush route: bounded, whole non-negative numbers, safe keys. Anything else is refused. */
export function parseFlushBody(body: unknown): { ok: true; counts: Counts } | { ok: false } {
  const raw = (body as { counts?: unknown } | null)?.counts;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false };
  const counts: Counts = {};
  let keys = 0;
  for (const [page, byCollection] of Object.entries(raw as Record<string, unknown>)) {
    if (!byCollection || typeof byCollection !== "object" || Array.isArray(byCollection)) return { ok: false };
    for (const [collection, n] of Object.entries(byCollection as Record<string, unknown>)) {
      keys += 1;
      if (keys > MAX_KEYS) return { ok: false };
      if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > MAX_VALUE) return { ok: false };
      addCount(counts, sanitizeKey(page), sanitizeKey(collection), n);
    }
  }
  return { ok: true, counts };
}

// ---- the daily document and its summary (what the Read usage tab shows) ----

export type DayDoc = {
  day: string;
  total: number;
  client?: { total?: number; pages?: Counts };
  server?: { total?: number; routes?: Counts };
};

export type DaySummary = { day: string; total: number; client: number; server: number };
export type Source = { source: string; docs: number };
export type UsageSummary = {
  days: DaySummary[];
  today: DaySummary;
  byPage: Source[];
  byCollection: Source[];
  top: Source[];
};

const numberOr0 = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const sortDesc = (m: Map<string, number>): Source[] => [...m].map(([source, docs]) => ({ source, docs })).sort((a, b) => b.docs - a.docs || a.source.localeCompare(b.source));

/** Today's detail and the per-day totals from the daily documents (`null` = no document that day). `docs` newest first, `days[0]` is today. */
export function summarizeUsage(docs: { day: string; data: DayDoc | null }[]): UsageSummary {
  const days: DaySummary[] = docs.map(({ day, data }) => ({ day, total: numberOr0(data?.total), client: numberOr0(data?.client?.total), server: numberOr0(data?.server?.total) }));
  const byPage = new Map<string, number>();
  const byCollection = new Map<string, number>();
  const top = new Map<string, number>();
  const today = docs[0]?.data;
  const add = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n);
  const walk = (prefix: string, counts: Counts | undefined) => {
    for (const [page, byColl] of Object.entries(counts ?? {})) {
      for (const [coll, n] of Object.entries(byColl)) {
        const docsRead = numberOr0(n);
        add(byPage, `${prefix}${page}`, docsRead);
        add(byCollection, coll, docsRead);
        add(top, `${prefix}${page} > ${coll}`, docsRead);
      }
    }
  };
  walk("", today?.client?.pages);
  walk("server: ", today?.server?.routes);
  return {
    days,
    today: days[0] ?? { day: "", total: 0, client: 0, server: 0 },
    byPage: sortDesc(byPage),
    byCollection: sortDesc(byCollection),
    top: sortDesc(top).slice(0, 10),
  };
}

/** The estimated documents a heavy admin tool reads, for the confirmation: a plain sum with the free allowance beside it. */
export function describeEstimate(parts: { label: string; docs: number }[]): { total: number; text: string } {
  const total = parts.reduce((sum, p) => sum + p.docs, 0);
  const share = Math.round((total / DAILY_FREE_READS) * 100);
  const detail = parts.map((p) => `${p.docs.toLocaleString("en-US")} ${p.label}`).join(", ");
  return { total, text: `About ${total.toLocaleString("en-US")} documents (${detail}), roughly ${share}% of the ${DAILY_FREE_READS.toLocaleString("en-US")} free reads per day.` };
}
