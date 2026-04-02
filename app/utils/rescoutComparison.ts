type ComparableField = {
  key: string;
  label: string;
  original: unknown;
  exemplar: unknown;
  diff: number;
  weight: number;
};

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value === "boolean") return value ? 1 : 0;
  return 0;
}

function pushNumber(fields: ComparableField[], key: string, label: string, original: unknown, exemplar: unknown, weight = 1) {
  const orig = toNumber(original);
  const ex = toNumber(exemplar);
  const denom = Math.max(1, Math.abs(orig));
  const diff = Math.abs(orig - ex) / denom;
  fields.push({ key, label, original: orig, exemplar: ex, diff, weight });
}

function pushBoolean(fields: ComparableField[], key: string, label: string, original: unknown, exemplar: unknown, weight = 1) {
  const orig = Boolean(original);
  const ex = Boolean(exemplar);
  const diff = orig === ex ? 0 : 1;
  fields.push({ key, label, original: orig, exemplar: ex, diff, weight });
}

function pushString(fields: ComparableField[], key: string, label: string, original: unknown, exemplar: unknown, weight = 1) {
  const orig = String(original ?? "").trim();
  const ex = String(exemplar ?? "").trim();
  const diff = orig.toLowerCase() === ex.toLowerCase() ? 0 : 1;
  fields.push({ key, label, original: orig, exemplar: ex, diff, weight });
}

function pushArray(fields: ComparableField[], key: string, label: string, original: unknown, exemplar: unknown, weight = 0.25) {
  const origArray = Array.isArray(original) ? original.map(toNumber) : [];
  const exArray = Array.isArray(exemplar) ? exemplar.map(toNumber) : [];
  const origAvg = origArray.length ? origArray.reduce((sum, v) => sum + v, 0) / origArray.length : 0;
  const exAvg = exArray.length ? exArray.reduce((sum, v) => sum + v, 0) / exArray.length : 0;
  const denom = Math.max(1, Math.abs(origAvg));
  const diff = Math.abs(origAvg - exAvg) / denom;
  fields.push({
    key,
    label,
    original: origArray,
    exemplar: exArray,
    diff,
    weight,
  });
}

export function computeRescoutDiff(original: Record<string, unknown>, exemplar: Record<string, unknown>) {
  const fields: ComparableField[] = [];
  const game = String(original.game || exemplar.game || "").toUpperCase();

  if (game === "REBUILT") {
    pushString(fields, "startingPosition", "Starting Position", original.startingPosition, exemplar.startingPosition, 0.5);
    pushArray(fields, "incidents", "Incidents", original.incidents, exemplar.incidents, 0.5);

    const autoO = (original.auto as Record<string, unknown>) || {};
    const autoE = (exemplar.auto as Record<string, unknown>) || {};
    pushNumber(fields, "auto.preloadScale", "Auto Preload Scale", autoO.preloadScale, autoE.preloadScale);
    pushNumber(fields, "auto.bpsScale", "Auto BPS Scale", autoO.bpsScale, autoE.bpsScale);
    pushNumber(fields, "auto.carryingScale", "Auto Carry Scale", autoO.carryingScale, autoE.carryingScale);
    pushArray(fields, "auto.cycleTimes", "Auto Cycles", autoO.cycleTimes, autoE.cycleTimes, 0.25);
    pushNumber(fields, "auto.counterOverride", "Auto Counter Override", autoO.counterOverride, autoE.counterOverride);
    pushNumber(fields, "auto.counterOverrideMissedFuel", "Auto Missed Fuel", autoO.counterOverrideMissedFuel, autoE.counterOverrideMissedFuel);
    pushNumber(fields, "auto.humanPlayerFuel", "Auto Human Fuel", autoO.humanPlayerFuel, autoE.humanPlayerFuel);
    pushNumber(fields, "auto.failedClimb", "Auto Failed Climb", autoO.failedClimb, autoE.failedClimb);
    pushBoolean(fields, "auto.successfulClimb", "Auto Successful Climb", autoO.successfulClimb, autoE.successfulClimb);
    pushBoolean(fields, "auto.wonAuto", "Won Auto", autoO.wonAuto, autoE.wonAuto);
    pushBoolean(fields, "auto.hubActivationOverride", "Hub Activation Override", autoO.hubActivationOverride, autoE.hubActivationOverride);

    const teleO = (original.teleop as Record<string, unknown>) || {};
    const teleE = (exemplar.teleop as Record<string, unknown>) || {};
    pushNumber(fields, "teleop.bpsScale", "Teleop BPS Scale", teleO.bpsScale, teleE.bpsScale);
    pushNumber(fields, "teleop.carryingScale", "Teleop Carry Scale", teleO.carryingScale, teleE.carryingScale);
    pushArray(fields, "teleop.transitionCycles", "Transition Cycles", teleO.transitionCycles, teleE.transitionCycles, 0.25);
    pushArray(fields, "teleop.shift1Cycles", "Shift 1 Cycles", teleO.shift1Cycles, teleE.shift1Cycles, 0.25);
    pushArray(fields, "teleop.shift2Cycles", "Shift 2 Cycles", teleO.shift2Cycles, teleE.shift2Cycles, 0.25);
    pushArray(fields, "teleop.shift3Cycles", "Shift 3 Cycles", teleO.shift3Cycles, teleE.shift3Cycles, 0.25);
    pushArray(fields, "teleop.shift4Cycles", "Shift 4 Cycles", teleO.shift4Cycles, teleE.shift4Cycles, 0.25);
    pushNumber(fields, "teleop.transitionOverride", "Transition Override", teleO.transitionOverride, teleE.transitionOverride);
    pushNumber(fields, "teleop.transitionMissedFuel", "Transition Missed Fuel", teleO.transitionMissedFuel, teleE.transitionMissedFuel);
    pushNumber(fields, "teleop.shift1Override", "Shift 1 Override", teleO.shift1Override, teleE.shift1Override);
    pushNumber(fields, "teleop.shift1MissedFuel", "Shift 1 Missed Fuel", teleO.shift1MissedFuel, teleE.shift1MissedFuel);
    pushNumber(fields, "teleop.shift2Override", "Shift 2 Override", teleO.shift2Override, teleE.shift2Override);
    pushNumber(fields, "teleop.shift2MissedFuel", "Shift 2 Missed Fuel", teleO.shift2MissedFuel, teleE.shift2MissedFuel);
    pushNumber(fields, "teleop.shift3Override", "Shift 3 Override", teleO.shift3Override, teleE.shift3Override);
    pushNumber(fields, "teleop.shift3MissedFuel", "Shift 3 Missed Fuel", teleO.shift3MissedFuel, teleE.shift3MissedFuel);
    pushNumber(fields, "teleop.shift4Override", "Shift 4 Override", teleO.shift4Override, teleE.shift4Override);
    pushNumber(fields, "teleop.shift4MissedFuel", "Shift 4 Missed Fuel", teleO.shift4MissedFuel, teleE.shift4MissedFuel);
    pushNumber(fields, "teleop.humanPlayerFuel", "Teleop Human Fuel", teleO.humanPlayerFuel, teleE.humanPlayerFuel);

    const endO = (original.endgame as Record<string, unknown>) || {};
    const endE = (exemplar.endgame as Record<string, unknown>) || {};
    pushString(fields, "endgame.status", "Endgame Status", endO.status, endE.status, 0.5);
    pushNumber(fields, "endgame.failedClimb", "Endgame Failed Climb", endO.failedClimb, endE.failedClimb);
    pushArray(fields, "endgame.cycleTimes", "Endgame Cycles", endO.cycleTimes, endE.cycleTimes, 0.25);
    pushNumber(fields, "endgame.counterOverride", "Endgame Override", endO.counterOverride, endE.counterOverride);
    pushNumber(fields, "endgame.counterOverrideMissedFuel", "Endgame Missed Fuel", endO.counterOverrideMissedFuel, endE.counterOverrideMissedFuel);
    pushNumber(fields, "endgame.humanPlayerFuel", "Endgame Human Fuel", endO.humanPlayerFuel, endE.humanPlayerFuel);
  } else {
    pushString(fields, "startingPosition", "Starting Position", original.startingPosition, exemplar.startingPosition, 0.5);
    pushBoolean(fields, "leftStartingZone", "Left Starting Zone", original.leftStartingZone, exemplar.leftStartingZone, 0.5);
    pushNumber(fields, "autoCoralMissed", "Auto Coral Missed", original.autoCoralMissed, exemplar.autoCoralMissed);
    pushNumber(fields, "autoCoralL1", "Auto Coral L1", original.autoCoralL1, exemplar.autoCoralL1);
    pushNumber(fields, "autoCoralL2", "Auto Coral L2", original.autoCoralL2, exemplar.autoCoralL2);
    pushNumber(fields, "autoCoralL3", "Auto Coral L3", original.autoCoralL3, exemplar.autoCoralL3);
    pushNumber(fields, "autoCoralL4", "Auto Coral L4", original.autoCoralL4, exemplar.autoCoralL4);
    pushNumber(fields, "autoAlgaeProcessorMissed", "Auto Processor Missed", original.autoAlgaeProcessorMissed, exemplar.autoAlgaeProcessorMissed);
    pushNumber(fields, "autoAlgaeProcessorScored", "Auto Processor Scored", original.autoAlgaeProcessorScored, exemplar.autoAlgaeProcessorScored);
    pushNumber(fields, "autoAlgaeNetMissed", "Auto Net Missed", original.autoAlgaeNetMissed, exemplar.autoAlgaeNetMissed);
    pushNumber(fields, "autoAlgaeNetScored", "Auto Net Scored", original.autoAlgaeNetScored, exemplar.autoAlgaeNetScored);
    pushNumber(fields, "teleopCoralMissed", "Teleop Coral Missed", original.teleopCoralMissed, exemplar.teleopCoralMissed);
    pushNumber(fields, "teleopCoralL1", "Teleop Coral L1", original.teleopCoralL1, exemplar.teleopCoralL1);
    pushNumber(fields, "teleopCoralL2", "Teleop Coral L2", original.teleopCoralL2, exemplar.teleopCoralL2);
    pushNumber(fields, "teleopCoralL3", "Teleop Coral L3", original.teleopCoralL3, exemplar.teleopCoralL3);
    pushNumber(fields, "teleopCoralL4", "Teleop Coral L4", original.teleopCoralL4, exemplar.teleopCoralL4);
    pushBoolean(fields, "teleopAlgaeRemoved", "Teleop Algae Removed", original.teleopAlgaeRemoved, exemplar.teleopAlgaeRemoved, 0.5);
    pushNumber(fields, "teleopProcessorMissed", "Teleop Processor Missed", original.teleopProcessorMissed, exemplar.teleopProcessorMissed);
    pushNumber(fields, "teleopProcessorScored", "Teleop Processor Scored", original.teleopProcessorScored, exemplar.teleopProcessorScored);
    pushNumber(fields, "teleopNetRobotMissed", "Teleop Net Robot Missed", original.teleopNetRobotMissed, exemplar.teleopNetRobotMissed);
    pushNumber(fields, "teleopNetRobotScored", "Teleop Net Robot Scored", original.teleopNetRobotScored, exemplar.teleopNetRobotScored);
    pushNumber(fields, "teleopNetHumanMissed", "Teleop Net Human Missed", original.teleopNetHumanMissed, exemplar.teleopNetHumanMissed);
    pushNumber(fields, "teleopNetHumanScored", "Teleop Net Human Scored", original.teleopNetHumanScored, exemplar.teleopNetHumanScored);
    pushNumber(fields, "failedClimb", "Failed Climb", original.failedClimb, exemplar.failedClimb);
    pushString(fields, "stageStatus", "Stage Status", original.stageStatus, exemplar.stageStatus, 0.5);
    pushArray(fields, "incidents", "Incidents", original.incidents, exemplar.incidents, 0.5);
  }

  const totalWeight = fields.reduce((sum, f) => sum + f.weight, 0) || 1;
  const weightedDiff = fields.reduce((sum, f) => sum + f.diff * f.weight, 0);
  const diffPercent = Math.round((weightedDiff / totalWeight) * 1000) / 10;

  return { diffPercent, fields };
}

export type { ComparableField };
