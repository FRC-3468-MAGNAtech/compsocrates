import type { AnalyticsGame } from "@/app/utils/analyticsEvents";

export type RebuiltScoringEntry = {
  auto?: {
    preloadScale?: number;
    bpsScale?: number;
    carryingScale?: number;
    cycleTimes?: number[];
    counterOverride?: number;
    counterOverrideMissedFuel?: number;
    humanPlayerFuel?: number;
    successfulClimb?: boolean;
    wonAuto?: boolean;
  };
  teleop?: {
    bpsScale?: number;
    carryingScale?: number;
    transitionCycles?: number[];
    shift1Cycles?: number[];
    shift2Cycles?: number[];
    shift3Cycles?: number[];
    shift4Cycles?: number[];
    transitionOverride?: number;
    transitionMissedFuel?: number;
    shift1Override?: number;
    shift1MissedFuel?: number;
    shift2Override?: number;
    shift2MissedFuel?: number;
    shift3Override?: number;
    shift3MissedFuel?: number;
    shift4Override?: number;
    shift4MissedFuel?: number;
    humanPlayerFuel?: number;
    shiftParityFromWonAuto?: boolean;
  };
  endgame?: {
    cycleTimes?: number[];
    counterOverride?: number;
    counterOverrideMissedFuel?: number;
    humanPlayerFuel?: number;
    status?: string;
  };
};

export type ReefscapeScoringEntry = {
  leftStartingZone?: boolean;
  autoCoralL1?: number;
  autoCoralL2?: number;
  autoCoralL3?: number;
  autoCoralL4?: number;
  autoAlgaeProcessorScored?: number;
  autoAlgaeNetScored?: number;
  teleopCoralL1?: number;
  teleopCoralL2?: number;
  teleopCoralL3?: number;
  teleopCoralL4?: number;
  teleopAlgaeRemoved?: boolean;
  teleopProcessorScored?: number;
  teleopNetRobotScored?: number;
  teleopNetHumanScored?: number;
  penaltyPoints?: number;
  stageStatus?: string;
};

export type ChargedUpScoringEntry = {
  mobility?: boolean;
  auto?: {
    mobility?: boolean;
    gridBottom?: number;
    gridMiddle?: number;
    gridTop?: number;
    chargeStation?: string;
  };
  teleop?: {
    gridBottom?: number;
    gridMiddle?: number;
    gridTop?: number;
    links?: number;
  };
  endgame?: {
    chargeStation?: string;
  };
  penaltyPoints?: number;
};

export type ScoringEntry = RebuiltScoringEntry & ReefscapeScoringEntry & ChargedUpScoringEntry;

const REBUILT_BPS_VALUES = [0, 2, 5, 8, 12, 16, 20, 23, 25];
const REBUILT_CARRY_VALUES = [0, 12, 23, 32, 42, 53, 64, 74, 75];
const REBUILT_BPS_MAX = REBUILT_BPS_VALUES.length - 1;
const REBUILT_CARRY_MAX = REBUILT_CARRY_VALUES.length - 1;

const PTS = {
  LEAVE: 3,
  AUTO_CORAL_L1: 3,
  AUTO_CORAL_L2: 4,
  AUTO_CORAL_L3: 6,
  AUTO_CORAL_L4: 7,
  AUTO_ALGAE_PROC: 6,
  AUTO_ALGAE_NET: 4,
  TELE_CORAL_L1: 2,
  TELE_CORAL_L2: 3,
  TELE_CORAL_L3: 4,
  TELE_CORAL_L4: 5,
  TELE_ALGAE_PROC: 6,
  TELE_ALGAE_NET_R: 4,
  TELE_ALGAE_NET_H: 4,
  CLIMB_PARK: 2,
  CLIMB_SHALLOW: 6,
  CLIMB_DEEP: 12,
};

function rebuiltFuelFromCycles(cycles: number[] | undefined, bpsScale: number, carryScale: number) {
  if (!Array.isArray(cycles) || cycles.length === 0) return 0;
  const bps = REBUILT_BPS_VALUES[Math.max(0, Math.min(REBUILT_BPS_MAX, Number(bpsScale || 0)))] || 0;
  const carryCap = REBUILT_CARRY_VALUES[Math.max(0, Math.min(REBUILT_CARRY_MAX, Number(carryScale || 0)))] || 0;
  return cycles.reduce((sum, seconds) => {
    const sec = Number(seconds || 0);
    if (!Number.isFinite(sec) || sec <= 0) return sum;
    return sum + Math.max(0, Math.round(Math.min(carryCap, bps * sec)));
  }, 0);
}

function rebuiltAutoFuelFromCycles(cycles: number[] | undefined, preloadScale: number, bpsScale: number, carryScale: number) {
  if (!Array.isArray(cycles) || cycles.length === 0) return 0;
  const preloadCap = [0, 2, 4, 6, 8][Math.max(0, Math.min(4, Number(preloadScale || 0)))] || 0;
  const bps = REBUILT_BPS_VALUES[Math.max(0, Math.min(REBUILT_BPS_MAX, Number(bpsScale || 0)))] || 0;
  const carryCap = REBUILT_CARRY_VALUES[Math.max(0, Math.min(REBUILT_CARRY_MAX, Number(carryScale || 0)))] || 0;
  return cycles.reduce((sum, seconds, index) => {
    const sec = Number(seconds || 0);
    if (!Number.isFinite(sec) || sec <= 0) return sum;
    const capacity = index === 0 && preloadCap > 0 ? preloadCap : carryCap;
    return sum + Math.max(0, Math.round(Math.min(capacity, bps * sec)));
  }, 0);
}

function applyFuelOverride(estimated: number, overrideValue: number | undefined, missedValue: number | undefined) {
  const override = Number(overrideValue || 0);
  if (override > 0) return override;
  const missed = Math.max(0, Number(missedValue || 0));
  return Math.max(0, estimated - missed);
}

export function getRebuiltFuelBreakdown(entry: RebuiltScoringEntry) {
  const autoPreloadScale = Number(entry.auto?.preloadScale || 0);
  const autoBpsScale = Number(entry.auto?.bpsScale || 0);
  const autoCarryScale = Number(entry.auto?.carryingScale || 0);
  const teleBpsScale = Number(entry.teleop?.bpsScale || 0);
  const teleCarryScale = Number(entry.teleop?.carryingScale || 0);

  const autoEstimated = rebuiltAutoFuelFromCycles(entry.auto?.cycleTimes, autoPreloadScale, autoBpsScale, autoCarryScale);
  const transitionEstimated = rebuiltFuelFromCycles(entry.teleop?.transitionCycles, teleBpsScale, teleCarryScale);
  const shift1Estimated = rebuiltFuelFromCycles(entry.teleop?.shift1Cycles, teleBpsScale, teleCarryScale);
  const shift2Estimated = rebuiltFuelFromCycles(entry.teleop?.shift2Cycles, teleBpsScale, teleCarryScale);
  const shift3Estimated = rebuiltFuelFromCycles(entry.teleop?.shift3Cycles, teleBpsScale, teleCarryScale);
  const shift4Estimated = rebuiltFuelFromCycles(entry.teleop?.shift4Cycles, teleBpsScale, teleCarryScale);
  const endgameEstimated = rebuiltFuelFromCycles(entry.endgame?.cycleTimes, teleBpsScale, teleCarryScale);

  const autoSectionFuel = applyFuelOverride(autoEstimated, entry.auto?.counterOverride, entry.auto?.counterOverrideMissedFuel);
  const transitionFuel = applyFuelOverride(transitionEstimated, entry.teleop?.transitionOverride, entry.teleop?.transitionMissedFuel);
  const shift1Fuel = applyFuelOverride(shift1Estimated, entry.teleop?.shift1Override, entry.teleop?.shift1MissedFuel);
  const shift2Fuel = applyFuelOverride(shift2Estimated, entry.teleop?.shift2Override, entry.teleop?.shift2MissedFuel);
  const shift3Fuel = applyFuelOverride(shift3Estimated, entry.teleop?.shift3Override, entry.teleop?.shift3MissedFuel);
  const shift4Fuel = applyFuelOverride(shift4Estimated, entry.teleop?.shift4Override, entry.teleop?.shift4MissedFuel);
  const endgameSectionFuel = applyFuelOverride(endgameEstimated, entry.endgame?.counterOverride, entry.endgame?.counterOverrideMissedFuel);

  const autoHumanFuel = Number(entry.auto?.humanPlayerFuel || 0);
  const teleHumanFuel = Number(entry.teleop?.humanPlayerFuel || 0);
  const endgameHumanFuel = Number(entry.endgame?.humanPlayerFuel || 0);
  const countShiftsTwoFour =
    typeof entry.teleop?.shiftParityFromWonAuto === "boolean"
      ? entry.teleop.shiftParityFromWonAuto
      : Boolean(entry.auto?.wonAuto);

  const autoFuel = autoSectionFuel + autoHumanFuel;
  const teleFuel = transitionFuel + (countShiftsTwoFour ? shift2Fuel + shift4Fuel : shift1Fuel + shift3Fuel) + teleHumanFuel;
  const endgameFuel = endgameSectionFuel + endgameHumanFuel;

  return {
    autoFuel,
    teleFuel,
    endgameFuel,
  };
}

export function scoreRebuiltEntry(entry: RebuiltScoringEntry): number {
  const rebuiltFuel = getRebuiltFuelBreakdown(entry);
  const autoFuel = rebuiltFuel.autoFuel;
  const teleFuel = rebuiltFuel.teleFuel;
  const endgameFuel = rebuiltFuel.endgameFuel;
  const autoClimb = entry.auto?.successfulClimb ? 15 : 0;
  const end = String(entry.endgame?.status || "").toLowerCase();
  const endgameClimb = end === "level-1" ? 10 : end === "level-2" ? 20 : end === "level-3" ? 30 : 0;
  return autoFuel + teleFuel + endgameFuel + autoClimb + endgameClimb;
}

function chargedAutoStationPoints(value: unknown) {
  const status = String(value || "").trim().toLowerCase();
  if (status === "engaged") return 12;
  if (status === "docked") return 8;
  return 0;
}

function chargedEndgameStationPoints(value: unknown) {
  const status = String(value || "").trim().toLowerCase();
  if (status === "engaged") return 10;
  if (status === "docked") return 6;
  if (status === "parked") return 2;
  return 0;
}

export function scoreChargedUpEntry(entry: ChargedUpScoringEntry): number {
  const autoScore =
    (Boolean(entry.auto?.mobility ?? entry.mobility) ? 3 : 0) +
    Number(entry.auto?.gridBottom || 0) * 3 +
    Number(entry.auto?.gridMiddle || 0) * 4 +
    Number(entry.auto?.gridTop || 0) * 6 +
    chargedAutoStationPoints(entry.auto?.chargeStation);
  const teleopScore =
    Number(entry.teleop?.gridBottom || 0) * 2 +
    Number(entry.teleop?.gridMiddle || 0) * 3 +
    Number(entry.teleop?.gridTop || 0) * 5 +
    Number(entry.teleop?.links || 0) * 5;
  const endgameScore = chargedEndgameStationPoints(entry.endgame?.chargeStation);
  return autoScore + teleopScore + endgameScore;
}

export function scoreEntryForGame(entry: ScoringEntry, game: AnalyticsGame): number {
  if (game === "CHARGED_UP") return scoreChargedUpEntry(entry) + Number(entry.penaltyPoints || 0);
  if (game === "REBUILT") return scoreRebuiltEntry(entry);

  let total = 0;
  if (entry.leftStartingZone) total += PTS.LEAVE;
  total += (entry.autoCoralL1 || 0) * PTS.AUTO_CORAL_L1;
  total += (entry.autoCoralL2 || 0) * PTS.AUTO_CORAL_L2;
  total += (entry.autoCoralL3 || 0) * PTS.AUTO_CORAL_L3;
  total += (entry.autoCoralL4 || 0) * PTS.AUTO_CORAL_L4;
  total += (entry.autoAlgaeProcessorScored || 0) * PTS.AUTO_ALGAE_PROC;
  total += (entry.autoAlgaeNetScored || 0) * PTS.AUTO_ALGAE_NET;
  total += (entry.teleopCoralL1 || 0) * PTS.TELE_CORAL_L1;
  total += (entry.teleopCoralL2 || 0) * PTS.TELE_CORAL_L2;
  total += (entry.teleopCoralL3 || 0) * PTS.TELE_CORAL_L3;
  total += (entry.teleopCoralL4 || 0) * PTS.TELE_CORAL_L4;
  total += (entry.teleopProcessorScored || 0) * PTS.TELE_ALGAE_PROC;
  total += (entry.teleopNetRobotScored || 0) * PTS.TELE_ALGAE_NET_R;
  total += (entry.teleopNetHumanScored || 0) * PTS.TELE_ALGAE_NET_H;
  total += Number(entry.penaltyPoints || 0);
  const end = String(entry.stageStatus || "").toLowerCase();
  if (end.includes("deep")) total += PTS.CLIMB_DEEP;
  else if (end.includes("shallow")) total += PTS.CLIMB_SHALLOW;
  else if (end.includes("park") || end.includes("barge")) total += PTS.CLIMB_PARK;
  return total;
}
