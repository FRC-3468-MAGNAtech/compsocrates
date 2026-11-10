/**
 * CS match ids <-> CE (matchType, matchNumber), docs/ROUTES.md D11.
 *
 * CS identifies a scouted match with a short id: `p3` (practice), `q12` (qualification), `qf2` / `sf5` (a double-elimination
 * bracket slot) and `f1` (finals game), plus a `matchType` of `practice | qualification | finals` and a `matchNumber` string.
 * CE has `MatchType` = Practice | Qualification | Playoff with a single numeric `matchNumber`, so playoffs use the D11
 * numbering: bracket slots 1..13, finals games 14..16 (overtime continues 17, 18).
 *
 * The id parser is a port of CS's `normalizeScoutedMatchId` (app/scout-form/page.tsx). Reverse mapping is lossy for playoffs
 * (`qf2` and `sf2` are both slot 2), which is why the adapter keeps the original CS strings in `ScoutEntry.legacy`.
 */
import { EVENT_CONFIG } from "@/config/event";
import type { MatchType } from "@/lib/ftc/types";

export type CsMatchType = "practice" | "qualification" | "finals";

function parsePlayoffSlotFromKey(raw: string, compLevel: "sf" | "qf"): number | null {
  const match = raw.match(new RegExp(`_${compLevel}(\\d+)m(\\d+)`, "i"));
  if (!match) return null;
  const slot = Number(match[1]);
  return Number.isFinite(slot) && slot > 0 ? slot : null;
}

function parseFinalsSeriesFromKey(raw: string): number | null {
  const match = raw.match(/_f(\d+)m(\d+)/i);
  if (!match) return null;
  const setNum = Number(match[1]);
  const matchNum = Number(match[2]);
  if (setNum >= 14 && setNum <= 16) return setNum - 13;
  if (setNum === 1 && matchNum >= 1 && matchNum <= 3) return matchNum;
  if (setNum >= 1 && setNum <= 3 && matchNum === 1) return setNum;
  return null;
}

/**
 * Port of CS `normalizeScoutedMatchId`: any of the match identifiers CS has stored (`q12`, `qf2m1`, a TBA key such as
 * `2026arli_qm12`, a label such as "Qualification 12") to the short id (`p3 | q12 | qf2 | sf5 | f1`). Unrecognised
 * strings come back lowercased with whitespace removed, exactly as CS does.
 */
export function normalizeCsMatchId(value: unknown): string {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  const direct = raw.match(/^(p|q|qf|sf|f)(\d+)$/);
  if (direct) return `${direct[1]}${Number(direct[2])}`;
  const playoffSet = raw.match(/^(qf|sf|f)(\d+)m(\d+)$/);
  if (playoffSet) return `${playoffSet[1]}${Number(playoffSet[2])}`;

  const fromQmKey = raw.match(/_qm(\d+)/);
  if (fromQmKey) return `q${Number(fromQmKey[1])}`;
  const fromPracticeKey = raw.match(/_(?:pr|pm)(\d+)/);
  if (fromPracticeKey) return `p${Number(fromPracticeKey[1])}`;
  const fromPractice = raw.match(/practice(?:\s+match)?\s+(\d+)/);
  if (fromPractice) return `p${Number(fromPractice[1])}`;
  const fromQual = raw.match(/qualification(?:\s+match)?\s+(\d+)/);
  if (fromQual) return `q${Number(fromQual[1])}`;

  const sfSlot = parsePlayoffSlotFromKey(raw, "sf");
  if (sfSlot !== null) return `sf${sfSlot}`;
  const sfLabel = raw.match(/semifinal\s+(\d+)(?:-(\d+))?/);
  if (sfLabel) return `sf${Number(sfLabel[1])}`;

  const qfSlot = parsePlayoffSlotFromKey(raw, "qf");
  if (qfSlot !== null) return `qf${qfSlot}`;
  const qfLabel = raw.match(/quarterfinal\s+(\d+)(?:-(\d+))?/);
  if (qfLabel) return `qf${Number(qfLabel[1])}`;

  const finalsSeries = parseFinalsSeriesFromKey(raw);
  if (finalsSeries !== null) return `f${finalsSeries}`;
  const finalsLabel = raw.match(/finals\s+(\d+)/);
  if (finalsLabel) {
    const n = Number(finalsLabel[1]);
    return `f${n >= 14 && n <= 16 ? n - 13 : n}`;
  }
  const genericMatch = raw.match(/\bmatch\s+(\d+)\b/);
  if (genericMatch) return `sf${Number(genericMatch[1])}`;
  return raw.replace(/\s+/g, "");
}

export type CsMatchRef = { matchType: MatchType; matchNumber: number };

function fromShortId(id: string): CsMatchRef | null {
  const m = id.match(/^(p|q|qf|sf|f)(\d+)$/);
  if (!m) return null;
  const n = Number(m[2]);
  switch (m[1]) {
    case "p":
      return { matchType: "Practice", matchNumber: n };
    case "q":
      return { matchType: "Qualification", matchNumber: n };
    case "f":
      // f1..f3 are the finals games (D11: 14..16). f4+ is a bracket slot written through CS's bracket picker.
      return { matchType: "Playoff", matchNumber: n >= 1 && n <= 3 ? EVENT_CONFIG.playoff.finalsOffset + n : n };
    default:
      return { matchType: "Playoff", matchNumber: n };
  }
}

function digits(value: unknown): number {
  const n = Number(String(value ?? "").replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * The CE match a CS `scouting` doc is for. Reads `matchId`, then `matchKey`, then `matchLabel` (CS's own precedence), and
 * falls back to `matchType` + `matchNumber` when none of them parse.
 */
export function csDocMatchRef(doc: Record<string, unknown>): CsMatchRef {
  for (const candidate of [doc.matchId, doc.matchKey, doc.matchLabel]) {
    const ref = fromShortId(normalizeCsMatchId(candidate));
    if (ref) return ref;
  }
  const type = String(doc.matchType || "").trim().toLowerCase();
  const number = digits(doc.matchNumber);
  if (type.startsWith("p")) return { matchType: "Practice", matchNumber: number };
  if (type.startsWith("f") || type.startsWith("pl") || type.startsWith("e")) {
    const { finalsOffset } = EVENT_CONFIG.playoff;
    return { matchType: "Playoff", matchNumber: number >= 1 && number <= 3 && type.startsWith("f") ? finalsOffset + number : number };
  }
  return { matchType: "Qualification", matchNumber: number };
}

export type CsMatchFields = { matchId: string; matchType: CsMatchType; matchNumber: string };

/**
 * The CS identity fields for a CE match. Playoff slots 1..13 are written as `sf{slot}` (what CS stores for the 2026 feed,
 * where TBA encodes the bracket slot as SF{slot}M{n}); finals games 14..16 as `f1..f3`, whose CS `matchNumber` is the series
 * number 1..3, not 14..16.
 */
export function appMatchToCs(matchType: MatchType, matchNumber: number): CsMatchFields {
  const n = Math.max(0, Math.trunc(matchNumber));
  if (matchType === "Practice") return { matchId: `p${n}`, matchType: "practice", matchNumber: String(n) };
  if (matchType === "Qualification") return { matchId: `q${n}`, matchType: "qualification", matchNumber: String(n) };
  const { bracketSlots, finalsOffset } = EVENT_CONFIG.playoff;
  if (n > bracketSlots) {
    const series = n - finalsOffset;
    return { matchId: `f${series}`, matchType: "finals", matchNumber: String(series) };
  }
  return { matchId: `sf${n}`, matchType: "finals", matchNumber: String(n) };
}
