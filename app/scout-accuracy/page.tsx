"use client";

import { useState, useEffect } from "react";
import { collection, getDocs, query, where, deleteDoc, doc, updateDoc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import DataSourceCredits from "@/app/components/DataSourceCredits";
import { Users, Target, ClipboardList } from "lucide-react";
import { calculateAccuracy } from "@/app/utils/practiceTypes";
import { getRoleBadge as getTeamRoleBadge, getUserRoles } from "@/app/utils/roles";
import { evaluateScoutingFlags, flagStateDocId, type StoredFlagState } from "@/app/utils/scoutingFlags";

interface ScoutStats {
  scoutName: string;
  role: string;
  roles?: string[];
  totalEntries: number;
  practiceSessionsCompleted: number;
  averageAccuracy: number;
  lastPracticeDate: number;
  recentAccuracies: number[];
  recentSessions: Array<{
    sessionId: string;
    accuracy: number;
    timestamp: number;
    deviceType?: "mobile" | "pc";
    flags: string[];
    dismissed: boolean;
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
  matchType?: string;
  game?: string;
  matchId?: string;
  scoutId?: string;
  practiceMode?: string;
  isPracticeScouting?: boolean;
  isLivePracticeScouting?: boolean;
  deviceType?: "mobile" | "pc";
  teamNumber?: string;
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
};

function getEntryGame(value: ScoutingEntry): "REEFSCAPE" | "REBUILT" {
  const explicit = String(value.game || "").trim().toUpperCase();
  if (explicit === "REBUILT" || explicit === "REEFSCAPE") return explicit;
  const eventKey = String(value.eventKey || "").trim().toLowerCase();
  if (eventKey === "2026week0") return "REBUILT";
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
  [10],
];

const CARRY_SCALE_VALUES: number[][] = [
  [0],
  Array.from({ length: 12 }, (_, i) => i + 1),
  Array.from({ length: 11 }, (_, i) => i + 13),
  Array.from({ length: 10 }, (_, i) => i + 23),
  Array.from({ length: 10 }, (_, i) => i + 33),
  Array.from({ length: 11 }, (_, i) => i + 43),
  [54],
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

function rebuiltEntryScoreCandidates(entry: ScoutingEntry): number[] {
  const autoPreloadCandidates = getScaleCandidates(entry.auto?.preloadScale, PRELOAD_SCALE_VALUES, 0);
  const autoBpsCandidates = getScaleCandidates(entry.auto?.bpsScale, BPS_SCALE_VALUES, 0);
  const autoCarryCandidates = getScaleCandidates(entry.auto?.carryingScale, CARRY_SCALE_VALUES, 0);
  const teleBpsCandidates = getScaleCandidates(entry.teleop?.bpsScale, BPS_SCALE_VALUES, 0);
  const teleCarryCandidates = getScaleCandidates(entry.teleop?.carryingScale, CARRY_SCALE_VALUES, 0);
  const wonAuto = Boolean(entry.auto?.wonAuto || entry.teleop?.shiftParityFromWonAuto);
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
            const teleFuel = transition + (wonAuto ? shift2 + shift4 : shift1 + shift3) + toNumber(entry.teleop?.humanPlayerFuel);
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
  const userRoles = getUserRoles({ role: userData?.role, roles: userData?.roles });
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
  const [scoutStats, setScoutStats] = useState<ScoutStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedScout, setSelectedScout] = useState<string | null>(null);
  const [selectedGame, setSelectedGame] = useState<"REEFSCAPE" | "REBUILT">("REBUILT");
  const [selectedMode, setSelectedMode] = useState<"trial" | "competitive">("trial");
  const [rerunningAccuracy, setRerunningAccuracy] = useState(false);
  const [rerunSessionId, setRerunSessionId] = useState("");
  const [rerunResultModal, setRerunResultModal] = useState<{
    sessionId: string;
    entries: number;
    accuracy: number;
    scoutedScore: number;
    officialScore: number;
  } | null>(null);

  useEffect(() => {
    loadScoutStats();
  }, [selectedMode, selectedGame, userData?.teamId]);

  async function loadScoutStats() {
    setLoading(true);
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
            const row = docSnap.data() as StoredFlagState & { entityId?: string; entityType?: "scoutingEntry" | "practiceSession" };
            const entityId = String(row.entityId || "");
            const entityType = row.entityType === "practiceSession" ? "practiceSession" : "scoutingEntry";
            if (!entityId) return;
            teamFlagStateById.set(flagStateDocId(entityType, entityId), row);
          });
        } catch (error) {
          console.warn("Unable to load scouting flag states for scout accuracy. Continuing without flag states.", error);
        }
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
        let totalAccuracy = 0;
        let recentAccuracies: number[] = [];
        let recentSessions: ScoutStats["recentSessions"] = [];
        let lastPracticeDate = 0;
        const practiceDevicePoints: Array<{ deviceType?: "mobile" | "pc"; accuracy: number }> = [];
        const accuracyTimeline: Array<{ accuracy: number; timestamp: number; sessionId: string; deviceType?: "mobile" | "pc"; flags: string[]; dismissed: boolean }> = [];
        practiceRows.forEach(({ id, row: data }) => {
          if (typeof data.accuracy === "number") {
            totalAccuracy += data.accuracy;
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
            accuracyTimeline.push({
              accuracy: Number(data.accuracy || 0),
              timestamp: Number.isFinite(rowTimestamp) ? rowTimestamp : 0,
              sessionId: id,
              deviceType: sessionDeviceType,
              flags,
              dismissed,
            });
            practiceDevicePoints.push({
              deviceType: sessionDeviceType,
              accuracy: Number(data.accuracy || 0),
            });
          }
          const rowTimestamp = Number(data.timestamp || data.completedAt || data.startedAt || 0);
          if (rowTimestamp > lastPracticeDate) {
            lastPracticeDate = rowTimestamp;
          }
        });
        recentSessions = accuracyTimeline
          .sort((a, b) => a.timestamp - b.timestamp)
          .slice(-5);
        recentAccuracies = recentSessions.map((row) => row.accuracy);
        const averageAccuracy = accuracyTimeline.length > 0
          ? Math.round(totalAccuracy / accuracyTimeline.length)
          : 0;

        return {
          scoutName: member.scoutName,
          role: member.role,
          roles: member.roles,
          totalEntries: scoutPracticeEntries.length,
          practiceSessionsCompleted: practiceRows.length,
          averageAccuracy,
          lastPracticeDate: lastPracticeDate || Date.now(),
          recentAccuracies,
          recentSessions,
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
    const roles = getUserRoles({ role: s.role, roles: s.roles });
    return roles.includes("match-scout") || roles.includes("media");
  }).length;
  const membersWithPracticeAccuracy = scoutStats.filter((s) => s.practiceSessionsCompleted > 0 && s.averageAccuracy > 0);
  const rankedScoutStats = (() => {
    let currentRank = 0;
    let previousKey = "";
    return scoutStats.map((scout, index) => {
      const key = `${scout.practiceSessionsCompleted > 0 ? "sessions" : "nosessions"}:${scout.averageAccuracy}`;
      if (key !== previousKey) {
        currentRank = index + 1;
        previousKey = key;
      }
      return { scout, rank: currentRank };
    });
  })();

  function getAccuracyColor(accuracy: number): string {
    if (accuracy >= 95) return "text-green-600";
    if (accuracy >= 85) return "text-yellow-600";
    if (accuracy >= 75) return "text-orange-600";
    return "text-[#ff0000]";
  }

  function getAccuracyBadge(
    accuracy: number,
    practiceSessions: number
  ): { bg: string; text: string; label: string; showWarning: boolean } {
    // If no practice sessions, status is undetermined
    if (practiceSessions === 0) {
      return {
        bg: "bg-gray-100",
        text: "text-gray-700",
        label: "Undetermined",
        showWarning: false
      };
    }
    
    // Status thresholds:
    // 0-50 = Mentor Intervention
    // 51-74 = Student Intervention
    // 75-89 = Good
    // 90-100 = Excellent
    
    if (accuracy >= 90) {
      return {
        bg: "bg-green-100",
        text: "text-green-700",
        label: "Excellent",
        showWarning: false
      };
    }
    if (accuracy >= 75) {
      return {
        bg: "bg-blue-100",
        text: "text-blue-700",
        label: "Good",
        showWarning: false
      };
    }
    if (accuracy >= 51) {
      return {
        bg: "bg-orange-100",
        text: "text-orange-800",
        label: "Student Intervention",
        showWarning: true
      };
    }
    // 0-50
    return {
      bg: "bg-red-100",
      text: "text-red-800",
      label: "Mentor Intervention",
      showWarning: true
    };
  }

  const selectedScoutData = scoutStats.find(s => s.scoutName === selectedScout);
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

  async function setPracticeSessionFlagDismissed(sessionId: string, dismissed: boolean) {
    if (!canManageFlags || !userData?.teamId) return;
    const key = flagStateDocId("practiceSession", sessionId);
    setFlagSaveKey(key);
    try {
      await setDoc(
        doc(db, "scoutingFlagStates", key),
        {
          teamId: userData.teamId,
          entityType: "practiceSession",
          entityId: sessionId,
          dismissed,
          dismissedAt: Date.now(),
          dismissedBy: userData.uid || "",
        },
        { merge: true }
      );
      await loadScoutStats();
    } catch (error) {
      console.error("Failed updating practice session flag state:", error);
      alert("Could not update flag state.");
    } finally {
      setFlagSaveKey("");
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
              ({`Showing ${selectedMode === "trial" ? "Trial" : "Competitive"} practice mode`})
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
          </div>
          {canViewRestrictedData && canResetScoutData && (
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
                      {membersWithPracticeAccuracy.length > 0
                        ? Math.round(
                            membersWithPracticeAccuracy.reduce((sum, s) => sum + s.averageAccuracy, 0) /
                              membersWithPracticeAccuracy.length
                          )
                        : 0}%
                    </p>
                  </div>

                  <div className="bg-white rounded-xl shadow-md p-6">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold text-gray-700">Practice Sessions</h3>
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
              <div className="bg-white rounded-xl shadow-md overflow-hidden mb-6">
                <div className="p-6 border-b border-gray-200">
                  <h2 className="text-xl font-semibold">Team Member Accuracy Rankings</h2>
                  <p className="text-sm text-gray-500 mt-1">All team members ranked by practice accuracy</p>
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
                          Sessions
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Total Entries
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {rankedScoutStats.map(({ scout, rank }) => {
                        const badge = getAccuracyBadge(scout.averageAccuracy, scout.practiceSessionsCompleted);
                        const roleBadge = getTeamRoleBadge(scout.role, scout.roles);
                        const displayRank = scout.practiceSessionsCompleted === 0 ? "?" : `#${rank}`;
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
                            <td className="px-6 py-4 whitespace-nowrap">
                              <button
                                onClick={() => setSelectedScout(scout.scoutName)}
                                className="text-sm font-medium hover:underline"
                                style={{ color: "var(--primary-color)" }}
                              >
                                View Details →
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* SCOUT DETAIL MODAL */}
              {selectedScoutData && (
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
                                  <div>{`Session ${i + 1}`}</div>
                                  <div className="text-xs">
                                    {session.deviceType === "mobile"
                                      ? "Mobile"
                                      : session.deviceType === "pc"
                                      ? "PC"
                                      : "Unknown Device"}
                                    {session.flags.length > 0 && canManageFlags && !session.dismissed ? " • Flagged" : ""}
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
                              </div>
                            ))}
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
                        const badge = getAccuracyBadge(
                          selectedScoutData.averageAccuracy,
                          selectedScoutData.practiceSessionsCompleted
                        );
                        
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

