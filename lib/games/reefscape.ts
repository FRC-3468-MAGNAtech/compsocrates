/**
 * REEFSCAPE (FRC 2025) game plugin. READ-ONLY (formId null, `valuesToDoc` returns null; docs/ROUTES.md D3).
 * A CS doc with no `game` field is REEFSCAPE. Fields are flat, so the form value key equals the CS field name.
 *
 * Scoring ports analyticsScoring.ts `scoreEntryForGame(entry, "REEFSCAPE")`. Known CS quirk, kept on purpose: climb
 * status matching uses `includes`, so the old form's "not-parked" value contains "park" and scores 2 points.
 */
import { REEFSCAPE_CONFIG as C } from "@/config/games/reefscape";
import { DEFAULT_VERIFICATION_METRICS, VERIFICATION_THRESHOLD } from "@/config/games/shared";
import { buildTacticalPrediction, compareScoutToLead, computeRescoutDiff, finiteNum, normalizeGameName, num } from "@/lib/games/common";
import type { CsDoc, FullGamePlugin, GameValues, PhaseScore, ScoutingFlag } from "@/lib/games/types";

/** Every flat REEFSCAPE field a CS doc may carry (matches the old form and the analytics Entry type). */
const REEFSCAPE_KEYS = [
  "startingPosition",
  "leftStartingZone",
  "autoCoralMissed",
  "autoCoralL1",
  "autoCoralL2",
  "autoCoralL3",
  "autoCoralL4",
  "autoAlgaeProcessorMissed",
  "autoAlgaeProcessorScored",
  "autoAlgaeNetMissed",
  "autoAlgaeNetScored",
  "teleopCoralMissed",
  "teleopCoralL1",
  "teleopCoralL2",
  "teleopCoralL3",
  "teleopCoralL4",
  "teleopAlgaeRemoved",
  "teleopProcessorMissed",
  "teleopProcessorScored",
  "teleopNetRobotMissed",
  "teleopNetRobotScored",
  "teleopNetHumanMissed",
  "teleopNetHumanScored",
  "failedClimb",
  "stageStatus",
  "penaltyPoints",
  "incidents",
  "notes",
] as const;

function pick(source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of REEFSCAPE_KEYS) if (source[key] !== undefined) out[key] = source[key];
  return out;
}

function autoPoints(doc: CsDoc): number {
  const p = C.points;
  return (
    (doc.leftStartingZone ? p.leave : 0) +
    num(doc.autoCoralL1) * p.autoCoral.L1 +
    num(doc.autoCoralL2) * p.autoCoral.L2 +
    num(doc.autoCoralL3) * p.autoCoral.L3 +
    num(doc.autoCoralL4) * p.autoCoral.L4 +
    num(doc.autoAlgaeProcessorScored) * p.autoProcessor +
    num(doc.autoAlgaeNetScored) * p.autoNet
  );
}

function teleopRobotPoints(doc: CsDoc): number {
  const p = C.points;
  return (
    num(doc.teleopCoralL1) * p.teleopCoral.L1 +
    num(doc.teleopCoralL2) * p.teleopCoral.L2 +
    num(doc.teleopCoralL3) * p.teleopCoral.L3 +
    num(doc.teleopCoralL4) * p.teleopCoral.L4 +
    num(doc.teleopProcessorScored) * p.teleopProcessor +
    num(doc.teleopNetRobotScored) * p.teleopNetRobot
  );
}

function teleopHumanPoints(doc: CsDoc): number {
  return num(doc.teleopNetHumanScored) * C.points.teleopNetHuman;
}

function climbPoints(doc: CsDoc): number {
  const status = String(doc.stageStatus || "").toLowerCase();
  const rule = C.points.climb.find((r) => r.includes.some((part) => status.includes(part)));
  return rule ? rule.points : 0;
}

function scoreDoc(doc: CsDoc): PhaseScore {
  const auto = autoPoints(doc);
  const teleop = teleopRobotPoints(doc) + teleopHumanPoints(doc);
  const endgame = climbPoints(doc);
  const penalty = num(doc.penaltyPoints);
  return { auto, teleop, endgame, total: auto + teleop + endgame + penalty, penalty };
}

function flags(doc: CsDoc): ScoutingFlag[] {
  // CS (scoutingFlags.ts) reads these as `toNumber`: non-finite counts as 0.
  const f = (key: string) => finiteNum(doc[key]);
  const p = C.points;
  const auto =
    f("autoCoralL1") * p.autoCoral.L1 +
    f("autoCoralL2") * p.autoCoral.L2 +
    f("autoCoralL3") * p.autoCoral.L3 +
    f("autoCoralL4") * p.autoCoral.L4 +
    f("autoAlgaeProcessorScored") * p.autoProcessor +
    f("autoAlgaeNetScored") * p.autoNet;
  const teleRobot =
    f("teleopCoralL1") * p.teleopCoral.L1 +
    f("teleopCoralL2") * p.teleopCoral.L2 +
    f("teleopCoralL3") * p.teleopCoral.L3 +
    f("teleopCoralL4") * p.teleopCoral.L4 +
    f("teleopProcessorScored") * p.teleopProcessor +
    f("teleopNetRobotScored") * p.teleopNetRobot;
  const teleHuman = f("teleopNetHumanScored") * p.teleopNetHuman;
  const hp = C.flags.humanPlayerHeavy;
  const ao = C.flags.autoOnlyNoTeleop;
  const out: ScoutingFlag[] = [];

  if (teleHuman >= hp.minHumanPoints && (teleRobot <= 0 || teleHuman >= teleRobot * hp.shareOfRobotPoints)) {
    out.push({ code: "human-player-heavy", label: hp.label, detail: `Human net points are ${teleHuman}, unusually high vs robot teleop points.` });
  }
  if (auto >= ao.minAutoPoints && teleRobot <= 0 && teleHuman <= 0) {
    out.push({ code: "auto-only-no-teleop", label: ao.label, detail: `Auto points ${auto} but teleop points are 0.` });
  }
  if (auto <= 0 && teleRobot <= 0 && teleHuman <= 0) {
    out.push({ code: "zero-main-scoring", label: C.flags.zeroMainScoring.label, detail: "No scored autonomous/teleop points recorded." });
  }
  return out;
}

export const reefscapePlugin: FullGamePlugin = {
  id: "REEFSCAPE",
  label: C.label,
  season: C.season,
  formId: C.formId,
  // CS quirk: a doc without a `game` field is REEFSCAPE.
  matches: (doc) => {
    const game = normalizeGameName(doc.game);
    return game === "" || game === C.id;
  },
  docToValues: (doc: CsDoc): GameValues => pick(doc),
  valuesToDoc: () => null,
  scoreDoc,
  scoreValues: (values) => scoreDoc(pick(values)),
  defaultValues: () => ({}),
  flags,
  verify: (junior, lead, options) =>
    compareScoutToLead(junior, lead, options?.metrics ?? DEFAULT_VERIFICATION_METRICS, options?.threshold ?? VERIFICATION_THRESHOLD),
  predict: (team, docs, source, tier) => buildTacticalPrediction(team, docs, source, tier, (doc) => scoreDoc(doc).total),
  compareToExemplar: (original, exemplar) => computeRescoutDiff(original, exemplar, C.rescoutFields),
};
