// A team number is a plain FRC team number: digits only, no sign or decimal, not zero. Pure (no React, no Firebase), so the
// client forms, the API routes and the tests share one definition.

/** "3468" -> 3468. 1 to 5 digits, no sign/decimal, not zero. Anything else is `null`. */
export function parseTeamNumber(input: string | number | null | undefined): number | null {
  const text = typeof input === "number" ? String(input) : (input ?? "").trim();
  if (!/^\d{1,5}$/.test(text)) return null;
  const n = Number(text);
  return n > 0 ? n : null;
}

/** "Team 3468" (or "Team 3468 · Name"): the label for a team in headers and messages. */
export function teamLabel(number: number | string, name?: string | null): string {
  const base = `Team ${number}`;
  const trimmed = (name ?? "").trim();
  return trimmed ? `${base} · ${trimmed}` : base;
}

/** The fields of a team doc that carry its identity: CS's raw `teamNumber` (a STRING there) / `teamName`, or the adapter's `number` / `name`. */
export type TeamIdentitySource = { teamNumber?: unknown; teamName?: unknown; number?: unknown; name?: unknown } | null | undefined;

/** Pure: a team doc (raw CS, or the adapter's `TeamDoc`) -> its number (parsed to an integer, null when absent or malformed) and trimmed name (null when empty). */
export function readTeamIdentity(doc: TeamIdentitySource): { number: number | null; name: string | null } {
  if (!doc) return { number: null, name: null };
  const csNumber = typeof doc.teamNumber === "string" || typeof doc.teamNumber === "number" ? parseTeamNumber(doc.teamNumber) : null;
  const number = csNumber ?? parseTeamNumber(typeof doc.number === "number" ? doc.number : null);
  const rawName = typeof doc.teamName === "string" ? doc.teamName : typeof doc.name === "string" ? doc.name : "";
  return { number, name: rawName.trim() || null };
}
