import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

// Counts the reads THIS script has issued per Pacific-time day (Firestore's daily quota resets at midnight Pacific). It cannot see the site's own
// reads or anyone else's; the Firebase console's Usage tab shows the real total.

export type Ledger = { days: Record<string, number> };

export const LEDGER_FILE = "export-ledger.json";

export function pacificDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function readLedger(file: string): Ledger {
  if (!existsSync(file)) return { days: {} };
  const parsed = JSON.parse(readFileSync(file, "utf8")) as Ledger;
  if (!parsed || typeof parsed.days !== "object") throw new Error(`The read ledger ${file} is not valid; fix or remove it before running.`);
  return parsed;
}

export function ledgerTotal(l: Ledger, day: string): number {
  return l.days[day] ?? 0;
}

export function withReads(l: Ledger, day: string, reads: number): Ledger {
  return { days: { ...l.days, [day]: ledgerTotal(l, day) + reads } };
}

export function saveLedger(file: string, l: Ledger): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(l, null, 2)}\n`, "utf8");
  renameSync(tmp, file);
}

/** Throws when this day's recorded reads plus the run's cap would pass the ceiling. */
export function assertWithinCeiling(l: Ledger, day: string, cap: number, ceiling: number): void {
  const used = ledgerTotal(l, day);
  if (used + cap > ceiling) {
    throw new Error(
      `Refusing to run: this script has already used ${used} reads on ${day} (Pacific), this run could use up to ${cap}, and the daily ceiling is ${ceiling}. Lower --max-reads, raise --daily-ceiling (50,000 minus about twice the site's typical daily reads), or run after midnight Pacific.`
    );
  }
}
