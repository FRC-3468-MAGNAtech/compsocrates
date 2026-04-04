"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, getDocs, query, where, deleteDoc, doc, updateDoc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import DataSourceCredits from "@/app/components/DataSourceCredits";
import { Users, Target, ClipboardList, ChevronDown } from "lucide-react";
import { calculateAccuracy } from "@/app/utils/practiceTypes";
import {
  calculateMatchAccuracyFromTotals,
  calculateScoutAccuracy,
  type ScoutAccuracyStatus,
  type ScoutAccuracyConfidence,
} from "@/app/utils/scoutAccuracy";
import { getRoleBadge as getTeamRoleBadge, getUserRoles, getRoleLabel, TEAM_ROLES, type TeamRole } from "@/app/utils/roles";
import { evaluateScoutingFlags, flagStateDocId, type FlagEntityType, type StoredFlagState } from "@/app/utils/scoutingFlags";
import { getUpcomingEvents, type UpcomingEvent } from "@/app/utils/stats-calculator";
import { entryMatchesAnalyticsFilters, getEventsForGame, normalizeMatchLabel } from "@/app/utils/analyticsEvents";
import { formatMatchLabelLong } from "@/app/utils/displayFormat";

interface ScoutStats {
  scoutId: string;
  scoutName: string;
  role: string;
  roles?: string[];
  secondaryRoles?: string[];
  totalEntries: number;
  practiceSessionsCompleted: number;
  averageAccuracy: number;
  confidenceLevel: ScoutAccuracyConfidence;
  status: ScoutAccuracyStatus;
  confirmed: boolean;
  lastPracticeDate: number;
  recentAccuracies: number[];
  recentSessions: Array<{
    sessionId: string;
    sessionNumber: number;
    accuracy: number;
    timestamp: number;
    deviceType?: "mobile" | "pc";
    flags: string[];
    dismissed: boolean;
    excluded: boolean;
  }>;
  allSessions: Array<{
    sessionId: string;
    sessionNumber: number;
    accuracy: number;
    timestamp: number;
    deviceType?: "mobile" | "pc";
    flags: string[];
    dismissed: boolean;
    excluded: boolean;
  }>;
  deviceBreakdown?: {
    mobileCount: number;
    pcCount: number;
    mobileAvg: number;
    pcAvg: number;
    betterDevice: "mobile" | "pc" | "tie" | null;
  };
}

type ScoutingEntry = {
  id?: string;
  practiceSessionId?: string;
  scoutName?: string;
  eventKey?: string;
  eventName?: string;
  matchType?: string;
  matchNumber?: string;
  matchKey?: string;
  matchLabel?: string;
  game?: string;
  matchId?: string;
  scoutId?: string;
  entryType?: string;
  formType?: string;
  isLeadScouting?: boolean;
  practiceMode?: string;
  isPracticeScouting?: boolean;
  isLivePracticeScouting?: boolean;
  deviceType?: "mobile" | "pc";
  teamNumber?: string;
  accuracy?: number;
  accuracyScriptStatus?: string;
  scriptStatus?: string;
  excludeFromStats?: boolean;
  submittedAt?: number;
  timestamp?: number;
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
  stageStatus?: string;
  penaltyPoints?: number;
  estimatedScore?: number;
  auto?: {
    preloadScale?: number;
    bpsScale?: number;
    carryingScale?: number;
    cycleTimes?: number[];
    counterOverride?: number;
    counterOverrideMissedFuel?: number;
    humanPlayerFuel?: number;
    estimatedFuel?: number;
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
    shiftParityFromWonAuto?: boolean;
    humanPlayerFuel?: number;
    estimatedFuel?: number;
  };
  endgame?: {
    cycleTimes?: number[];
    counterOverride?: number;
    counterOverrideMissedFuel?: number;
    humanPlayerFuel?: number;
    estimatedFuel?: number;
    status?: string;
  };
  accuracyDetails?: {
    scoutedPoints?: number;
    actualPoints?: number;
  };
};

function getEntryEventKey(value: ScoutingEntry): string {
  const explicit = String(
    value.eventKey || (value as Record<string, unknown>).event || (value as Record<string, unknown>).eventId || ""
  ).trim();
  if (explicit) return explicit;
  const matchKey = String(value.matchKey || "").trim();
  if (matchKey && matchKey.includes("_")) {
    return matchKey.split("_")[0] || "";
  }
  return "";
}

function getEntryGame(value: ScoutingEntry): "REEFSCAPE" | "REBUILT" {
  const explicit = String(value.game || "").trim().toUpperCase();
  if (explicit === "REBUILT" || explicit === "REEFSCAPE") return explicit;
  const eventKey = getEntryEventKey(value).toLowerCase();
  if (eventKey.startsWith("2026") || eventKey === "2026week0") return "REBUILT";
  return "REEFSCAPE";
}

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

const PRELOAD_SCALE_VALUES: number[][] = [
  [0],
  [1, 2],
  [3, 4],
  [5, 6],
  [7, 8],
];

const BPS_SCALE_VALUES: number[][] = [
  [0],
  [1, 2, 3],
  [4, 5, 6],
  [7, 8, 9],
  [10, 11, 12, 13],
  [14, 15, 16, 17],
  [18, 19, 20, 21],
  [22, 23, 24],
  [25],
];

const CARRY_SCALE_VALUES: number[][] = [
  [0],
  Array.from({ length: 12 }, (_, i) => i + 1),
  Array.from({ length: 11 }, (_, i) => i + 13),
  Array.from({ length: 10 }, (_, i) => i + 23),
  Array.from({ length: 10 }, (_, i) => i + 33),
  Array.from({ length: 11 }, (_, i) => i + 43),
  Array.from({ length: 11 }, (_, i) => i + 54),
  Array.from({ length: 10 }, (_, i) => i + 65),
  [75],
];

function getScaleCandidates(scale: unknown, table: number[][], fallback = 0) {
  const idx = Math.max(0, Math.min(table.length - 1, Number(scale || 0)));
  const values = table[idx];
  return values.length > 0 ? values : [fallback];
}

function estimateFuelFromCycles(
  cycles: number[] | undefined,
  bps: number,
  carry: number,
  preload?: number
) {
  if (!Array.isArray(cycles) || cycles.length === 0) return 0;
  return cycles.reduce((sum, rawSec, index) => {
    const sec = toNumber(rawSec);
    if (sec <= 0 || bps <= 0) return sum;
    const cap = index === 0 && typeof preload === "number" ? preload : carry;
    return sum + Math.max(0, Math.round(Math.min(Math.max(0, cap), bps * sec)));
  }, 0);
}

function resolveSectionFuel(estimated: number, scoredOverride: unknown, missedFuel: unknown) {
  const override = toNumber(scoredOverride);
  if (override > 0) return override;
  return Math.max(0, estimated - Math.max(0, toNumber(missedFuel)));
}

function isRealScoutingEntry(entry: ScoutingEntry) {
  return !entry.isPracticeScouting && !entry.isLivePracticeScouting;
}

function isMatchScoutEntry(entry: ScoutingEntry) {
  if (entry.isLeadScouting) return false;
  const entryType = String(entry.entryType || entry.formType || "").toLowerCase().trim();
  if (!entryType) return true;
  if (entryType === "lead" || entryType.includes("lead")) return false;
  if (entryType === "sub-in-request" || entryType === "sub-in-claim") return false;
  return true;
}

function getEntryTimestamp(entry: ScoutingEntry): number {
  const value = Number(entry.submittedAt || entry.timestamp || 0);
  return Number.isFinite(value) ? value : 0;
}

function getMatchIdentityKey(entry: ScoutingEntry): string {
  const matchKey = String(entry.matchKey || "").trim();
  if (matchKey) return matchKey;
  const matchId = String(entry.matchId || "").trim();
  const eventKey = getEntryEventKey(entry);
  if (matchId) return `${eventKey}:${matchId}`;
  const matchLabel = String(entry.matchLabel || "").trim();
  if (matchLabel) {
    const normalized = normalizeMatchLabel(matchLabel);
    if (normalized.matchId) return `${eventKey}:${normalized.matchId}`;
    if (normalized.matchType || normalized.matchNumber) {
      return `${eventKey}:${normalized.matchType}:${normalized.matchNumber}`;
    }
  }
  const matchType = String(entry.matchType || "").trim();
  const matchNumber = String(entry.matchNumber || "").trim();
  if (matchType || matchNumber) return `${eventKey}:${matchType}:${matchNumber}`;
  return String(entry.id || "");
}

function isAccuracyComplete(entry: ScoutingEntry): boolean {
  const status = String(entry.accuracyScriptStatus || entry.scriptStatus || "").trim().toLowerCase();
  return status === "complete";
}

function resolveMatchAccuracy(entry: ScoutingEntry): number | null {
  const details = entry.accuracyDetails;
  if (details && typeof details.scoutedPoints === "number" && typeof details.actualPoints === "number") {
    return calculateMatchAccuracyFromTotals(details.scoutedPoints, details.actualPoints);
  }
  if (typeof entry.accuracy === "number" && Number.isFinite(entry.accuracy)) {
    const normalized = Math.max(0, Math.min(1, entry.accuracy / 100));
    return normalized;
  }
  return null;
}

function isAllRobotsScouted(entry: ScoutingEntry): boolean {
  const details = (entry as ScoutingEntry & { accuracyDetails?: { allRobotsScouted?: string } }).accuracyDetails;
  if (details && typeof details.allRobotsScouted === "string") {
    return details.allRobotsScouted.toLowerCase() === "yes";
  }
  return isAccuracyComplete(entry);
}

function formatRealMatchLabel(entry: ScoutingEntry): string {
  const rawLabel = String(entry.matchLabel || "").trim();
  const fallbackLabel = String(entry.matchKey || entry.matchId || entry.matchType || "").trim();
  const primary = rawLabel || fallbackLabel;
  if (!primary) return "Match";
  return formatMatchLabelLong(primary);
}

type CalculationScope = {
  eventKey: string;
  practiceMode: "trial" | "competitive" | null;
};

function parseCalculationScope(value: string): CalculationScope {
  const trimmed = String(value || "").trim();
  if (!trimmed) return { eventKey: "all", practiceMode: null };
  const [eventKeyRaw, practiceModeRaw] = trimmed.split(":");
  const eventKey = eventKeyRaw || "all";
  const practiceMode =
    practiceModeRaw === "trial" || practiceModeRaw === "competitive" ? practiceModeRaw : null;
  return { eventKey, practiceMode };
}

function rebuiltEntryScoreCandidates(entry: ScoutingEntry): number[] {
  const autoPreloadCandidates = getScaleCandidates(entry.auto?.preloadScale, PRELOAD_SCALE_VALUES, 0);
  const autoBpsCandidates = getScaleCandidates(entry.auto?.bpsScale, BPS_SCALE_VALUES, 0);
  const autoCarryCandidates = getScaleCandidates(entry.auto?.carryingScale, CARRY_SCALE_VALUES, 0);
  const teleBpsCandidates = getScaleCandidates(entry.teleop?.bpsScale, BPS_SCALE_VALUES, 0);
  const teleCarryCandidates = getScaleCandidates(entry.teleop?.carryingScale, CARRY_SCALE_VALUES, 0);
  const countShiftsTwoFour =
    typeof entry.teleop?.shiftParityFromWonAuto === "boolean"
      ? entry.teleop.shiftParityFromWonAuto
      : Boolean(entry.auto?.wonAuto);
  const autoClimb = entry.auto?.successfulClimb ? 15 : 0;
  const endStatus = String(entry.endgame?.status || "").toLowerCase();
  const teleopClimb =
    endStatus === "level-1" ? 10 :
    endStatus === "level-2" ? 20 :
    endStatus === "level-3" ? 30 : 0;

  const candidates = new Set<number>();

  for (const preload of autoPreloadCandidates) {
    for (const autoBps of autoBpsCandidates) {
      for (const autoCarry of autoCarryCandidates) {
        const autoEstimated = estimateFuelFromCycles(entry.auto?.cycleTimes, autoBps, autoCarry, preload);
        const autoFuel = resolveSectionFuel(
          autoEstimated,
          entry.auto?.counterOverride,
          entry.auto?.counterOverrideMissedFuel
        ) + toNumber(entry.auto?.humanPlayerFuel);

        for (const teleBps of teleBpsCandidates) {
          for (const teleCarry of teleCarryCandidates) {
            const transition = resolveSectionFuel(
              estimateFuelFromCycles(entry.teleop?.transitionCycles, teleBps, teleCarry),
              entry.teleop?.transitionOverride,
              entry.teleop?.transitionMissedFuel
            );
            const shift1 = resolveSectionFuel(
              estimateFuelFromCycles(entry.teleop?.shift1Cycles, teleBps, teleCarry),
              entry.teleop?.shift1Override,
              entry.teleop?.shift1MissedFuel
            );
            const shift2 = resolveSectionFuel(
              estimateFuelFromCycles(entry.teleop?.shift2Cycles, teleBps, teleCarry),
              entry.teleop?.shift2Override,
              entry.teleop?.shift2MissedFuel
            );
            const shift3 = resolveSectionFuel(
              estimateFuelFromCycles(entry.teleop?.shift3Cycles, teleBps, teleCarry),
              entry.teleop?.shift3Override,
              entry.teleop?.shift3MissedFuel
            );
            const shift4 = resolveSectionFuel(
              estimateFuelFromCycles(entry.teleop?.shift4Cycles, teleBps, teleCarry),
              entry.teleop?.shift4Override,
              entry.teleop?.shift4MissedFuel
            );
            const teleFuel = transition + (countShiftsTwoFour ? shift2 + shift4 : shift1 + shift3) + toNumber(entry.teleop?.humanPlayerFuel);
            const endgameFuel = resolveSectionFuel(
              estimateFuelFromCycles(entry.endgame?.cycleTimes, teleBps, teleCarry),
              entry.endgame?.counterOverride,
              entry.endgame?.counterOverrideMissedFuel
            ) + toNumber(entry.endgame?.humanPlayerFuel);

            candidates.add(autoFuel + teleFuel + endgameFuel + autoClimb + teleopClimb);
          }
        }
      }
    }
  }

  if (candidates.size === 0) {
    candidates.add(scoreRebuiltEntry(entry));
  }

  return Array.from(candidates);
}

function calculateBestRebuiltPracticeScore(entries: ScoutingEntry[], targetBaseScore: number): number {
  if (entries.length === 0) return 0;
  let sums = new Set<number>([0]);

  for (const entry of entries) {
    const entryCandidates = rebuiltEntryScoreCandidates(entry);
    const next = new Set<number>();
    for (const base of sums) {
      for (const candidate of entryCandidates) {
        next.add(base + candidate);
      }
    }
    let trimmed = Array.from(next);
    if (trimmed.length > 6000) {
      trimmed = trimmed
        .sort((a, b) => Math.abs(a - targetBaseScore) - Math.abs(b - targetBaseScore))
        .slice(0, 6000);
    }
    sums = new Set(trimmed);
  }

  const best = Array.from(sums).sort(
    (a, b) => Math.abs(a - targetBaseScore) - Math.abs(b - targetBaseScore)
  )[0];
  return typeof best === "number" ? best : entries.reduce((sum, entry) => sum + scoreRebuiltEntry(entry), 0);
}

function scoreRebuiltEntry(entry: ScoutingEntry): number {
  const autoFuel = toNumber(entry.auto?.estimatedFuel);
  const teleopFuel = toNumber(entry.teleop?.estimatedFuel);
  const endgameFuel = toNumber(entry.endgame?.estimatedFuel);
  const autoClimb = entry.auto?.successfulClimb ? 15 : 0;
  const endStatus = String(entry.endgame?.status || "").toLowerCase();
  const teleopClimb =
    endStatus === "level-1" ? 10 :
    endStatus === "level-2" ? 20 :
    endStatus === "level-3" ? 30 : 0;

  return autoFuel + teleopFuel + endgameFuel + autoClimb + teleopClimb;
}

function getDeviceBreakdown(points: Array<{ deviceType?: "mobile" | "pc"; accuracy: number }>) {
  const mobile = points.filter((p) => p.deviceType === "mobile");
  const pc = points.filter((p) => p.deviceType === "pc");
  const mobileAvg = mobile.length ? mobile.reduce((sum, p) => sum + p.accuracy, 0) / mobile.length : 0;
  const pcAvg = pc.length ? pc.reduce((sum, p) => sum + p.accuracy, 0) / pc.length : 0;
  let betterDevice: "mobile" | "pc" | "tie" | null = null;
  if (mobile.length > 0 && pc.length > 0) {
    if (mobileAvg > pcAvg) betterDevice = "mobile";
    else if (pcAvg > mobileAvg) betterDevice = "pc";
    else betterDevice = "tie";
  }
  return { mobileCount: mobile.length, pcCount: pc.length, mobileAvg, pcAvg, betterDevice };
}

function scorePracticeEntryWithoutPenalty(entry: ScoutingEntry, game: "REEFSCAPE" | "REBUILT"): number {
  if (game === "REBUILT") return scoreRebuiltEntry(entry);

  let score = 0;
  if (entry.leftStartingZone) score += 3;
  score += (entry.autoCoralL1 || 0) * 3;
  score += (entry.autoCoralL2 || 0) * 4;
  score += (entry.autoCoralL3 || 0) * 6;
  score += (entry.autoCoralL4 || 0) * 7;
  score += (entry.autoAlgaeProcessorScored || 0) * 6;
  score += (entry.autoAlgaeNetScored || 0) * 4;
  score += (entry.teleopCoralL1 || 0) * 2;
  score += (entry.teleopCoralL2 || 0) * 3;
  score += (entry.teleopCoralL3 || 0) * 4;
  score += (entry.teleopCoralL4 || 0) * 5;
  score += (entry.teleopProcessorScored || 0) * 6;
  score += (entry.teleopNetRobotScored || 0) * 4;
  score += (entry.teleopNetHumanScored || 0) * 4;
  const end = (entry.stageStatus || "").toLowerCase();
  if (end.includes("deep")) score += 12;
  else if (end.includes("shallow")) score += 6;
  else if (end.includes("park") || end.includes("barge")) score += 2;
  return score;
}

function ScoutAccuracyContent() {
  const { userData } = useAuth();
  const userRoles = getUserRoles({
    role: userData?.role,
    roles: userData?.roles,
    secondaryRoles: userData?.secondaryRoles,
  });
  const canViewFullAccuracy =
    Boolean(userData?.isTeamAdmin) ||
    userData?.role === "coach" ||
    userRoles.includes("team-coach") ||
    userRoles.includes("lead-scout");
  const canViewRealEventTab =
    Boolean(userData?.isTeamAdmin) ||
    userData?.role === "coach" ||
    userRoles.includes("lead-scout") ||
    userData?.role === "lead-scout";
  const canViewRestrictedData =
    Boolean(userData?.isTeamAdmin) ||
    userData?.role === "coach" ||
    userRoles.includes("team-coach") ||
    userRoles.includes("lead-scout") ||
    userRoles.includes("lead-strategist");
  const canManageFlags =
    Boolean(userData?.isTeamAdmin) ||
    userData?.role === "coach" ||
    userRoles.includes("team-coach");
  const [flagSaveKey, setFlagSaveKey] = useState("");
  const [flagStates, setFlagStates] = useState<Record<string, StoredFlagState>>({});
  const [scoutStats, setScoutStats] = useState<ScoutStats[]>([]);
  const [realScoutingEntries, setRealScoutingEntries] = useState<ScoutingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedScout, setSelectedScout] = useState<string | null>(null);
  const [selectedGame, setSelectedGame] = useState<"REEFSCAPE" | "REBUILT">("REBUILT");
  const [selectedMode, setSelectedMode] = useState<"trial" | "competitive" | "real">("trial");
  const [rerunningAccuracy, setRerunningAccuracy] = useState(false);
  const [rerunSessionId, setRerunSessionId] = useState("");
  const [rerunResultModal, setRerunResultModal] = useState<{
    sessionId: string;
    entries: number;
    accuracy: number;
    scoutedScore: number;
    officialScore: number;
  } | null>(null);
  const [showAllSessionsModal, setShowAllSessionsModal] = useState(false);
  const [eventOptions, setEventOptions] = useState<UpcomingEvent[]>([]);
  const [eventAttendees, setEventAttendees] = useState<Record<string, string[]>>({});
  const [attendanceFilter, setAttendanceFilter] = useState<string>("all");
  const [rankMode, setRankMode] = useState<"preserve" | "event" | "role">("preserve");
  const [roleFilters, setRoleFilters] = useState<TeamRole[]>([...TEAM_ROLES]);
  const [rolesDropdownOpen, setRolesDropdownOpen] = useState(false);
  const [calculationEvent, setCalculationEvent] = useState<string>("all");

  useEffect(() => {
    loadScoutStats();
  }, [selectedMode, selectedGame, userData?.teamId, calculationEvent]);

  useEffect(() => {
    if (!canViewRealEventTab && selectedMode === "real") {
      setSelectedMode("trial");
    }
  }, [canViewRealEventTab, selectedMode]);

  useEffect(() => {
    setSelectedScout(null);
    setShowAllSessionsModal(false);
  }, [selectedMode]);

  useEffect(() => {
    async function loadEventFilters() {
      if (!userData?.teamId) {
        setEventOptions([]);
        setEventAttendees({});
        setAttendanceFilter("all");
        return;
      }
      try {
        const [events, teamDoc] = await Promise.all([
          getUpcomingEvents(userData.teamId),
          getDoc(doc(db, "teams", userData.teamId)),
        ]);
        setEventOptions(events);
        const attendees = (teamDoc.exists()
          ? (teamDoc.data().eventAttendees as Record<string, string[]> | undefined)
          : {}) || {};
        setEventAttendees(attendees);
      } catch (error) {
        console.error("Failed loading event attendance for scout accuracy:", error);
        setEventOptions([]);
        setEventAttendees({});
      }
    }
    void loadEventFilters();
  }, [userData?.teamId]);

  useEffect(() => {
    const scope = parseCalculationScope(calculationEvent);
    if (scope.eventKey === "all") return;
    const validKeys = new Set(eventOptions.map((event) => event.key));
    if (!validKeys.has(scope.eventKey)) {
      setCalculationEvent("all");
    }
  }, [calculationEvent, eventOptions]);

  const allRolesSelected = roleFilters.length === TEAM_ROLES.length;
  const roleFilterSet = useMemo(() => new Set(roleFilters), [roleFilters]);
  const calculationScope = useMemo(() => parseCalculationScope(calculationEvent), [calculationEvent]);
  const includePracticeInReal = Boolean(calculationScope.practiceMode);
  const realModeMatchesLabel = "Matches";
  const calculationOptions = useMemo(() => {
    const options: Array<{ value: string; label: string }> = [
      { value: "all", label: "All Events" },
      { value: "all:trial", label: "All Events (Trial Practice)" },
      { value: "all:competitive", label: "All Events (Competitive Practice)" },
    ];
    eventOptions.forEach((event) => {
      options.push({ value: event.key, label: event.name });
      options.push({ value: `${event.key}:trial`, label: `${event.name} (Trial Practice)` });
      options.push({ value: `${event.key}:competitive`, label: `${event.name} (Competitive Practice)` });
    });
    return options;
  }, [eventOptions]);

  useEffect(() => {
    if (rankMode === "role" && allRolesSelected) {
      setRankMode("preserve");
    }
  }, [allRolesSelected, rankMode]);

  useEffect(() => {
    if (rankMode === "role" && roleFilters.length === 0) {
      setRankMode("preserve");
    }
  }, [rankMode, roleFilters.length]);

  useEffect(() => {
    if (attendanceFilter === "all" && rankMode === "event") {
      setRankMode("preserve");
    }
  }, [attendanceFilter, rankMode]);

  async function loadScoutStats() {
    setLoading(true);
    if (selectedMode !== "real") {
      setRealScoutingEntries([]);
    }
    try {
      // Get ALL team members (no filtering)
      const teamQuery = query(collection(db, "users"), where("teamId", "==", userData?.teamId));
      const teamSnapshot = await getDocs(teamQuery);
      const allMembers = teamSnapshot.docs;
      const memberData = allMembers.map((memberDoc) => {
        const data = memberDoc.data();
        return {
          uid: memberDoc.id,
          scoutName: data.displayName as string,
          role: data.role as string,
          roles: (data.roles || []) as string[],
        };
      });
      const teamFlagStateById = new Map<string, StoredFlagState>();
      if (userData?.teamId) {
        try {
          const flagSnap = await getDocs(
            query(collection(db, "scoutingFlagStates"), where("teamId", "==", userData.teamId))
          );
          flagSnap.docs.forEach((docSnap) => {
            const row = docSnap.data() as StoredFlagState & { entityId?: string; entityType?: FlagEntityType };
            const entityId = String(row.entityId || "");
            const entityType = row.entityType === "practiceSession" ? "practiceSession" : "scoutingEntry";
            if (!entityId) return;
            teamFlagStateById.set(flagStateDocId(entityType, entityId), row);
          });
          setFlagStates(Object.fromEntries(teamFlagStateById.entries()));
        } catch (error) {
          console.warn("Unable to load scouting flag states for scout accuracy. Continuing without flag states.", error);
          setFlagStates({});
        }
      }
      if (selectedMode === "real") {
        const calculationScope = parseCalculationScope(calculationEvent);
        const calculationEventKey = calculationScope.eventKey;
        const includePractice = Boolean(calculationScope.practiceMode);
        const entriesSnap = await getDocs(collection(db, "scouting"));
        const allEntries = entriesSnap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as ScoutingEntry) }));
        const entriesByScoutId = new Map<string, ScoutingEntry[]>();
        const entriesByScoutName = new Map<string, ScoutingEntry[]>();
        allEntries.forEach((entry) => {
          const scoutId = String(entry.scoutId || "").trim();
          const scoutName = String(entry.scoutName || "").trim().toLowerCase();
          if (scoutId) {
            const bucket = entriesByScoutId.get(scoutId) || [];
            bucket.push(entry);
            entriesByScoutId.set(scoutId, bucket);
          }
          if (scoutName) {
            const bucket = entriesByScoutName.get(scoutName) || [];
            bucket.push(entry);
            entriesByScoutName.set(scoutName, bucket);
          }
        });

        const realEntriesBase = allEntries
          .filter((entry) => isRealScoutingEntry(entry))
          .filter((entry) => isMatchScoutEntry(entry))
          .filter((entry) => getEntryGame(entry) === selectedGame)
          .filter((entry) => !entry.excludeFromStats);
        const eventOptions = getEventsForGame(selectedGame);
        const matchesCalculationEvent = (entry: ScoutingEntry) =>
          calculationEventKey === "all"
            ? true
            : entryMatchesAnalyticsFilters(entry, selectedGame, calculationEventKey, eventOptions);
        const baseByEvent = realEntriesBase.filter((entry) =>
          matchesCalculationEvent(entry)
        );
        const realEntries = baseByEvent.filter((entry) => isAccuracyComplete(entry));
        setRealScoutingEntries(realEntries);

        const practiceByScoutId = new Map<string, number[]>();
        const practiceByScoutName = new Map<string, number[]>();
        if (includePractice && calculationScope.practiceMode) {
          try {
            const practiceSnap = await getDocs(
              query(collection(db, "practiceSessions"), where("mode", "==", calculationScope.practiceMode))
            );
            practiceSnap.docs.forEach((docSnap) => {
              const data = docSnap.data() as Record<string, unknown>;
              const accuracy = Number(data.accuracy);
              if (!Number.isFinite(accuracy)) return;
              const game = String(data.game || "REEFSCAPE").toUpperCase();
              if (game !== selectedGame) return;
              if (Boolean(data.isLivePracticeScouting)) return;
              const sessionTeamId = String(data.teamId || data.team || "").trim();
              if (userData?.teamId && sessionTeamId && sessionTeamId !== String(userData.teamId)) return;
              const excluded =
                Boolean(teamFlagStateById.get(flagStateDocId("practiceSession", docSnap.id))?.excludeFromAccuracy) ||
                Boolean((data as Record<string, unknown>).excludeFromAccuracy);
              if (excluded) return;
              const scoutId = String(data.scoutId || "").trim();
              const scoutName = String(data.scoutName || "").trim().toLowerCase();
              if (scoutId) {
                const current = practiceByScoutId.get(scoutId) || [];
                current.push(accuracy);
                practiceByScoutId.set(scoutId, current);
              } else if (scoutName) {
                const current = practiceByScoutName.get(scoutName) || [];
                current.push(accuracy);
                practiceByScoutName.set(scoutName, current);
              }
            });
          } catch (error) {
            console.warn("Unable to load practice sessions for real-event calculations:", error);
          }
        }

        const stats = memberData.map((member) => {
          const combined = new Map<string, ScoutingEntry>();
          (entriesByScoutId.get(member.uid) || []).forEach((entry) => {
            combined.set(String(entry.id || ""), entry);
          });
          (entriesByScoutName.get(String(member.scoutName || "").trim().toLowerCase()) || []).forEach((entry) => {
            combined.set(String(entry.id || ""), entry);
          });

          const filteredEntries = Array.from(combined.values())
            .filter((entry) => isRealScoutingEntry(entry))
            .filter((entry) => isMatchScoutEntry(entry))
            .filter((entry) => getEntryGame(entry) === selectedGame)
            .filter((entry) => !entry.excludeFromStats);
          const calculationEntries = filteredEntries.filter((entry) => matchesCalculationEvent(entry));
          const eligibleEntries = calculationEntries.filter((entry) => isAccuracyComplete(entry));
          const accuracyInputs = eligibleEntries
            .map((entry) => {
              const accuracy = resolveMatchAccuracy(entry);
              if (accuracy === null) return null;
              return { accuracy, environment: "real" as const };
            })
            .filter((row): row is { accuracy: number; environment: "real" } => Boolean(row));

          const scoutNameKey = String(member.scoutName || "").trim().toLowerCase();
          const practiceById = practiceByScoutId.get(member.uid) || [];
          const practiceByName = practiceByScoutName.get(scoutNameKey) || [];
          const practiceAccuracies = includePractice ? [...practiceById, ...practiceByName] : [];
          if (includePractice && calculationScope.practiceMode) {
            practiceAccuracies.forEach((accuracy) => {
              accuracyInputs.push({
                accuracy: Math.max(0, Math.min(1, accuracy / 100)),
                environment: calculationScope.practiceMode,
              });
            });
          }

          const accuracyResult = calculateScoutAccuracy(accuracyInputs, {
            mode: "real",
            minMatches: 5,
          });
          const averageAccuracy = accuracyResult.displayAccuracy;
          const lastSubmit = eligibleEntries.reduce((max, entry) => Math.max(max, getEntryTimestamp(entry)), 0);

          return {
            scoutId: member.uid,
            scoutName: member.scoutName,
            role: member.role,
            roles: member.roles,
            totalEntries: eligibleEntries.length,
            practiceSessionsCompleted: accuracyResult.totalMatches,
            averageAccuracy,
            confidenceLevel: accuracyResult.confidenceLevel,
            status: accuracyResult.status,
            confirmed: accuracyResult.confirmed,
            lastPracticeDate: lastSubmit || 0,
            recentAccuracies: [],
            recentSessions: [],
            allSessions: [],
          } as ScoutStats;
        });

        setScoutStats(
          stats.sort((a, b) => {
            const aHasSessions = a.practiceSessionsCompleted > 0 ? 1 : 0;
            const bHasSessions = b.practiceSessionsCompleted > 0 ? 1 : 0;
            if (aHasSessions !== bHasSessions) return bHasSessions - aHasSessions;
            if (b.averageAccuracy !== a.averageAccuracy) return b.averageAccuracy - a.averageAccuracy;
            if (b.totalEntries !== a.totalEntries) return b.totalEntries - a.totalEntries;
            return a.scoutName.localeCompare(b.scoutName);
          })
        );
        return;
      }
      const statsPromises = memberData.map(async (member) => {
        const [scoutEntriesByNameSnap, scoutEntriesByUidSnap] = await Promise.all([
          getDocs(query(collection(db, "scouting"), where("scoutName", "==", member.scoutName))),
          getDocs(query(collection(db, "scouting"), where("scoutId", "==", member.uid))),
        ]);
        const scoutEntriesMap = new Map<string, ScoutingEntry>();
        scoutEntriesByNameSnap.docs.forEach((docSnap) => {
          scoutEntriesMap.set(docSnap.id, { id: docSnap.id, ...(docSnap.data() as ScoutingEntry) });
        });
        scoutEntriesByUidSnap.docs.forEach((docSnap) => {
          scoutEntriesMap.set(docSnap.id, { id: docSnap.id, ...(docSnap.data() as ScoutingEntry) });
        });
        const scoutPracticeEntries = Array.from(scoutEntriesMap.values())
          .filter((row) => {
            if (!row.isPracticeScouting) return false;
            if (row.isLivePracticeScouting) return false;
            if (String(row.practiceMode || "").toLowerCase() !== selectedMode) return false;
            return getEntryGame(row) === selectedGame;
          });

        const [practiceByNameSnap, practiceByUidSnap] = await Promise.all([
          getDocs(
            query(
              collection(db, "practiceSessions"),
              where("scoutName", "==", member.scoutName),
              where("mode", "==", selectedMode)
            )
          ),
          getDocs(
            query(
              collection(db, "practiceSessions"),
              where("scoutId", "==", member.uid),
              where("mode", "==", selectedMode)
            )
          ),
        ]);
        const practiceRowsMap = new Map<string, Record<string, unknown>>();
        practiceByNameSnap.docs.forEach((docSnap) => {
          practiceRowsMap.set(docSnap.id, docSnap.data() as Record<string, unknown>);
        });
        practiceByUidSnap.docs.forEach((docSnap) => {
          practiceRowsMap.set(docSnap.id, docSnap.data() as Record<string, unknown>);
        });
        const practiceRows = Array.from(practiceRowsMap.entries())
          .map(([id, row]) => ({ id, row }))
          .filter(({ row }) => String(row.game || "REEFSCAPE").toUpperCase() === selectedGame)
          .filter(({ row }) => !row.isLivePracticeScouting);
        const scoutEntriesBySession = new Map<string, ScoutingEntry[]>();
        scoutPracticeEntries.forEach((entry) => {
          const sessionId = String(entry.practiceSessionId || "").trim();
          if (!sessionId) return;
          if (!scoutEntriesBySession.has(sessionId)) scoutEntriesBySession.set(sessionId, []);
          scoutEntriesBySession.get(sessionId)?.push(entry);
        });
        let recentAccuracies: number[] = [];
        let recentSessions: ScoutStats["recentSessions"] = [];
        let allSessions: ScoutStats["allSessions"] = [];
        let lastPracticeDate = 0;
        const practiceDevicePoints: Array<{ deviceType?: "mobile" | "pc"; accuracy: number }> = [];
        const accuracyTimeline: Array<{
          accuracy: number;
          timestamp: number;
          sessionId: string;
          deviceType?: "mobile" | "pc";
          flags: string[];
          dismissed: boolean;
          excluded: boolean;
        }> = [];
        practiceRows.forEach(({ id, row: data }) => {
          if (typeof data.accuracy === "number") {
            const rowTimestamp = Number(data.timestamp || data.completedAt || data.startedAt || 0);
            const linkedEntries = scoutEntriesBySession.get(id) || [];
            const sessionDeviceType = (data.deviceType as "mobile" | "pc" | undefined) ?? linkedEntries.find((entry) => entry.deviceType)?.deviceType;
            const hasManualFlaggedEntry = linkedEntries.some((entry) => {
              const entryId = String(entry.id || "").trim();
              return entryId ? Boolean(teamFlagStateById.get(flagStateDocId("scoutingEntry", entryId))?.manualFlagged) : false;
            });
            const flags = Array.from(
              new Set([
                ...linkedEntries.flatMap((entry) => evaluateScoutingFlags(entry).map((flag) => flag.label)),
                ...(hasManualFlaggedEntry ? ["Manual Flagged Entry"] : []),
              ])
            );
            const dismissed = Boolean(teamFlagStateById.get(flagStateDocId("practiceSession", id))?.dismissed);
            const excluded =
              Boolean(teamFlagStateById.get(flagStateDocId("practiceSession", id))?.excludeFromAccuracy) ||
              Boolean((data as Record<string, unknown>).excludeFromAccuracy);
            accuracyTimeline.push({
              accuracy: Number(data.accuracy || 0),
              timestamp: Number.isFinite(rowTimestamp) ? rowTimestamp : 0,
              sessionId: id,
              deviceType: sessionDeviceType,
              flags,
              dismissed,
              excluded,
            });
            if (!excluded) {
              practiceDevicePoints.push({
                deviceType: sessionDeviceType,
                accuracy: Number(data.accuracy || 0),
              });
            }
          }
          const rowTimestamp = Number(data.timestamp || data.completedAt || data.startedAt || 0);
          if (rowTimestamp > lastPracticeDate) {
            lastPracticeDate = rowTimestamp;
          }
        });
        const sortedTimeline = accuracyTimeline
          .slice()
          .sort((a, b) => b.timestamp - a.timestamp);
        const chronological = accuracyTimeline
          .slice()
          .sort((a, b) => {
            if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
            return a.sessionId.localeCompare(b.sessionId);
          });
        const sessionNumberById = new Map<string, number>();
        chronological.forEach((row, idx) => {
          sessionNumberById.set(row.sessionId, idx + 1);
        });
        const withSessionNumber = (row: typeof accuracyTimeline[number]) => ({
          ...row,
          sessionNumber: sessionNumberById.get(row.sessionId) || 1,
        });
        recentSessions = sortedTimeline.slice(0, 5).map(withSessionNumber);
        allSessions = sortedTimeline.map(withSessionNumber);
        recentAccuracies = recentSessions.map((row) => row.accuracy);
        const includedSessions = accuracyTimeline.filter((row) => !row.excluded);
        const practiceInputs = includedSessions.map((session) => ({
          accuracy: Math.max(0, Math.min(1, session.accuracy / 100)),
          environment: selectedMode,
        }));
        const practiceAccuracyResult = calculateScoutAccuracy(practiceInputs, {
          mode: selectedMode,
          minMatches: 5,
        });
        const averageAccuracy = practiceAccuracyResult.displayAccuracy;

        return {
          scoutId: member.uid,
          scoutName: member.scoutName,
          role: member.role,
          roles: member.roles,
          totalEntries: scoutPracticeEntries.length,
          practiceSessionsCompleted: practiceAccuracyResult.totalMatches,
          averageAccuracy,
          confidenceLevel: practiceAccuracyResult.confidenceLevel,
          status: practiceAccuracyResult.status,
          confirmed: practiceAccuracyResult.confirmed,
          lastPracticeDate: lastPracticeDate || Date.now(),
          recentAccuracies,
          recentSessions,
          allSessions,
          deviceBreakdown: getDeviceBreakdown(practiceDevicePoints),
        };
      });

      const stats = await Promise.all(statsPromises);
      setScoutStats(
        stats.sort((a, b) => {
          const aHasSessions = a.practiceSessionsCompleted > 0 ? 1 : 0;
          const bHasSessions = b.practiceSessionsCompleted > 0 ? 1 : 0;
          if (aHasSessions !== bHasSessions) return bHasSessions - aHasSessions;
          if (b.averageAccuracy !== a.averageAccuracy) return b.averageAccuracy - a.averageAccuracy;
          if (b.totalEntries !== a.totalEntries) return b.totalEntries - a.totalEntries;
          return a.scoutName.localeCompare(b.scoutName);
        })
      );
    } catch (error) {
      console.error("Error loading scout stats:", error);
    } finally {
      setLoading(false);
    }
  }

  // Count active scouts only: dedicated match scouts (lead roles are excluded from scout counts).
  const actualScoutCount = scoutStats.filter((s) => {
    const roles = getUserRoles({
      role: s.role,
      roles: s.roles,
      secondaryRoles: s.secondaryRoles,
    });
    return roles.includes("match-scout") || roles.includes("media");
  }).length;
  const membersWithAccuracy = scoutStats.filter((s) => s.practiceSessionsCompleted > 0 && s.averageAccuracy > 0);
  const isRealMode = selectedMode === "real";
  const selectedEventLabel = useMemo(() => {
    if (attendanceFilter === "all") return "";
    return eventOptions.find((event) => event.key === attendanceFilter)?.name || attendanceFilter;
  }, [attendanceFilter, eventOptions]);
  const rankedScoutStats = useMemo(() => {
    const rankScouts = (rows: ScoutStats[]) => {
      let currentRank = 0;
      let previousKey = "";
      return rows.map((scout, index) => {
        const key = `${scout.practiceSessionsCompleted > 0 ? "sessions" : "nosessions"}:${scout.averageAccuracy}`;
        if (key !== previousKey) {
          currentRank = index + 1;
          previousKey = key;
        }
        return { scout, rank: currentRank };
      });
    };

    const scoutKey = (scout: ScoutStats) =>
      String(scout.scoutId || scout.scoutName || "").trim().toLowerCase();

    const baseRankMap = new Map(
      rankScouts(scoutStats).map(({ scout, rank }) => [scoutKey(scout), rank])
    );

    const attendanceFiltered =
      attendanceFilter === "all"
        ? scoutStats
        : scoutStats.filter((scout) => {
            const attendees = eventAttendees[attendanceFilter] || [];
            if (attendees.includes(scout.scoutId)) return true;
            if (attendees.includes(scout.scoutName)) return true;
            return attendees.some(
              (value) => String(value || "").trim().toLowerCase() === scout.scoutName.trim().toLowerCase()
            );
          });

    const eventRankMap = new Map(
      rankScouts(attendanceFiltered).map(({ scout, rank }) => [scoutKey(scout), rank])
    );

    const roleFiltered = attendanceFiltered.filter((scout) => {
      if (allRolesSelected) return true;
      const roles = getUserRoles({
        role: scout.role,
        roles: scout.roles,
        secondaryRoles: scout.secondaryRoles,
      });
      return roles.some((role) => roleFilterSet.has(role));
    });

    const roleRankMap = new Map(
      rankScouts(roleFiltered).map(({ scout, rank }) => [scoutKey(scout), rank])
    );

    const listForDisplay = allRolesSelected ? attendanceFiltered : roleFiltered;

    const withRanks = listForDisplay.map((scout) => {
      const key = scoutKey(scout);
      const fallbackRank = baseRankMap.get(key) ?? 0;
      if (rankMode === "event") {
        return { scout, rank: eventRankMap.get(key) ?? fallbackRank };
      }
      if (rankMode === "role") {
        return { scout, rank: roleRankMap.get(key) ?? fallbackRank };
      }
      return { scout, rank: fallbackRank };
    });

    if (rankMode === "event" || rankMode === "role") {
      return withRanks
        .slice()
        .sort((a, b) => {
          const aRank = a.rank || Number.MAX_SAFE_INTEGER;
          const bRank = b.rank || Number.MAX_SAFE_INTEGER;
          if (aRank !== bRank) return aRank - bRank;
          return a.scout.scoutName.localeCompare(b.scout.scoutName);
        });
    }
    return withRanks;
  }, [attendanceFilter, eventAttendees, rankMode, scoutStats, allRolesSelected, roleFilterSet]);
  const visibleRankedScoutStats = useMemo(() => {
    if (canViewFullAccuracy) return rankedScoutStats;
    return rankedScoutStats.filter(({ scout, rank }) => scout.practiceSessionsCompleted > 0 && rank <= 5);
  }, [canViewFullAccuracy, rankedScoutStats]);

  function getAccuracyColor(accuracy: number): string {
    if (accuracy >= 95) return "text-green-600";
    if (accuracy >= 85) return "text-yellow-600";
    if (accuracy >= 75) return "text-orange-600";
    return "text-[#ff0000]";
  }

  function getAccuracyBadge(
    status: ScoutAccuracyStatus,
    confirmed: boolean
  ): { bg: string; text: string; label: string; showWarning: boolean } {
    if (!confirmed || status === "undetermined") {
      return {
        bg: "bg-gray-100",
        text: "text-gray-700",
        label: "Undetermined",
        showWarning: false,
      };
    }

    const map: Record<ScoutAccuracyStatus, { bg: string; text: string; label: string; showWarning: boolean }> = {
      "mentor-intervention": { bg: "bg-red-100", text: "text-red-800", label: "Mentor Intervention", showWarning: true },
      "student-intervention": { bg: "bg-orange-100", text: "text-orange-800", label: "Student Intervention", showWarning: true },
      certified: { bg: "bg-purple-100", text: "text-purple-800", label: "Certified", showWarning: false },
      good: { bg: "bg-blue-100", text: "text-blue-700", label: "Good", showWarning: false },
      excellent: { bg: "bg-green-100", text: "text-green-700", label: "Excellent", showWarning: false },
      undetermined: { bg: "bg-gray-100", text: "text-gray-700", label: "Undetermined", showWarning: false },
    };
    return map[status] || map.undetermined;
  }

  const selectedScoutData = scoutStats.find(s => s.scoutName === selectedScout);
  const selectedRealEntries = useMemo(() => {
    if (!isRealMode || !selectedScoutData) return [];
    const scoutId = String(selectedScoutData.scoutId || "").trim();
    const scoutName = String(selectedScoutData.scoutName || "").trim().toLowerCase();
    return realScoutingEntries.filter((entry) => {
      const entryScoutId = String(entry.scoutId || "").trim();
      const entryScoutName = String(entry.scoutName || "").trim().toLowerCase();
      if (scoutId && entryScoutId && entryScoutId === scoutId) return true;
      return scoutName && entryScoutName === scoutName;
    }).filter((entry) => isAllRobotsScouted(entry));
  }, [isRealMode, selectedScoutData, realScoutingEntries]);

  const selectedRealMatches = useMemo(() => {
    if (!isRealMode || selectedRealEntries.length === 0) return [];
    const matchMap = new Map<string, ScoutingEntry>();
    selectedRealEntries.forEach((entry) => {
      const key = getMatchIdentityKey(entry);
      if (!key) return;
      const existing = matchMap.get(key);
      if (!existing || getEntryTimestamp(entry) > getEntryTimestamp(existing)) {
        matchMap.set(key, entry);
      }
    });
    return Array.from(matchMap.values()).sort(
      (a, b) => getEntryTimestamp(b) - getEntryTimestamp(a)
    );
  }, [isRealMode, selectedRealEntries]);
  const selectedRealLastSubmit = useMemo(() => {
    if (!isRealMode || selectedRealEntries.length === 0) return 0;
    return selectedRealEntries.reduce((max, entry) => Math.max(max, getEntryTimestamp(entry)), 0);
  }, [isRealMode, selectedRealEntries]);

  useEffect(() => {
    setShowAllSessionsModal(false);
  }, [selectedScout]);
  const canResetScoutData = Boolean(userData?.isTeamAdmin);

  async function resetScoutSessions(scoutName: string) {
    if (!canResetScoutData) {
      alert("Only team admins can reset scout data.");
      return;
    }
    if (!confirm(`Hard reset all scouting/practice data for ${scoutName}? This cannot be undone.`)) return;
    try {
      let scoutUid = "";
      const userSnap = await getDocs(
        query(
          collection(db, "users"),
          where("teamId", "==", userData?.teamId || ""),
          where("displayName", "==", scoutName)
        )
      );
      if (!userSnap.empty) {
        scoutUid = userSnap.docs[0].id;
      }

      const practiceIds = new Set<string>();
      const sessionsByName = await getDocs(query(collection(db, "practiceSessions"), where("scoutName", "==", scoutName)));
      sessionsByName.docs.forEach((d) => practiceIds.add(d.id));
      if (scoutUid) {
        const sessionsByUid = await getDocs(query(collection(db, "practiceSessions"), where("scoutId", "==", scoutUid)));
        sessionsByUid.docs.forEach((d) => practiceIds.add(d.id));
      }
      await Promise.all(Array.from(practiceIds).map((id) => deleteDoc(doc(db, "practiceSessions", id))));

      const scoutingIds = new Set<string>();
      const entriesByName = await getDocs(query(collection(db, "scouting"), where("scoutName", "==", scoutName)));
      entriesByName.docs.forEach((d) => scoutingIds.add(d.id));
      if (scoutUid) {
        const entriesByUid = await getDocs(query(collection(db, "scouting"), where("scoutId", "==", scoutUid)));
        entriesByUid.docs.forEach((d) => scoutingIds.add(d.id));
      }
      await Promise.all(Array.from(scoutingIds).map((id) => deleteDoc(doc(db, "scouting", id))));

      await loadScoutStats();
      setSelectedScout(null);
      alert("Hard reset complete.");
    } catch (error) {
      console.error("Error resetting scout sessions:", error);
      alert("Failed to hard reset scout data.");
    }
  }

  async function rerunSessionAccuracyScript(sessionIdRaw: string) {
    if (!canResetScoutData || !userData?.teamId) {
      alert("Only team admins can rerun session accuracy scripts.");
      return;
    }
    const sessionId = sessionIdRaw.trim();
    if (!sessionId) {
      alert("Enter a practice session ID first.");
      return;
    }
    if (!confirm(`Recalculate stored accuracy for practice session ${sessionId}?`)) return;

    setRerunningAccuracy(true);
    try {
      const sessionRef = doc(db, "practiceSessions", sessionId);
      const sessionSnap = await getDoc(sessionRef);
      if (!sessionSnap.exists()) {
        alert("Session not found.");
        return;
      }
      const sessionData = sessionSnap.data() as Record<string, unknown>;

      const teamUsersSnap = await getDocs(query(collection(db, "users"), where("teamId", "==", userData.teamId)));
      const memberIds = new Set(teamUsersSnap.docs.map((memberDoc) => memberDoc.id));
      const sessionScoutId = String(sessionData.scoutId || "");
      if (sessionScoutId && !memberIds.has(sessionScoutId)) {
        alert("This session does not belong to your team.");
        return;
      }

      const officialScore =
        typeof sessionData.officialScore === "number"
          ? sessionData.officialScore
          : typeof sessionData.actualScore === "number"
          ? sessionData.actualScore
          : 0;
      const scoutingSnap = await getDocs(query(collection(db, "scouting"), where("practiceSessionId", "==", sessionId)));
      const entries = scoutingSnap.docs.map((entryDoc) => ({
        id: entryDoc.id,
        ...(entryDoc.data() as ScoutingEntry),
      }));
      if (entries.length === 0) {
        alert("No scouting entries found for that practice session.");
        return;
      }

      const sessionGame = String(sessionData.game || "REEFSCAPE").toUpperCase() === "REBUILT" ? "REBUILT" : "REEFSCAPE";
      const sessionPenaltyPoints =
        typeof sessionData.penaltyPoints === "number"
          ? Number(sessionData.penaltyPoints)
          : typeof entries[0]?.penaltyPoints === "number"
          ? Number(entries[0].penaltyPoints)
          : 0;
      const targetBaseScore = Math.max(0, officialScore - sessionPenaltyPoints);
      const baseScoutedScore = sessionGame === "REBUILT"
        ? calculateBestRebuiltPracticeScore(entries, targetBaseScore)
        : entries.reduce((sum, entry) => sum + scorePracticeEntryWithoutPenalty(entry, sessionGame), 0);
      const totalScoutedScore = baseScoutedScore + sessionPenaltyPoints;
      const recalculatedAccuracy = calculateAccuracy(totalScoutedScore, officialScore);

      await updateDoc(sessionRef, {
        scoutedScore: totalScoutedScore,
        accuracy: recalculatedAccuracy,
        recalculatedAt: Date.now(),
      });

      for (const entry of entries) {
        const entryScore = scorePracticeEntryWithoutPenalty(entry, sessionGame);
        await updateDoc(doc(db, "scouting", entry.id), {
          accuracy: recalculatedAccuracy,
          scoutedScore: entryScore,
          recalculatedAt: Date.now(),
        });
      }

      await loadScoutStats();
      setRerunResultModal({
        sessionId,
        entries: entries.length,
        accuracy: recalculatedAccuracy,
        scoutedScore: totalScoutedScore,
        officialScore,
      });
    } catch (error) {
      console.error("Error rerunning session accuracy script:", error);
      alert("Failed to rerun session accuracy.");
    } finally {
      setRerunningAccuracy(false);
    }
  }

  async function updatePracticeSessionFlagState(sessionId: string, patch: Partial<StoredFlagState>) {
    if (!canManageFlags || !userData?.teamId) return;
    const trimmedSessionId = String(sessionId || "").trim();
    if (!trimmedSessionId) return;
    const key = flagStateDocId("practiceSession", trimmedSessionId);
    setFlagSaveKey(key);
    const existing = flagStates[key];
    let saved = false;
    try {
      const nextState: StoredFlagState = {
        entityType: "practiceSession",
        entityId: trimmedSessionId,
        dismissed: patch.dismissed ?? existing?.dismissed ?? false,
        manualFlagged: patch.manualFlagged ?? existing?.manualFlagged ?? false,
        manualReason: patch.manualReason ?? existing?.manualReason,
        manualFlaggedAt: patch.manualFlaggedAt ?? existing?.manualFlaggedAt,
        manualFlaggedBy: patch.manualFlaggedBy ?? existing?.manualFlaggedBy,
        excludeFromAccuracy: patch.excludeFromAccuracy ?? existing?.excludeFromAccuracy ?? false,
        excludeReason: patch.excludeReason ?? existing?.excludeReason,
        excludedAt: patch.excludedAt ?? existing?.excludedAt,
        excludedBy: patch.excludedBy ?? existing?.excludedBy,
        dismissedAt: patch.dismissedAt ?? existing?.dismissedAt,
        dismissedBy: patch.dismissedBy ?? existing?.dismissedBy,
      };
      const payload: Record<string, unknown> = {
        teamId: userData.teamId,
        entityType: nextState.entityType,
        entityId: nextState.entityId,
        dismissed: nextState.dismissed,
        manualFlagged: Boolean(nextState.manualFlagged),
        excludeFromAccuracy: Boolean(nextState.excludeFromAccuracy),
      };
      if (nextState.manualReason !== undefined) payload.manualReason = nextState.manualReason;
      if (nextState.manualFlaggedAt !== undefined) payload.manualFlaggedAt = nextState.manualFlaggedAt;
      if (nextState.manualFlaggedBy !== undefined) payload.manualFlaggedBy = nextState.manualFlaggedBy;
      if (nextState.excludeReason !== undefined) payload.excludeReason = nextState.excludeReason;
      if (nextState.excludedAt !== undefined) payload.excludedAt = nextState.excludedAt;
      if (nextState.excludedBy !== undefined) payload.excludedBy = nextState.excludedBy;
      if (nextState.dismissedAt !== undefined) payload.dismissedAt = nextState.dismissedAt;
      if (nextState.dismissedBy !== undefined) payload.dismissedBy = nextState.dismissedBy;

      await setDoc(doc(db, "scoutingFlagStates", key), payload, { merge: true });
      setFlagStates((prev) => ({ ...prev, [key]: nextState }));
      saved = true;
    } catch (error) {
      console.error("Failed updating practice session flag state:", error);
    } finally {
      setFlagSaveKey("");
    }
    if (!saved) return;

    setScoutStats((prev) =>
      prev.map((scout) => {
        let touched = false;
        const updateSession = (session: ScoutStats["recentSessions"][number]) => {
          if (session.sessionId !== trimmedSessionId) return session;
          touched = true;
          return {
            ...session,
            dismissed: typeof patch.dismissed === "boolean" ? patch.dismissed : session.dismissed,
            excluded: typeof patch.excludeFromAccuracy === "boolean" ? patch.excludeFromAccuracy : session.excluded,
          };
        };
        const nextAllSessions = scout.allSessions.map(updateSession);
        const nextRecentSessions = scout.recentSessions.map(updateSession);
        if (!touched) return scout;
        const includedSessions = nextAllSessions.filter((session) => !session.excluded);
        const practiceInputs = includedSessions.map((session) => ({
          accuracy: Math.max(0, Math.min(1, session.accuracy / 100)),
          environment: selectedMode,
        }));
        const practiceAccuracyResult = calculateScoutAccuracy(practiceInputs, {
          mode: selectedMode,
          minMatches: 5,
        });
        return {
          ...scout,
          allSessions: nextAllSessions,
          recentSessions: nextRecentSessions,
          recentAccuracies: nextRecentSessions.map((session) => session.accuracy),
          averageAccuracy: practiceAccuracyResult.displayAccuracy,
          confidenceLevel: practiceAccuracyResult.confidenceLevel,
          status: practiceAccuracyResult.status,
          confirmed: practiceAccuracyResult.confirmed,
          practiceSessionsCompleted: practiceAccuracyResult.totalMatches,
        };
      })
    );
    void loadScoutStats().catch((error) => {
      console.warn("Unable to refresh scout accuracy after flag update.", error);
    });
  }

  async function setPracticeSessionFlagDismissed(sessionId: string, dismissed: boolean) {
    await updatePracticeSessionFlagState(sessionId, {
      dismissed,
      dismissedAt: Date.now(),
      dismissedBy: userData?.uid || "",
    });
  }

  async function setPracticeSessionExcluded(sessionId: string, excluded: boolean) {
    const excludedBy = userData?.uid;
    await updatePracticeSessionFlagState(sessionId, {
      excludeFromAccuracy: excluded,
      excludedAt: Date.now(),
      excludedBy: excludedBy || undefined,
    });
    try {
      await updateDoc(doc(db, "practiceSessions", sessionId), {
        excludeFromAccuracy: excluded,
        excludedAt: Date.now(),
        excludedBy: excludedBy || undefined,
      });
    } catch (error) {
      console.warn("Unable to update practice session exclusion on session record:", error);
    }
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-8">
          <h1 className="text-3xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>
            Scout Accuracy
          </h1>
          <p className="text-gray-600 mb-8">
            Track and verify the accuracy of your team members&apos; data
            <span className="text-sm text-gray-500 ml-2">
              {selectedMode === "real"
                ? "(Real event accuracy estimates)"
                : `(Showing ${selectedMode === "trial" ? "Trial" : "Competitive"} practice mode)`}
            </span>
          </p>
          <DataSourceCredits className="mb-6" />

          <div className="bg-white rounded-xl shadow-md p-4 mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">Game</label>
            <select
              value={selectedGame}
              onChange={(event) => setSelectedGame(event.target.value === "REBUILT" ? "REBUILT" : "REEFSCAPE")}
              className="w-full md:w-96 border rounded p-2"
            >
              <option value="REEFSCAPE">REEFSCAPE</option>
              <option value="REBUILT">REBUILT</option>
            </select>
          </div>

          {loading ? (
            <div className="text-center py-12">
              <LoadingSpinner />
              <p className="text-gray-600 mt-4">Loading statistics...</p>
            </div>
          ) : scoutStats.length === 0 ? (
            <div className="bg-white rounded-xl shadow-md p-12 text-center">
              <div className="text-6xl mb-4">📊</div>
              <h2 className="text-2xl font-semibold mb-2">No Data Yet</h2>
              <p className="text-gray-600">
                Scout accuracy tracking will appear once team members complete sessions.
              </p>
            </div>
          ) : (
            <>

          {/* MODE TABS */}
          <div className="bg-white rounded-xl shadow-md p-2 mb-6 flex gap-2">
            <button
              onClick={() => {
                setSelectedMode("trial");
              }}
              className={`flex-1 px-4 py-2 rounded font-medium transition-colors ${
                selectedMode === "trial"
                  ? "bg-red-600 text-white" 
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              Trial Mode
            </button>
            <button
              onClick={() => {
                setSelectedMode("competitive");
              }}
              className={`flex-1 px-4 py-2 rounded font-medium transition-colors ${
                selectedMode === "competitive"
                  ? "bg-red-600 text-white" 
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              Competitive Mode
            </button>
            {canViewRealEventTab && (
              <button
                onClick={() => {
                  setSelectedMode("real");
                }}
                className={`flex-1 px-4 py-2 rounded font-medium transition-colors ${
                  selectedMode === "real"
                    ? "bg-red-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                Real Event
              </button>
            )}
          </div>
          {selectedMode !== "real" && canViewRestrictedData && canResetScoutData && (
            <div className="bg-white rounded-xl shadow-md p-4 mb-6">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="font-semibold">Maintenance</p>
                  <p className="text-sm text-gray-600">Recalculate accuracy for one practice session ID.</p>
                </div>
                <div className="flex gap-2 items-center">
                  <input
                    value={rerunSessionId}
                    onChange={(event) => setRerunSessionId(event.target.value)}
                    placeholder="Practice Session ID"
                    className="border rounded px-3 py-2 text-sm w-64"
                    disabled={rerunningAccuracy}
                  />
                  <button
                    onClick={() => void rerunSessionAccuracyScript(rerunSessionId)}
                    disabled={rerunningAccuracy}
                    className="px-3 py-2 rounded bg-red-600 text-white text-sm font-medium disabled:opacity-50"
                  >
                    {rerunningAccuracy ? "Recalculating..." : "Rerun Session"}
                  </button>
                </div>
              </div>
            </div>
          )}
          {isRealMode && (
            <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-xl p-4 mb-6">
              <p className="text-sm">
                Real event accuracy is an estimate based on completed match analytics and may not be 100% exact.
              </p>
              {includePracticeInReal && (
                <p className="text-xs text-yellow-700 mt-1">
                  Practice sessions are blended into this estimate based on the selected calculation mode.
                </p>
              )}
            </div>
          )}
              {canViewRestrictedData && (
                <div className="grid md:grid-cols-4 gap-6 mb-6">
                  <div className="bg-white rounded-xl shadow-md p-6">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold text-gray-700">Scouts / Members</h3>
                      <Users size={22} className="text-gray-500" />
                    </div>
                    <p className="text-3xl font-bold" style={{ color: "var(--primary-color)" }}>
                      {actualScoutCount} / {scoutStats.length}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {actualScoutCount} scout{actualScoutCount !== 1 ? 's' : ''}, {scoutStats.length - actualScoutCount} other role{scoutStats.length - actualScoutCount !== 1 ? 's' : ''}
                    </p>
                  </div>

                  <div className="bg-white rounded-xl shadow-md p-6">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold text-gray-700">Avg. Accuracy</h3>
                      <Target size={22} className="text-gray-500" />
                    </div>
                    <p className="text-3xl font-bold" style={{ color: "var(--primary-color)" }}>
                      {membersWithAccuracy.length > 0
                        ? Math.round(
                            membersWithAccuracy.reduce((sum, s) => sum + s.averageAccuracy, 0) /
                              membersWithAccuracy.length
                          )
                        : 0}%
                    </p>
                  </div>

                  <div className="bg-white rounded-xl shadow-md p-6">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold text-gray-700">
                        {isRealMode ? realModeMatchesLabel : "Practice Sessions"}
                      </h3>
                      <ClipboardList size={22} className="text-gray-500" />
                    </div>
                    <p className="text-3xl font-bold" style={{ color: "var(--primary-color)" }}>
                      {scoutStats.reduce((sum, s) => sum + s.practiceSessionsCompleted, 0)}
                    </p>
                  </div>

                  <div className="bg-white rounded-xl shadow-md p-6">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold text-gray-700">Total Entries</h3>
                      <ClipboardList size={22} className="text-gray-500" />
                    </div>
                    <p className="text-3xl font-bold" style={{ color: "var(--primary-color)" }}>
                      {scoutStats.reduce((sum, s) => sum + s.totalEntries, 0)}
                    </p>
                  </div>
                </div>
              )}

              {/* LEADERBOARD */}
              <div className="bg-white rounded-xl shadow-md overflow-visible mb-6">
                <div className="p-6 border-b border-gray-200">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-semibold">Team Member Accuracy Rankings</h2>
                      <p className="text-sm text-gray-500 mt-1">
                        {attendanceFilter === "all"
                          ? `All team members ranked by ${isRealMode ? "real-event accuracy estimates" : "practice accuracy"}`
                          : `Members attending ${selectedEventLabel || "this event"} ranked by ${isRealMode ? "real-event accuracy estimates" : "practice accuracy"}`}
                      </p>
                      {isRealMode && (
                        <p className="text-xs text-gray-500 mt-1">
                          Real-event accuracy is an estimate based on match-level alliance accuracy and is not scout-specific.
                          {includePracticeInReal && (
                            <span className="block">
                              Practice session accuracy is blended in for the selected calculation mode.
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] font-semibold uppercase text-gray-500">Members</label>
                        <select
                          value={attendanceFilter}
                          onChange={(event) => setAttendanceFilter(event.target.value)}
                          className="border rounded px-2 py-1.5 text-sm min-w-[220px]"
                        >
                          <option value="all">All members</option>
                          {eventOptions.map((event) => (
                            <option key={event.key} value={event.key}>
                              {event.name}
                            </option>
                          ))}
                          </select>
                      </div>
                      <div className="flex flex-col gap-1 relative">
                        <label className="text-[11px] font-semibold uppercase text-gray-500">Roles</label>
                        <button
                          type="button"
                          onClick={() => setRolesDropdownOpen((prev) => !prev)}
                          className="border rounded px-2 py-1.5 text-sm min-w-[220px] flex items-center justify-between gap-2 bg-white"
                        >
                          <span>
                            {allRolesSelected
                              ? "All roles"
                              : roleFilters.length === 0
                              ? "No roles selected"
                              : `${roleFilters.length} role${roleFilters.length === 1 ? "" : "s"}`}
                          </span>
                          <ChevronDown size={16} className="text-gray-500" />
                        </button>
                        {rolesDropdownOpen && (
                          <div className="absolute z-20 mt-1 top-full left-0 w-64 bg-white border rounded-lg shadow-lg p-3 max-h-72 overflow-y-auto">
                            <label className="flex items-center gap-2 text-sm font-medium">
                              <input
                                type="checkbox"
                                checked={allRolesSelected}
                                onChange={(event) =>
                                  setRoleFilters(event.target.checked ? [...TEAM_ROLES] : [])
                                }
                              />
                              All roles
                            </label>
                            <div className="mt-2 space-y-1">
                              {TEAM_ROLES.map((role) => {
                                const checked = roleFilterSet.has(role);
                                return (
                                  <label key={role} className="flex items-center gap-2 text-sm">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => {
                                        setRoleFilters((prev) =>
                                          prev.includes(role)
                                            ? prev.filter((value) => value !== role)
                                            : [...prev, role]
                                        );
                                      }}
                                    />
                                    {getRoleLabel(role)}
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                      {isRealMode && (
                        <div className="flex flex-col gap-1">
                          <label className="text-[11px] font-semibold uppercase text-gray-500">Calculations</label>
                          <select
                            value={calculationEvent}
                            onChange={(event) => setCalculationEvent(event.target.value)}
                            className="border rounded px-2 py-1.5 text-sm min-w-[220px]"
                          >
                            {calculationOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] font-semibold uppercase text-gray-500">Rank</label>
                        <select
                          value={rankMode}
                          onChange={(event) => {
                            const value = event.target.value;
                            if (value === "event") setRankMode("event");
                            else if (value === "role") setRankMode("role");
                            else setRankMode("preserve");
                          }}
                          className="border rounded px-2 py-1.5 text-sm min-w-[200px]"
                          disabled={attendanceFilter === "all" && allRolesSelected}
                        >
                          <option value="preserve">Preserve original ranks</option>
                          <option value="event" disabled={attendanceFilter === "all"}>
                            Event leaderboard
                          </option>
                          <option value="role" disabled={allRolesSelected || roleFilters.length === 0}>
                            Role leaderboard
                          </option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Rank
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Name
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Role
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Accuracy
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Status
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          {isRealMode ? realModeMatchesLabel : "Sessions"}
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Total Entries
                        </th>
                        {canViewFullAccuracy && (
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Actions
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {visibleRankedScoutStats.map(({ scout, rank }) => {
                        const badge = getAccuracyBadge(scout.status, scout.confirmed);
                        const roleBadge = getTeamRoleBadge(scout.role, scout.roles);
                        const displayRank = scout.confirmed ? `#${rank}` : "?";
                        return (
                          <tr key={scout.scoutName} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className="text-2xl">
                                {displayRank}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className="font-semibold">{scout.scoutName}</span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`px-2 py-1 rounded text-xs font-medium ${roleBadge.bg} ${roleBadge.text}`}>
                                {roleBadge.label}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`text-2xl font-bold ${getAccuracyColor(scout.averageAccuracy)}`}>
                                {scout.averageAccuracy}%
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`px-2 py-1 rounded text-xs font-medium ${badge.bg} ${badge.text}`}>
                                {badge.label}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                              {scout.practiceSessionsCompleted}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                              {scout.totalEntries}
                            </td>
                            {canViewFullAccuracy && (
                              <td className="px-6 py-4 whitespace-nowrap">
                                <button
                                  onClick={() => setSelectedScout(scout.scoutName)}
                                  className="text-sm font-medium hover:underline"
                                  style={{ color: "var(--primary-color)" }}
                                >
                                  View Details
                                </button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* SCOUT DETAIL MODAL */}
              {selectedScoutData && isRealMode && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                  <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                    <div className="p-6 border-b border-gray-200">
                      <div className="flex items-center justify-between">
                        <div>
                          <h2 className="text-2xl font-bold">{selectedScoutData.scoutName}</h2>
                          <span
                            className={`inline-block px-2 py-1 rounded text-xs font-medium mt-2 ${getTeamRoleBadge(selectedScoutData.role, selectedScoutData.roles).bg} ${getTeamRoleBadge(selectedScoutData.role, selectedScoutData.roles).text}`}
                          >
                            {getTeamRoleBadge(selectedScoutData.role, selectedScoutData.roles).label}
                          </span>
                        </div>
                        <button
                          onClick={() => setSelectedScout(null)}
                          className="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 font-medium"
                        >
                          Close
                        </button>
                      </div>
                    </div>

                    <div className="p-6 space-y-6">
                      <div>
                        <h3 className="text-lg font-semibold mb-4">Accuracy Overview</h3>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="p-4 bg-gray-50 rounded-lg">
                            <p className="text-sm text-gray-600 mb-1">Average Accuracy</p>
                            <p className={`text-4xl font-bold ${getAccuracyColor(selectedScoutData.averageAccuracy)}`}>
                              {selectedScoutData.averageAccuracy}%
                            </p>
                          </div>
                          <div className="p-4 bg-gray-50 rounded-lg">
                            <p className="text-sm text-gray-600 mb-1">{realModeMatchesLabel}</p>
                            <p className="text-4xl font-bold" style={{ color: "var(--primary-color)" }}>
                              {selectedScoutData.practiceSessionsCompleted}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div>
                        <h3 className="text-lg font-semibold mb-4">Recent Match Accuracy</h3>
                        <p className="text-xs text-gray-500 mb-2">
                          Alliance accuracy is shown per match and is not scout-specific. Only matches with a complete
                          accuracy script are listed.
                        </p>
                        {selectedRealMatches.length > 0 ? (
                          <div className="space-y-2">
                            {selectedRealMatches.map((entry) => {
                              const timestamp = getEntryTimestamp(entry);
                              const matchAccuracy = resolveMatchAccuracy(entry);
                              const accuracyValue =
                                typeof matchAccuracy === "number" ? Math.round(matchAccuracy * 100) : null;
                              const displayAccuracy = accuracyValue !== null ? accuracyValue : 0;
                              return (
                                <div
                                  key={String(entry.id || getMatchIdentityKey(entry))}
                                  className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg"
                                >
                                  <div className="text-sm text-gray-600 w-40">
                                    <div className="font-semibold">{formatRealMatchLabel(entry)}</div>
                                    <div className="text-xs text-gray-500">
                                      {timestamp ? new Date(timestamp).toLocaleString() : "Unknown time"}
                                    </div>
                                  </div>
                                  <div className="flex-1 bg-gray-200 rounded-full h-8 overflow-hidden">
                                    <div
                                      className="h-full flex items-center justify-end pr-3 text-white text-sm font-semibold transition-all"
                                      style={{
                                        width: `${displayAccuracy}%`,
                                        backgroundColor:
                                          displayAccuracy >= 90 ? "#10b981" :
                                          displayAccuracy >= 75 ? "#15803d" :
                                          displayAccuracy >= 50 ? "#f97316" : "#ef4444"
                                      }}
                                    >
                                      {accuracyValue !== null ? `${accuracyValue}%` : "-"}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-gray-500 text-center py-4">No complete matches found for this scout</p>
                        )}
                      </div>

                      <div>
                        <h3 className="text-lg font-semibold mb-4">Statistics</h3>
                        <div className="space-y-3">
                          <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                            <span className="text-gray-700">Total Match Entries</span>
                            <span className="text-lg font-bold">{selectedRealEntries.length}</span>
                          </div>
                          <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                            <span className="text-gray-700">Last Submit</span>
                            <span className="text-lg font-bold">
                              {selectedRealLastSubmit ? new Date(selectedRealLastSubmit).toLocaleDateString() : "-"}
                            </span>
                          </div>
                        </div>
                      </div>

                      {(() => {
                        const badge = getAccuracyBadge(selectedScoutData.status, selectedScoutData.confirmed);
                        return (
                          <div className={`p-4 rounded-lg ${badge.bg} ${badge.text} border ${
                            badge.label === "Excellent" ? "border-green-200" :
                            badge.label === "Good" ? "border-green-700" :
                            badge.label === "Student Intervention" ? "border-orange-200" :
                            badge.label === "Undetermined" ? "border-gray-200" :
                            "border-red-200"
                          }`}>
                            <h3 className="font-semibold mb-2">
                              {badge.label === "Excellent" ? "Excellent Performance" :
                               badge.label === "Good" ? "Good Performance" :
                               badge.label === "Student Intervention" ? "Needs Improvement" :
                               badge.label === "Undetermined" ? "Status Pending" :
                               "Immediate Action Required"}
                            </h3>
                            <p className="text-sm">
                              {badge.label === "Excellent"
                                ? `${selectedScoutData.scoutName} is performing excellently across completed matches.`
                                : badge.label === "Good"
                                ? `${selectedScoutData.scoutName} is performing well. Continued reps should improve consistency.`
                                : badge.label === "Student Intervention"
                                ? `${selectedScoutData.scoutName} needs additional practice and review before key matches.`
                                : badge.label === "Undetermined"
                                ? `${selectedScoutData.scoutName} has not completed enough matches for a stable estimate.`
                                : `${selectedScoutData.scoutName} requires immediate mentor intervention and focused review.`}
                            </p>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              )}

              {selectedScoutData && !isRealMode && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                  <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                    <div className="p-6 border-b border-gray-200">
                      <div className="flex items-center justify-between">
                        <div>
                          <h2 className="text-2xl font-bold">{selectedScoutData.scoutName}</h2>
                          <span className={`inline-block px-2 py-1 rounded text-xs font-medium mt-2 ${getTeamRoleBadge(selectedScoutData.role, selectedScoutData.roles).bg} ${getTeamRoleBadge(selectedScoutData.role, selectedScoutData.roles).text}`}>
                            {getTeamRoleBadge(selectedScoutData.role, selectedScoutData.roles).label}
                          </span>
                        </div>
                        <button
                          onClick={() => setSelectedScout(null)}
                          className="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 font-medium"
                        >
                          Close
                        </button>
                      </div>
                    </div>

                    <div className="p-6 space-y-6">
                      {/* ACCURACY OVERVIEW */}
                      <div>
                        <h3 className="text-lg font-semibold mb-4">Accuracy Overview</h3>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="p-4 bg-gray-50 rounded-lg">
                            <p className="text-sm text-gray-600 mb-1">Average Accuracy</p>
                            <p className={`text-4xl font-bold ${getAccuracyColor(selectedScoutData.averageAccuracy)}`}>
                              {selectedScoutData.averageAccuracy}%
                            </p>
                          </div>
                          <div className="p-4 bg-gray-50 rounded-lg">
                            <p className="text-sm text-gray-600 mb-1">Practice Sessions</p>
                            <p className="text-4xl font-bold" style={{ color: "var(--primary-color)" }}>{selectedScoutData.practiceSessionsCompleted}</p>
                          </div>
                        </div>
                      </div>

                      {/* RECENT ACCURACY SCORES */}
                      <div>
                        <h3 className="text-lg font-semibold mb-4">Recent Practice Scores</h3>
                        {selectedScoutData.deviceBreakdown &&
                          selectedScoutData.deviceBreakdown.mobileCount > 0 &&
                          selectedScoutData.deviceBreakdown.pcCount > 0 && (
                            <p className="text-xs text-gray-500 mb-2">
                              Device trend:{" "}
                              {selectedScoutData.deviceBreakdown.betterDevice === "tie"
                                ? "equal on mobile and PC"
                                : selectedScoutData.deviceBreakdown.betterDevice === "mobile"
                                ? "better on mobile"
                                : "better on PC"}
                            </p>
                          )}
                        {selectedScoutData.recentAccuracies.length > 0 ? (
                          <div className="space-y-2">
                            {selectedScoutData.recentSessions.map((session, i) => (
                              <div key={i} className="flex items-center gap-4">
                                <div className="text-sm text-gray-600 w-40">
                                  <div>{`Session ${session.sessionNumber}`}</div>
                                  <div className="text-xs">
                                    {session.deviceType === "mobile"
                                      ? "Mobile"
                                      : session.deviceType === "pc"
                                      ? "PC"
                                      : "Unknown Device"}
                                    {session.flags.length > 0 && canManageFlags && !session.dismissed ? " • Flagged" : ""}
                                    {session.excluded ? " • Excluded" : ""}
                                  </div>
                                </div>
                                <div className="flex-1 bg-gray-200 rounded-full h-8 overflow-hidden">
                                  <div
                                    className="h-full flex items-center justify-end pr-3 text-white text-sm font-semibold transition-all"
                                    style={{
                                      width: `${session.accuracy}%`,
                                      backgroundColor: 
                                        session.accuracy === 100 ? "#9333ea" :
                                        session.accuracy >= 90 ? "#10b981" : 
                                        session.accuracy >= 80 ? "#15803d" :
                                        session.accuracy >= 50 ? "#f97316" : "#ef4444"
                                    }}
                                  >
                                    {session.accuracy}%
                                  </div>
                                </div>
                                {canManageFlags && session.flags.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => void setPracticeSessionFlagDismissed(session.sessionId, !session.dismissed)}
                                    disabled={flagSaveKey === flagStateDocId("practiceSession", session.sessionId)}
                                    className="px-2 py-1 rounded text-xs border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
                                  >
                                    {session.dismissed ? "Restore Flag" : "Dismiss Flag"}
                                  </button>
                                )}
                                {canManageFlags && (
                                  <button
                                    type="button"
                                    onClick={() => void setPracticeSessionExcluded(session.sessionId, !session.excluded)}
                                    disabled={flagSaveKey === flagStateDocId("practiceSession", session.sessionId)}
                                    className="px-2 py-1 rounded text-xs border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
                                  >
                                    {session.excluded ? "Include In Avg" : "Exclude From Avg"}
                                  </button>
                                )}
                              </div>
                            ))}
                            {selectedScoutData.allSessions.length > 5 && (
                              <div className="pt-2">
                                <button
                                  type="button"
                                  onClick={() => setShowAllSessionsModal(true)}
                                  className="text-sm font-medium hover:underline"
                                  style={{ color: "var(--primary-color)" }}
                                >
                                  View All Sessions
                                </button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="text-gray-500 text-center py-4">No sessions completed yet</p>
                        )}
                      </div>

                      {/* STATS */}
                      <div>
                        <h3 className="text-lg font-semibold mb-4">Statistics</h3>
                        <div className="space-y-3">
                          <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                            <span className="text-gray-700">Total Match Entries</span>
                            <span className="font-bold">{selectedScoutData.totalEntries}</span>
                          </div>
                          <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                            <span className="text-gray-700">Last Practice</span>
                            <span className="font-bold">
                              {selectedScoutData.practiceSessionsCompleted > 0
                                ? new Date(selectedScoutData.lastPracticeDate).toLocaleDateString()
                                : "Never"}
                            </span>
                          </div>
                          {selectedScoutData.deviceBreakdown &&
                            selectedScoutData.deviceBreakdown.mobileCount > 0 &&
                            selectedScoutData.deviceBreakdown.pcCount > 0 && (
                              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                <span className="text-gray-700">Better Device</span>
                                <span className="font-bold">
                                  {selectedScoutData.deviceBreakdown.betterDevice === "tie"
                                    ? "Equal on PC and Mobile"
                                    : selectedScoutData.deviceBreakdown.betterDevice === "mobile"
                                    ? "Mobile"
                                    : "PC"}
                                </span>
                              </div>
                            )}
                        </div>
                        <button
                          onClick={() => resetScoutSessions(selectedScoutData.scoutName)}
                          disabled={!canResetScoutData}
                          className="mt-4 px-3 py-2 rounded text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                          style={{
                            backgroundColor: "rgba(var(--primary-rgb), 0.16)",
                            color: "var(--theme-body-text)",
                            border: "1px solid rgba(var(--primary-rgb), 0.5)",
                          }}
                        >
                          Hard Reset Scout Data
                        </button>
                        {!canResetScoutData && (
                          <p className="text-xs text-gray-500 mt-2">Only team admins can reset scout data.</p>
                        )}
                      </div>

                      {/* RECOMMENDATIONS */}
                      {(() => {
                        const badge = getAccuracyBadge(selectedScoutData.status, selectedScoutData.confirmed);
                        
                        return (
                          <div className={`p-4 rounded-lg ${badge.bg} ${badge.text} border ${
                            badge.label === "Excellent" ? "border-green-200" :
                            badge.label === "Good" ? "border-green-700" :
                            badge.label === "Student Intervention" ? "border-orange-200" :
                            badge.label === "Undetermined" ? "border-gray-200" :
                            "border-red-200"
                          }`}>
                            <h3 className="font-semibold mb-2">
                              {badge.label === "Excellent" ? "Excellent Performance" :
                               badge.label === "Good" ? "Good Performance" :
                               badge.label === "Student Intervention" ? "Needs Improvement" :
                               badge.label === "Undetermined" ? "Status Pending" :
                               "Immediate Action Required"}
                            </h3>
                            <p className="text-sm">
                              {badge.label === "Excellent"
                                ? `${selectedScoutData.scoutName} is performing excellently and is ready for competition scouting.`
                                : badge.label === "Good"
                                ? `${selectedScoutData.scoutName} is performing well. Consider a few more practice sessions to reach excellent status.`
                                : badge.label === "Student Intervention"
                                ? `${selectedScoutData.scoutName} needs additional practice. Recommend peer mentoring and focused practice sessions.`
                                : badge.label === "Undetermined"
                                ? `${selectedScoutData.scoutName} has not completed any practice sessions yet. Practice is required before competition scouting.`
                                : `${selectedScoutData.scoutName} requires immediate mentor intervention and intensive practice before being assigned to matches.`}
                            </p>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              )}
              {selectedScoutData && showAllSessionsModal && !isRealMode && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                  <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                    <div className="p-6 border-b border-gray-200 flex items-center justify-between">
                      <div>
                        <h2 className="text-xl font-bold">All Practice Sessions</h2>
                        <p className="text-sm text-gray-600">{selectedScoutData.scoutName}</p>
                      </div>
                      <button
                        onClick={() => setShowAllSessionsModal(false)}
                        className="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 font-medium"
                      >
                        Close
                      </button>
                    </div>
                    <div className="p-6 space-y-3">
                      {selectedScoutData.allSessions.map((session, i) => (
                        <div key={session.sessionId} className="flex items-center gap-4">
                          <div className="text-sm text-gray-600 w-40">
                            <div>{`Session ${session.sessionNumber}`}</div>
                            <div className="text-xs">
                              {session.deviceType === "mobile"
                                ? "Mobile"
                                : session.deviceType === "pc"
                                ? "PC"
                                : "Unknown Device"}
                              {session.flags.length > 0 && canManageFlags && !session.dismissed ? " • Flagged" : ""}
                              {session.excluded ? " • Excluded" : ""}
                            </div>
                          </div>
                          <div className="flex-1 bg-gray-200 rounded-full h-8 overflow-hidden">
                            <div
                              className="h-full flex items-center justify-end pr-3 text-white text-sm font-semibold transition-all"
                              style={{
                                width: `${session.accuracy}%`,
                                backgroundColor:
                                  session.accuracy === 100 ? "#9333ea" :
                                  session.accuracy >= 90 ? "#10b981" :
                                  session.accuracy >= 80 ? "#15803d" :
                                  session.accuracy >= 50 ? "#f97316" : "#ef4444"
                              }}
                            >
                              {session.accuracy}%
                            </div>
                          </div>
                          {canManageFlags && session.flags.length > 0 && (
                            <button
                              type="button"
                              onClick={() => void setPracticeSessionFlagDismissed(session.sessionId, !session.dismissed)}
                              disabled={flagSaveKey === flagStateDocId("practiceSession", session.sessionId)}
                              className="px-2 py-1 rounded text-xs border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
                            >
                              {session.dismissed ? "Restore Flag" : "Dismiss Flag"}
                            </button>
                          )}
                          {canManageFlags && (
                            <button
                              type="button"
                              onClick={() => void setPracticeSessionExcluded(session.sessionId, !session.excluded)}
                              disabled={flagSaveKey === flagStateDocId("practiceSession", session.sessionId)}
                              className="px-2 py-1 rounded text-xs border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
                            >
                              {session.excluded ? "Include In Avg" : "Exclude From Avg"}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {rerunResultModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                  <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
                    <div className="p-6 border-b border-gray-200">
                      <h2 className="text-xl font-bold" style={{ color: "var(--primary-color)" }}>Session Recalculated</h2>
                      <p className="text-sm text-gray-600 mt-1">Practice session {rerunResultModal.sessionId}</p>
                    </div>
                    <div className="p-6 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600">Updated Entries</span>
                        <span className="font-semibold">{rerunResultModal.entries}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600">New Accuracy</span>
                        <span className="font-semibold">{rerunResultModal.accuracy}%</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600">Scouted Score</span>
                        <span className="font-semibold">{rerunResultModal.scoutedScore}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600">Official Score</span>
                        <span className="font-semibold">{rerunResultModal.officialScore}</span>
                      </div>
                    </div>
                    <div className="p-6 pt-0">
                      <button
                        onClick={() => setRerunResultModal(null)}
                        className="w-full py-2 rounded text-white font-medium"
                        style={{ backgroundColor: "var(--primary-color)" }}
                      >
                        Close
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ScoutAccuracyPage() {
  return (
    <ProtectedRoute requireAuth={true}>
      <ScoutAccuracyContent />
    </ProtectedRoute>
  );
}

