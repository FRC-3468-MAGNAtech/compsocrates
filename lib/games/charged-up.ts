/**
 * CHARGED UP (FRC 2023) game plugin. READ-ONLY (formId null, `valuesToDoc` returns null; docs/ROUTES.md D3).
 * Nested `auto` / `teleop` / `endgame` phases, so form value keys are `phase_field` (`auto_gridBottom`).
 * Top-level `mobility` and `penaltyPoints` keep their names. Scoring ports analyticsScoring.ts `scoreChargedUpEntry`
 * plus `penaltyPoints` (added by `scoreEntryForGame`).
 */
import { CHARGED_UP_CONFIG as C } from "@/config/games/charged-up";
import { DEFAULT_VERIFICATION_METRICS, VERIFICATION_THRESHOLD } from "@/config/games/shared";
import { asRecord, buildTacticalPrediction, compareScoutToLead, computeRescoutDiff, normalizeGameName, num } from "@/lib/games/common";
import type { CsDoc, FullGamePlugin, GameValues, PhaseScore } from "@/lib/games/types";

const PHASE_FIELDS = {
  auto: ["mobility", "gridBottom", "gridMiddle", "gridTop", "missed", "chargeStation"],
  teleop: ["gridBottom", "gridMiddle", "gridTop", "missed", "links"],
  endgame: ["chargeStation"],
} as const;
const TOP_FIELDS = ["startingPosition", "mobility", "penaltyPoints", "incidents", "notes"] as const;

function docToValues(doc: CsDoc): GameValues {
  const values: GameValues = {};
  for (const key of TOP_FIELDS) if (doc[key] !== undefined) values[key] = doc[key];
  for (const phase of Object.keys(PHASE_FIELDS) as Array<keyof typeof PHASE_FIELDS>) {
    const source = asRecord(doc[phase]);
    for (const field of PHASE_FIELDS[phase]) if (source[field] !== undefined) values[`${phase}_${field}`] = source[field];
  }
  return values;
}

/** Inverse of `docToValues`; only keys present in `values` are emitted so `auto.mobility ?? mobility` keeps working. */
function valuesToCsShape(values: GameValues): CsDoc {
  const doc: CsDoc = {};
  for (const key of TOP_FIELDS) if (values[key] !== undefined) doc[key] = values[key];
  for (const phase of Object.keys(PHASE_FIELDS) as Array<keyof typeof PHASE_FIELDS>) {
    const nested: Record<string, unknown> = {};
    for (const field of PHASE_FIELDS[phase]) if (values[`${phase}_${field}`] !== undefined) nested[field] = values[`${phase}_${field}`];
    if (Object.keys(nested).length > 0) doc[phase] = nested;
  }
  return doc;
}

function station(table: Record<string, number>, value: unknown): number {
  const status = String(value || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(table, status) ? table[status] : 0;
}

function scoreDoc(doc: CsDoc): PhaseScore {
  const auto = asRecord(doc.auto);
  const teleop = asRecord(doc.teleop);
  const endgame = asRecord(doc.endgame);
  const p = C.points;
  const autoScore =
    (Boolean(auto.mobility ?? doc.mobility) ? p.autoMobility : 0) +
    num(auto.gridBottom) * p.autoGrid.bottom +
    num(auto.gridMiddle) * p.autoGrid.middle +
    num(auto.gridTop) * p.autoGrid.top +
    station(p.autoStation, auto.chargeStation);
  const teleopScore =
    num(teleop.gridBottom) * p.teleopGrid.bottom +
    num(teleop.gridMiddle) * p.teleopGrid.middle +
    num(teleop.gridTop) * p.teleopGrid.top +
    num(teleop.links) * p.teleopLink;
  const endgameScore = station(p.endgameStation, endgame.chargeStation);
  const penalty = num(doc.penaltyPoints);
  return { auto: autoScore, teleop: teleopScore, endgame: endgameScore, total: autoScore + teleopScore + endgameScore + penalty, penalty };
}

export const chargedUpPlugin: FullGamePlugin = {
  id: "CHARGED_UP",
  label: C.label,
  season: C.season,
  formId: C.formId,
  matches: (doc) => normalizeGameName(doc.game) === C.id,
  docToValues,
  valuesToDoc: () => null,
  scoreDoc,
  scoreValues: (values) => scoreDoc(valuesToCsShape(values)),
  defaultValues: () => ({}),
  // CS's flag code only knows REBUILT and REEFSCAPE (it would run the REEFSCAPE rules on a CHARGED UP doc and flag every
  // row "Zero Main Scoring"). We raise none instead.
  flags: () => [],
  verify: (junior, lead, options) =>
    compareScoutToLead(junior, lead, options?.metrics ?? DEFAULT_VERIFICATION_METRICS, options?.threshold ?? VERIFICATION_THRESHOLD),
  predict: (team, docs, source, tier) => buildTacticalPrediction(team, docs, source, tier, (doc) => scoreDoc(doc).total),
  compareToExemplar: (original, exemplar) => computeRescoutDiff(original, exemplar, C.rescoutFields),
};
