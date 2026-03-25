"use client";
export const dynamic = "force-dynamic";

import { useEffect, useMemo, useRef, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "@/app/firebase";
import { useAuth } from "@/app/AuthContext";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import AnalyticsShell from "@/app/components/AnalyticsShell";
import {
  entryMatchesAnalyticsFilters,
  getExplicitMatchTypeFromLabel,
  getEventOptionsForEntries,
  getEventsForGame,
  isPracticeScoutedEntry,
  normalizeMatchLabel,
  type AnalyticsEventOption,
  type AnalyticsGame,
} from "@/app/utils/analyticsEvents";
import { getTeamEventOptions } from "@/app/utils/eventDetection";
import { compareMatchLabels, compareSortValues, sortLabel, type SortDir } from "@/app/utils/sortHelpers";
import { evaluateScoutingFlags, flagStateDocId, type StoredFlagState } from "@/app/utils/scoutingFlags";
import { getUserRoles } from "@/app/utils/roles";
import ExpandableNotesCell from "@/app/components/ExpandableNotesCell";

type Entry = {
  id: string;
  matchKey?: string;
  matchNumber?: string;
  matchType?: "qualification" | "practice" | "finals";
  matchId?: string;
  scoutId?: string;
  practiceMode?: "trial" | "competitive";
  isPracticeScouting?: boolean;
  deviceType?: "mobile" | "pc";
  practiceSessionId?: string;
  eventKey?: string;
  eventName?: string;
  game?: string;
  penaltyPoints?: number;
  alliance?: string;
  allianceColor?: string;
  assignedAlliance?: string;
  officialScore?: number;
  actualScore?: number;
  teamNumber: string;
  scoutName: string;
  startingPosition: string;
  leftStartingZone: boolean;
  submittedAt?: number;
  autoCoralMissed: number;
  autoCoralL1: number;
  autoCoralL2: number;
  autoCoralL3: number;
  autoCoralL4: number;
  autoAlgaeProcessorMissed: number;
  autoAlgaeProcessorScored: number;
  autoAlgaeNetMissed: number;
  autoAlgaeNetScored: number;
  teleopCoralMissed: number;
  teleopCoralL1: number;
  teleopCoralL2: number;
  teleopCoralL3: number;
  teleopCoralL4: number;
  teleopAlgaeRemoved: boolean;
  teleopProcessorMissed: number;
  teleopProcessorScored: number;
  teleopNetRobotMissed: number;
  teleopNetRobotScored: number;
  teleopNetHumanMissed: number;
  teleopNetHumanScored: number;
  failedClimb: number;
  stageStatus: string;
  incidents: string[];
  notes: string;
  timestamp: number;
  estimatedScore?: number;
  excludeFromStats?: boolean;
  accuracy?: number;
  accuracyScriptStatus?: string;
  accuracyDetails?: AccuracyDetails;
  accuracyRobotBreakdown?: AccuracyRobotBreakdown[];
  accuracyUpdatedAt?: number;
  auto?: {
    preloadScale?: number;
    bpsScale?: number;
    carryingScale?: number;
    failedClimb?: number;
    cycleTimes?: number[];
    estimatedFuel?: number;
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
    estimatedFuel?: number;
  };
  endgame?: {
    cycleTimes?: number[];
    counterOverride?: number;
    counterOverrideMissedFuel?: number;
    humanPlayerFuel?: number;
    estimatedFuel?: number;
    failedClimb?: number;
    status?: string;
  };
};

const INCIDENT_LABELS: Record<string, string> = {
  died: "Died During Match",
  "never-started": "Never Started Match",
  disabled: "Disabled by FRC",
  recovered: "Recovered from Freeze",
  tipped: "Tipped Over",
  "yellow-card": "Yellow Card",
  "red-card": "Red Card",
};

const MANUAL_FLAG_REASONS = [
  { value: "no-teleop-score", label: "No teleop score" },
  { value: "excessive-auto-score", label: "Excessive auto score" },
  { value: "excessive-human-player-score", label: "Excessive human player score" },
  { value: "other", label: "Other / coach review" },
];

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

function scoreRebuiltEntry(e: Entry) {
  const rebuiltFuel = getRebuiltFuelBreakdown(e);
  const autoFuel = rebuiltFuel.autoFuel;
  const teleFuel = rebuiltFuel.teleFuel;
  const endgameFuel = rebuiltFuel.endgameFuel;
  const autoClimb = e.auto?.successfulClimb ? 15 : 0;
  const end = String(e.endgame?.status || "").toLowerCase();
  const endgameClimb = end === "level-1" ? 10 : end === "level-2" ? 20 : end === "level-3" ? 30 : 0;
  return autoFuel + teleFuel + endgameFuel + autoClimb + endgameClimb;
}

function scoreEntry(e: Entry, game: AnalyticsGame) {
  if (game === "REBUILT") return scoreRebuiltEntry(e);

  let s = 0;
  if (e.leftStartingZone) s += PTS.LEAVE;
  s += e.autoCoralL1 * PTS.AUTO_CORAL_L1;
  s += e.autoCoralL2 * PTS.AUTO_CORAL_L2;
  s += e.autoCoralL3 * PTS.AUTO_CORAL_L3;
  s += e.autoCoralL4 * PTS.AUTO_CORAL_L4;
  s += e.autoAlgaeProcessorScored * PTS.AUTO_ALGAE_PROC;
  s += e.autoAlgaeNetScored * PTS.AUTO_ALGAE_NET;
  s += e.teleopCoralL1 * PTS.TELE_CORAL_L1;
  s += e.teleopCoralL2 * PTS.TELE_CORAL_L2;
  s += e.teleopCoralL3 * PTS.TELE_CORAL_L3;
  s += e.teleopCoralL4 * PTS.TELE_CORAL_L4;
  s += e.teleopProcessorScored * PTS.TELE_ALGAE_PROC;
  s += e.teleopNetRobotScored * PTS.TELE_ALGAE_NET_R;
  s += e.teleopNetHumanScored * PTS.TELE_ALGAE_NET_H;
  s += Number(e.penaltyPoints || 0);
  const end = e.stageStatus.toLowerCase();
  if (end.includes("deep")) s += PTS.CLIMB_DEEP;
  else if (end.includes("shallow")) s += PTS.CLIMB_SHALLOW;
  else if (end.includes("park") || end.includes("barge")) s += PTS.CLIMB_PARK;
  return s;
}

function scoreEntryBase(e: Entry, game: AnalyticsGame) {
  if (game === "REBUILT") return scoreRebuiltEntry(e);

  let s = 0;
  if (e.leftStartingZone) s += PTS.LEAVE;
  s += e.autoCoralL1 * PTS.AUTO_CORAL_L1;
  s += e.autoCoralL2 * PTS.AUTO_CORAL_L2;
  s += e.autoCoralL3 * PTS.AUTO_CORAL_L3;
  s += e.autoCoralL4 * PTS.AUTO_CORAL_L4;
  s += e.autoAlgaeProcessorScored * PTS.AUTO_ALGAE_PROC;
  s += e.autoAlgaeNetScored * PTS.AUTO_ALGAE_NET;
  s += e.teleopCoralL1 * PTS.TELE_CORAL_L1;
  s += e.teleopCoralL2 * PTS.TELE_CORAL_L2;
  s += e.teleopCoralL3 * PTS.TELE_CORAL_L3;
  s += e.teleopCoralL4 * PTS.TELE_CORAL_L4;
  s += e.teleopProcessorScored * PTS.TELE_ALGAE_PROC;
  s += e.teleopNetRobotScored * PTS.TELE_ALGAE_NET_R;
  s += e.teleopNetHumanScored * PTS.TELE_ALGAE_NET_H;
  const end = e.stageStatus.toLowerCase();
  if (end.includes("deep")) s += PTS.CLIMB_DEEP;
  else if (end.includes("shallow")) s += PTS.CLIMB_SHALLOW;
  else if (end.includes("park") || end.includes("barge")) s += PTS.CLIMB_PARK;
  return s;
}

function matchLabel(entry: Entry) {
  function remapLegacyFinalLabel(rawLabel: string) {
    const parsed = String(rawLabel || "").trim().toUpperCase().match(/^F(\d+)$/);
    if (!parsed) return rawLabel;
    const number = Number(parsed[1] || 0);
    if (number >= 1 && number <= 13) return `SF${number}`;
    if (number >= 14 && number <= 16) return `F${number - 13}`;
    return rawLabel;
  }

  const num = entry.matchNumber || "-";
  const matchId = String(entry.matchId || "").trim();
  const matchIdMatch = matchId.match(/^(qf|sf|f)(\d+)(?:m(\d+))?$/i);
  if (matchIdMatch) {
    const prefix = matchIdMatch[1].toUpperCase();
    const setNumber = Number(matchIdMatch[2] || 0);
    const matchNumber = Number(matchIdMatch[3] || 0);
    if (prefix === "QF" || prefix === "SF") {
      return `${prefix}${setNumber || "-"}`;
    }
    if (prefix === "F") {
      return remapLegacyFinalLabel(`F${matchNumber || setNumber || "-"}`);
    }
  }
  if (entry.matchType === "practice") return `P${num}`;
  if (entry.matchType === "qualification") return `Q${num}`;
  if (entry.matchType === "finals") return remapLegacyFinalLabel(`F${num}`);
  return num;
}

function isPracticeScoutingEntry(entry: Entry) {
  return isPracticeScoutedEntry(entry);
}

type MatchIdentity = {
  compLevel: "qm" | "qf" | "sf" | "f";
  setNumber: number | null;
  matchNumber: number;
};

type TbaMatchRow = {
  key?: string;
  comp_level?: string;
  set_number?: number;
  match_number?: number;
  alliances?: {
    red?: { team_keys?: string[]; score?: number };
    blue?: { team_keys?: string[]; score?: number };
  };
  score_breakdown?: {
    red?: { foulPoints?: number };
    blue?: { foulPoints?: number };
  };
};

const REBUILT_PRELOAD_RANGES = ["0", "1-2", "3-4", "5-6", "7-8"];
const REBUILT_BPS_RANGES = ["0", "1-3", "4-6", "7-9", "10-13", "14-17", "18-21", "22-24", "25+"];
const REBUILT_CARRY_RANGES = ["0", "1-12", "13-23", "23-32", "33-42", "43-53", "54-64", "65-74", "75+"];
const REBUILT_BPS_VALUES = [0, 2, 5, 8, 12, 16, 20, 23, 25];
const REBUILT_CARRY_VALUES = [0, 12, 23, 32, 42, 53, 64, 74, 75];
const REBUILT_BPS_MAX = REBUILT_BPS_RANGES.length - 1;
const REBUILT_CARRY_MAX = REBUILT_CARRY_RANGES.length - 1;

function rebuiltPreloadRange(scale?: number) {
  const idx = Math.max(0, Math.min(REBUILT_BPS_MAX, Number(scale ?? 0)));
  return REBUILT_PRELOAD_RANGES[idx];
}

function rebuiltBpsRange(scale?: number) {
  const idx = Math.max(0, Math.min(4, Number(scale ?? 0)));
  return REBUILT_BPS_RANGES[idx];
}

function rebuiltCarryRange(scale?: number) {
  const idx = Math.max(0, Math.min(REBUILT_CARRY_MAX, Number(scale ?? 0)));
  return REBUILT_CARRY_RANGES[idx];
}

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

function formatCyclesCell(cycles: number[] | undefined) {
  return Array.isArray(cycles) && cycles.length > 0 ? cycles.map((v) => Number(v).toFixed(2)).join(", ") : "-";
}

function inferAllianceColor(entry: Entry): "red" | "blue" | null {
  const raw = String(entry.allianceColor || entry.assignedAlliance || entry.alliance || "")
    .trim()
    .toLowerCase();
  if (raw.includes("red")) return "red";
  if (raw.includes("blue")) return "blue";
  return null;
}

function parseMatchIdentity(entry: Pick<Entry, "matchId" | "matchType" | "matchNumber">): MatchIdentity | null {
  const matchId = String(entry.matchId || "").trim().toLowerCase();
  const rawType = String(entry.matchType || "").trim().toLowerCase();
  const matchNumberFallback = Number(String(entry.matchNumber || "").replace(/\D/g, ""));

  const qmLike = matchId.match(/^(?:q|qm|p)(\d+)$/);
  if (qmLike) {
    return { compLevel: "qm", setNumber: null, matchNumber: Number(qmLike[1]) };
  }

  const playoff = matchId.match(/^(qf|sf|f)(\d+)(?:m(\d+))?$/);
  if (playoff) {
    const compLevel = playoff[1] as "qf" | "sf" | "f";
    const first = Number(playoff[2]);
    const second = playoff[3] ? Number(playoff[3]) : null;
    if (compLevel === "f") {
      return {
        compLevel,
        setNumber: second === null ? null : first,
        matchNumber: second === null ? first : second,
      };
    }
    if (second === null) {
      return { compLevel, setNumber: first, matchNumber: 1 };
    }
    return {
      compLevel,
      setNumber: first,
      matchNumber: second,
    };
  }

  if (matchNumberFallback > 0) {
    if (rawType === "qualification" || rawType === "practice") {
      return { compLevel: "qm", setNumber: null, matchNumber: matchNumberFallback };
    }
    if (rawType === "finals") {
      return { compLevel: "f", setNumber: null, matchNumber: matchNumberFallback };
    }
  }

  return null;
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

function applyFuelOverride(
  estimated: number,
  overrideValue: number | undefined,
  missedValue: number | undefined
) {
  const override = Number(overrideValue || 0);
  if (override > 0) return override;
  const missed = Math.max(0, Number(missedValue || 0));
  return Math.max(0, estimated - missed);
}

function getRebuiltFuelBreakdown(entry: Entry) {
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
  const autoSectionEstimated = Number(entry.auto?.counterOverride || 0) <= 0 && autoEstimated > 0;
  const transitionEstimatedUsed = Number(entry.teleop?.transitionOverride || 0) <= 0 && transitionEstimated > 0;
  const shift1EstimatedUsed = Number(entry.teleop?.shift1Override || 0) <= 0 && shift1Estimated > 0;
  const shift2EstimatedUsed = Number(entry.teleop?.shift2Override || 0) <= 0 && shift2Estimated > 0;
  const shift3EstimatedUsed = Number(entry.teleop?.shift3Override || 0) <= 0 && shift3Estimated > 0;
  const shift4EstimatedUsed = Number(entry.teleop?.shift4Override || 0) <= 0 && shift4Estimated > 0;
  const endgameSectionEstimated = Number(entry.endgame?.counterOverride || 0) <= 0 && endgameEstimated > 0;

  const autoHumanFuel = Number(entry.auto?.humanPlayerFuel || 0);
  const teleHumanFuel = Number(entry.teleop?.humanPlayerFuel || 0);
  const endgameHumanFuel = Number(entry.endgame?.humanPlayerFuel || 0);
  const countShiftsTwoFour =
    typeof entry.teleop?.shiftParityFromWonAuto === "boolean"
      ? entry.teleop.shiftParityFromWonAuto
      : Boolean(entry.auto?.wonAuto);

  const autoFuel = autoSectionFuel + autoHumanFuel;
  const teleFuel = transitionFuel + (countShiftsTwoFour ? shift2Fuel + shift4Fuel : shift1Fuel + shift3Fuel) + teleHumanFuel;
  const teleEstimatedUsed = countShiftsTwoFour
    ? transitionEstimatedUsed || shift2EstimatedUsed || shift4EstimatedUsed
    : transitionEstimatedUsed || shift1EstimatedUsed || shift3EstimatedUsed;
  const endgameFuel = endgameSectionFuel + endgameHumanFuel;

  return {
    autoFuel,
    autoSectionEstimated,
    autoHumanFuel,
    transitionFuel,
    transitionEstimatedUsed,
    shift1Fuel,
    shift1EstimatedUsed,
    shift2Fuel,
    shift2EstimatedUsed,
    shift3Fuel,
    shift3EstimatedUsed,
    shift4Fuel,
    shift4EstimatedUsed,
    teleHumanFuel,
    teleFuel,
    teleEstimatedUsed,
    endgameSectionFuel,
    endgameSectionEstimated,
    endgameHumanFuel,
    endgameFuel,
  };
}

function formatFuelValue(value: number, isEstimated: boolean) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  return isEstimated ? `~${value}` : String(value);
}

function normalizePracticeSessionMatchType(rawType: unknown, rawMatchKey: unknown): "practice" | "qualification" | "finals" {
  const matchKey = String(rawMatchKey || "").trim().toLowerCase();
  if (/_qm\d+/.test(matchKey)) return "qualification";
  if (/_qf\d+m\d+/.test(matchKey) || /_sf\d+m\d+/.test(matchKey) || /_f\d+m\d+/.test(matchKey)) return "finals";

  const type = String(rawType || "").trim().toLowerCase();
  if (type === "practice") return "practice";
  if (type === "qualification") return "qualification";
  if (type === "playoff" || type === "finals") return "finals";
  return "qualification";
}

function matchIdentityEquals(a: MatchIdentity, b: MatchIdentity): boolean {
  if (a.compLevel !== b.compLevel) return false;
  if (a.matchNumber !== b.matchNumber) return false;
  if (a.setNumber === null || b.setNumber === null) return true;
  return a.setNumber === b.setNumber;
}

function parseMatchIdentityFromLabel(label: string): MatchIdentity | null {
  const normalized = normalizeMatchLabel(label);
  return parseMatchIdentity({
    matchId: normalized.matchId,
    matchType: normalized.matchType,
    matchNumber: normalized.matchNumber,
  });
}

function tbaMatchLabel(row: TbaMatchRow): string {
  const level = String(row.comp_level || "").toLowerCase();
  const matchNumber = Number(row.match_number || 0);
  if (level === "f") return `F${matchNumber || "-"}`;
  if (level === "qm") return `Q${matchNumber || "-"}`;
  if (level === "sf") return `SF${Number(row.set_number || 0) || "-"}`;
  if (level === "qf") return `QF${Number(row.set_number || 0) || "-"}`;
  return `M${matchNumber || "-"}`;
}

function chooseLatestEntryPerTeam(entries: Entry[]): Entry[] {
  const byTeam = new Map<string, Entry>();
  entries.forEach((entry) => {
    const team = String(entry.teamNumber || "").trim();
    if (!team) return;
    const prev = byTeam.get(team);
    const prevTime = Number(prev?.submittedAt || prev?.timestamp || 0);
    const currentTime = Number(entry.submittedAt || entry.timestamp || 0);
    if (!prev || currentTime >= prevTime) {
      byTeam.set(team, entry);
    }
  });
  return Array.from(byTeam.values());
}

type AccuracyDetails = {
  scoutedPoints: number;
  actualPoints: number | null;
  penaltyPoints: number;
  allRobotsScouted: "yes" | "no" | "unknown";
  eventKeyUsed: string;
  matchLabelUsed: string;
};

type AccuracyRobotBreakdown = {
  teamNumber: string;
  total: number;
  source: "computed" | "reefscape";
  autoFuel: number;
  teleFuel: number;
  autoClimb: number;
  endgameClimb: number;
};

function getRebuiltBreakdown(entry: Entry): AccuracyRobotBreakdown {
  const teamNumber = String(entry.teamNumber || "-").trim() || "-";
  const fuel = getRebuiltFuelBreakdown(entry);
  const autoFuel = fuel.autoFuel;
  const teleFuel = fuel.teleFuel + fuel.endgameFuel;
  const autoClimb = entry.auto?.successfulClimb ? 15 : 0;
  const end = String(entry.endgame?.status || "").toLowerCase();
  const endgameClimb = end === "level-1" ? 10 : end === "level-2" ? 20 : end === "level-3" ? 30 : 0;
  return {
    teamNumber,
    total: autoFuel + teleFuel + autoClimb + endgameClimb,
    source: "computed",
    autoFuel,
    teleFuel,
    autoClimb,
    endgameClimb,
  };
}

function displayEntryText(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "0" || raw.toLowerCase() === "n/a" || raw.toLowerCase() === "unknown") return "-";
  return raw;
}

function toDisplayTitle(value: unknown) {
  const raw = displayEntryText(value);
  if (raw === "-") return raw;
  return raw
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function formatScriptStatus(value: unknown) {
  const cleaned = String(value || "").trim().toLowerCase();
  if (!cleaned) return "-";
  if (cleaned === "complete") return "Complete";
  if (cleaned === "missing robots") return "Needs Robots";
  return cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  values.push(current);
  return values.map((value) => value.trim());
}

function splitCsvRecords(text: string): string[] {
  const records: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '""';
        i += 1;
      } else {
        inQuotes = !inQuotes;
        current += ch;
      }
      continue;
    }
    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (current.trim()) records.push(current);
      current = "";
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      continue;
    }
    current += ch;
  }

  if (current.trim()) records.push(current);
  return records;
}

function normalizeHeader(header: string) {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseAccuracyPercent(value: string): number | undefined {
  const raw = String(value || "").trim();
  if (!raw) return undefined;
  const direct = Number(raw);
  if (Number.isFinite(direct)) return Math.round(direct);
  const percentMatch = raw.match(/(\d+(?:\.\d+)?)\s*%/);
  if (percentMatch) return Math.round(Number(percentMatch[1]));
  const fallback = raw.match(/(\d+(?:\.\d+)?)/);
  if (fallback) return Math.round(Number(fallback[1]));
  return undefined;
}

type SortKey =
  | keyof Entry
  | "score"
  | "matchLabel"
  | "accuracy"
  | "scriptStatus"
  | "autoPreloadScale"
  | "autoBpsScale"
  | "autoCarryScale"
  | "autoFuel"
  | "autoHumanFuel"
  | "autoClimb"
  | "autoCycles"
  | "teleBpsScale"
  | "teleCarryScale"
  | "transitionFuel"
  | "shift1Fuel"
  | "shift2Fuel"
  | "shift3Fuel"
  | "shift4Fuel"
  | "teleHumanFuel"
  | "teleFuel"
  | "transitionCycles"
  | "shift1Cycles"
  | "shift2Cycles"
  | "shift3Cycles"
  | "shift4Cycles"
  | "endPlace"
  | "endgameFuel"
  | "endgameHumanFuel"
  | "endgameClimb"
  | "endgameCycles"
  | "totalUsed";

function AnalyticsPageContent() {
  const { userData } = useAuth();
  const userRoles = getUserRoles({ role: userData?.role, roles: userData?.roles });
  const isCoach = userData?.role === "coach";
  const isTeamCoach = String(userData?.role || "").toLowerCase() === "team-coach";
  const isTeamAdmin = Boolean(userData?.isTeamAdmin);
  const isTeamMember = Boolean(userData?.teamId);
  const isLeadStrategist = userRoles.includes("lead-strategist");
  const canImportCsv = isCoach || isTeamAdmin || isLeadStrategist;
  const canExportCsv = isTeamMember;
  const csvDisabledReason = "Temporarily disabled due to bugs.";
  const canDeleteEntries = isCoach || isTeamAdmin || isLeadStrategist;
  const canManageFlags = isCoach || isTeamCoach || isTeamAdmin || isLeadStrategist;
  const canViewAdminColumns = isCoach || isTeamCoach || isTeamAdmin || isLeadStrategist;
  const [rawData, setRawData] = useState<Entry[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("matchLabel");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selectedGame, setSelectedGame] = useState<AnalyticsGame>(() => {
    if (typeof window === "undefined") return "REEFSCAPE";
    const saved = localStorage.getItem("analytics-selected-game");
    return saved === "REEFSCAPE" || saved === "REBUILT" ? saved : "REEFSCAPE";
  });
  const [selectedEvent, setSelectedEvent] = useState(() => {
    if (typeof window === "undefined") return "all";
    return localStorage.getItem("analytics-selected-event") || "all";
  });
  const [practiceMatchesOnly, setPracticeMatchesOnly] = useState(false);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importMatchMode, setImportMatchMode] = useState<"official" | "practice-scouted">("official");
  const [importing, setImporting] = useState(false);
  const [importGame, setImportGame] = useState<AnalyticsGame>(() => {
    if (typeof window === "undefined") return "REEFSCAPE";
    const saved = localStorage.getItem("analytics-selected-game");
    return saved === "REEFSCAPE" || saved === "REBUILT" ? saved : "REEFSCAPE";
  });
  const [importEvent, setImportEvent] = useState("app-testing");
  const [selectedAccuracyEntry, setSelectedAccuracyEntry] = useState<Entry | null>(null);
  const [accuracyModalLoading, setAccuracyModalLoading] = useState(false);
  const [accuracyDetails, setAccuracyDetails] = useState<AccuracyDetails>({
    scoutedPoints: 0,
    actualPoints: null,
    penaltyPoints: 0,
    allRobotsScouted: "unknown",
    eventKeyUsed: "",
    matchLabelUsed: "",
  });
  const [accuracyRobotBreakdown, setAccuracyRobotBreakdown] = useState<AccuracyRobotBreakdown[]>([]);
  const [detectedEventOptions, setDetectedEventOptions] = useState<AnalyticsEventOption[]>([]);
  const [tbaAuth, setTbaAuth] = useState<{ encryptedKey: string; plainKey: string }>({ encryptedKey: "", plainKey: "" });
  const [tbaMatchesByEvent, setTbaMatchesByEvent] = useState<Record<string, TbaMatchRow[]>>({});
  const [flagStates, setFlagStates] = useState<Record<string, StoredFlagState>>({});
  const [flagSavingKey, setFlagSavingKey] = useState("");
  const [flagMenuEntry, setFlagMenuEntry] = useState<Entry | null>(null);
  const [excludeSavingId, setExcludeSavingId] = useState("");
  const [manualFlagReason, setManualFlagReason] = useState<string>(MANUAL_FLAG_REASONS[0].value);
  const deleteGuardRef = useRef<string | null>(null);
  const accuracyPersistedRef = useRef<Set<string>>(new Set());

  const rebuiltEventOptions = useMemo(
    () =>
      detectedEventOptions.map((event) => ({
        id: String(event.id || event.key || "").trim(),
        key: event.key,
        name: event.name,
        startDate: event.startDate,
        endDate: event.endDate,
      })).filter((event) => Boolean(event.id)),
    [detectedEventOptions]
  );

  const eventOptions = useMemo(
    () => [
      { id: "all", name: "All Events" },
      ...getEventOptionsForEntries(rawData, selectedGame, selectedGame === "REBUILT" ? rebuiltEventOptions : []),
    ],
    [rawData, selectedGame, rebuiltEventOptions]
  );
  const importEventOptions = useMemo(() => {
    if (importGame !== "REBUILT") return getEventsForGame(importGame);
    return getEventOptionsForEntries([], importGame, rebuiltEventOptions);
  }, [importGame, rebuiltEventOptions]);

  useEffect(() => {
    const savedPractice = localStorage.getItem("analytics-practice-matches-only");
    if (savedPractice !== null) {
      setPracticeMatchesOnly(savedPractice === "true");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadDetectedEvents() {
      if (!userData?.teamId) {
        if (!cancelled) setDetectedEventOptions([]);
        return;
      }
      try {
        const teamEvents = await getTeamEventOptions(userData.teamId);
        if (cancelled) return;
        setDetectedEventOptions(
          teamEvents.map((event) => ({
            id: event.key,
            key: event.key,
            name: event.name,
            startDate: event.startDate,
            endDate: event.endDate,
          }))
        );
      } catch (error) {
        console.error("Failed to load team event options:", error);
        if (!cancelled) setDetectedEventOptions([]);
      }
    }
    void loadDetectedEvents();
    return () => {
      cancelled = true;
    };
  }, [userData?.teamId]);

  useEffect(() => {
    let cancelled = false;
    async function loadTeamTbaAuth() {
      if (!userData?.teamId) {
        if (!cancelled) setTbaAuth({ encryptedKey: "", plainKey: "" });
        return;
      }
      try {
        const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
        if (cancelled) return;
        setTbaAuth({
          encryptedKey: String(teamDoc.data()?.tbaApiKeyEncrypted || "").trim(),
          plainKey: String(teamDoc.data()?.tbaApiKey || "").trim(),
        });
      } catch (error) {
        console.warn("Failed loading team TBA auth for analytics:", error);
        if (!cancelled) setTbaAuth({ encryptedKey: "", plainKey: "" });
      }
    }
    void loadTeamTbaAuth();
    return () => {
      cancelled = true;
    };
  }, [userData?.teamId]);

  useEffect(() => {
    localStorage.setItem("analytics-selected-game", selectedGame);
    localStorage.setItem("analytics-selected-event", selectedEvent);
    localStorage.setItem("analytics-practice-matches-only", String(practiceMatchesOnly));
  }, [selectedGame, selectedEvent, practiceMatchesOnly]);

  useEffect(() => {
    if (!flagMenuEntry) return;
    const stateId = flagStateDocId("scoutingEntry", flagMenuEntry.id);
    const savedReason = flagStates[stateId]?.manualReason;
    if (savedReason) {
      setManualFlagReason(savedReason);
    } else {
      setManualFlagReason(MANUAL_FLAG_REASONS[0].value);
    }
  }, [flagMenuEntry, flagStates]);

  useEffect(() => {
    const validEvents = new Set(eventOptions.map((option) => option.id));
    if (!validEvents.has(selectedEvent)) {
      setSelectedEvent("all");
    }
  }, [eventOptions, selectedEvent]);

  function handleGameChange(nextGame: AnalyticsGame) {
    const validEvents =
      nextGame === "REBUILT"
        ? getEventOptionsForEntries(rawData, nextGame, rebuiltEventOptions).map((event) => event.id)
        : getEventsForGame(nextGame).map((event) => event.id);
    setSelectedGame(nextGame);
    setImportGame(nextGame);
    if (selectedEvent !== "all" && !validEvents.includes(selectedEvent)) {
      setSelectedEvent("all");
    }
  }

  async function loadData() {
    const snapshot = await getDocs(collection(db, "scouting"));
    const entries = snapshot.docs.map((entryDoc) => ({ id: entryDoc.id, ...entryDoc.data() })) as Entry[];
    const practiceSessionIds = Array.from(
      new Set(
        entries
          .map((entry) => String(entry.practiceSessionId || "").trim())
          .filter(Boolean)
      )
    );

    const sessionMetaById = new Map<string, { matchType: "practice" | "qualification" | "finals"; matchNumber?: number; matchKey?: string }>();
    await Promise.all(
      practiceSessionIds.map(async (sessionId) => {
        try {
          const sessionSnap = await getDoc(doc(db, "practiceSessions", sessionId));
          if (!sessionSnap.exists()) return;
          const session = sessionSnap.data() as Record<string, unknown>;
          sessionMetaById.set(sessionId, {
            matchType: normalizePracticeSessionMatchType(session.matchType, session.matchKey),
            matchNumber: typeof session.matchNumber === "number" ? session.matchNumber : undefined,
            matchKey: String(session.matchKey || "").trim() || undefined,
          });
        } catch {
          // Best-effort enrichment only.
        }
      })
    );

    const enriched = entries.map((entry) => {
      const sessionId = String(entry.practiceSessionId || "").trim();
      const sessionMeta = sessionMetaById.get(sessionId);
      if (!sessionMeta) return entry;

      const fallbackNumber = Number(entry.matchNumber || sessionMeta.matchNumber || 0) || sessionMeta.matchNumber || 0;
      const prefix = sessionMeta.matchType === "practice" ? "p" : sessionMeta.matchType === "finals" ? "f" : "q";
      const next: Entry = { ...entry };

      if (
        sessionMeta.matchType !== "qualification" &&
        (!entry.matchType || String(entry.matchType).toLowerCase() === "qualification")
      ) {
        next.matchType = sessionMeta.matchType;
      }
      if (fallbackNumber > 0 && (!entry.matchNumber || String(entry.matchNumber).trim() === "")) {
        next.matchNumber = String(fallbackNumber);
      }
      const existingMatchId = String(entry.matchId || "").trim();
      if (fallbackNumber > 0 && (!existingMatchId || /^q\d+$/i.test(existingMatchId))) {
        next.matchId = `${prefix}${fallbackNumber}`;
      }
      if (!String(entry.matchKey || "").trim() && sessionMeta.matchKey) {
        next.matchKey = sessionMeta.matchKey;
      }

      return next;
    });

    setRawData(enriched);
    if (userData?.teamId) {
      try {
        const flagSnap = await getDocs(query(collection(db, "scoutingFlagStates"), where("teamId", "==", userData.teamId)));
        const nextFlagStates: Record<string, StoredFlagState> = {};
        flagSnap.docs.forEach((flagDoc) => {
          const row = flagDoc.data() as StoredFlagState;
          const entityType = row.entityType === "practiceSession" ? "practiceSession" : "scoutingEntry";
          const entityId = String(row.entityId || "").trim();
          if (!entityId) return;
          nextFlagStates[flagStateDocId(entityType, entityId)] = row;
        });
        setFlagStates(nextFlagStates);
      } catch (error) {
        console.warn("Unable to load scouting flag states for analytics. Continuing without flag states.", error);
        setFlagStates({});
      }
    } else {
      setFlagStates({});
    }
  }

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    return rawData.filter((entry) => {
      if (!entryMatchesAnalyticsFilters(entry, selectedGame, selectedEvent, selectedGame === "REBUILT" ? rebuiltEventOptions : undefined)) return false;
      if (practiceMatchesOnly) return isPracticeScoutingEntry(entry);
      return !isPracticeScoutingEntry(entry);
    });
  }, [rawData, selectedEvent, selectedGame, practiceMatchesOnly, rebuiltEventOptions]);

  const allianceAccuracyByEntryId = useMemo(() => {
    const result: Record<string, { accuracy: number | null; scriptStatus: string }> = {};
    const grouped = new Map<string, Entry[]>();

    filtered.forEach((entry) => {
      if (isPracticeScoutingEntry(entry)) return;
      const eventKey = selectedEvent !== "all" ? selectedEvent : String(entry.eventKey || "").trim();
      if (!eventKey) return;
      const identity = parseMatchIdentity(entry) || parseMatchIdentityFromLabel(matchLabel(entry));
      if (!identity) return;
      const key = `${eventKey}:${identity.compLevel}:${identity.setNumber ?? ""}:${identity.matchNumber}`;
      const bucket = grouped.get(key) || [];
      bucket.push(entry);
      grouped.set(key, bucket);
    });

    grouped.forEach((entries, key) => {
      const [eventKey] = key.split(":");
      const matches = tbaMatchesByEvent[eventKey] || [];
      if (matches.length === 0) {
        entries.forEach((entry) => {
          result[entry.id] = { accuracy: null, scriptStatus: "" };
        });
        return;
      }

      const identity = parseMatchIdentity(entries[0]) || parseMatchIdentityFromLabel(matchLabel(entries[0]));
      const matching = identity
        ? matches.find((row) => {
            const level = String(row.comp_level || "").toLowerCase();
            if (level !== identity.compLevel) return false;
            if (Number(row.match_number || 0) !== identity.matchNumber) return false;
            if (identity.setNumber !== null && Number(row.set_number || 0) !== identity.setNumber) return false;
            return true;
          })
        : null;

      if (!matching) {
        entries.forEach((entry) => {
          result[entry.id] = { accuracy: null, scriptStatus: "" };
        });
        return;
      }

      const redTeams = (matching.alliances?.red?.team_keys || [])
        .map((key) => String(key).replace("frc", "").trim())
        .filter(Boolean);
      const blueTeams = (matching.alliances?.blue?.team_keys || [])
        .map((key) => String(key).replace("frc", "").trim())
        .filter(Boolean);

      const latest = chooseLatestEntryPerTeam(entries);
      const byAlliance: Record<"red" | "blue", Entry[]> = { red: [], blue: [] };
      latest.forEach((entry) => {
        const team = String(entry.teamNumber || "").trim();
        if (team && redTeams.includes(team)) {
          byAlliance.red.push(entry);
          return;
        }
        if (team && blueTeams.includes(team)) {
          byAlliance.blue.push(entry);
          return;
        }
        const inferred = inferAllianceColor(entry);
        if (inferred) byAlliance[inferred].push(entry);
      });

      (["red", "blue"] as const).forEach((alliance) => {
        const entriesForAlliance = byAlliance[alliance];
        if (entriesForAlliance.length === 0) return;
        const foulPoints = Number(matching.score_breakdown?.[alliance]?.foulPoints || 0);
        const baseScouted = entriesForAlliance.reduce((sum, row) => sum + scoreEntryBase(row, selectedGame), 0);
        const scoutedTotal = baseScouted + foulPoints;
        const official = Number(matching.alliances?.[alliance]?.score || 0);
        const accuracy = official > 0 ? Math.max(0, 1 - Math.abs(official - scoutedTotal) / official) * 100 : 0;
        const scriptStatus = entriesForAlliance.length >= 3 ? "complete" : "missing robots";
        entriesForAlliance.forEach((entry) => {
          result[entry.id] = { accuracy, scriptStatus };
        });
      });
    });

    return result;
  }, [filtered, selectedEvent, selectedGame, tbaMatchesByEvent]);

  useEffect(() => {
    if (!canViewAdminColumns || !userData?.teamId) return;
    const updates: Array<Promise<void>> = [];
    const payloadById: Record<string, Record<string, unknown>> = {};
    filtered.forEach((entry) => {
      if (isPracticeScoutingEntry(entry)) return;
      if (entry.excludeFromStats) return;
      const computed = allianceAccuracyByEntryId[entry.id];
      if (!computed) return;
      const nextStatus = String(computed.scriptStatus || "").trim().toLowerCase();
      if (!nextStatus) return;
      const storedStatus = String(entry.accuracyScriptStatus || "").trim().toLowerCase();
      const storedAccuracy =
        typeof (entry as Entry & { accuracy?: number }).accuracy === "number"
          ? Math.round(Number((entry as Entry & { accuracy?: number }).accuracy))
          : null;
      const nextAccuracy = typeof computed.accuracy === "number" ? Math.round(computed.accuracy) : null;
      const needsStatus = storedStatus !== nextStatus;
      const needsAccuracy = nextAccuracy !== null && storedAccuracy !== nextAccuracy;
      if (!needsStatus && !needsAccuracy) return;
      if (accuracyPersistedRef.current.has(entry.id)) return;
      accuracyPersistedRef.current.add(entry.id);
      const payload: Record<string, unknown> = {
        accuracyScriptStatus: nextStatus,
        accuracyUpdatedAt: Date.now(),
      };
      if (nextAccuracy !== null) payload.accuracy = nextAccuracy;
      payloadById[entry.id] = payload;
      updates.push(
        updateDoc(doc(db, "scouting", entry.id), payload).catch((error) => {
          console.warn("Failed to persist accuracy data for scouting entry:", entry.id, error);
        })
      );
    });
    if (updates.length === 0) return;
    Promise.all(updates).then(() => {
      setRawData((prev) =>
        prev.map((entry) => (payloadById[entry.id] ? { ...entry, ...payloadById[entry.id] } : entry))
      );
    });
  }, [allianceAccuracyByEntryId, canViewAdminColumns, filtered, userData?.teamId]);

  useEffect(() => {
    if (!userData?.teamId) return;
    const eventKeys = new Set(
      filtered
        .filter((entry) => !entry.accuracyScriptStatus && typeof entry.accuracy !== "number")
        .map((entry) => (selectedEvent !== "all" ? selectedEvent : String(entry.eventKey || "").trim()))
        .filter((key) => Boolean(key))
    );
    if (eventKeys.size === 0) return;

    eventKeys.forEach((eventKey) => {
      if (!eventKey || tbaMatchesByEvent[eventKey]) return;
      if (!tbaAuth.encryptedKey && !tbaAuth.plainKey) return;
      (async () => {
        try {
          const response = await fetch("/api/tba/matches", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              eventKey,
              encryptedKey: tbaAuth.encryptedKey,
              plainKey: tbaAuth.plainKey,
            }),
          });
          if (!response.ok) return;
          const payload = (await response.json()) as { matches?: TbaMatchRow[] };
          if (!Array.isArray(payload.matches)) return;
          setTbaMatchesByEvent((prev) => (prev[eventKey] ? prev : { ...prev, [eventKey]: payload.matches as TbaMatchRow[] }));
        } catch (error) {
          console.warn("Failed loading TBA matches for analytics:", error);
        }
      })();
    });
  }, [filtered, selectedEvent, tbaAuth.encryptedKey, tbaAuth.plainKey, tbaMatchesByEvent, userData?.teamId]);

  const data = useMemo(() => {
    const withScore = filtered.map((entry) => {
      const fuel = getRebuiltFuelBreakdown(entry);
      const autoFuel = fuel.autoFuel;
      const teleFuel = fuel.teleFuel;
      const endgameFuel = fuel.endgameFuel;
      const autoClimb = entry.auto?.successfulClimb ? 15 : 0;
      const end = String(entry.endgame?.status || "").toLowerCase();
      const endgameClimb = end === "level-1" ? 10 : end === "level-2" ? 20 : end === "level-3" ? 30 : 0;
      const totalUsed = autoFuel + teleFuel + endgameFuel + autoClimb + endgameClimb;
      const computedAccuracy = allianceAccuracyByEntryId[entry.id];
      const accuracyValue = typeof (entry as Entry & { accuracy?: number }).accuracy === "number"
        ? Number((entry as Entry & { accuracy?: number }).accuracy)
        : computedAccuracy?.accuracy ?? null;
      const storedStatus = String((entry as Entry & { accuracyScriptStatus?: string }).accuracyScriptStatus || "")
        .trim()
        .toLowerCase();
      const scriptStatus = storedStatus
        ? storedStatus
        : computedAccuracy?.scriptStatus
        ? computedAccuracy.scriptStatus === "complete"
          ? "complete"
          : computedAccuracy.scriptStatus
        : accuracyValue === null
        ? ""
        : "complete";

      const normalizedAccuracy = typeof accuracyValue === "number" ? accuracyValue : undefined;

      return {
        ...entry,
        score: scoreEntry(entry, selectedGame),
        matchLabel: matchLabel(entry),
        accuracy: normalizedAccuracy,
        scriptStatus,
        autoPreloadScale: entry.auto?.preloadScale ?? 0,
        autoBpsScale: entry.auto?.bpsScale ?? 0,
        autoCarryScale: entry.auto?.carryingScale ?? 0,
        autoFuel,
        autoHumanFuel: fuel.autoHumanFuel,
        autoClimb,
        autoCycles: entry.auto?.cycleTimes || [],
        teleBpsScale: Number(entry.teleop?.bpsScale || 0),
        teleCarryScale: Number(entry.teleop?.carryingScale || 0),
        transitionFuel: fuel.transitionFuel,
        shift1Fuel: fuel.shift1Fuel,
        shift2Fuel: fuel.shift2Fuel,
        shift3Fuel: fuel.shift3Fuel,
        shift4Fuel: fuel.shift4Fuel,
        teleHumanFuel: fuel.teleHumanFuel,
        teleFuel,
        endgameFuel,
        endgameHumanFuel: fuel.endgameHumanFuel,
        transitionCycles: entry.teleop?.transitionCycles || [],
        shift1Cycles: entry.teleop?.shift1Cycles || [],
        shift2Cycles: entry.teleop?.shift2Cycles || [],
        shift3Cycles: entry.teleop?.shift3Cycles || [],
        shift4Cycles: entry.teleop?.shift4Cycles || [],
        endPlace: entry.endgame?.status || entry.stageStatus || "",
        endgameClimb,
        endgameCycles: entry.endgame?.cycleTimes || [],
        totalUsed,
      };
    });

    return withScore.sort((a, b) => {
      if (sortKey === "matchLabel") {
        const labelDiff = compareMatchLabels(String(a.matchLabel || ""), String(b.matchLabel || ""), sortDir);
        if (labelDiff !== 0) return labelDiff;
        return compareSortValues(String(a.eventName || a.eventKey || ""), String(b.eventName || b.eventKey || ""), sortDir);
      }
      return compareSortValues(a[sortKey], b[sortKey], sortDir);
    });
  }, [filtered, sortDir, sortKey, selectedGame]);

  function handleSort(key: SortKey) {
    setSortKey((prevKey) => {
      if (prevKey === key) {
        setSortDir((prevDir) => (prevDir === "asc" ? "desc" : "asc"));
        return prevKey;
      }
      setSortDir("asc");
      return key;
    });
  }

  async function handleDeleteEntry(entry: Entry) {
    if (!canDeleteEntries) {
      alert("Only coaches or team admins can delete entries.");
      return;
    }
    const sessionId = String(entry.practiceSessionId || "").trim();
    const isPracticeEntry = isPracticeScoutingEntry(entry);

    if (isPracticeEntry && sessionId) {
      const ok = window.confirm(
        "Delete this entire practice session? This will remove all scouting rows tied to this session."
      );
      if (!ok) return;

      const relatedEntriesSnap = await getDocs(
        query(collection(db, "scouting"), where("practiceSessionId", "==", sessionId))
      );
      const deleteOps = relatedEntriesSnap.docs.map((docSnap) => deleteDoc(doc(db, "scouting", docSnap.id)));
      deleteOps.push(deleteDoc(doc(db, "practiceSessions", sessionId)));
      await Promise.all(deleteOps);
      await loadData();
      return;
    }

    const ok = window.confirm("Delete this scouting entry?");
    if (!ok) return;
    await deleteDoc(doc(db, "scouting", entry.id));
    await loadData();
  }

  function triggerDeleteEntry(entry: Entry, event?: { preventDefault?: () => void; stopPropagation?: () => void }) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (deleteGuardRef.current === entry.id) return;
    deleteGuardRef.current = entry.id;
    void handleDeleteEntry(entry).finally(() => {
      if (deleteGuardRef.current === entry.id) {
        deleteGuardRef.current = null;
      }
    });
  }

  async function updateScoutingEntryFlagState(
    entryId: string,
    patch: Partial<StoredFlagState>
  ) {
    if (!canManageFlags || !userData?.teamId) return;
    const stateId = flagStateDocId("scoutingEntry", entryId);
    setFlagSavingKey(stateId);
    try {
      const nextState: StoredFlagState = {
        entityType: "scoutingEntry",
        entityId: entryId,
        dismissed: patch.dismissed ?? flagStates[stateId]?.dismissed ?? false,
        manualFlagged: patch.manualFlagged ?? flagStates[stateId]?.manualFlagged ?? false,
        dismissedAt: patch.dismissedAt ?? flagStates[stateId]?.dismissedAt,
        dismissedBy: patch.dismissedBy ?? flagStates[stateId]?.dismissedBy,
        manualFlaggedAt: patch.manualFlaggedAt ?? flagStates[stateId]?.manualFlaggedAt,
        manualFlaggedBy: patch.manualFlaggedBy ?? flagStates[stateId]?.manualFlaggedBy,
        manualReason: patch.manualReason ?? flagStates[stateId]?.manualReason,
      };
      await setDoc(
        doc(db, "scoutingFlagStates", stateId),
        {
          teamId: userData.teamId,
          ...nextState,
        },
        { merge: true }
      );
      setFlagStates((prev) => ({
        ...prev,
        [stateId]: nextState,
      }));
    } catch (error) {
      console.error("Failed updating scouting entry flag state:", error);
      alert("Could not update flag state.");
    } finally {
      setFlagSavingKey("");
    }
  }

  async function setScoutingEntryFlagDismissed(entryId: string, dismissed: boolean) {
    await updateScoutingEntryFlagState(entryId, {
      dismissed,
      dismissedAt: Date.now(),
      dismissedBy: userData?.uid || "",
    });
  }

  async function setScoutingEntryManualFlag(entryId: string, manualFlagged: boolean, reason?: string) {
    await updateScoutingEntryFlagState(entryId, {
      manualFlagged,
      manualFlaggedAt: Date.now(),
      manualFlaggedBy: userData?.uid || "",
      manualReason: manualFlagged ? reason ?? manualFlagReason : undefined,
    });
  }

  async function setScoutingEntryExcluded(entryId: string, excluded: boolean) {
    if (!canManageFlags) return;
    setExcludeSavingId(entryId);
    try {
      await updateDoc(doc(db, "scouting", entryId), {
        excludeFromStats: excluded,
        excludedAt: excluded ? Date.now() : null,
        excludedBy: excluded ? userData?.uid || "" : null,
      });
      setRawData((prev) =>
        prev.map((entry) =>
          entry.id === entryId ? { ...entry, excludeFromStats: excluded } : entry
        )
      );
    } catch (error) {
      console.error("Failed to update exclude-from-stats state:", error);
      alert("Unable to update stats exclusion for this entry.");
    } finally {
      setExcludeSavingId("");
    }
  }

  async function loadAccuracyDetails(entry: Entry) {
    setAccuracyModalLoading(true);
    const clickedLabel = matchLabel(entry);
    setAccuracyRobotBreakdown([]);
    setAccuracyDetails({
      scoutedPoints: 0,
      actualPoints: null,
      penaltyPoints: Number(entry.penaltyPoints || 0),
      allRobotsScouted: "unknown",
      eventKeyUsed: "",
      matchLabelUsed: clickedLabel,
    });
    if (entry.accuracyDetails && typeof entry.accuracyDetails.scoutedPoints === "number") {
      setAccuracyRobotBreakdown(Array.isArray(entry.accuracyRobotBreakdown) ? entry.accuracyRobotBreakdown : []);
      setAccuracyDetails({
        scoutedPoints: Number(entry.accuracyDetails.scoutedPoints || 0),
        actualPoints:
          typeof entry.accuracyDetails.actualPoints === "number" ? entry.accuracyDetails.actualPoints : null,
        penaltyPoints: Number(entry.accuracyDetails.penaltyPoints || 0),
        allRobotsScouted: entry.accuracyDetails.allRobotsScouted || "unknown",
        eventKeyUsed: String(entry.accuracyDetails.eventKeyUsed || ""),
        matchLabelUsed: String(entry.accuracyDetails.matchLabelUsed || clickedLabel),
      });
      setAccuracyModalLoading(false);
      return;
    }
    const persistAccuracySnapshot = async (
      details: AccuracyDetails,
      breakdown: AccuracyRobotBreakdown[],
      isPracticeEntry: boolean
    ) => {
      if (!canViewAdminColumns) return;
      const payload: Record<string, unknown> = {
        accuracyDetails: details,
        accuracyRobotBreakdown: breakdown,
        accuracyUpdatedAt: Date.now(),
      };
      if (!isPracticeEntry && typeof details.actualPoints === "number") {
        const official = Number(details.actualPoints || 0);
        const scouted = Number(details.scoutedPoints || 0);
        const accuracy = official > 0 ? Math.max(0, 1 - Math.abs(official - scouted) / official) * 100 : 0;
        payload.accuracy = Math.round(accuracy);
        payload.accuracyScriptStatus = details.allRobotsScouted === "yes" ? "complete" : "missing robots";
      }
      try {
        await updateDoc(doc(db, "scouting", entry.id), payload);
        setRawData((prev) => prev.map((row) => (row.id === entry.id ? { ...row, ...payload } : row)));
      } catch (error) {
        console.warn("Unable to persist accuracy details snapshot:", error);
      }
    };
    try {
      const selectedTeam = String(entry.teamNumber || "").trim();
      const entryGame = String(entry.game || "REEFSCAPE").toUpperCase() as AnalyticsGame;
      const sameGameRows = rawData.filter((row) => String(row.game || "REEFSCAPE").toUpperCase() === entryGame);
      const sameLabelRows = sameGameRows.filter((row) => matchLabel(row) === clickedLabel);
      const sameScoutRows = sameLabelRows.filter(
        (row) => String(row.scoutName || "").trim() === String(entry.scoutName || "").trim()
      );

      const eventKeyFromEntry = String(entry.eventKey || "").trim();
      const eventKeyFromSelector = selectedEvent !== "all" ? selectedEvent : "";
      const eventKeyPool = sameLabelRows
        .filter((row) => !selectedTeam || String(row.teamNumber || "").trim() === selectedTeam)
        .map((row) => String(row.eventKey || "").trim())
        .filter(Boolean);
      const eventKeyFrequency = eventKeyPool.reduce<Record<string, number>>((acc, key) => {
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
      const mostCommonEventKey =
        Object.entries(eventKeyFrequency).sort((a, b) => b[1] - a[1])[0]?.[0] ||
        sameLabelRows.map((row) => String(row.eventKey || "").trim()).filter(Boolean)[0] ||
        "";
      // If user filtered by an event, trust that selection before row-level event keys.
      const eventKey = eventKeyFromSelector || eventKeyFromEntry || mostCommonEventKey;

      const poolByEvent = eventKey
        ? sameGameRows.filter((row) => String(row.eventKey || "").trim() === eventKey)
        : sameLabelRows;
      const identity =
        parseMatchIdentity(entry) ||
        parseMatchIdentityFromLabel(clickedLabel) ||
        sameLabelRows.map((row) => parseMatchIdentity(row)).find((value): value is MatchIdentity => Boolean(value)) ||
        null;
      const matchRows = poolByEvent.filter((row) => {
        if (matchLabel(row) === clickedLabel) return true;
        if (!identity) return false;
        const rowIdentity = parseMatchIdentity(row) || parseMatchIdentityFromLabel(matchLabel(row));
        return Boolean(rowIdentity && matchIdentityEquals(identity, rowIdentity));
      });
      const latestReferenceRows = chooseLatestEntryPerTeam(sameScoutRows.length > 0 ? sameScoutRows : matchRows);
      const scoutedTeamsReference = new Set(
        latestReferenceRows.map((row) => String(row.teamNumber || "").trim()).filter(Boolean)
      );

      let allianceColor = inferAllianceColor(entry);
      let officialTeamsForAlliance: string[] = [];
      let matchLabelUsed = clickedLabel;
      let actualPoints: number | null =
        typeof entry.officialScore === "number"
          ? Number(entry.officialScore)
          : typeof entry.actualScore === "number"
          ? Number(entry.actualScore)
          : null;
      const practiceEntry = isPracticeScoutingEntry(entry);
      const practiceSessionId = String(entry.practiceSessionId || "").trim();

      let scopedMatchRows = matchRows;
      if (practiceEntry && practiceSessionId) {
        scopedMatchRows = sameGameRows.filter(
          (row) => String(row.practiceSessionId || "").trim() === practiceSessionId
        );
        if (scopedMatchRows.length > 0) {
          const latestSessionRows = chooseLatestEntryPerTeam(scopedMatchRows);
          let sessionScoutedPoints = latestSessionRows.reduce((sum, row) => sum + scoreEntry(row, entryGame), 0);
          const breakdown = latestSessionRows.map((row) =>
            entryGame === "REBUILT"
              ? getRebuiltBreakdown(row)
              : {
                  teamNumber: String(row.teamNumber || "-"),
                  total: scoreEntry(row, entryGame),
                  source: "reefscape" as const,
                  autoFuel: 0,
                  teleFuel: 0,
                  autoClimb: 0,
                  endgameClimb: 0,
                }
          );
          setAccuracyRobotBreakdown(breakdown);

          try {
            const sessionSnap = await getDoc(doc(db, "practiceSessions", practiceSessionId));
            if (sessionSnap.exists()) {
              const sessionData = sessionSnap.data() as { officialScore?: number; eventKey?: string; scoutedScore?: number };
              if (typeof sessionData.officialScore === "number") {
                actualPoints = Number(sessionData.officialScore);
              }
              if (typeof sessionData.scoutedScore === "number") {
                sessionScoutedPoints = Number(sessionData.scoutedScore);
              }
            }
          } catch (sessionError) {
            console.warn("Could not load practice session while opening accuracy details:", sessionError);
          }

          const details: AccuracyDetails = {
            scoutedPoints: sessionScoutedPoints,
            actualPoints,
            penaltyPoints:
              Number(
                latestSessionRows.find((row) => typeof row.penaltyPoints === "number")?.penaltyPoints ??
                  entry.penaltyPoints ??
                  0
              ) || 0,
            allRobotsScouted: latestSessionRows.length >= 3 ? "yes" : "no",
            eventKeyUsed: eventKey,
            matchLabelUsed,
          };
          setAccuracyDetails(details);
          void persistAccuracySnapshot(details, breakdown, true);
          return;
        }
      }

      if (!userData?.teamId) {
        const allianceRows =
          allianceColor === null
            ? latestReferenceRows
            : matchRows.filter((row) => inferAllianceColor(row) === allianceColor);
        const latestAllianceRows = chooseLatestEntryPerTeam(allianceRows);
        const scoutedPoints = latestAllianceRows.reduce((sum, row) => sum + scoreEntry(row, entryGame), 0);
        const breakdown = latestAllianceRows.map((row) =>
          entryGame === "REBUILT"
            ? getRebuiltBreakdown(row)
            : {
                teamNumber: String(row.teamNumber || "-"),
                total: scoreEntry(row, entryGame),
                source: "reefscape" as const,
                autoFuel: 0,
                teleFuel: 0,
                autoClimb: 0,
                endgameClimb: 0,
              }
        );
        setAccuracyRobotBreakdown(breakdown);
        const details: AccuracyDetails = {
          scoutedPoints,
          actualPoints,
          penaltyPoints: Number(entry.penaltyPoints || 0),
          allRobotsScouted: "unknown",
          eventKeyUsed: eventKey,
          matchLabelUsed: matchLabelUsed,
        };
        setAccuracyDetails(details);
        void persistAccuracySnapshot(details, breakdown, false);
        return;
      }

      const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
      const encryptedKey = String(teamDoc.data()?.tbaApiKeyEncrypted || "").trim();
      const plainKey = String(teamDoc.data()?.tbaApiKey || "").trim();
      if (!practiceEntry && eventKey && identity && (encryptedKey || plainKey)) {
        const response = await fetch("/api/tba/matches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventKey, encryptedKey, plainKey }),
        });
        if (response.ok) {
          const payload = await response.json();
          const matches = (Array.isArray(payload.matches) ? payload.matches : []) as TbaMatchRow[];
          const candidates = matches.filter((row) => {
            const rowLevel = String(row.comp_level || "").toLowerCase();
            return ["qm", "qf", "sf", "f"].includes(rowLevel);
          });
          const scoredCandidates = candidates
            .map((row) => {
              const redTeams = (row.alliances?.red?.team_keys || [])
                .map((key) => String(key).replace("frc", "").trim())
                .filter(Boolean);
              const blueTeams = (row.alliances?.blue?.team_keys || [])
                .map((key) => String(key).replace("frc", "").trim())
                .filter(Boolean);
              const redOverlap = redTeams.filter((team) => scoutedTeamsReference.has(team)).length;
              const blueOverlap = blueTeams.filter((team) => scoutedTeamsReference.has(team)).length;
              const bestOverlap = Math.max(redOverlap, blueOverlap);
              const overlapAlliance: "red" | "blue" = redOverlap >= blueOverlap ? "red" : "blue";
              const rowIdentity: MatchIdentity = {
                compLevel: String(row.comp_level || "").toLowerCase() as MatchIdentity["compLevel"],
                setNumber: Number(row.set_number || 0) > 0 ? Number(row.set_number || 0) : null,
                matchNumber: Number(row.match_number || 0),
              };
              const identityBoost = identity && matchIdentityEquals(identity, rowIdentity) ? 1 : 0;
              return { row, rowIdentity, redTeams, blueTeams, redOverlap, blueOverlap, bestOverlap, overlapAlliance, identityBoost };
            })
            .sort((a, b) => {
              if (b.bestOverlap !== a.bestOverlap) return b.bestOverlap - a.bestOverlap;
              if (b.identityBoost !== a.identityBoost) return b.identityBoost - a.identityBoost;
              return 0;
            });
          const exactIdentityCandidates =
            identity
              ? scoredCandidates.filter((candidate) => matchIdentityEquals(identity, candidate.rowIdentity))
              : [];
          const best = (exactIdentityCandidates.length > 0 ? exactIdentityCandidates : scoredCandidates)[0];
          if (best && best.bestOverlap > 0) {
            const alliances = best.row.alliances || {};
            if (!allianceColor) {
              if (selectedTeam && best.redTeams.includes(selectedTeam)) allianceColor = "red";
              else if (selectedTeam && best.blueTeams.includes(selectedTeam)) allianceColor = "blue";
              else allianceColor = best.overlapAlliance;
            }
            if (allianceColor === "red") {
              officialTeamsForAlliance = best.redTeams;
              actualPoints = typeof alliances.red?.score === "number" ? alliances.red.score : actualPoints;
            } else if (allianceColor === "blue") {
              officialTeamsForAlliance = best.blueTeams;
              actualPoints = typeof alliances.blue?.score === "number" ? alliances.blue.score : actualPoints;
            }
            matchLabelUsed = tbaMatchLabel(best.row);
          }
        }
      }

      const allianceRows =
          allianceColor === null
            ? latestReferenceRows
            : officialTeamsForAlliance.length > 0
          ? scopedMatchRows.filter((row) => officialTeamsForAlliance.includes(String(row.teamNumber || "").trim()))
          : scopedMatchRows.filter((row) => inferAllianceColor(row) === allianceColor);
      let latestAllianceRows = chooseLatestEntryPerTeam(allianceRows);
      if (officialTeamsForAlliance.length > 0 && latestAllianceRows.length < 2 && latestReferenceRows.length >= 2) {
        // If official-team matching collapses rows (bad/missing team keys), keep scouted alliance rows visible.
        latestAllianceRows = latestReferenceRows;
      }
      const scoutedPoints = latestAllianceRows.reduce((sum, row) => sum + scoreEntry(row, entryGame), 0);
      const breakdown = latestAllianceRows.map((row) =>
        entryGame === "REBUILT"
          ? getRebuiltBreakdown(row)
          : {
              teamNumber: String(row.teamNumber || "-"),
              total: scoreEntry(row, entryGame),
              source: "reefscape" as const,
              autoFuel: 0,
              teleFuel: 0,
              autoClimb: 0,
              endgameClimb: 0,
            }
      );
      setAccuracyRobotBreakdown(breakdown);
      const scoutedTeams = new Set(latestAllianceRows.map((row) => String(row.teamNumber || "").trim()).filter(Boolean));
      const allRobotsScouted =
        officialTeamsForAlliance.length > 0
          ? officialTeamsForAlliance.every((team) => scoutedTeams.has(team))
            ? "yes"
            : "no"
          : "unknown";
      const details: AccuracyDetails = {
        scoutedPoints,
        actualPoints,
        penaltyPoints:
          Number(
            latestAllianceRows.find((row) => typeof row.penaltyPoints === "number")?.penaltyPoints ??
              entry.penaltyPoints ??
              0
          ) || 0,
        allRobotsScouted,
        eventKeyUsed: eventKey,
        matchLabelUsed: matchLabelUsed,
      };
      setAccuracyDetails(details);
      void persistAccuracySnapshot(details, breakdown, false);
    } catch (error) {
      console.error("Failed to load alliance robot details:", error);
      setAccuracyDetails((prev) => ({ ...prev, allRobotsScouted: "unknown", matchLabelUsed: clickedLabel }));
    } finally {
      setAccuracyModalLoading(false);
    }
  }

  function exportToCSV() {
    if (filtered.length === 0) {
      alert("No data to export");
      return;
    }
    const headers = [
      "Match",
      "Team",
      "Scout",
      "Starting Position",
      "Leave",
      "Auto Coral Missed",
      "Auto Coral L1",
      "Auto Coral L2",
      "Auto Coral L3",
      "Auto Coral L4",
      "Auto Algae Processor Missed",
      "Auto Algae Processor Scored",
      "Auto Algae Net Missed",
      "Auto Algae Net Scored",
      "Tele Coral Missed",
      "Tele Coral L1",
      "Tele Coral L2",
      "Tele Coral L3",
      "Tele Coral L4",
      "Remove Algae from Reef",
      "Tele Processor Missed",
      "Tele Processor Scored",
      "Tele Net Robot Missed",
      "Tele Net Robot Scored",
      "Tele Net Human Missed",
      "Tele Net Human Scored",
      "Climb Failed",
      "End Place",
      "Miscellaneous",
      "Comments",
      "Alliance Accuracy",
      "Script Status",
    ];
    const rows = filtered.map((entry) => [
      matchLabel(entry),
      entry.teamNumber || "",
      entry.scoutName || "",
      entry.startingPosition || "",
      entry.leftStartingZone ? "1" : "0",
      entry.autoCoralMissed || 0,
      entry.autoCoralL1 || 0,
      entry.autoCoralL2 || 0,
      entry.autoCoralL3 || 0,
      entry.autoCoralL4 || 0,
      entry.autoAlgaeProcessorMissed || 0,
      entry.autoAlgaeProcessorScored || 0,
      entry.autoAlgaeNetMissed || 0,
      entry.autoAlgaeNetScored || 0,
      entry.teleopCoralMissed || 0,
      entry.teleopCoralL1 || 0,
      entry.teleopCoralL2 || 0,
      entry.teleopCoralL3 || 0,
      entry.teleopCoralL4 || 0,
      entry.teleopAlgaeRemoved ? "1" : "0",
      entry.teleopProcessorMissed || 0,
      entry.teleopProcessorScored || 0,
      entry.teleopNetRobotMissed || 0,
      entry.teleopNetRobotScored || 0,
      entry.teleopNetHumanMissed || 0,
      entry.teleopNetHumanScored || 0,
      entry.failedClimb || 0,
      entry.stageStatus || "",
      (entry.incidents || []).join(";"),
      (entry.notes || "").replace(/,/g, ";"),
      typeof (entry as Entry & { accuracy?: number }).accuracy === "number"
        ? (entry as Entry & { accuracy?: number }).accuracy
        : "",
      String(entry.accuracyScriptStatus || "").trim()
        ? formatScriptStatus(entry.accuracyScriptStatus)
        : typeof (entry as Entry & { accuracy?: number }).accuracy === "number"
        ? "Complete"
        : "",
    ]);
    const csv = [
      headers.join(","),
      ...rows.map((row) => row.map((cell) => (String(cell).includes(",") ? `"${cell}"` : cell)).join(",")),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `analytics-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImportFilePick(event: React.ChangeEvent<HTMLInputElement>) {
    if (!canImportCsv) {
      alert("Only coaches or team admins can import CSV files.");
      event.target.value = "";
      return;
    }
    const file = event.target.files?.[0];
    if (!file) return;
    setPendingImportFile(file);
    setShowImportDialog(true);
    event.target.value = "";
  }

  async function runCSVImport() {
    if (!canImportCsv) {
      alert("Only coaches or team admins can import CSV files.");
      return;
    }
    if (!pendingImportFile || importing) return;
    setImporting(true);

    const reader = new FileReader();
    reader.onload = async (loadEvent) => {
      try {
        const text = loadEvent.target?.result as string;
        const lines = splitCsvRecords(text);
        if (lines.length < 2) {
          throw new Error("CSV has no data rows.");
        }
        const findHeaderRowIndex = () => {
          for (let row = 0; row < Math.min(lines.length, 8); row += 1) {
            const cells = parseCsvLine(lines[row]).map(normalizeHeader);
            if (
              cells.includes("match") &&
              (cells.includes("team") || cells.includes("teamnumber")) &&
              cells.includes("scout")
            ) {
              return row;
            }
          }
          return 0;
        };
        const headerRowIndex = findHeaderRowIndex();
        const headers = parseCsvLine(lines[headerRowIndex]).map(normalizeHeader);
        const column = (aliases: string[], fallbackIndex: number) => {
          for (const alias of aliases) {
            const idx = headers.indexOf(normalizeHeader(alias));
            if (idx >= 0) return idx;
          }
          return fallbackIndex;
        };
        const idxMatch = column(["match"], 0);
        const idxTeam = column(["team"], 1);
        const idxScout = column(["scout"], 2);
        const idxStartingPos = column(["startingposition"], 3);
        const idxLeave = column(["leave"], 4);
        const idxAutoCoralMissed = column(["autocoralmissed"], 5);
        const idxAutoCoralL1 = column(["autocorall1"], 6);
        const idxAutoCoralL2 = column(["autocorall2"], 7);
        const idxAutoCoralL3 = column(["autocorall3"], 8);
        const idxAutoCoralL4 = column(["autocorall4"], 9);
        const idxAutoAlgaeProcMissed = column(["autoalgaeprocessormissed"], 10);
        const idxAutoAlgaeProcScored = column(["autoalgaeprocessorscored"], 11);
        const idxAutoAlgaeNetMissed = column(["autoalgaenetmissed"], 12);
        const idxAutoAlgaeNetScored = column(["autoalgaenetscored"], 13);
        const idxTeleCoralMissed = column(["telecoralmissed"], 14);
        const idxTeleCoralL1 = column(["telecorall1"], 15);
        const idxTeleCoralL2 = column(["telecorall2"], 16);
        const idxTeleCoralL3 = column(["telecorall3"], 17);
        const idxTeleCoralL4 = column(["telecorall4"], 18);
        const idxRemovedReef = column(["removealgaefromreef", "removedreef"], 19);
        const idxTeleProcMissed = column(["teleprocessormissed"], 20);
        const idxTeleProcScored = column(["teleprocessorscored"], 21);
        const idxTeleNetRobotMissed = column(["telenetrobotmissed"], 22);
        const idxTeleNetRobotScored = column(["telenetrobotscored"], 23);
        const idxTeleNetHumanMissed = column(["telenethumanmissed"], 24);
        const idxTeleNetHumanScored = column(["telenethumanscored"], 25);
        const idxFailedClimb = column(["climbfailed", "failed"], 26);
        const idxEndPlace = column(["endplace", "stagestatus"], 27);
        const idxIncidents = column(["miscellaneous", "incidents"], 28);
        const idxComments = column(["comments", "notes"], 29);
        const idxAccuracy = column(["allianceaccuracy", "accuracy"], 30);

        const startDataRow = Math.max(headerRowIndex + 1, 3);
        let imported = 0;
        let skipped = 0;
        type CandidateRow = {
          values: string[];
          matchRaw: string;
          parsedMatch: ReturnType<typeof normalizeMatchLabel>;
          explicitType: ReturnType<typeof getExplicitMatchTypeFromLabel>;
          numericOnly: boolean;
        };
        const candidates: CandidateRow[] = [];
        for (let i = startDataRow; i < lines.length; i++) {
          if (!lines[i].trim()) continue;
          const values = parseCsvLine(lines[i]);
          const matchRaw = (values[idxMatch] || "").trim();
          const teamRaw = (values[idxTeam] || "").trim();
          const scoutRaw = (values[idxScout] || "").trim();
          const startRaw = (values[idxStartingPos] || "").trim();
          const parsedTeamNumber = Number(teamRaw.replace(/\D/g, ""));
          const rowSignals = [matchRaw, teamRaw, scoutRaw, startRaw].map(normalizeHeader);
          const looksLikeHeaderRow =
            rowSignals.includes("match") ||
            rowSignals.includes("team") ||
            rowSignals.includes("scout") ||
            rowSignals.includes("startingposition") ||
            rowSignals.includes("information") ||
            rowSignals.includes("prematch") ||
            rowSignals.includes("autonomous") ||
            rowSignals.includes("teleop") ||
            rowSignals.includes("endgame") ||
            rowSignals.includes("general") ||
            rowSignals.includes("actions");
          const numericCells = [
            idxAutoCoralMissed,
            idxAutoCoralL1,
            idxAutoCoralL2,
            idxAutoCoralL3,
            idxAutoCoralL4,
            idxAutoAlgaeProcMissed,
            idxAutoAlgaeProcScored,
            idxAutoAlgaeNetMissed,
            idxAutoAlgaeNetScored,
            idxTeleCoralMissed,
            idxTeleCoralL1,
            idxTeleCoralL2,
            idxTeleCoralL3,
            idxTeleCoralL4,
            idxTeleProcMissed,
            idxTeleProcScored,
            idxTeleNetRobotMissed,
            idxTeleNetRobotScored,
            idxTeleNetHumanMissed,
            idxTeleNetHumanScored,
            idxFailedClimb,
          ];
          const hasNumericData = numericCells.some((idx) => Number(values[idx] || 0) > 0);
          const hasTextData =
            Boolean(scoutRaw) ||
            Boolean(startRaw) ||
            Boolean((values[idxComments] || "").trim()) ||
            Boolean((values[idxIncidents] || "").trim()) ||
            Boolean((values[idxEndPlace] || "").trim());
          const hasMatchSignal = /\d/.test(matchRaw) || /(practice|final|upper|lower|ub|lb|qual|qm|round)/i.test(matchRaw);
          const hasCoreIds = hasMatchSignal && Number.isFinite(parsedTeamNumber) && parsedTeamNumber > 0;
          if (looksLikeHeaderRow || !hasCoreIds || (!hasNumericData && !hasTextData)) {
            skipped += 1;
            continue;
          }

          const parsedMatch = normalizeMatchLabel(matchRaw);
          candidates.push({
            values,
            matchRaw,
            parsedMatch,
            explicitType: getExplicitMatchTypeFromLabel(matchRaw),
            numericOnly: /^\d+$/.test(matchRaw.replace(/\s+/g, "")),
          });
        }

        const explicitByMatchNumber = new Map<string, Record<"practice" | "qualification" | "finals", number>>();
        for (const candidate of candidates) {
          if (!candidate.explicitType) continue;
          const key = candidate.parsedMatch.matchNumber || "1";
          const counts = explicitByMatchNumber.get(key) || { practice: 0, qualification: 0, finals: 0 };
          counts[candidate.explicitType] += 1;
          explicitByMatchNumber.set(key, counts);
        }

        const inferContextType = (index: number): "practice" | "qualification" | "finals" => {
          const row = candidates[index];
          if (row.explicitType) return row.explicitType;

          const sameNumberCounts = explicitByMatchNumber.get(row.parsedMatch.matchNumber || "1");
          if (sameNumberCounts) {
            const ranked = (Object.entries(sameNumberCounts) as Array<["practice" | "qualification" | "finals", number]>)
              .sort((a, b) => b[1] - a[1]);
            if (ranked[0]?.[1] > 0 && ranked[0]?.[1] > (ranked[1]?.[1] || 0)) {
              return ranked[0][0];
            }
          }

          let prev: { type: "practice" | "qualification" | "finals"; dist: number } | null = null;
          for (let p = index - 1; p >= 0; p -= 1) {
            const type = candidates[p].explicitType;
            if (type) {
              prev = { type, dist: index - p };
              break;
            }
          }

          let next: { type: "practice" | "qualification" | "finals"; dist: number } | null = null;
          for (let n = index + 1; n < candidates.length; n += 1) {
            const type = candidates[n].explicitType;
            if (type) {
              next = { type, dist: n - index };
              break;
            }
          }

          if (prev && next) {
            if (prev.type === next.type) return prev.type;
            if (prev.dist < next.dist) return prev.type;
            if (next.dist < prev.dist) return next.type;
            return row.parsedMatch.matchType;
          }
          if (prev) return prev.type;
          if (next) return next.type;
          return row.parsedMatch.matchType;
        };

        for (let i = 0; i < candidates.length; i += 1) {
          const candidate = candidates[i];
          const values = candidate.values;
          const parsedMatch = candidate.parsedMatch;
          const importedMatchType = inferContextType(i);
          const matchId = `${importedMatchType === "practice" ? "p" : importedMatchType === "finals" ? "f" : "q"}${parsedMatch.matchNumber}`;
          const now = Date.now();
          const parseNum = (value: string, fallback = 0) => {
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : fallback;
          };
          const parseBool = (value: string) => value === "1" || /^y(es)?$/i.test(value) || /^true$/i.test(value);
          const parsedAccuracy = parseAccuracyPercent(values[idxAccuracy] || "");
          await addDoc(collection(db, "scouting"), {
            matchId,
            matchNumber: parsedMatch.matchNumber,
            matchType: importedMatchType,
            teamNumber: values[idxTeam] || "",
            scoutName: values[idxScout] || "",
            startingPosition: values[idxStartingPos] || "",
            leftStartingZone: parseBool(values[idxLeave] || ""),
            autoCoralMissed: parseNum(values[idxAutoCoralMissed]),
            autoCoralL1: parseNum(values[idxAutoCoralL1]),
            autoCoralL2: parseNum(values[idxAutoCoralL2]),
            autoCoralL3: parseNum(values[idxAutoCoralL3]),
            autoCoralL4: parseNum(values[idxAutoCoralL4]),
            autoAlgaeProcessorMissed: parseNum(values[idxAutoAlgaeProcMissed]),
            autoAlgaeProcessorScored: parseNum(values[idxAutoAlgaeProcScored]),
            autoAlgaeNetMissed: parseNum(values[idxAutoAlgaeNetMissed]),
            autoAlgaeNetScored: parseNum(values[idxAutoAlgaeNetScored]),
            teleopCoralMissed: parseNum(values[idxTeleCoralMissed]),
            teleopCoralL1: parseNum(values[idxTeleCoralL1]),
            teleopCoralL2: parseNum(values[idxTeleCoralL2]),
            teleopCoralL3: parseNum(values[idxTeleCoralL3]),
            teleopCoralL4: parseNum(values[idxTeleCoralL4]),
            teleopAlgaeRemoved: parseBool(values[idxRemovedReef] || ""),
            teleopProcessorMissed: parseNum(values[idxTeleProcMissed]),
            teleopProcessorScored: parseNum(values[idxTeleProcScored]),
            teleopNetRobotMissed: parseNum(values[idxTeleNetRobotMissed]),
            teleopNetRobotScored: parseNum(values[idxTeleNetRobotScored]),
            teleopNetHumanMissed: parseNum(values[idxTeleNetHumanMissed]),
            teleopNetHumanScored: parseNum(values[idxTeleNetHumanScored]),
            failedClimb: parseNum(values[idxFailedClimb]),
            stageStatus: values[idxEndPlace] || "",
            incidents: (values[idxIncidents] || "").split(";").map((item) => item.trim()).filter(Boolean),
            notes: values[idxComments] || "",
            ...(typeof parsedAccuracy === "number" ? { accuracy: parsedAccuracy } : {}),
            ...(importMatchMode === "practice-scouted" ? { isPracticeScouting: true, practiceMode: "trial" } : {}),
            eventKey: importEvent,
            eventName: importEventOptions.find((option) => option.id === importEvent)?.name || "App Testing",
            game: importGame,
            timestamp: now,
            submittedAt: now,
          });
          imported += 1;
        }
        alert(`Successfully imported ${imported} entries${skipped ? ` (${skipped} rows skipped)` : ""}`);
        await loadData();
        setShowImportDialog(false);
        setPendingImportFile(null);
      } catch (error) {
        console.error("Import failed:", error);
        const message = error instanceof Error ? error.message : "Unknown error";
        alert(`Error importing CSV: ${message}`);
      } finally {
        setImporting(false);
      }
    };
    reader.readAsText(pendingImportFile);
  }

  return (
    <AnalyticsShell
      entriesCount={data.length}
      selectedGame={selectedGame}
      onSelectedGameChange={(game) => handleGameChange(game as AnalyticsGame)}
      practiceMatchesOnly={practiceMatchesOnly}
      onPracticeMatchesOnlyChange={setPracticeMatchesOnly}
      selectedEvent={selectedEvent}
      eventOptions={eventOptions}
      onSelectedEventChange={setSelectedEvent}
    >
      <div className="mb-4">
        <h1 className="text-3xl font-bold mb-1 theme-text">Match Analytics</h1>
        <p className="text-sm text-gray-600">Match scouting breakdown with sticky match/team columns.</p>
      </div>
      <div className="bg-white rounded-xl shadow p-4 mb-4 flex flex-wrap items-center gap-4">
        <button
          className="px-3 py-1.5 text-sm rounded bg-gray-400 text-white cursor-not-allowed disabled:opacity-100"
          onClick={exportToCSV}
          disabled
          title={csvDisabledReason}
        >
          Export CSV
        </button>
        <label
          className="px-3 py-1.5 text-sm rounded text-white bg-gray-400 cursor-not-allowed"
          title={csvDisabledReason}
        >
          Import CSV
          <input type="file" accept=".csv" onChange={handleImportFilePick} className="hidden" disabled />
        </label>
      </div>

      {showImportDialog && (
        <div className="fixed inset-0 bg-black/45 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-xl font-semibold mb-4">Import CSV</h2>
            <p className="text-sm text-gray-600 mb-4">
              Choose the game and event for this import.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Game</label>
                <select
                  value={importGame}
                  onChange={(event) => {
                    const next = event.target.value as AnalyticsGame;
                    setImportGame(next);
                    const nextOptions =
                      next === "REBUILT"
                        ? getEventOptionsForEntries([], next, rebuiltEventOptions)
                        : getEventsForGame(next);
                    setImportEvent(nextOptions[0]?.id || "app-testing");
                  }}
                  className="w-full border rounded p-2"
                >
                  <option value="REEFSCAPE">REEFSCAPE</option>
                  <option value="REBUILT">REBUILT</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Import As</label>
                <select
                  value={importMatchMode}
                  onChange={(event) => setImportMatchMode(event.target.value as "official" | "practice-scouted")}
                  className="w-full border rounded p-2"
                >
                  <option value="official">Official (Practice/Qualification/Finals)</option>
                  <option value="practice-scouted">Practice Scouted Matches</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Event</label>
                <select
                  value={importEvent}
                  onChange={(event) => setImportEvent(event.target.value)}
                  className="w-full border rounded p-2"
                >
                  {importEventOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-6 flex gap-2">
              <button
                onClick={runCSVImport}
                disabled={importing}
                className="flex-1 py-2 rounded bg-blue-600 text-white font-semibold disabled:opacity-60"
              >
                {importing ? "Importing..." : "Import"}
              </button>
              <button
                onClick={() => {
                  setShowImportDialog(false);
                  setPendingImportFile(null);
                }}
                disabled={importing}
                className="flex-1 py-2 rounded border border-gray-300 disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow h-[calc(100vh-270px)] table-scroll overflow-x-auto">
        {selectedGame === "REBUILT" ? (
          <table>
            <thead className="sticky-header">
              <tr>
                <th className="sticky-left-group sticky-row-1 bg-red-300 text-center" colSpan={2}>Information</th>
                <th className="sticky-left-2 sticky-row-1 bg-yellow-300 text-center" colSpan={1}>Pre-Match</th>
                <th className="bg-yellow-300 text-center" colSpan={1} />
                <th className="bg-green-300 text-center" colSpan={7}>Autonomous</th>
                <th className="bg-blue-300 text-center" colSpan={14}>Teleoperated</th>
                <th className="bg-purple-300 text-center" colSpan={5}>Endgame</th>
                <th className="bg-pink-300 text-center" colSpan={canViewAdminColumns ? 5 : 3}>General</th>
                {canViewAdminColumns && <th className="bg-gray-300 text-center" colSpan={1} />}
              </tr>
              <tr>
                <th className="sticky-left-group sticky-row-2 bg-red-200 text-center" colSpan={2}>Information</th>
                <th className="sticky-left-2 sticky-row-2 bg-yellow-200 text-center" colSpan={1}>Pre-Match</th>
                <th className="bg-yellow-200 text-center" colSpan={1} />
                <th className="bg-green-200 text-center" colSpan={3}>Stats</th>
                <th className="bg-green-200 text-center" colSpan={2}>Fuel</th>
                <th className="bg-green-200 text-center" colSpan={1}>Climb</th>
                <th className="bg-green-200 text-center" colSpan={1}>Cycles</th>
                <th className="bg-blue-200 text-center" colSpan={9}>Fuel</th>
                <th className="bg-blue-200 text-center" colSpan={5}>Cycles</th>
                <th className="bg-purple-200 text-center" colSpan={1}>Fuel</th>
                <th className="bg-purple-200 text-center" colSpan={1}>Human Player</th>
                <th className="bg-purple-200 text-center" colSpan={1}>End Place</th>
                <th className="bg-purple-200 text-center" colSpan={1}>Climb</th>
                <th className="bg-purple-200 text-center" colSpan={1}>Cycles</th>
                <th className="bg-pink-200 text-center" colSpan={1}>Incidents</th>
                <th className="bg-pink-200 text-center" colSpan={1}>Score</th>
                <th className="bg-pink-200 text-center" colSpan={1}>Comments</th>
                {canViewAdminColumns && <th className="bg-pink-200 text-center" colSpan={2}>Accuracy Script</th>}
                {canViewAdminColumns && <th className="bg-gray-200 text-center" colSpan={1}>Actions</th>}
              </tr>
              <tr>
                <th className="sticky-left-0 sticky-row-3 cursor-pointer text-center" onClick={() => handleSort("matchLabel")}>
                  {sortLabel(sortKey, sortDir, "matchLabel", "Match")}
                </th>
                <th className="sticky-left-1 sticky-row-3 cursor-pointer text-center" onClick={() => handleSort("teamNumber")}>
                  {sortLabel(sortKey, sortDir, "teamNumber", "Team")}
                </th>
                <th className="sticky-left-2 sticky-row-3 cursor-pointer text-center" onClick={() => handleSort("scoutName")}>
                  {sortLabel(sortKey, sortDir, "scoutName", "Scout")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("startingPosition")}>
                  {sortLabel(sortKey, sortDir, "startingPosition", "Starting Position")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("autoPreloadScale")}>
                  {sortLabel(sortKey, sortDir, "autoPreloadScale", "Preload")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("autoBpsScale")}>
                  {sortLabel(sortKey, sortDir, "autoBpsScale", "BPS")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("autoCarryScale")}>
                  {sortLabel(sortKey, sortDir, "autoCarryScale", "Carry")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("autoFuel")}>
                  {sortLabel(sortKey, sortDir, "autoFuel", "Fuel")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("autoHumanFuel")}>
                  {sortLabel(sortKey, sortDir, "autoHumanFuel", "Human Player")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("autoClimb")}>
                  {sortLabel(sortKey, sortDir, "autoClimb", "Climb Pts")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("autoCycles")}>
                  {sortLabel(sortKey, sortDir, "autoCycles", "Cycles")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("teleBpsScale")}>
                  {sortLabel(sortKey, sortDir, "teleBpsScale", "BPS")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("teleCarryScale")}>
                  {sortLabel(sortKey, sortDir, "teleCarryScale", "Carry")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("transitionFuel")}>
                  {sortLabel(sortKey, sortDir, "transitionFuel", "Transition")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("shift1Fuel")}>
                  {sortLabel(sortKey, sortDir, "shift1Fuel", "Shift 1")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("shift2Fuel")}>
                  {sortLabel(sortKey, sortDir, "shift2Fuel", "Shift 2")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("shift3Fuel")}>
                  {sortLabel(sortKey, sortDir, "shift3Fuel", "Shift 3")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("shift4Fuel")}>
                  {sortLabel(sortKey, sortDir, "shift4Fuel", "Shift 4")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("teleHumanFuel")}>
                  {sortLabel(sortKey, sortDir, "teleHumanFuel", "Human Player")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("teleFuel")}>
                  {sortLabel(sortKey, sortDir, "teleFuel", "Fuel Used")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("transitionCycles")}>
                  {sortLabel(sortKey, sortDir, "transitionCycles", "Transition")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("shift1Cycles")}>
                  {sortLabel(sortKey, sortDir, "shift1Cycles", "Shift 1")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("shift2Cycles")}>
                  {sortLabel(sortKey, sortDir, "shift2Cycles", "Shift 2")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("shift3Cycles")}>
                  {sortLabel(sortKey, sortDir, "shift3Cycles", "Shift 3")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("shift4Cycles")}>
                  {sortLabel(sortKey, sortDir, "shift4Cycles", "Shift 4")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("endgameFuel")}>
                  {sortLabel(sortKey, sortDir, "endgameFuel", "Fuel")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("endgameHumanFuel")}>
                  {sortLabel(sortKey, sortDir, "endgameHumanFuel", "Human Player")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("endPlace")}>
                  {sortLabel(sortKey, sortDir, "endPlace", "End Place")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("endgameClimb")}>
                  {sortLabel(sortKey, sortDir, "endgameClimb", "Climb Pts")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("endgameCycles")}>
                  {sortLabel(sortKey, sortDir, "endgameCycles", "Cycles")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("incidents")}>
                  {sortLabel(sortKey, sortDir, "incidents", "Incidents")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("totalUsed")}>
                  {sortLabel(sortKey, sortDir, "totalUsed", "Total")}
                </th>
                <th className="cursor-pointer text-center" style={{ minWidth: "260px" }} onClick={() => handleSort("notes")}>
                  {sortLabel(sortKey, sortDir, "notes", "Comments")}
                </th>
                {canViewAdminColumns && (
                  <th className="cursor-pointer text-center" onClick={() => handleSort("accuracy")}>
                    {sortLabel(sortKey, sortDir, "accuracy", "Alliance Accuracy")}
                  </th>
                )}
                {canViewAdminColumns && (
                  <th className="cursor-pointer text-center" onClick={() => handleSort("scriptStatus")}>
                    {sortLabel(sortKey, sortDir, "scriptStatus", "Script Status")}
                  </th>
                )}
                {canViewAdminColumns && (
                  <th className="cursor-pointer text-center" onClick={() => handleSort("id")}>
                    {sortLabel(sortKey, sortDir, "id", "Actions")}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {data.map((entry) => {
                const fuel = getRebuiltFuelBreakdown(entry);
                const autoFuel = fuel.autoFuel;
                const teleFuel = fuel.teleFuel;
                const endgameFuel = fuel.endgameFuel;
                const autoClimb = entry.auto?.successfulClimb ? 15 : 0;
                const end = String(entry.endgame?.status || "").toLowerCase();
                const endgameClimb = end === "level-1" ? 10 : end === "level-2" ? 20 : end === "level-3" ? 30 : 0;
                const totalUsed = autoFuel + teleFuel + endgameFuel + autoClimb + endgameClimb;
                const entryFlags = evaluateScoutingFlags(entry as unknown as Record<string, unknown>);
                const flagState = flagStates[flagStateDocId("scoutingEntry", entry.id)];
                const isFlagDismissed = Boolean(flagState?.dismissed);
                const isManualFlagged = Boolean(flagState?.manualFlagged);
                const autoFlags = isFlagDismissed ? [] : entryFlags;
                const flagCount = autoFlags.length + (isManualFlagged ? 1 : 0);
                const isExcluded = Boolean(entry.excludeFromStats);
                return (
                <tr key={entry.id} className={isExcluded ? "line-through text-gray-500" : ""}>
                  <td className="sticky-left-0 bg-white font-semibold text-center">{matchLabel(entry)}</td>
                  <td className="sticky-left-1 bg-white font-semibold text-center">{displayEntryText(entry.teamNumber)}</td>
                  <td className="sticky-left-2 bg-white text-center">{displayEntryText(entry.scoutName)}</td>
                  <td className="text-center">{toDisplayTitle(entry.startingPosition)}</td>
                  <td className="text-center">{rebuiltPreloadRange(entry.auto?.preloadScale)}</td>
                  <td className="text-center">{rebuiltBpsRange(entry.auto?.bpsScale)}</td>
                  <td className="text-center">{rebuiltCarryRange(entry.auto?.carryingScale)}</td>
                  <td className="text-center">{formatFuelValue(autoFuel, fuel.autoSectionEstimated)}</td>
                  <td className="text-center">{fuel.autoHumanFuel}</td>
                  <td className="text-center">{autoClimb}</td>
                  <td className="text-center" style={{ minWidth: "140px", whiteSpace: "normal", overflowWrap: "anywhere" }}>{formatCyclesCell(entry.auto?.cycleTimes)}</td>
                  <td className="text-center">{rebuiltBpsRange(entry.teleop?.bpsScale)}</td>
                  <td className="text-center">{rebuiltCarryRange(entry.teleop?.carryingScale)}</td>
                  <td className="text-center">{formatFuelValue(fuel.transitionFuel, fuel.transitionEstimatedUsed)}</td>
                  <td className="text-center">{formatFuelValue(fuel.shift1Fuel, fuel.shift1EstimatedUsed)}</td>
                  <td className="text-center">{formatFuelValue(fuel.shift2Fuel, fuel.shift2EstimatedUsed)}</td>
                  <td className="text-center">{formatFuelValue(fuel.shift3Fuel, fuel.shift3EstimatedUsed)}</td>
                  <td className="text-center">{formatFuelValue(fuel.shift4Fuel, fuel.shift4EstimatedUsed)}</td>
                  <td className="text-center">{fuel.teleHumanFuel}</td>
                  <td className="text-center">{formatFuelValue(teleFuel, fuel.teleEstimatedUsed)}</td>
                  <td className="text-center" style={{ minWidth: "140px", whiteSpace: "normal", overflowWrap: "anywhere" }}>{formatCyclesCell(entry.teleop?.transitionCycles)}</td>
                  <td className="text-center" style={{ minWidth: "140px", whiteSpace: "normal", overflowWrap: "anywhere" }}>{formatCyclesCell(entry.teleop?.shift1Cycles)}</td>
                  <td className="text-center" style={{ minWidth: "140px", whiteSpace: "normal", overflowWrap: "anywhere" }}>{formatCyclesCell(entry.teleop?.shift2Cycles)}</td>
                  <td className="text-center" style={{ minWidth: "140px", whiteSpace: "normal", overflowWrap: "anywhere" }}>{formatCyclesCell(entry.teleop?.shift3Cycles)}</td>
                  <td className="text-center" style={{ minWidth: "140px", whiteSpace: "normal", overflowWrap: "anywhere" }}>{formatCyclesCell(entry.teleop?.shift4Cycles)}</td>
                  <td className="text-center">{formatFuelValue(fuel.endgameFuel, fuel.endgameSectionEstimated)}</td>
                  <td className="text-center">{fuel.endgameHumanFuel}</td>
                  <td className="text-center">{toDisplayTitle(entry.endgame?.status || entry.stageStatus || "-")}</td>
                  <td className="text-center">{endgameClimb}</td>
                  <td className="text-center" style={{ minWidth: "140px", whiteSpace: "normal", overflowWrap: "anywhere" }}>{formatCyclesCell(entry.endgame?.cycleTimes)}</td>
                  <td className="text-center">
                    {entry.incidents?.map((incident) => INCIDENT_LABELS[incident] || incident).join(", ") || "-"}
                  </td>
                  <td className="text-center font-semibold">{totalUsed}</td>
                  <td className="text-left align-top" style={{ minWidth: "220px", maxWidth: "360px" }}>
                    <ExpandableNotesCell text={entry.notes} />
                  </td>
                  {canViewAdminColumns && (
                    <td className="text-center">
                      {typeof (entry as Entry & { accuracy?: number }).accuracy === "number" ? (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedAccuracyEntry(entry);
                            void loadAccuracyDetails(entry);
                          }}
                          className="underline decoration-dotted underline-offset-2"
                          style={{ color: "var(--primary-color)" }}
                        >
                          {`${Math.round((entry as Entry & { accuracy?: number }).accuracy || 0)}%`}
                        </button>
                      ) : (
                        "-"
                      )}
                    </td>
                  )}
                  {canViewAdminColumns && <td className="text-center">{formatScriptStatus(entry.scriptStatus)}</td>}
                  {canViewAdminColumns && (
                    <td className="text-center">
                      {canManageFlags && (
                        <div className="mb-2">
                          <button
                            type="button"
                            onClick={() => setFlagMenuEntry(entry)}
                            disabled={flagSavingKey === flagStateDocId("scoutingEntry", entry.id)}
                            className="px-2 py-1 rounded border border-gray-300 bg-gray-50 text-gray-800 text-xs disabled:opacity-50"
                          >
                            {`Config${flagCount > 0 ? ` (${flagCount})` : ""}`}
                          </button>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={(event) => triggerDeleteEntry(entry, event)}
                        onPointerUp={(event) => triggerDeleteEntry(entry, event)}
                        className="px-3 py-1 rounded text-white text-sm touch-manipulation disabled:opacity-60"
                        style={{ backgroundColor: "#dc2626" }}
                        disabled={!canDeleteEntries}
                        title={canDeleteEntries ? undefined : "Only coaches or team admins can delete entries."}
                      >
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
        <table>
          <thead className="sticky-header">
            <tr>
              <th className="sticky-left-group sticky-row-1 bg-red-300 text-center" colSpan={2}>Information</th>
              <th className="sticky-left-2 sticky-row-1 bg-yellow-300 text-center" colSpan={1}>Pre-Match</th>
              <th className="bg-yellow-300 text-center" colSpan={1} />
              <th className="bg-green-300 text-center" colSpan={10}>Autonomous</th>
              <th className="bg-blue-300 text-center" colSpan={13}>Teleoperated</th>
              <th className="bg-purple-300 text-center" colSpan={2}>Endgame</th>
              <th className="bg-pink-300 text-center" colSpan={canViewAdminColumns ? 4 : 2}>General</th>
              {canViewAdminColumns && <th className="bg-gray-300 text-center" colSpan={1} />}
            </tr>
            <tr>
              <th className="sticky-left-group sticky-row-2 bg-red-200 text-center" colSpan={2}>Information</th>
              <th className="sticky-left-2 sticky-row-2 bg-yellow-200 text-center" colSpan={1}>Pre-Match</th>
              <th className="bg-yellow-200 text-center" colSpan={1} />
              <th className="bg-green-200 text-center" colSpan={1}>Leave</th>
              <th className="bg-green-200 text-center" colSpan={5}>Coral</th>
              <th className="bg-green-200 text-center" colSpan={2}>Algae Processor</th>
              <th className="bg-green-200 text-center" colSpan={2}>Algae Net</th>
              <th className="bg-blue-200 text-center" colSpan={5}>Coral</th>
              <th className="bg-blue-200 text-center" colSpan={1}>Algae Collection</th>
              <th className="bg-blue-200 text-center" colSpan={2}>Algae Processor</th>
              <th className="bg-blue-200 text-center" colSpan={2}>Algae Net (Robot)</th>
              <th className="bg-blue-200 text-center" colSpan={2}>Algae Net (Human)</th>
              <th className="bg-purple-200 text-center" colSpan={1}>Climb</th>
              <th className="bg-purple-200 text-center" colSpan={1}>End Place</th>
              <th className="bg-pink-200 text-center" colSpan={2}>Comments</th>
              {canViewAdminColumns && <th className="bg-pink-200 text-center" colSpan={1}>Accuracy Script</th>}
              {canViewAdminColumns && <th className="bg-pink-200 text-center" colSpan={1}>Script Status</th>}
              {canViewAdminColumns && <th className="bg-gray-200 text-center" colSpan={1}>Actions</th>}
            </tr>
            <tr>
              <th className="sticky-left-0 sticky-row-3 cursor-pointer text-center" onClick={() => handleSort("matchLabel")}>
                {sortLabel(sortKey, sortDir, "matchLabel", "Match")}
              </th>
              <th className="sticky-left-1 sticky-row-3 cursor-pointer text-center" onClick={() => handleSort("teamNumber")}>
                {sortLabel(sortKey, sortDir, "teamNumber", "Team")}
              </th>
              <th className="sticky-left-2 sticky-row-3 cursor-pointer text-center" onClick={() => handleSort("scoutName")}>
                {sortLabel(sortKey, sortDir, "scoutName", "Scout")}
              </th>
              <th className="cursor-pointer text-center" onClick={() => handleSort("startingPosition")}>
                {sortLabel(sortKey, sortDir, "startingPosition", "Starting Position")}
              </th>
              <th className="cursor-pointer text-center" onClick={() => handleSort("leftStartingZone")}>
                {sortLabel(sortKey, sortDir, "leftStartingZone", "Leave")}
              </th>
              <th className="cursor-pointer text-center" onClick={() => handleSort("autoCoralMissed")}>
                {sortLabel(sortKey, sortDir, "autoCoralMissed", "Missed")}
              </th>
              <th className="cursor-pointer text-center" onClick={() => handleSort("autoCoralL1")}>
                {sortLabel(sortKey, sortDir, "autoCoralL1", "L1")}
              </th>
              <th className="cursor-pointer text-center" onClick={() => handleSort("autoCoralL2")}>
                {sortLabel(sortKey, sortDir, "autoCoralL2", "L2")}
              </th>
              <th className="cursor-pointer text-center" onClick={() => handleSort("autoCoralL3")}>
                {sortLabel(sortKey, sortDir, "autoCoralL3", "L3")}
              </th>
              <th className="cursor-pointer text-center" onClick={() => handleSort("autoCoralL4")}>
                {sortLabel(sortKey, sortDir, "autoCoralL4", "L4")}
              </th>
              <th className="cursor-pointer text-center" onClick={() => handleSort("autoAlgaeProcessorMissed")}>
                {sortLabel(sortKey, sortDir, "autoAlgaeProcessorMissed", "Missed")}
              </th>
              <th className="cursor-pointer text-center" onClick={() => handleSort("autoAlgaeProcessorScored")}>
                {sortLabel(sortKey, sortDir, "autoAlgaeProcessorScored", "Scored")}
              </th>
              <th className="cursor-pointer text-center" onClick={() => handleSort("autoAlgaeNetMissed")}>
                {sortLabel(sortKey, sortDir, "autoAlgaeNetMissed", "Missed")}
              </th>
              <th className="cursor-pointer text-center" onClick={() => handleSort("autoAlgaeNetScored")}>
                {sortLabel(sortKey, sortDir, "autoAlgaeNetScored", "Scored")}
              </th>
              <th className="cursor-pointer text-center" onClick={() => handleSort("teleopCoralMissed")}>
                {sortLabel(sortKey, sortDir, "teleopCoralMissed", "Missed")}
              </th>
              <th className="cursor-pointer text-center" onClick={() => handleSort("teleopCoralL1")}>
                {sortLabel(sortKey, sortDir, "teleopCoralL1", "L1")}
              </th>
              <th className="cursor-pointer text-center" onClick={() => handleSort("teleopCoralL2")}>
                {sortLabel(sortKey, sortDir, "teleopCoralL2", "L2")}
              </th>
              <th className="cursor-pointer text-center" onClick={() => handleSort("teleopCoralL3")}>
                {sortLabel(sortKey, sortDir, "teleopCoralL3", "L3")}
              </th>
              <th className="cursor-pointer text-center" onClick={() => handleSort("teleopCoralL4")}>
                {sortLabel(sortKey, sortDir, "teleopCoralL4", "L4")}
              </th>
              <th className="cursor-pointer text-center" onClick={() => handleSort("teleopAlgaeRemoved")}>
                {sortLabel(sortKey, sortDir, "teleopAlgaeRemoved", "Removed Reef")}
              </th>
              <th className="cursor-pointer text-center" onClick={() => handleSort("teleopProcessorMissed")}>
                {sortLabel(sortKey, sortDir, "teleopProcessorMissed", "Missed")}
              </th>
              <th className="cursor-pointer text-center" onClick={() => handleSort("teleopProcessorScored")}>
                {sortLabel(sortKey, sortDir, "teleopProcessorScored", "Scored")}
              </th>
              <th className="cursor-pointer text-center" onClick={() => handleSort("teleopNetRobotMissed")}>
                {sortLabel(sortKey, sortDir, "teleopNetRobotMissed", "Missed")}
              </th>
              <th className="cursor-pointer text-center" onClick={() => handleSort("teleopNetRobotScored")}>
                {sortLabel(sortKey, sortDir, "teleopNetRobotScored", "Scored")}
              </th>
              <th className="cursor-pointer text-center" onClick={() => handleSort("teleopNetHumanMissed")}>
                {sortLabel(sortKey, sortDir, "teleopNetHumanMissed", "Missed")}
              </th>
              <th className="cursor-pointer text-center" onClick={() => handleSort("teleopNetHumanScored")}>
                {sortLabel(sortKey, sortDir, "teleopNetHumanScored", "Scored")}
              </th>
              <th className="cursor-pointer text-center" onClick={() => handleSort("failedClimb")}>
                {sortLabel(sortKey, sortDir, "failedClimb", "Failed")}
              </th>
              <th className="cursor-pointer text-center" onClick={() => handleSort("stageStatus")}>
                {sortLabel(sortKey, sortDir, "stageStatus", "End Place")}
              </th>
              <th className="cursor-pointer text-center" onClick={() => handleSort("incidents")}>
                {sortLabel(sortKey, sortDir, "incidents", "Miscellaneous")}
              </th>
              <th className="cursor-pointer text-center" style={{ minWidth: "260px" }} onClick={() => handleSort("notes")}>
                {sortLabel(sortKey, sortDir, "notes", "Comments")}
              </th>
              {canViewAdminColumns && (
                <th className="cursor-pointer text-center" onClick={() => handleSort("accuracy")}>
                  {sortLabel(sortKey, sortDir, "accuracy", "Alliance Accuracy")}
                </th>
              )}
              {canViewAdminColumns && (
                <th className="cursor-pointer text-center" onClick={() => handleSort("scriptStatus")}>
                  {sortLabel(sortKey, sortDir, "scriptStatus", "Script Status")}
                </th>
              )}
              {canViewAdminColumns && (
                <th className="cursor-pointer text-center" onClick={() => handleSort("id")}>
                  {sortLabel(sortKey, sortDir, "id", "Actions")}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {data.map((entry) => {
              const entryFlags = evaluateScoutingFlags(entry as unknown as Record<string, unknown>);
              const flagState = flagStates[flagStateDocId("scoutingEntry", entry.id)];
              const isFlagDismissed = Boolean(flagState?.dismissed);
              const isManualFlagged = Boolean(flagState?.manualFlagged);
              const autoFlags = isFlagDismissed ? [] : entryFlags;
              const flagCount = autoFlags.length + (isManualFlagged ? 1 : 0);
              const isExcluded = Boolean(entry.excludeFromStats);
              return (
              <tr key={entry.id} className={isExcluded ? "line-through text-gray-500" : ""}>
                <td className="sticky-left-0 bg-white font-semibold text-center">{matchLabel(entry)}</td>
                <td className="sticky-left-1 bg-white font-semibold text-center">{displayEntryText(entry.teamNumber)}</td>
                <td className="sticky-left-2 bg-white text-center">{displayEntryText(entry.scoutName)}</td>
                <td className="text-center">{toDisplayTitle(entry.startingPosition)}</td>
                <td className="text-center">{entry.leftStartingZone ? "Y" : "N"}</td>
                <td className="text-center">{entry.autoCoralMissed || 0}</td>
                <td className="text-center">{entry.autoCoralL1 || 0}</td>
                <td className="text-center">{entry.autoCoralL2 || 0}</td>
                <td className="text-center">{entry.autoCoralL3 || 0}</td>
                <td className="text-center">{entry.autoCoralL4 || 0}</td>
                <td className="text-center">{entry.autoAlgaeProcessorMissed || 0}</td>
                <td className="text-center">{entry.autoAlgaeProcessorScored || 0}</td>
                <td className="text-center">{entry.autoAlgaeNetMissed || 0}</td>
                <td className="text-center">{entry.autoAlgaeNetScored || 0}</td>
                <td className="text-center">{entry.teleopCoralMissed || 0}</td>
                <td className="text-center">{entry.teleopCoralL1 || 0}</td>
                <td className="text-center">{entry.teleopCoralL2 || 0}</td>
                <td className="text-center">{entry.teleopCoralL3 || 0}</td>
                <td className="text-center">{entry.teleopCoralL4 || 0}</td>
                <td className="text-center">{entry.teleopAlgaeRemoved ? "Y" : "N"}</td>
                <td className="text-center">{entry.teleopProcessorMissed || 0}</td>
                <td className="text-center">{entry.teleopProcessorScored || 0}</td>
                <td className="text-center">{entry.teleopNetRobotMissed || 0}</td>
                <td className="text-center">{entry.teleopNetRobotScored || 0}</td>
                <td className="text-center">{entry.teleopNetHumanMissed || 0}</td>
                <td className="text-center">{entry.teleopNetHumanScored || 0}</td>
                <td className="text-center">{entry.failedClimb || 0}</td>
                <td className="text-center">{toDisplayTitle(entry.stageStatus || "-")}</td>
                <td className="text-center">
                  {entry.incidents?.map((incident) => INCIDENT_LABELS[incident] || incident).join(", ") || "-"}
                </td>
                <td className="text-left align-top" style={{ minWidth: "220px", maxWidth: "360px" }}>
                  <ExpandableNotesCell text={entry.notes} />
                </td>
                {canViewAdminColumns && (
                  <td className="text-center">
                    {typeof (entry as Entry & { accuracy?: number }).accuracy === "number" ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedAccuracyEntry(entry);
                          void loadAccuracyDetails(entry);
                        }}
                        className="underline decoration-dotted underline-offset-2"
                        style={{ color: "var(--primary-color)" }}
                      >
                        {`${Math.round((entry as Entry & { accuracy?: number }).accuracy || 0)}%`}
                      </button>
                    ) : (
                      "-"
                    )}
                  </td>
                )}
                {canViewAdminColumns && <td className="text-center">{formatScriptStatus(entry.scriptStatus)}</td>}
                {canViewAdminColumns && (
                  <td className="text-center">
                    {canManageFlags && (
                      <div className="mb-2">
                        <button
                          type="button"
                          onClick={() => setFlagMenuEntry(entry)}
                          disabled={flagSavingKey === flagStateDocId("scoutingEntry", entry.id)}
                          className="px-2 py-1 rounded border border-gray-300 bg-gray-50 text-gray-800 text-xs disabled:opacity-50"
                        >
                          {`Config${flagCount > 0 ? ` (${flagCount})` : ""}`}
                        </button>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={(event) => triggerDeleteEntry(entry, event)}
                      onPointerUp={(event) => triggerDeleteEntry(entry, event)}
                      className="px-3 py-1 rounded text-white text-sm touch-manipulation disabled:opacity-60"
                      style={{ backgroundColor: "#dc2626" }}
                      disabled={!canDeleteEntries}
                      title={canDeleteEntries ? undefined : "Only coaches or team admins can delete entries."}
                    >
                      Delete
                    </button>
                  </td>
                )}
              </tr>
              );
            })}
          </tbody>
        </table>
        )}
      </div>

      {selectedAccuracyEntry && (
        <div className="fixed inset-0 bg-black/45 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-xl font-semibold mb-3">Alliance Accuracy Details</h2>
            {(() => {
              return (
                <div className="space-y-2 text-sm">
                  <p><span className="font-semibold">Match:</span> {accuracyDetails.matchLabelUsed || "-"}</p>
                  <p><span className="font-semibold">Event:</span> {accuracyDetails.eventKeyUsed || "Unknown"}</p>
                  <p><span className="font-semibold">Scouted Points:</span> {accuracyDetails.scoutedPoints}</p>
                  <p><span className="font-semibold">Actual Points:</span> {accuracyDetails.actualPoints ?? "Unavailable"}</p>
                  <p>
                    <span className="font-semibold">All Robots Scouted:</span>{" "}
                    {accuracyModalLoading ? "Checking..." : accuracyDetails.allRobotsScouted === "yes" ? "Yes" : accuracyDetails.allRobotsScouted === "no" ? "No" : "Unknown"}
                  </p>
                  <p><span className="font-semibold">Penalty Points:</span> {accuracyDetails.penaltyPoints}</p>
                  {accuracyRobotBreakdown.length > 0 && (
                    <div className="pt-2">
                      <p className="font-semibold mb-1">Score Breakdown</p>
                      <div className="space-y-1 text-xs">
                        {accuracyRobotBreakdown.map((row) => (
                          <p key={`${row.teamNumber}-${row.source}`}>
                            Team {row.teamNumber}: {row.total}{" "}
                            {row.source === "computed"
                              ? `(autoFuel=${row.autoFuel} + teleFuel=${row.teleFuel} + autoClimb=${row.autoClimb} + endgameClimb=${row.endgameClimb})`
                              : "(REEFSCAPE scorer)"}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
            <div className="mt-5">
              <button
                onClick={() => setSelectedAccuracyEntry(null)}
                className="w-full py-2 rounded text-white font-semibold"
                style={{ backgroundColor: "var(--primary-color)" }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {flagMenuEntry && canManageFlags && (
        <div className="fixed inset-0 bg-black/45 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
            {(() => {
              const stateId = flagStateDocId("scoutingEntry", flagMenuEntry.id);
              const flagState = flagStates[stateId];
              const entryFlags = evaluateScoutingFlags(flagMenuEntry as unknown as Record<string, unknown>);
              const isDismissed = Boolean(flagState?.dismissed);
              const isManualFlagged = Boolean(flagState?.manualFlagged);
              const isExcluded = Boolean(flagMenuEntry.excludeFromStats);
              const manualReasonValue = flagState?.manualReason || manualFlagReason;
              const reasonLabel =
                MANUAL_FLAG_REASONS.find((reason) => reason.value === manualReasonValue)?.label ||
                manualReasonValue ||
                "Manual flag";

              return (
                <div className="space-y-4">
                  <div>
                    <h2 className="text-xl font-semibold">Config</h2>
                    <p className="text-sm text-gray-600">
                      Match {matchLabel(flagMenuEntry)} • Team {displayEntryText(flagMenuEntry.teamNumber)}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="font-semibold">Auto Flags</div>
                    {entryFlags.length === 0 && <p className="text-sm text-gray-600">No auto flags detected.</p>}
                    {entryFlags.length > 0 && (
                      <div className="space-y-2">
                        {entryFlags.map((flag) => (
                          <div key={flag.code} className="rounded border border-amber-200 bg-amber-50 p-2 text-sm">
                            <div className="font-semibold text-amber-900">{flag.label}</div>
                            <div className="text-amber-800">{flag.detail}</div>
                          </div>
                        ))}
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void setScoutingEntryFlagDismissed(flagMenuEntry.id, !isDismissed)}
                            disabled={flagSavingKey === stateId}
                            className="px-3 py-1 rounded border border-amber-300 bg-amber-50 text-amber-900 text-sm disabled:opacity-50"
                          >
                            {isDismissed ? "Restore Auto Flags" : "Dismiss Auto Flags"}
                          </button>
                          {isDismissed && <span className="text-xs text-gray-600">Auto flags are dismissed.</span>}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="font-semibold">Manual Flag</div>
                    {isManualFlagged && (
                      <p className="text-sm text-gray-700">
                        Current reason: <span className="font-semibold">{reasonLabel}</span>
                      </p>
                    )}
                    <label className="block text-sm font-medium text-gray-700">
                      Reason
                      <select
                        value={manualFlagReason}
                        onChange={(event) => setManualFlagReason(event.target.value)}
                        className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                      >
                        {MANUAL_FLAG_REASONS.map((reason) => (
                          <option key={reason.value} value={reason.value}>
                            {reason.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void setScoutingEntryManualFlag(flagMenuEntry.id, true, manualFlagReason)}
                        disabled={flagSavingKey === stateId}
                        className="px-3 py-1 rounded border border-red-300 bg-red-50 text-red-900 text-sm disabled:opacity-50"
                      >
                        {isManualFlagged ? "Update Manual Flag" : "Add Manual Flag"}
                      </button>
                      {isManualFlagged && (
                        <button
                          type="button"
                          onClick={() => void setScoutingEntryManualFlag(flagMenuEntry.id, false)}
                          disabled={flagSavingKey === stateId}
                          className="px-3 py-1 rounded border border-gray-300 bg-gray-50 text-gray-800 text-sm disabled:opacity-50"
                        >
                          Remove Manual Flag
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="font-semibold">Stats Exclusion</div>
                    <p className="text-sm text-gray-600">
                      Excluded entries stay visible here but will be ignored by stats and averages.
                    </p>
                    <button
                      type="button"
                      onClick={() => void setScoutingEntryExcluded(flagMenuEntry.id, !isExcluded)}
                      disabled={excludeSavingId === flagMenuEntry.id}
                      className={`px-3 py-1 rounded border text-sm disabled:opacity-50 ${
                        isExcluded
                          ? "border-green-300 bg-green-50 text-green-900"
                          : "border-gray-300 bg-gray-50 text-gray-800"
                      }`}
                    >
                      {isExcluded ? "Include In Stats" : "Exclude From Stats"}
                    </button>
                  </div>

                  <div>
                    <button
                      type="button"
                      onClick={() => setFlagMenuEntry(null)}
                      className="w-full py-2 rounded text-white font-semibold"
                      style={{ backgroundColor: "var(--primary-color)" }}
                    >
                      Close
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </AnalyticsShell>
  );
}

export default function AnalyticsPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["coach", "scout"]}>
      <AnalyticsPageContent />
    </ProtectedRoute>
  );
}

