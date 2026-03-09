export type ScoutingFlagCode =
  | "human-player-heavy"
  | "auto-only-no-teleop"
  | "zero-main-scoring";

export type ScoutingFlag = {
  code: ScoutingFlagCode;
  label: string;
  detail: string;
};

type AnyEntry = Record<string, unknown> & {
  game?: string;
  auto?: Record<string, unknown>;
  teleop?: Record<string, unknown>;
  endgame?: Record<string, unknown>;
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
  teleopProcessorScored?: number;
  teleopNetRobotScored?: number;
  teleopNetHumanScored?: number;
};

function toNumber(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getEntryGame(entry: AnyEntry): "REEFSCAPE" | "REBUILT" {
  const explicit = String(entry.game || "").trim().toUpperCase();
  if (explicit === "REBUILT") return "REBUILT";
  return "REEFSCAPE";
}

function evaluateRebuiltFlags(entry: AnyEntry): ScoutingFlag[] {
  const autoFuel = toNumber(entry.auto?.estimatedFuel);
  const teleFuel = toNumber(entry.teleop?.estimatedFuel);
  const endgameFuel = toNumber(entry.endgame?.estimatedFuel);
  const humanFuel =
    toNumber(entry.auto?.humanPlayerFuel) +
    toNumber(entry.teleop?.humanPlayerFuel) +
    toNumber(entry.endgame?.humanPlayerFuel);
  const totalFuel = autoFuel + teleFuel + endgameFuel;
  const flags: ScoutingFlag[] = [];

  if (humanFuel >= 15 && (totalFuel <= 0 || humanFuel >= totalFuel * 0.6)) {
    flags.push({
      code: "human-player-heavy",
      label: "High Human Player Share",
      detail: `Human player fuel is ${humanFuel}, unusually high compared to robot fuel.`,
    });
  }
  if (autoFuel >= 20 && teleFuel <= 0) {
    flags.push({
      code: "auto-only-no-teleop",
      label: "Auto Without Teleop Fuel",
      detail: `Auto fuel ${autoFuel} but teleop fuel is 0.`,
    });
  }
  if (totalFuel <= 0 && humanFuel <= 0) {
    flags.push({
      code: "zero-main-scoring",
      label: "Zero Main Scoring",
      detail: "No auto/teleop/endgame fuel recorded.",
    });
  }

  return flags;
}

function evaluateReefscapeFlags(entry: AnyEntry): ScoutingFlag[] {
  const autoPoints =
    toNumber(entry.autoCoralL1) * 3 +
    toNumber(entry.autoCoralL2) * 4 +
    toNumber(entry.autoCoralL3) * 6 +
    toNumber(entry.autoCoralL4) * 7 +
    toNumber(entry.autoAlgaeProcessorScored) * 6 +
    toNumber(entry.autoAlgaeNetScored) * 4;
  const teleRobotPoints =
    toNumber(entry.teleopCoralL1) * 2 +
    toNumber(entry.teleopCoralL2) * 3 +
    toNumber(entry.teleopCoralL3) * 4 +
    toNumber(entry.teleopCoralL4) * 5 +
    toNumber(entry.teleopProcessorScored) * 6 +
    toNumber(entry.teleopNetRobotScored) * 4;
  const teleHumanPoints = toNumber(entry.teleopNetHumanScored) * 4;
  const flags: ScoutingFlag[] = [];

  if (teleHumanPoints >= 20 && (teleRobotPoints <= 0 || teleHumanPoints >= teleRobotPoints * 0.6)) {
    flags.push({
      code: "human-player-heavy",
      label: "High Human Player Share",
      detail: `Human net points are ${teleHumanPoints}, unusually high vs robot teleop points.`,
    });
  }
  if (autoPoints >= 20 && teleRobotPoints <= 0 && teleHumanPoints <= 0) {
    flags.push({
      code: "auto-only-no-teleop",
      label: "Auto Without Teleop Points",
      detail: `Auto points ${autoPoints} but teleop points are 0.`,
    });
  }
  if (autoPoints <= 0 && teleRobotPoints <= 0 && teleHumanPoints <= 0) {
    flags.push({
      code: "zero-main-scoring",
      label: "Zero Main Scoring",
      detail: "No scored autonomous/teleop points recorded.",
    });
  }

  return flags;
}

export function evaluateScoutingFlags(entry: AnyEntry): ScoutingFlag[] {
  return getEntryGame(entry) === "REBUILT" ? evaluateRebuiltFlags(entry) : evaluateReefscapeFlags(entry);
}

export type StoredFlagState = {
  entityType: "scoutingEntry" | "practiceSession";
  entityId: string;
  dismissed: boolean;
  dismissedAt?: number;
  dismissedBy?: string;
};

export function flagStateDocId(entityType: "scoutingEntry" | "practiceSession", entityId: string): string {
  return `${entityType}:${String(entityId || "").trim()}`;
}
