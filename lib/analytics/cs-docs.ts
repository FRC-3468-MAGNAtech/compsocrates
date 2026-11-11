import { normalizeEventKey } from "@/config/event";
import { appMatchToCs, normalizeCsMatchId } from "@/data/cs/match-id";
import { scoutEntryToCsDoc } from "@/data/cs/scouting";
import { gameForDoc, getGamePlugin } from "@/lib/games/registry";
import type { CsDoc, FullGamePlugin, GameId } from "@/lib/games/types";
import type { ScoutEntry } from "@/lib/scout-entries";

// The CS-only analytics pages (prediction, verification, comparison, radar) run on the game plugins, which speak CS documents
// (`CsDoc`). A `ScoutEntry` is the app's model, so these helpers turn an entry back into the CS document the plugin expects
// (through the adapter in data/cs/scouting.ts) and read the identity fields the pages join on. Pure.

/**
 * The CS document of an entry, or null when its form cannot be stored in CS's schema (a form no game plugin owns).
 */
export function entryToDoc(entry: ScoutEntry): CsDoc | null {
  try {
    return scoutEntryToCsDoc(entry);
  } catch {
    return null;
  }
}

/** The game plugin that owns a rebuilt document (null for a game no plugin knows). */
export function pluginForDoc(doc: CsDoc): FullGamePlugin | null {
  return gameForDoc(doc);
}

/** Entries whose documents can be rebuilt and belong to `gameId`, with their documents. `skipped` counts the rest (other games, forms no game owns). */
export function docsForGame(entries: readonly ScoutEntry[], gameId: GameId): { items: Array<{ entry: ScoutEntry; doc: CsDoc }>; skipped: number } {
  const plugin = getGamePlugin(gameId);
  const items: Array<{ entry: ScoutEntry; doc: CsDoc }> = [];
  let skipped = 0;
  for (const entry of entries) {
    const doc = entryToDoc(entry);
    if (doc && plugin.matches(doc)) items.push({ entry, doc });
    else skipped += 1;
  }
  return { items, skipped };
}

/** CS short match id (`q12`, `qf2`, `f1`, `p3`) of an entry: the CS string it was read from when it has one, else the D11 mapping. */
export function entryMatchId(entry: Pick<ScoutEntry, "matchType" | "matchNumber" | "legacy">): string {
  const stored = normalizeCsMatchId(entry.legacy?.matchId);
  return stored || appMatchToCs(entry.matchType, entry.matchNumber).matchId;
}

/** `eventKey::matchId`: what every CS page keys a match by (event normalised, match short id). */
export function matchGroupKey(eventKey: string, matchId: string): string {
  return `${normalizeEventKey(String(eventKey || "").trim())}::${normalizeCsMatchId(matchId)}`;
}

/** Long label for a short match id ("q12" -> "Qualification 12"). Unknown ids come back upper-cased. */
export function formatMatchIdLong(matchId: string): string {
  const id = normalizeCsMatchId(matchId);
  const m = /^(p|q|qf|sf|f)(\d+)$/.exec(id);
  if (!m) return id ? id.toUpperCase() : "-";
  const names: Record<string, string> = { p: "Practice", q: "Qualification", qf: "Quarterfinal", sf: "Semifinal", f: "Final" };
  return `${names[m[1]]} ${m[2]}`;
}

export function normalizeAlliance(value: unknown): "red" | "blue" | null {
  const raw = String(value || "").toLowerCase().trim();
  if (raw.startsWith("r")) return "red";
  if (raw.startsWith("b")) return "blue";
  return null;
}

/** Digits of a team number ("254B" -> 254); null when there are none or it is not positive. */
export function parseTeamNumber(value: unknown): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const digits = raw.match(/\d+/)?.[0];
  const num = Number(digits ?? raw);
  return Number.isFinite(num) && num > 0 ? num : null;
}
