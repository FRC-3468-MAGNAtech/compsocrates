/**
 * Pit-sync for the REBUILT match form: CS `scout-form/page.tsx` `loadPitDefaults`, `parsePitValue`, `pitValueFitsScale`, `pitMismatchMessages`. Pure.
 *
 * After a team is picked the form reads that team's pit scouting entry for the event (values are strings like "10-13", "8", "x"), prefills the five
 * scale sliders with the scale INDEX the pit number falls in (`convertPitScale`), and warns, with a confirm on submit, when the scouted scales no longer
 * contain the pit number. Scoring is untouched: the plugin scores from the scale indices only (docs/CS-REFERENCE.md: CS's live estimate also used the raw
 * pit numbers when they fit; the plugin deliberately does not).
 */
import { REBUILT_CONFIG as C } from "@/config/games/rebuilt";
import { convertPitScale } from "@/lib/games/rebuilt";
import type { FormValue, FormValues } from "@/lib/forms/types";

export type PitKind = "preload" | "bps" | "carry";

/** Raw numbers read from a pit entry; null = the pit scout left it blank, wrote `x`, or 0. */
export type PitValues = { preload: number | null; bps: number | null; carry: number | null };

/** The pit-scout field that holds each number (the `pitScouting` doc's own keys). */
export const PIT_FIELD: Record<PitKind, string> = { preload: "fuelPreloadCapacity", bps: "fuelBallsPerSecond", carry: "fuelCarryingCapacity" };

/** The match-form scale field each pit number prefills and is checked against (REBUILT form keys). BPS and carry feed auto AND teleop. */
export const SCALE_FIELDS: ReadonlyArray<{ kind: PitKind; key: string; label: string }> = [
  { kind: "preload", key: "auto_preloadScale", label: "Preload Capacity" },
  { kind: "bps", key: "auto_bpsScale", label: "Autonomous Balls Per Second" },
  { kind: "bps", key: "teleop_bpsScale", label: "Teleop Balls Per Second" },
  { kind: "carry", key: "auto_carryingScale", label: "Autonomous Carrying Capacity" },
  { kind: "carry", key: "teleop_carryingScale", label: "Teleop Carrying Capacity" },
];

/** CS `parsePitValue`: a positive number, or a range ("10-13", upper bound), or the first number in the text; else null. */
export function parsePitValue(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  const text = String(raw || "").trim();
  if (!text) return null;
  const range = text.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
  if (range) {
    const upper = Number(range[2]);
    return Number.isFinite(upper) && upper > 0 ? upper : null;
  }
  const numeric = text.match(/\d+(?:\.\d+)?/);
  if (!numeric) return null;
  const parsed = Number(numeric[0]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** CS `scaleRangeForIndex`: the raw numbers a scale step stands for (0 = exactly 0; the last BPS and carry steps are open-ended, preload ends at its top value). */
export function scaleRangeForIndex(kind: PitKind, index: number): { min: number; max: number } {
  const bounds = C.scales[kind].pitUpperBounds;
  const i = Math.max(0, Math.min(bounds.length, Math.trunc(index)));
  if (i === 0) return { min: 0, max: 0 };
  const min = bounds[i - 1] + 1;
  if (i < bounds.length) return { min, max: bounds[i] };
  return { min, max: kind === "preload" ? C.scales.preload.values[C.scales.preload.values.length - 1] : Number.POSITIVE_INFINITY };
}

/** CS `pitValueFitsScale`. */
export function pitValueFitsScale(kind: PitKind, value: number | null, scaleIndex: number): boolean {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return false;
  const range = scaleRangeForIndex(kind, scaleIndex);
  return value >= range.min && value <= range.max;
}

/** The newest of a team's pit entries as numbers: the entries are the team's `pitScouting` docs for this team and event, newest first or not. Null when there is none. */
export function pitValuesFromEntries(entries: ReadonlyArray<{ createdAtMs: number; values: FormValues }>): PitValues | null {
  if (entries.length === 0) return null;
  const latest = entries.reduce((best, e) => (e.createdAtMs > best.createdAtMs ? e : best));
  return { preload: parsePitValue(latest.values[PIT_FIELD.preload]), bps: parsePitValue(latest.values[PIT_FIELD.bps]), carry: parsePitValue(latest.values[PIT_FIELD.carry]) };
}

/** CS prefill: each pit number that exists sets its scale step(s); a blank one leaves the slider alone. */
export function pitPrefill(pit: PitValues): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { kind, key } of SCALE_FIELDS) {
    const raw = pit[kind];
    if (raw !== null) out[key] = convertPitScale(raw, kind);
  }
  return out;
}

const asIndex = (v: FormValue | undefined): number => Number(v) || 0;

/** CS `pitMismatchMessages`: one line per scale whose step no longer contains the pit number. Empty when nothing is synced or everything fits. */
export function pitMismatchMessages(pit: PitValues | null, values: FormValues): string[] {
  if (!pit) return [];
  const out: string[] = [];
  for (const { kind, key, label } of SCALE_FIELDS) {
    const raw = pit[kind];
    if (raw !== null && !pitValueFitsScale(kind, raw, asIndex(values[key]))) out.push(`${label} scale does not include pit value ${raw}.`);
  }
  return out;
}
