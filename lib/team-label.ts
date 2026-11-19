// THE team label helper: the one place that turns what is known about a team into the words a person sees. Pure (no React, no Firebase).
//
// A label is built ONLY from a number and a name. The helper never takes a team id as something to show: the team id (a join code in one program, a random string in the other) is
// passed, when at all, in `forbid`, solely so a piece that happens to equal it is dropped. A piece that is not a plausible team number is dropped too. With nothing usable the label
// is `pending` (a skeleton in the UI, "Team (loading)" as text): it never falls back to an id.

export type NameParts = { number?: string | number | null; name?: string | null };

export type TeamLabel = {
  state: "ready" | "pending";
  /** The number line (bold): "3468", or "35792 + 35794" for a team with several robot teams. Null when only a name is known. */
  number: string | null;
  /** The name line (beneath, wrapping). Null when there is none. */
  name: string | null;
  /** One line of text for places that cannot draw two: "Team 3468 · Name", "Team 3468", the name, or "Team (loading)". */
  text: string;
};

export const PENDING_LABEL_TEXT = "Team (loading)";
export const PENDING_LABEL: TeamLabel = { state: "pending", number: null, name: null, text: PENDING_LABEL_TEXT };

/** A team number: 1 to 6 digits, or several joined with " + ". Anything else (an id, a join code) is not a number. */
const NUMBER_PATTERN = /^\d{1,6}(?: \+ \d{1,6})*$/;
const MAX_PART = 120;

/** Pure: the robot teams a team lists (each with a number and a name), the organization name and the team's own number and name -> the team-level identity. */
export function composeTeamIdentity(input: { number: number | null; name: string | null; org?: string | null; robots?: readonly { number: number; name: string | null }[] }): { number: string; name: string } | null {
  const robots = input.robots ?? [];
  const org = (input.org ?? "").trim();
  let number: string;
  let name: string;
  if (robots.length >= 2) {
    // Several robot teams: their numbers joined, and the organization name when there is one, else their names joined.
    number = robots.map((r) => r.number).join(" + ");
    name = org || robots.map((r) => (r.name ?? "").trim()).filter((n) => n !== "").join(" + ");
  } else {
    number = input.number !== null ? String(input.number) : robots[0] ? String(robots[0].number) : "";
    name = org || (input.name ?? "").trim() || (robots[0]?.name ?? "").trim();
  }
  if (number === "" && name === "") return null;
  return { number: number.slice(0, MAX_PART), name: name.slice(0, MAX_PART) };
}

/** Pure: the parts of an older membership's `teamLabel` string ("Team 3468 · Name", "Team 3468", or just a name). Never an id (that string is built from a number and a name only). */
export function legacyLabelParts(label: string | null | undefined): NameParts | null {
  const text = (label ?? "").trim();
  if (!text) return null;
  const match = /^Team (\d{1,6})(?: · (.+))?$/.exec(text);
  return match ? { number: match[1], name: match[2] ?? null } : { number: null, name: text };
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function clean(parts: NameParts | null | undefined, forbid: readonly string[]): { number: string | null; name: string | null } {
  if (!parts) return { number: null, name: null };
  const rawNumber = typeof parts.number === "number" ? (Number.isFinite(parts.number) && parts.number > 0 ? String(parts.number) : "") : (parts.number ?? "").trim();
  const number = NUMBER_PATTERN.test(rawNumber) && !forbid.some((f) => same(f, rawNumber)) ? rawNumber : null;
  const rawName = (parts.name ?? "").trim().slice(0, MAX_PART);
  const name = rawName !== "" && !forbid.some((f) => same(f, rawName) || same(`Team ${f}`, rawName)) ? rawName : null;
  return { number, name };
}

/**
 * The label from the best source known, tried in order (live team document, the membership's snapshot, its older label string, the device cache ...): the first source with a usable
 * number or name wins WHOLE (parts of different sources are never mixed). `forbid` lists ids (team id, join code) that must never appear: a piece equal to one is dropped.
 * Nothing usable: the pending label.
 */
export function resolveTeamLabel(sources: readonly (NameParts | null | undefined)[], opts: { forbid?: readonly (string | null | undefined)[] } = {}): TeamLabel {
  const forbid = (opts.forbid ?? []).filter((f): f is string => typeof f === "string" && f.trim() !== "");
  for (const source of sources) {
    const { number, name } = clean(source, forbid);
    if (number === null && name === null) continue;
    const text = number !== null ? (name ? `Team ${number} · ${name}` : `Team ${number}`) : (name as string);
    return { state: "ready", number, name, text };
  }
  return PENDING_LABEL;
}
