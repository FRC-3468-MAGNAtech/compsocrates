/**
 * REBUILT (FRC 2026) game plugin. Scoring is a faithful port of CS app/utils/analyticsScoring.ts
 * (`getRebuiltFuelBreakdown`, `scoreRebuiltEntry`); flags, verification, prediction and rescout comparison port
 * scoutingFlags.ts, scoutVerification.ts, predictionEngine.ts and rescoutComparison.ts. Numbers come from
 * `config/games/rebuilt.ts`.
 *
 * Form value keys follow the KEY CONVENTION in `lib/games/types.ts` (`auto.cycleTimes` -> `auto_cycleTimes`).
 * D8: CS keeps ONE teleop human-player counter shared by every shift (a CS bug). Here each segment has its own value
 * (`teleop_humanPlayerFuel_transition`, `teleop_humanPlayerFuel_shift1..4`). `valuesToDoc` writes
 * `teleop.humanPlayerFuelByShift` AND `teleop.humanPlayerFuel` = the sum of the COUNTED segments (transition always;
 * shifts by parity), so CS readers and `scoreDoc` (which only reads `teleop.humanPlayerFuel`) stay consistent.
 * An old CS doc (no `humanPlayerFuelByShift`) loads its single total into the transition value, which always counts, so
 * re-saving it keeps the score.
 */
import { REBUILT_CONFIG as C } from "@/config/games/rebuilt";
import { DEFAULT_VERIFICATION_METRICS, VERIFICATION_THRESHOLD } from "@/config/games/shared";
import {
  asRecord,
  buildTacticalPrediction,
  compareScoutToLead,
  computeRescoutDiff,
  finiteNum,
  normalizeGameName,
} from "@/lib/games/common";
import type {
  CsDoc,
  FullGamePlugin,
  GameValues,
  PhaseScore,
  ScoutingFlag,
} from "@/lib/games/types";

type ScaleKind = "preload" | "bps" | "carry";

const BPS = C.scales.bps.values;
const CARRY = C.scales.carry.values;
const PRELOAD = C.scales.preload.values;

const SHIFT_KEYS = C.shifts.shifts;
const HP_SEGMENTS = C.shifts.segments;

// ---------------------------------------------------------------------------------------------------------------------
// Scoring (analyticsScoring.ts)
// ---------------------------------------------------------------------------------------------------------------------

function scaleValue(table: readonly number[], scale: unknown): number {
  return table[Math.max(0, Math.min(table.length - 1, Number(scale || 0)))] || 0;
}

function rebuiltFuelFromCycles(cycles: unknown, bpsScale: unknown, carryScale: unknown): number {
  if (!Array.isArray(cycles) || cycles.length === 0) return 0;
  const bps = scaleValue(BPS, bpsScale);
  const carryCap = scaleValue(CARRY, carryScale);
  return cycles.reduce<number>((sum, seconds) => {
    const sec = Number(seconds || 0);
    if (!Number.isFinite(sec) || sec <= 0) return sum;
    return sum + Math.max(0, Math.round(Math.min(carryCap, bps * sec)));
  }, 0);
}

function rebuiltAutoFuelFromCycles(cycles: unknown, preloadScale: unknown, bpsScale: unknown, carryScale: unknown): number {
  if (!Array.isArray(cycles) || cycles.length === 0) return 0;
  const preloadCap = scaleValue(PRELOAD, preloadScale);
  const bps = scaleValue(BPS, bpsScale);
  const carryCap = scaleValue(CARRY, carryScale);
  return cycles.reduce<number>((sum, seconds, index) => {
    const sec = Number(seconds || 0);
    if (!Number.isFinite(sec) || sec <= 0) return sum;
    const capacity = index === 0 && preloadCap > 0 ? preloadCap : carryCap;
    return sum + Math.max(0, Math.round(Math.min(capacity, bps * sec)));
  }, 0);
}

function applyFuelOverride(estimated: number, overrideValue: unknown, missedValue: unknown): number {
  const override = Number(overrideValue || 0);
  if (override > 0) return override;
  const missed = Math.max(0, Number(missedValue || 0));
  return Math.max(0, estimated - missed);
}

export type RebuiltFuelBreakdown = { autoFuel: number; teleFuel: number; endgameFuel: number };

/** CS `getRebuiltFuelBreakdown`, on a CS-shaped doc. */
export function getRebuiltFuelBreakdown(doc: CsDoc): RebuiltFuelBreakdown {
  const auto = asRecord(doc.auto);
  const teleop = asRecord(doc.teleop);
  const endgame = asRecord(doc.endgame);

  const teleBps = Number(teleop.bpsScale || 0);
  const teleCarry = Number(teleop.carryingScale || 0);

  const autoEstimated = rebuiltAutoFuelFromCycles(auto.cycleTimes, Number(auto.preloadScale || 0), Number(auto.bpsScale || 0), Number(auto.carryingScale || 0));
  const segment = (cycles: unknown, override: unknown, missed: unknown) =>
    applyFuelOverride(rebuiltFuelFromCycles(cycles, teleBps, teleCarry), override, missed);

  const autoSectionFuel = applyFuelOverride(autoEstimated, auto.counterOverride, auto.counterOverrideMissedFuel);
  const transitionFuel = segment(teleop.transitionCycles, teleop.transitionOverride, teleop.transitionMissedFuel);
  const shiftFuel = (n: 1 | 2 | 3 | 4) => segment(teleop[`shift${n}Cycles`], teleop[`shift${n}Override`], teleop[`shift${n}MissedFuel`]);
  const endgameSectionFuel = segment(endgame.cycleTimes, endgame.counterOverride, endgame.counterOverrideMissedFuel);

  const countShiftsTwoFour = typeof teleop.shiftParityFromWonAuto === "boolean" ? teleop.shiftParityFromWonAuto : Boolean(auto.wonAuto);

  const autoFuel = autoSectionFuel + Number(auto.humanPlayerFuel || 0);
  const teleFuel =
    transitionFuel + (countShiftsTwoFour ? shiftFuel(2) + shiftFuel(4) : shiftFuel(1) + shiftFuel(3)) + Number(teleop.humanPlayerFuel || 0);
  const endgameFuel = endgameSectionFuel + Number(endgame.humanPlayerFuel || 0);

  return { autoFuel, teleFuel, endgameFuel };
}

function climbPoints(doc: CsDoc): { auto: number; endgame: number } {
  const auto = asRecord(doc.auto).successfulClimb ? C.points.autoClimb : 0;
  const status = String(asRecord(doc.endgame).status || "").toLowerCase();
  const table: Record<string, number> = C.points.endgameClimb;
  return { auto, endgame: Object.prototype.hasOwnProperty.call(table, status) ? table[status] : 0 };
}

function scoreDoc(doc: CsDoc): PhaseScore {
  const fuel = getRebuiltFuelBreakdown(doc);
  const climb = climbPoints(doc);
  const auto = fuel.autoFuel * C.points.fuel + climb.auto;
  const teleop = fuel.teleFuel * C.points.fuel;
  const endgame = fuel.endgameFuel * C.points.fuel + climb.endgame;
  return { auto, teleop, endgame, total: auto + teleop + endgame };
}

// ---------------------------------------------------------------------------------------------------------------------
// Form values <-> CS doc
// ---------------------------------------------------------------------------------------------------------------------

function numVal(values: GameValues, key: string): number {
  const parsed = Number(values[key] ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
function boolVal(values: GameValues, key: string): boolean {
  return Boolean(values[key]);
}
function strVal(values: GameValues, key: string): string {
  return String(values[key] ?? "");
}
function arrVal(values: GameValues, key: string): number[] {
  const v = values[key];
  return Array.isArray(v) ? v.map(Number).filter((n) => Number.isFinite(n)) : [];
}
function strArrVal(values: GameValues, key: string): string[] {
  const v = values[key];
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

/** Shift parity as CS submit() computes it: wonAuto XOR hubActivationOverride. */
function parityOf(values: GameValues): boolean {
  return boolVal(values, "auto_wonAuto") !== boolVal(values, "auto_hubActivationOverride");
}

function buildDoc(values: GameValues): CsDoc {
  const parity = parityOf(values);

  const hpByShift: Record<string, number> = {};
  for (const segment of HP_SEGMENTS) hpByShift[segment] = numVal(values, `teleop_humanPlayerFuel_${segment}`);
  const counted: readonly string[] = ["transition", ...C.shifts.countedWhenParity[parity ? "true" : "false"]];
  const hpCounted = counted.reduce((sum, segment) => sum + hpByShift[segment], 0);

  const shiftFields: Record<string, unknown> = {};
  for (const shift of SHIFT_KEYS) shiftFields[`${shift}Cycles`] = arrVal(values, `teleop_${shift}Cycles`);
  const overrideFields: Record<string, number> = {
    transitionOverride: numVal(values, "teleop_transitionOverride"),
    transitionMissedFuel: numVal(values, "teleop_transitionMissedFuel"),
  };
  for (const shift of SHIFT_KEYS) {
    overrideFields[`${shift}Override`] = numVal(values, `teleop_${shift}Override`);
    overrideFields[`${shift}MissedFuel`] = numVal(values, `teleop_${shift}MissedFuel`);
  }

  const doc: CsDoc = {
    game: C.id,
    startingPosition: strVal(values, "startingPosition"),
    auto: {
      preloadScale: numVal(values, "auto_preloadScale"),
      bpsScale: numVal(values, "auto_bpsScale"),
      carryingScale: numVal(values, "auto_carryingScale"),
      cycleTimes: arrVal(values, "auto_cycleTimes"),
      estimatedFuel: 0,
      counterOverride: numVal(values, "auto_counterOverride"),
      counterOverrideMissedFuel: numVal(values, "auto_counterOverrideMissedFuel"),
      humanPlayerFuel: numVal(values, "auto_humanPlayerFuel"),
      failedClimb: numVal(values, "auto_failedClimb"),
      successfulClimb: boolVal(values, "auto_successfulClimb"),
      wonAuto: boolVal(values, "auto_wonAuto"),
      hubActivationOverride: boolVal(values, "auto_hubActivationOverride"),
    },
    teleop: {
      shiftParityFromWonAuto: parity,
      bpsScale: numVal(values, "teleop_bpsScale"),
      carryingScale: numVal(values, "teleop_carryingScale"),
      transitionCycles: arrVal(values, "teleop_transitionCycles"),
      ...shiftFields,
      ...overrideFields,
      humanPlayerFuel: hpCounted,
      humanPlayerFuelByShift: hpByShift,
      estimatedFuel: 0,
    },
    endgame: {
      cycleTimes: arrVal(values, "endgame_cycleTimes"),
      counterOverride: numVal(values, "endgame_counterOverride"),
      counterOverrideMissedFuel: numVal(values, "endgame_counterOverrideMissedFuel"),
      humanPlayerFuel: numVal(values, "endgame_humanPlayerFuel"),
      estimatedFuel: 0,
      failedClimb: numVal(values, "endgame_failedClimb"),
      status: strVal(values, "endgame_status"),
    },
    incidents: strArrVal(values, "incidents"),
    notes: strVal(values, "notes"),
    scoringWeights: { ...C.points.scoringWeightsSnapshot },
  };

  // CS stores each section's fuel (including human-player fuel) as `estimatedFuel`; flags and verification read it.
  const fuel = getRebuiltFuelBreakdown(doc);
  (doc.auto as Record<string, unknown>).estimatedFuel = fuel.autoFuel;
  (doc.teleop as Record<string, unknown>).estimatedFuel = fuel.teleFuel;
  (doc.endgame as Record<string, unknown>).estimatedFuel = fuel.endgameFuel;
  return doc;
}

function docToValues(doc: CsDoc): GameValues {
  const auto = asRecord(doc.auto);
  const teleop = asRecord(doc.teleop);
  const endgame = asRecord(doc.endgame);
  const n = (v: unknown) => finiteNum(v);
  const arr = (v: unknown) => (Array.isArray(v) ? v.map(Number).filter((x) => Number.isFinite(x)) : []);

  const values: GameValues = {
    startingPosition: String(doc.startingPosition || ""),
    auto_preloadScale: n(auto.preloadScale),
    auto_bpsScale: n(auto.bpsScale),
    auto_carryingScale: n(auto.carryingScale),
    auto_cycleTimes: arr(auto.cycleTimes),
    auto_counterOverride: n(auto.counterOverride),
    auto_counterOverrideMissedFuel: n(auto.counterOverrideMissedFuel),
    auto_humanPlayerFuel: n(auto.humanPlayerFuel),
    auto_failedClimb: n(auto.failedClimb),
    auto_successfulClimb: Boolean(auto.successfulClimb),
    auto_wonAuto: Boolean(auto.wonAuto),
    auto_hubActivationOverride: Boolean(auto.hubActivationOverride),
    teleop_bpsScale: n(teleop.bpsScale),
    teleop_carryingScale: n(teleop.carryingScale),
    teleop_transitionCycles: arr(teleop.transitionCycles),
    teleop_transitionOverride: n(teleop.transitionOverride),
    teleop_transitionMissedFuel: n(teleop.transitionMissedFuel),
    endgame_cycleTimes: arr(endgame.cycleTimes),
    endgame_counterOverride: n(endgame.counterOverride),
    endgame_counterOverrideMissedFuel: n(endgame.counterOverrideMissedFuel),
    endgame_humanPlayerFuel: n(endgame.humanPlayerFuel),
    endgame_failedClimb: n(endgame.failedClimb),
    endgame_status: String(endgame.status || ""),
    incidents: Array.isArray(doc.incidents) ? doc.incidents.map((v) => String(v)) : [],
    notes: String(doc.notes || ""),
  };
  for (const shift of SHIFT_KEYS) {
    values[`teleop_${shift}Cycles`] = arr(teleop[`${shift}Cycles`]);
    values[`teleop_${shift}Override`] = n(teleop[`${shift}Override`]);
    values[`teleop_${shift}MissedFuel`] = n(teleop[`${shift}MissedFuel`]);
  }

  const byShift = teleop.humanPlayerFuelByShift;
  if (byShift !== null && typeof byShift === "object" && !Array.isArray(byShift)) {
    const rec = byShift as Record<string, unknown>;
    for (const segment of HP_SEGMENTS) values[`teleop_humanPlayerFuel_${segment}`] = n(rec[segment]);
  } else {
    // Old CS doc: one shared total. Park it on the transition segment, which always counts.
    for (const segment of HP_SEGMENTS) values[`teleop_humanPlayerFuel_${segment}`] = segment === "transition" ? n(teleop.humanPlayerFuel) : 0;
  }
  return values;
}

function defaultValues(): GameValues {
  return docToValues({});
}

// ---------------------------------------------------------------------------------------------------------------------
// Flags (scoutingFlags.ts evaluateRebuiltFlags). Reads the doc's STORED estimatedFuel values, exactly as CS.
// ---------------------------------------------------------------------------------------------------------------------

function flags(doc: CsDoc): ScoutingFlag[] {
  const autoFuel = finiteNum(asRecord(doc.auto).estimatedFuel);
  const teleFuel = finiteNum(asRecord(doc.teleop).estimatedFuel);
  const endgameFuel = finiteNum(asRecord(doc.endgame).estimatedFuel);
  const humanFuel = finiteNum(asRecord(doc.auto).humanPlayerFuel) + finiteNum(asRecord(doc.teleop).humanPlayerFuel) + finiteNum(asRecord(doc.endgame).humanPlayerFuel);
  const totalFuel = autoFuel + teleFuel + endgameFuel;
  const out: ScoutingFlag[] = [];
  const hp = C.flags.humanPlayerHeavy;
  const ao = C.flags.autoOnlyNoTeleop;

  if (humanFuel >= hp.minHumanFuel && (totalFuel <= 0 || humanFuel >= totalFuel * hp.shareOfRobotFuel)) {
    out.push({
      code: "human-player-heavy",
      label: hp.label,
      detail: `Human player fuel is ${humanFuel}, unusually high compared to robot fuel.`,
    });
  }
  if (autoFuel >= ao.minAutoFuel && teleFuel <= 0) {
    out.push({ code: "auto-only-no-teleop", label: ao.label, detail: `Auto fuel ${autoFuel} but teleop fuel is 0.` });
  }
  if (totalFuel <= 0 && humanFuel <= 0) {
    out.push({ code: "zero-main-scoring", label: C.flags.zeroMainScoring.label, detail: "No auto/teleop/endgame fuel recorded." });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Pit scale conversion (scout-form convertPitScale)
// ---------------------------------------------------------------------------------------------------------------------

/** Map a raw pit-scout number (balls, balls per second, capacity) to the scale index CS stores. */
export function convertPitScale(value: number, kind: ScaleKind): number {
  const n = Number(value || 0);
  const bounds = C.scales[kind].pitUpperBounds;
  const index = bounds.findIndex((upper) => n <= upper);
  return index === -1 ? bounds.length : index;
}

export const rebuiltPlugin: FullGamePlugin = {
  id: "REBUILT",
  label: C.label,
  season: C.season,
  formId: C.formId,
  matches: (doc) => normalizeGameName(doc.game) === C.id,
  docToValues,
  valuesToDoc: buildDoc,
  scoreDoc,
  scoreValues: (values) => scoreDoc(buildDoc(values)),
  defaultValues,
  flags,
  verify: (junior, lead, options) =>
    compareScoutToLead(junior, lead, options?.metrics ?? DEFAULT_VERIFICATION_METRICS, options?.threshold ?? VERIFICATION_THRESHOLD),
  predict: (team, docs, source, tier) => buildTacticalPrediction(team, docs, source, tier, (doc) => scoreDoc(doc).total),
  compareToExemplar: (original, exemplar) => computeRescoutDiff(original, exemplar, C.rescoutFields),
};
