"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addDoc, collection, doc, getDoc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { db } from "@/app/firebase";
import { auth } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import ReefscapeMatchSelectModal, { type ReefscapeMatchOption } from "@/app/components/ReefscapeMatchSelectModal";
import PracticeDifficultyMatchModal, { type PracticeDifficultyModalOption } from "@/app/components/PracticeDifficultyMatchModal";
import { useAuth } from "@/app/AuthContext";
import { PracticeMatch, PracticeSession, calculateScoutedScore, calculateAccuracy } from "@/app/utils/practiceTypes";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { getEventsForGame, type AnalyticsGame } from "@/app/utils/analyticsEvents";
import { getTeamEventOptions, pickDetectedEventKey, type DetectedEventOption } from "@/app/utils/eventDetection";
import { getEventMatches, type TBAMatch } from "@/app/utils/tba-api";
import { buildCompletedModalIdsFromTba, buildReefscapeModalOptions, isTbaMatchCompleted } from "@/app/utils/reefscapeMatchSync";
import { getEffectiveNowSec } from "@/app/utils/teamTime";

// Counter component
const Counter = ({ label, value, onChange }: { label: string; value: number; onChange: (val: number) => void }) => (
  <div className="flex items-center justify-between py-2">
    <span className="text-sm font-medium text-gray-700">{label}</span>
    <div className="flex items-center gap-2">
      <button onClick={() => onChange(Math.max(0, value - 1))} className="theme-stepper-btn">−</button>
      <span className="w-8 text-center font-semibold">{value}</span>
      <button onClick={() => onChange(value + 1)} className="theme-stepper-btn">+</button>
    </div>
  </div>
);

const RebuiltCycleTimer = ({
  title,
  values,
  onAdd,
  onDelete,
}: {
  title: string;
  values: number[];
  onAdd: (value: number) => void;
  onDelete: (index: number) => void;
}) => {
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      if (startRef.current === null) return;
      setElapsed((performance.now() - startRef.current) / 1000);
    }, 20);
    return () => window.clearInterval(id);
  }, [running]);

  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-sm">{title}</span>
        <span className="font-mono text-sm">{elapsed.toFixed(2)} s</span>
      </div>
      <button
        type="button"
        onClick={() => {
          if (!running) {
            startRef.current = performance.now();
            setElapsed(0);
            setRunning(true);
            return;
          }
          setRunning(false);
          onAdd(Number(elapsed.toFixed(2)));
          setElapsed(0);
          startRef.current = null;
        }}
        className="px-3 py-2 rounded text-white text-sm"
        style={{ backgroundColor: running ? "#dc2626" : "var(--primary-color)" }}
      >
        {running ? "Stop" : "Start"}
      </button>
      {values.map((v, i) => (
        <div key={`${title}-${i}-${v}`} className="flex items-center justify-between gap-2 text-xs text-gray-700">
          <span>
            Cycle {i + 1}: {v.toFixed(2)}
          </span>
          <button
            type="button"
            onClick={() => onDelete(i)}
            className="px-2 py-0.5 rounded border border-red-300 text-red-700 hover:bg-red-50"
            aria-label={`Delete cycle ${i + 1}`}
          >
            Delete
          </button>
        </div>
      ))}
    </div>
  );
};

type PracticeMode = 'trial' | 'competitive';
type ScoutedData = PracticeSession["scoutedData"];
type PracticeStep = 'select' | 'live_reveal' | 'practice' | 'break' | 'results';
type RebuiltScoutedData = {
  teamNumber: string;
  startingPosition: string;
  autoPreloadScale: number;
  autoBpsScale: number;
  autoCarryScale: number;
  autoHumanPlayerFuel: number;
  autoCounterOverride: number;
  autoCounterMissedFuel: number;
  autoFailedClimb: number;
  autoSuccessfulClimb: boolean;
  wonAuto: boolean;
  teleBpsScale: number;
  teleCarryScale: number;
  transitionCounterOverride: number;
  transitionCounterMissedFuel: number;
  shift1CounterOverride: number;
  shift1CounterMissedFuel: number;
  shift2CounterOverride: number;
  shift2CounterMissedFuel: number;
  shift3CounterOverride: number;
  shift3CounterMissedFuel: number;
  shift4CounterOverride: number;
  shift4CounterMissedFuel: number;
  teleopHumanPlayerFuel: number;
  endgameCounterOverride: number;
  endgameCounterMissedFuel: number;
  endgameHumanPlayerFuel: number;
  endgameFailedClimb: number;
  endgameStatus: string;
  autoCycles: number[];
  transitionCycles: number[];
  shift1Cycles: number[];
  shift2Cycles: number[];
  shift3Cycles: number[];
  shift4Cycles: number[];
  endgameCycles: number[];
  incidents: string[];
  notes: string;
};

const REBUILT_BPS = [0, 2, 5, 8, 12, 16, 20, 23, 25];
const REBUILT_CARRY = [0, 12, 23, 32, 42, 53, 64, 74, 75];
const REBUILT_PRELOAD = [0, 2, 4, 6, 8];
const PRELOAD_LABELS = ["0", "1-2", "3-4", "5-6", "7-8"];
const BPS_LABELS = ["0", "1-3", "4-6", "7-9", "10-13", "14-17", "18-21", "22-24", "25+"];
const CARRY_LABELS = ["0", "1-12", "13-23", "23-32", "33-42", "43-53", "54-64", "65-74", "75+"];
const BPS_MAX = BPS_LABELS.length - 1;
const CARRY_MAX = CARRY_LABELS.length - 1;

function estimateRebuiltBalls(seconds: number, bpsScale: number, capacityBalls: number) {
  return Math.max(0, Math.round(Math.min(Math.max(0, capacityBalls), (REBUILT_BPS[bpsScale] || 0) * seconds)));
}

type PracticeSessionDraft = {
  version: 1;
  savedAt: number;
  scoutId: string;
  selectedGame: "REEFSCAPE" | "REBUILT" | null;
  selectedDifficulty: 'easy' | 'medium' | 'hard' | 'live' | null;
  selectedMode: PracticeMode | null;
  currentStep: Extract<PracticeStep, "practice" | "break">;
  currentMatch: PracticeMatch;
  currentRobotIndex: number;
  breakCompletedRobotIndex: number | null;
  robotSessions: ScoutedData[];
  rebuiltRobotSessions: RebuiltScoutedData[];
  humanPlayerRobot: number | null;
  formData: ScoutedData;
  rebuiltFormData: RebuiltScoutedData;
};

type CandidatePracticeMatch = PracticeMatch & {
  progress: "fresh" | "partial" | "complete";
};

type LiveRobotPickOption = {
  match: CandidatePracticeMatch;
  alliance: "red" | "blue";
  robotIndex: number;
  teamNumber: string;
};

type PendingLiveRobotPick = {
  stageLabel: string;
  matchNumber: number;
  red: LiveRobotPickOption[];
  blue: LiveRobotPickOption[];
};

type LivePracticeLobby = {
  id: string;
  code: string;
  hostId: string;
  hostName: string;
  teamId: string;
  game: "REEFSCAPE" | "REBUILT";
  mode: PracticeMode;
  status: "waiting" | "in_progress" | "completed" | "closed";
  createdAt: number;
  startedAt?: number;
  hostOptOut?: boolean;
  hostVideo?: boolean;
  selectedMatchId?: string;
  selectedMatchBase?: string;
  selectedMatchLabel?: string;
  selectedMatchDifficulty?: "easy" | "medium" | "hard" | "";
  revealUntil?: number;
  playersByUid?: Record<string, { name?: string; joinedAt?: number }>;
  matchJson?: string;
  assignmentsJson?: string;
  submissionsJson?: string;
};

type LivePracticeLobbyStorage = Omit<LivePracticeLobby, "id"> & { id?: string };

type LiveAssignment = {
  alliance: "red" | "blue";
  robotIndex: number;
  teamNumber: string;
  groupIndex: number;
};

type LiveMatchBundle = {
  red: PracticeMatch;
  blue: PracticeMatch;
};

type PracticeSelectorOption = ReefscapeMatchOption & {
  sourceId: string;
  progress: CandidatePracticeMatch["progress"];
};

const PRACTICE_DRAFT_KEY_PREFIX = "practice-session-draft";

function getPracticeDraftKey(scoutId: string) {
  return `${PRACTICE_DRAFT_KEY_PREFIX}:${scoutId}`;
}

function createEmptyScoutedData(teamNumber = "", notes = ""): ScoutedData {
  return {
    teamNumber,
    startingPosition: "",
    leftStartingZone: false,
    autoCoralMissed: 0,
    autoCoralL1: 0,
    autoCoralL2: 0,
    autoCoralL3: 0,
    autoCoralL4: 0,
    autoAlgaeProcessorMissed: 0,
    autoAlgaeProcessorScored: 0,
    autoAlgaeNetMissed: 0,
    autoAlgaeNetScored: 0,
    teleopCoralMissed: 0,
    teleopCoralL1: 0,
    teleopCoralL2: 0,
    teleopCoralL3: 0,
    teleopCoralL4: 0,
    teleopAlgaeRemoved: false,
    teleopProcessorMissed: 0,
    teleopProcessorScored: 0,
    teleopNetRobotMissed: 0,
    teleopNetRobotScored: 0,
    teleopNetHumanMissed: 0,
    teleopNetHumanScored: 0,
    failedClimb: 0,
    stageStatus: "",
    incidents: [] as string[],
    notes,
  };
}

function sanitizeAllianceTeams(candidate: unknown): number[] {
  const parseValues = (values: unknown[]): number[] =>
    values
      .map((value) => {
        if (typeof value === "number") return value;
        if (typeof value === "string") return parseInt(value.replace(/[^\d]/g, ""), 10);
        return NaN;
      })
      .filter((value) => !Number.isNaN(value) && value > 0);

  if (Array.isArray(candidate)) return parseValues(candidate);
  if (typeof candidate === "string") {
    const trimmed = candidate.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parseValues(parsed);
      } catch {
        return parseValues(trimmed.split(","));
      }
    }
    return parseValues(trimmed.split(","));
  }
  return [];
}

function getMatchTeams(match: PracticeMatch & Record<string, unknown>): number[] {
  const rawAlliances = match["alliances"];
  let alliances: Record<string, unknown> | undefined;
  if (rawAlliances && typeof rawAlliances === "object") {
    alliances = rawAlliances as Record<string, unknown>;
  } else if (typeof rawAlliances === "string") {
    try {
      const parsed = JSON.parse(rawAlliances) as Record<string, unknown>;
      alliances = parsed;
    } catch {
      alliances = undefined;
    }
  }
  const allianceSide = typeof match["alliance"] === "string" ? String(match["alliance"]).toLowerCase() : "";
  const preferredAlliance =
    allianceSide === "blue"
      ? alliances?.["blue"] as Record<string, unknown> | undefined
      : alliances?.["red"] as Record<string, unknown> | undefined;
  const alternateAlliance =
    allianceSide === "blue"
      ? alliances?.["red"] as Record<string, unknown> | undefined
      : alliances?.["blue"] as Record<string, unknown> | undefined;

  const candidates = [
    match.allianceTeams,
    match["teams"],
    match["teamNumbers"],
    match["redAllianceTeams"],
    match["blueAllianceTeams"],
    preferredAlliance?.["team_keys"],
    preferredAlliance?.["teams"],
    alternateAlliance?.["team_keys"],
    alternateAlliance?.["teams"],
  ];

  for (const candidate of candidates) {
    const parsed = sanitizeAllianceTeams(candidate);
    if (parsed.length >= 3) return parsed.slice(0, 3);
  }

  return [];
}

function buildLegacyGroupedMatches(matches: PracticeMatch[]): PracticeMatch[] {
  const grouped = new Map<string, PracticeMatch[]>();
  for (const match of matches) {
    const matchKey = String((match as unknown as Record<string, unknown>).matchKey || "");
    const alliance = String((match as unknown as Record<string, unknown>).alliance || "");
    const key = `${matchKey}::${alliance}`;
    const bucket = grouped.get(key) || [];
    bucket.push(match);
    grouped.set(key, bucket);
  }

  const output: PracticeMatch[] = [];
  for (const entries of grouped.values()) {
    const teams = entries
      .map((entry) => {
        const raw = (entry as unknown as Record<string, unknown>).teamNumber;
        const teamNumber = sanitizeAllianceTeams([raw])[0] || 0;
        const teamPositionRaw = (entry as unknown as Record<string, unknown>).teamPosition;
        const teamPosition =
          typeof teamPositionRaw === "number"
            ? teamPositionRaw
            : typeof teamPositionRaw === "string"
            ? Number(teamPositionRaw)
            : 0;
        return { teamNumber, teamPosition };
      })
      .filter((row) => row.teamNumber > 0)
      .sort((a, b) => a.teamPosition - b.teamPosition)
      .map((row) => row.teamNumber);

    if (teams.length < 3) continue;
    output.push({
      ...entries[0],
      allianceTeams: teams.slice(0, 3),
    });
  }
  return output;
}

function readOfficialData(value: unknown): { score: number; penaltyPoints: number; breakdown: Record<string, unknown> } {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return {
      score: typeof record.score === "number" ? record.score : 0,
      penaltyPoints: typeof record.penaltyPoints === "number" ? record.penaltyPoints : 0,
      breakdown: typeof record.breakdown === "object" && record.breakdown ? (record.breakdown as Record<string, unknown>) : {},
    };
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      return {
        score: typeof parsed.score === "number" ? parsed.score : 0,
        penaltyPoints: typeof parsed.penaltyPoints === "number" ? parsed.penaltyPoints : 0,
        breakdown: typeof parsed.breakdown === "object" && parsed.breakdown ? (parsed.breakdown as Record<string, unknown>) : {},
      };
    } catch {
      return { score: 0, penaltyPoints: 0, breakdown: {} };
    }
  }
  return { score: 0, penaltyPoints: 0, breakdown: {} };
}

function scoreToDifficulty(score: number): "easy" | "medium" | "hard" {
  if (!Number.isFinite(score) || score <= 200) return "easy";
  if (score <= 400) return "medium";
  return "hard";
}

function readScoreFromOfficialData(value: unknown): number | null {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(record, "score")) {
      const score = Number(record.score);
      if (Number.isFinite(score) && score >= 0) return score;
    }
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      if (Object.prototype.hasOwnProperty.call(parsed, "score")) {
        const score = Number(parsed.score);
        if (Number.isFinite(score) && score >= 0) return score;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function getPracticeMatchScore(match: PracticeMatch): number | null {
  const data = match as unknown as Record<string, unknown>;
  const scoreCandidates: Array<number | null> = [
    readScoreFromOfficialData(data.officialData),
    Number(data.officialScore),
    Number(data.allianceScore),
    Number(data.actualScore),
  ];
  for (const candidate of scoreCandidates) {
    if (candidate !== null && Number.isFinite(candidate) && candidate > 0) return candidate;
  }

  for (const candidate of scoreCandidates) {
    if (candidate !== null && Number.isFinite(candidate) && candidate === 0) return 0;
  }

  return null;
}

function matchMatchesDifficulty(match: PracticeMatch, difficulty: "easy" | "medium" | "hard"): boolean {
  const score = getPracticeMatchScore(match);
  if (score === null) return false;
  return scoreToDifficulty(score) === difficulty;
}

function dedupePracticeMatches(matches: PracticeMatch[]): PracticeMatch[] {
  const byIdentity = new Map<string, PracticeMatch>();
  for (const match of matches) {
    const stage = getPracticeStage(match);
    const key = String((match as unknown as Record<string, unknown>).matchKey || "").trim().toLowerCase();
    const baseIdentity = key || `${stage}:${Number(match.matchNumber || 0)}`;
    const alliance = normalizeAllianceSide((match as unknown as Record<string, unknown>).alliance);
    const identity = alliance ? `${baseIdentity}:${alliance}` : baseIdentity;
    const teams = (match.allianceTeams || []).join("-");
    const dedupeKey = `${identity || String(match.id || "")}::${teams}`;
    if (!dedupeKey.trim()) continue;
    if (!byIdentity.has(dedupeKey)) {
      byIdentity.set(dedupeKey, match);
    }
  }
  return Array.from(byIdentity.values());
}

function getScoutDevice() {
  if (typeof window === "undefined") {
    return { deviceType: "pc" as const, details: { ua: "", platform: "", viewport: "" } };
  }
  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "";
  const viewport = `${window.innerWidth}x${window.innerHeight}`;
  const coarsePointer = window.matchMedia?.("(pointer: coarse)")?.matches || false;
  const mobileByUa = /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile/i.test(ua);
  const deviceType = coarsePointer || mobileByUa ? "mobile" as const : "pc" as const;
  return { deviceType, details: { ua, platform, viewport } };
}

function getPracticeEventKey(match: PracticeMatch): string {
  const explicitKey = String((match as unknown as Record<string, unknown>).eventKey || "").trim();
  if (explicitKey) return explicitKey;

  const matchKey = String((match as unknown as Record<string, unknown>).matchKey || "").trim().toLowerCase();
  const parsed = matchKey.match(/^(\d{4}[a-z0-9]+)_/);
  if (parsed?.[1]) return parsed[1];

  return "app-testing";
}

function toLiveEventName(eventName: string): string {
  const trimmed = String(eventName || "").trim();
  if (!trimmed) return "Live Stream (Live)";
  return /\(live\)$/i.test(trimmed) ? trimmed : `${trimmed} (Live)`;
}

function createEmptyRebuiltScoutedData(teamNumber = "", notes = ""): RebuiltScoutedData {
  return {
    teamNumber,
    startingPosition: "",
    autoPreloadScale: 0,
    autoBpsScale: 0,
    autoCarryScale: 0,
    autoHumanPlayerFuel: 0,
    autoCounterOverride: 0,
    autoCounterMissedFuel: 0,
    autoFailedClimb: 0,
    autoSuccessfulClimb: false,
    wonAuto: false,
    teleBpsScale: 0,
    teleCarryScale: 0,
    transitionCounterOverride: 0,
    transitionCounterMissedFuel: 0,
    shift1CounterOverride: 0,
    shift1CounterMissedFuel: 0,
    shift2CounterOverride: 0,
    shift2CounterMissedFuel: 0,
    shift3CounterOverride: 0,
    shift3CounterMissedFuel: 0,
    shift4CounterOverride: 0,
    shift4CounterMissedFuel: 0,
    teleopHumanPlayerFuel: 0,
    endgameCounterOverride: 0,
    endgameCounterMissedFuel: 0,
    endgameHumanPlayerFuel: 0,
    endgameFailedClimb: 0,
    endgameStatus: "",
    autoCycles: [],
    transitionCycles: [],
    shift1Cycles: [],
    shift2Cycles: [],
    shift3Cycles: [],
    shift4Cycles: [],
    endgameCycles: [],
    incidents: [],
    notes,
  };
}

function resolveSectionFuel(estimated: number, scoredOverride: number, missedFuel: number) {
  if (scoredOverride > 0) return scoredOverride;
  return Math.max(0, estimated - Math.max(0, Number(missedFuel || 0)));
}

function calculateRebuiltScoutedScore(data: RebuiltScoutedData): number {
  const preloadCap = REBUILT_PRELOAD[Math.max(0, Math.min(4, data.autoPreloadScale))] || 0;
  const autoCarryCap = REBUILT_CARRY[Math.max(0, Math.min(CARRY_MAX, data.autoCarryScale))] || 0;
  const teleCarryCap = REBUILT_CARRY[Math.max(0, Math.min(CARRY_MAX, data.teleCarryScale))] || 0;
  const autoEstimatedFuel = data.autoCycles.reduce((sum, seconds, index) => {
    const capacity = index === 0 && preloadCap > 0 ? preloadCap : autoCarryCap;
    return sum + estimateRebuiltBalls(seconds, data.autoBpsScale, capacity);
  }, 0);
  const transitionEstimatedFuel = data.transitionCycles.reduce(
    (sum, seconds) => sum + estimateRebuiltBalls(seconds, data.teleBpsScale, teleCarryCap),
    0
  );
  const shift1EstimatedFuel = data.shift1Cycles.reduce((sum, seconds) => sum + estimateRebuiltBalls(seconds, data.teleBpsScale, teleCarryCap), 0);
  const shift2EstimatedFuel = data.shift2Cycles.reduce((sum, seconds) => sum + estimateRebuiltBalls(seconds, data.teleBpsScale, teleCarryCap), 0);
  const shift3EstimatedFuel = data.shift3Cycles.reduce((sum, seconds) => sum + estimateRebuiltBalls(seconds, data.teleBpsScale, teleCarryCap), 0);
  const shift4EstimatedFuel = data.shift4Cycles.reduce((sum, seconds) => sum + estimateRebuiltBalls(seconds, data.teleBpsScale, teleCarryCap), 0);
  const endgameEstimatedFuel = data.endgameCycles.reduce((sum, seconds) => sum + estimateRebuiltBalls(seconds, data.teleBpsScale, teleCarryCap), 0);

  const autoFuelSection = resolveSectionFuel(autoEstimatedFuel, data.autoCounterOverride, data.autoCounterMissedFuel);
  const transitionFuel = resolveSectionFuel(transitionEstimatedFuel, data.transitionCounterOverride, data.transitionCounterMissedFuel);
  const shift1Fuel = resolveSectionFuel(shift1EstimatedFuel, data.shift1CounterOverride, data.shift1CounterMissedFuel);
  const shift2Fuel = resolveSectionFuel(shift2EstimatedFuel, data.shift2CounterOverride, data.shift2CounterMissedFuel);
  const shift3Fuel = resolveSectionFuel(shift3EstimatedFuel, data.shift3CounterOverride, data.shift3CounterMissedFuel);
  const shift4Fuel = resolveSectionFuel(shift4EstimatedFuel, data.shift4CounterOverride, data.shift4CounterMissedFuel);
  const endgameFuelSection = resolveSectionFuel(endgameEstimatedFuel, data.endgameCounterOverride, data.endgameCounterMissedFuel);

  const autoFuel = autoFuelSection + Number(data.autoHumanPlayerFuel || 0);
  const teleopFuel = transitionFuel + (data.wonAuto ? shift2Fuel + shift4Fuel : shift1Fuel + shift3Fuel) + Number(data.teleopHumanPlayerFuel || 0);
  const endgameFuel = endgameFuelSection + Number(data.endgameHumanPlayerFuel || 0);
  const autoClimb = data.autoSuccessfulClimb ? 15 : 0;
  const teleopClimb =
    data.endgameStatus === "level-1" ? 10 :
    data.endgameStatus === "level-2" ? 20 :
    data.endgameStatus === "level-3" ? 30 : 0;
  return autoFuel + teleopFuel + endgameFuel + autoClimb + teleopClimb;
}

function getScaleCandidatesFromIndex(index: number, labels: "preload" | "bps" | "carry"): number[] {
  const maxIndex = labels === "carry" ? CARRY_MAX : labels === "bps" ? BPS_MAX : 4;
  const i = Math.max(0, Math.min(maxIndex, Number(index || 0)));
  if (labels === "preload") return [[0], [1, 2], [3, 4], [5, 6], [7, 8]][i] || [0];
  if (labels === "bps") {
    return [
      [0],
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
      [10, 11, 12, 13],
      [14, 15, 16, 17],
      [18, 19, 20, 21],
      [22, 23, 24],
      [25],
    ][i] || [0];
  }
  return [
    [0],
    Array.from({ length: 12 }, (_, n) => n + 1),
    Array.from({ length: 11 }, (_, n) => n + 13),
    Array.from({ length: 10 }, (_, n) => n + 23),
    Array.from({ length: 10 }, (_, n) => n + 33),
    Array.from({ length: 11 }, (_, n) => n + 43),
    Array.from({ length: 11 }, (_, n) => n + 54),
    Array.from({ length: 10 }, (_, n) => n + 65),
    [75],
  ][i] || [0];
}

function estimateWithRawParams(cycles: number[], bps: number, carry: number, preload?: number): number {
  return (cycles || []).reduce((sum, seconds, index) => {
    const sec = Number(seconds || 0);
    if (!Number.isFinite(sec) || sec <= 0 || bps <= 0) return sum;
    const cap = index === 0 && typeof preload === "number" ? preload : carry;
    return sum + Math.max(0, Math.round(Math.min(Math.max(0, cap), bps * sec)));
  }, 0);
}

function rebuiltScoreCandidatesForAccuracy(data: RebuiltScoutedData): number[] {
  const autoPreloadOptions = getScaleCandidatesFromIndex(data.autoPreloadScale, "preload");
  const autoBpsOptions = getScaleCandidatesFromIndex(data.autoBpsScale, "bps");
  const autoCarryOptions = getScaleCandidatesFromIndex(data.autoCarryScale, "carry");
  const teleBpsOptions = getScaleCandidatesFromIndex(data.teleBpsScale, "bps");
  const teleCarryOptions = getScaleCandidatesFromIndex(data.teleCarryScale, "carry");

  const candidates = new Set<number>();
  const autoClimb = data.autoSuccessfulClimb ? 15 : 0;
  const teleopClimb =
    data.endgameStatus === "level-1" ? 10 :
    data.endgameStatus === "level-2" ? 20 :
    data.endgameStatus === "level-3" ? 30 : 0;

  for (const preload of autoPreloadOptions) {
    for (const autoBps of autoBpsOptions) {
      for (const autoCarry of autoCarryOptions) {
        const autoEstimated = estimateWithRawParams(data.autoCycles, autoBps, autoCarry, preload);
        const autoFuel = resolveSectionFuel(autoEstimated, data.autoCounterOverride, data.autoCounterMissedFuel) + Number(data.autoHumanPlayerFuel || 0);

        for (const teleBps of teleBpsOptions) {
          for (const teleCarry of teleCarryOptions) {
            const transition = resolveSectionFuel(
              estimateWithRawParams(data.transitionCycles, teleBps, teleCarry),
              data.transitionCounterOverride,
              data.transitionCounterMissedFuel
            );
            const shift1 = resolveSectionFuel(
              estimateWithRawParams(data.shift1Cycles, teleBps, teleCarry),
              data.shift1CounterOverride,
              data.shift1CounterMissedFuel
            );
            const shift2 = resolveSectionFuel(
              estimateWithRawParams(data.shift2Cycles, teleBps, teleCarry),
              data.shift2CounterOverride,
              data.shift2CounterMissedFuel
            );
            const shift3 = resolveSectionFuel(
              estimateWithRawParams(data.shift3Cycles, teleBps, teleCarry),
              data.shift3CounterOverride,
              data.shift3CounterMissedFuel
            );
            const shift4 = resolveSectionFuel(
              estimateWithRawParams(data.shift4Cycles, teleBps, teleCarry),
              data.shift4CounterOverride,
              data.shift4CounterMissedFuel
            );
            const endgameFuel = resolveSectionFuel(
              estimateWithRawParams(data.endgameCycles, teleBps, teleCarry),
              data.endgameCounterOverride,
              data.endgameCounterMissedFuel
            ) + Number(data.endgameHumanPlayerFuel || 0);
            const teleFuel = transition + (data.wonAuto ? shift2 + shift4 : shift1 + shift3) + Number(data.teleopHumanPlayerFuel || 0);
            candidates.add(autoFuel + teleFuel + endgameFuel + autoClimb + teleopClimb);
          }
        }
      }
    }
  }

  if (candidates.size === 0) candidates.add(calculateRebuiltScoutedScore(data));
  return Array.from(candidates);
}

function calculateBestRebuiltSessionBaseScore(allRobotData: RebuiltScoutedData[], officialScore: number, penaltyPoints: number) {
  const targetBase = Math.max(0, Number(officialScore || 0) - Number(penaltyPoints || 0));
  let sums = new Set<number>([0]);

  for (const data of allRobotData) {
    const entryCandidates = rebuiltScoreCandidatesForAccuracy(data);
    const next = new Set<number>();
    for (const sum of sums) {
      for (const candidate of entryCandidates) {
        next.add(sum + candidate);
      }
    }
    let trimmed = Array.from(next);
    if (trimmed.length > 6000) {
      trimmed = trimmed
        .sort((a, b) => Math.abs(a - targetBase) - Math.abs(b - targetBase))
        .slice(0, 6000);
    }
    sums = new Set(trimmed);
  }

  const best = Array.from(sums).sort((a, b) => Math.abs(a - targetBase) - Math.abs(b - targetBase))[0];
  return typeof best === "number"
    ? best
    : allRobotData.reduce((sum, data) => sum + calculateRebuiltScoutedScore(data), 0);
}

function normalizePracticeMatchType(
  rawType: unknown,
  rawMatchKey: unknown,
  rawCompLevel: unknown
): "qualification" | "playoff" | "practice" {
  const compLevel = String(rawCompLevel || "").trim().toLowerCase();
  if (compLevel === "qm") return "qualification";
  if (compLevel === "qf" || compLevel === "sf" || compLevel === "f") return "playoff";

  const matchKey = String(rawMatchKey || "").trim().toLowerCase();
  if (/_qm\d+/.test(matchKey)) return "qualification";
  if (/_qf\d+m\d+/.test(matchKey) || /_sf\d+m\d+/.test(matchKey) || /_f\d+m\d+/.test(matchKey)) return "playoff";

  const typeValue = String(rawType || "").trim().toLowerCase();
  if (typeValue === "qualification" || typeValue === "playoff" || typeValue === "practice") {
    return typeValue;
  }

  return "practice";
}

function normalizeAllianceSide(rawAlliance: unknown): "red" | "blue" | "" {
  const alliance = String(rawAlliance || "").trim().toLowerCase();
  if (alliance === "red" || alliance === "blue") return alliance;
  return "";
}

function getPracticeStage(match: {
  matchType?: unknown;
  matchKey?: unknown;
  compLevel?: unknown;
}): "practice" | "qualification" | "semifinal" | "finals" {
  const matchKey = String(match.matchKey || "").trim().toLowerCase();
  const compLevel = String(match.compLevel || "").trim().toLowerCase();

  if (compLevel === "sf" || /_sf\d+m\d+/.test(matchKey)) return "semifinal";
  if (compLevel === "f" || /_f\d+m\d+/.test(matchKey)) return "finals";
  if (compLevel === "qf" || /_qf\d+m\d+/.test(matchKey)) return "finals";

  const normalizedType = normalizePracticeMatchType(match.matchType, match.matchKey, match.compLevel);
  if (normalizedType === "practice") return "practice";
  if (normalizedType === "qualification") return "qualification";
  return "finals";
}

function getPracticeStageLabel(stage: "practice" | "qualification" | "semifinal" | "finals"): string {
  if (stage === "practice") return "Practice";
  if (stage === "qualification") return "Qualification";
  if (stage === "semifinal") return "Semi-Finals";
  return "Finals";
}

function parseBracketNumbers(match: { matchKey?: unknown; setNumber?: unknown; matchNumber?: unknown }) {
  const key = String(match.matchKey || "").toLowerCase();
  const fromKey = key.match(/_(qf|sf|f)(\d+)m(\d+)$/i);
  if (fromKey) {
    return {
      setNumber: Number(fromKey[2] || 0),
      matchNumber: Number(fromKey[3] || 0),
    };
  }

  const setNumber = Number(match.setNumber || 0);
  const matchNumber = Number(match.matchNumber || 0);
  return { setNumber, matchNumber };
}

function mapPlayoffToBracketSlot(match: {
  matchKey?: unknown;
  setNumber?: unknown;
  matchNumber?: unknown;
  compLevel?: unknown;
}): number | null {
  const compLevel = String(match.compLevel || "").trim().toLowerCase();
  const { setNumber, matchNumber } = parseBracketNumbers(match);
  const key = String(match.matchKey || "").trim().toLowerCase();

  const inferredLevel = compLevel
    || (/_qf\d+m\d+/.test(key) ? "qf" : "")
    || (/_sf\d+m\d+/.test(key) ? "sf" : "")
    || (/_f\d+m\d+/.test(key) ? "f" : "");

  // 2026+ double-elim feeds often encode bracket slot as SF{slot}M1.
  if (inferredLevel === "sf" && setNumber >= 1 && setNumber <= 13) {
    return setNumber;
  }
  if (inferredLevel === "qf") {
    if (setNumber >= 1 && setNumber <= 4) return setNumber; // 1-4
    if (matchNumber >= 2 && setNumber === 1) return 7;
    if (matchNumber >= 2 && setNumber === 2) return 8;
    return null;
  }
  if (inferredLevel === "sf") {
    if (matchNumber === 1 && setNumber === 1) return 5;
    if (matchNumber === 1 && setNumber === 2) return 6;
    if (matchNumber === 2 && setNumber === 1) return 9;
    if (matchNumber === 2 && setNumber === 2) return 10;
    if (matchNumber === 3 && setNumber === 1) return 11;
    if (matchNumber === 3 && setNumber === 2) return 12;
    return null;
  }
  return null;
}

function parsePracticeMatchNumber(match: { matchKey?: unknown; matchNumber?: unknown; setNumber?: unknown; compLevel?: unknown }): number {
  const playoffSlot = mapPlayoffToBracketSlot(match);
  if (playoffSlot !== null) return playoffSlot;

  const key = String(match.matchKey || "").toLowerCase();
  const compLevel = String(match.compLevel || "").trim().toLowerCase();
  const finalsKey = key.match(/_f(\d+)m(\d+)$/i);
  if (finalsKey && compLevel === "f") {
    const setNum = Number(finalsKey[1]);
    const matchNum = Number(finalsKey[2]);
    if (setNum >= 14 && setNum <= 16) return setNum - 13;
    if (setNum === 1 && matchNum >= 1 && matchNum <= 3) return matchNum;
    if (setNum >= 1 && setNum <= 3 && matchNum === 1) return setNum;
  }
  const fromKey =
    key.match(/_qm(\d+)$/)?.[1] ||
    key.match(/_pm(\d+)$/)?.[1] ||
    key.match(/_pr(\d+)$/)?.[1] ||
    key.match(/_m(\d+)$/)?.[1];
  if (fromKey) return Number(fromKey);
  const number = Number(match.matchNumber || 0);
  if (compLevel === "f") {
    const setNum = Number(match.setNumber || 0);
    if (setNum >= 14 && setNum <= 16) return setNum - 13;
    if (setNum >= 1 && setNum <= 3 && number === 1) return setNum;
  }
  if (Number.isFinite(number) && number > 0) return number;
  return 1;
}

function getModalIdForMatch(match: CandidatePracticeMatch): string {
  const stage = getPracticeStage(match);
  const modalType: ReefscapeMatchOption["type"] =
    stage === "practice" ? "practice" : stage === "qualification" ? "qualification" : "finals";
  const bracketSlot = modalType === "finals"
    ? mapPlayoffToBracketSlot(match as { matchKey?: unknown; setNumber?: unknown; matchNumber?: unknown; compLevel?: unknown })
    : null;
  const parsedNumber =
    bracketSlot !== null
      ? bracketSlot
      : parsePracticeMatchNumber(match as { matchKey?: unknown; matchNumber?: unknown; setNumber?: unknown; compLevel?: unknown });
  const finalsKind = modalType === "finals" ? (bracketSlot !== null ? "bracket" : "series") : undefined;
  if (modalType === "practice") return `p${parsedNumber}`;
  if (modalType === "qualification") return `q${parsedNumber}`;
  return finalsKind === "bracket" ? `sf${parsedNumber}` : `f${parsedNumber}`;
}

function pickNextModalIdFromOptions(options: ReefscapeMatchOption[], completed: Set<string>, nowSec: number): string {
  if (options.length === 0) return "";
  const now = nowSec;

  const bracketOptions = options.filter((opt) => opt.type === "finals" && opt.id.startsWith("sf"));
  if (bracketOptions.length > 0) {
    const timesByNumber = new Map<number, number>();
    bracketOptions.forEach((opt) => {
      const existing = Number(timesByNumber.get(opt.matchNumber) || 0);
      const nextTime = Number(opt.scheduleTime || 0);
      if (existing <= 0 || (nextTime > 0 && nextTime < existing)) {
        timesByNumber.set(opt.matchNumber, nextTime);
      }
    });
    const availableNumbers = Array.from(new Set(bracketOptions.map((opt) => opt.matchNumber))).sort((a, b) => a - b);
    const completedNumbers = new Set(
      availableNumbers.filter((n) => completed.has(`sf${n}`))
    );
    const hasScheduleTimes = availableNumbers.some((n) => Number(timesByNumber.get(n) || 0) > 0);
    const hasCompleted = completedNumbers.size > 0;
    const graceSeconds = 10 * 60;
    const nextByTime =
      availableNumbers
        .filter((n) => !completedNumbers.has(n))
        .map((n) => ({ n, t: Number(timesByNumber.get(n) || 0) }))
        .filter((row) => row.t > 0 && row.t >= now - graceSeconds)
        .sort((a, b) => a.t - b.t)[0]?.n ?? -1;
    const firstOpen = availableNumbers.find((n) => !completedNumbers.has(n)) || -1;
    const nextSlot = hasScheduleTimes ? (nextByTime > 0 ? nextByTime : firstOpen) : hasCompleted ? firstOpen : -1;
    if (nextSlot > 0) return `sf${nextSlot}`;
  }

  const scheduled = options
    .filter((opt) => !completed.has(opt.id))
    .map((opt) => ({ id: opt.id, time: Number(opt.scheduleTime || 0), matchNumber: opt.matchNumber }))
    .filter((row) => row.time > 0)
    .sort((a, b) => {
      if (a.time !== b.time) return a.time - b.time;
      return a.matchNumber - b.matchNumber;
    });
  if (scheduled.length > 0) {
    const upcoming = scheduled.find((row) => row.time >= now);
    return (upcoming || scheduled[0]).id;
  }

  const firstIncomplete = options.find((opt) => !completed.has(opt.id));
  return firstIncomplete?.id || "";
}

function pickNextModalIdFromTba(matches: TBAMatch[], nowSec: number, useScheduleCompletion = false): string {
  if (!matches.length) return "";
  const options = buildReefscapeModalOptions(matches);
  if (options.length === 0) return "";
  const completed = buildCompletedModalIdsFromTba(matches, useScheduleCompletion ? nowSec : undefined);
  return pickNextModalIdFromOptions(options, completed, nowSec);
}

function buildModalOptionsFromCandidates(matches: CandidatePracticeMatch[]): {
  options: ReefscapeMatchOption[];
  completed: Set<string>;
} {
  const byId = new Map<string, ReefscapeMatchOption>();
  const completed = new Set<string>();

  matches.forEach((match) => {
    const id = getModalIdForMatch(match);
    if (!id) return;
    const stage = getPracticeStage(match);
    const modalType: ReefscapeMatchOption["type"] =
      stage === "practice" ? "practice" : stage === "qualification" ? "qualification" : "finals";
    const bracketSlot = modalType === "finals"
      ? mapPlayoffToBracketSlot(match as { matchKey?: unknown; setNumber?: unknown; matchNumber?: unknown; compLevel?: unknown })
      : null;
    const matchNumber =
      bracketSlot !== null
        ? bracketSlot
        : parsePracticeMatchNumber(match as { matchKey?: unknown; matchNumber?: unknown; setNumber?: unknown; compLevel?: unknown });
    const finalsKind = modalType === "finals" ? (bracketSlot !== null ? "bracket" : "series") : undefined;
    const matchData = match as unknown as Record<string, unknown>;
    const rawScheduleTime =
      Number(matchData.scheduleTime || 0)
      || Number(matchData.time || 0)
      || Number(matchData.predictedTime || 0)
      || Number(matchData.predicted_time || 0)
      || Number(matchData.actualTime || 0)
      || Number(matchData.actual_time || 0);
    const scheduleTime = Number.isFinite(rawScheduleTime) ? rawScheduleTime : 0;
    if (Boolean(matchData.isCompleted)) completed.add(id);

    const existing = byId.get(id);
    if (!existing || (scheduleTime > 0 && (existing.scheduleTime <= 0 || scheduleTime < existing.scheduleTime))) {
      byId.set(id, {
        id,
        label: "",
        type: modalType,
        matchNumber,
        scheduleTime,
        finalsKind,
      });
    }
  });

  return { options: Array.from(byId.values()), completed };
}

function normalizeEventValue(value: string): string {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function resolvePracticeEvent(
  match: PracticeMatch,
  game: AnalyticsGame,
  dynamicCatalog: DetectedEventOption[] = []
): { eventKey: string; eventName: string } {
  const nameCandidate = String((match as unknown as Record<string, unknown>).eventName || "").trim();
  const explicitKey = String((match as unknown as Record<string, unknown>).eventKey || "").trim().toLowerCase();

  // Always trust explicit event key from practice match records first.
  if (explicitKey && explicitKey !== "app-testing") {
    return { eventKey: explicitKey, eventName: nameCandidate || explicitKey };
  }

  // Build a wider catalog across both games for robust name/key mapping.
  const staticCatalog = [
    ...getEventsForGame("REEFSCAPE").filter((event) => event.id !== "app-testing"),
    ...getEventsForGame("REBUILT").filter((event) => event.id !== "app-testing"),
  ];
  const dynamicEvents = dynamicCatalog.map((event) => ({
    id: event.key,
    key: event.key,
    name: event.name,
    startDate: event.startDate,
    endDate: event.endDate,
  }));
  const catalogById = new Map<string, { id: string; key?: string; name: string }>();
  [...staticCatalog, ...dynamicEvents].forEach((event) => {
    const key = String(event.id || "").trim().toLowerCase();
    if (!key || catalogById.has(key)) return;
    catalogById.set(key, event);
  });
  const catalog = Array.from(catalogById.values());
  const byKey = new Map(catalog.map((event) => [event.id.toLowerCase(), event]));
  const byName = new Map(catalog.map((event) => [normalizeEventValue(event.name), event]));

  const keyCandidate = getPracticeEventKey(match).toLowerCase();
  const keyMatch = byKey.get(keyCandidate);
  if (keyMatch) {
    return { eventKey: keyMatch.id, eventName: keyMatch.name };
  }

  const normalizedName = normalizeEventValue(nameCandidate);
  const nameMatch = byName.get(normalizedName);
  if (nameMatch) {
    return { eventKey: nameMatch.id, eventName: nameMatch.name };
  }

  // Heuristic for known legacy event labels in practice data.
  if (normalizedName.includes("rocketcity")) {
    return { eventKey: "2025alhu", eventName: "Rocket City Regional" };
  }

  if (keyCandidate && keyCandidate !== "app-testing") {
    return { eventKey: keyCandidate, eventName: nameCandidate || keyCandidate };
  }

  if (nameCandidate) {
    return { eventKey: "app-testing", eventName: nameCandidate };
  }

  return { eventKey: "app-testing", eventName: "App Testing" };
}

function PracticeScoutingContent() {
  const router = useRouter();
  const { userData, teamTimeOverride } = useAuth();
  const [activeMatchGame, setActiveMatchGame] = useState<"REEFSCAPE" | "REBUILT" | null>(null);
  const [currentStep, setCurrentStep] = useState<PracticeStep>('select');
  const [selectedDifficulty, setSelectedDifficulty] = useState<'easy' | 'medium' | 'hard' | 'live' | null>(null);
  const [selectedMode, setSelectedMode] = useState<PracticeMode | null>(null);
  const [currentMatch, setCurrentMatch] = useState<PracticeMatch | null>(null);
  const [currentRobotIndex, setCurrentRobotIndex] = useState(0);
  const [breakCompletedRobotIndex, setBreakCompletedRobotIndex] = useState<number | null>(null);
  const [robotSessions, setRobotSessions] = useState<ScoutedData[]>([]);
  const [rebuiltRobotSessions, setRebuiltRobotSessions] = useState<RebuiltScoutedData[]>([]);
  const [humanPlayerRobot, setHumanPlayerRobot] = useState<number | null>(null); // 0, 1, 2, or null
  const [sessionResults, setSessionResults] = useState<PracticeSession | null>(null);
  const [candidateMatches, setCandidateMatches] = useState<CandidatePracticeMatch[]>([]);
  const [showMatchSelectModal, setShowMatchSelectModal] = useState(false);
  const [showDifficultyMatchModal, setShowDifficultyMatchModal] = useState(false);
  const [showLiveLinkModal, setShowLiveLinkModal] = useState(false);
  const [showLiveRobotModal, setShowLiveRobotModal] = useState(false);
  const [pendingLiveMatchPick, setPendingLiveMatchPick] = useState<PendingLiveRobotPick | null>(null);
  const [liveVideoUrl, setLiveVideoUrl] = useState("");
  const [liveStreamTitle, setLiveStreamTitle] = useState("");
  const [liveEventKeyHint, setLiveEventKeyHint] = useState("");
  const [liveEventTeamSuggestions, setLiveEventTeamSuggestions] = useState<number[]>([]);
  const [liveEventTeamNameMap, setLiveEventTeamNameMap] = useState<Record<string, string>>({});
  const [liveLobbyId, setLiveLobbyId] = useState("");
  const [liveLobbyCodeInput, setLiveLobbyCodeInput] = useState("");
  const [liveLobby, setLiveLobby] = useState<LivePracticeLobby | null>(null);
  const [liveLobbyBusy, setLiveLobbyBusy] = useState(false);
  const [liveLobbyError, setLiveLobbyError] = useState("");
  const [showLobbyMatchModal, setShowLobbyMatchModal] = useState(false);
  const [lobbyMatchCandidates, setLobbyMatchCandidates] = useState<CandidatePracticeMatch[]>([]);
  const [lobbyMatchBusy, setLobbyMatchBusy] = useState(false);
  const [lobbyMatchError, setLobbyMatchError] = useState("");
  const [lobbyMatchDifficultyFilter, setLobbyMatchDifficultyFilter] = useState<"all" | "easy" | "medium" | "hard">("all");
  const [liveMatchBundle, setLiveMatchBundle] = useState<LiveMatchBundle | null>(null);
  const [liveAssignments, setLiveAssignments] = useState<Record<string, LiveAssignment>>({});
  const [liveSubmissions, setLiveSubmissions] = useState<Record<string, Record<string, unknown>>>({});
  const [liveRevealCountdown, setLiveRevealCountdown] = useState(0);
  const [liveTeamAccuracy, setLiveTeamAccuracy] = useState<number | null>(null);
  const [liveLeaderboard, setLiveLeaderboard] = useState<Array<{ team: string; accuracy: number; completed: number }>>([]);
  const [liveStartedSessionKey, setLiveStartedSessionKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [mobileNotesOpen, setMobileNotesOpen] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<PracticeSessionDraft | null>(null);
  const [teamEventCatalog, setTeamEventCatalog] = useState<DetectedEventOption[]>([]);
  const [tbaAuth, setTbaAuth] = useState<{ encryptedKey: string; plainKey: string }>({ encryptedKey: "", plainKey: "" });
  const [liveTbaMatches, setLiveTbaMatches] = useState<TBAMatch[]>([]);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const formPaneRef = useRef<HTMLDivElement | null>(null);

  const [formData, setFormData] = useState<ScoutedData>(createEmptyScoutedData());
  const [rebuiltFormData, setRebuiltFormData] = useState<RebuiltScoutedData>(createEmptyRebuiltScoutedData());
  const REBUILT_WEEK0_EVENT_KEY = "2026week0";

  const persistedDifficulty: "easy" | "medium" | "hard" = selectedDifficulty === "live"
    ? "hard"
    : (selectedDifficulty || "easy");

  const liveLobbyPlayers = useMemo(() => {
    if (!liveLobby?.playersByUid) return [] as Array<{ uid: string; name: string; joinedAt: number }>;
    return Object.entries(liveLobby.playersByUid)
      .map(([uid, player]) => ({
        uid,
        name: String(player?.name || `User ${uid.slice(0, 6)}`),
        joinedAt: Number(player?.joinedAt || 0),
      }))
      .sort((a, b) => a.joinedAt - b.joinedAt);
  }, [liveLobby]);

  const liveLobbyParticipants = useMemo(() => {
    if (!liveLobby) return [] as Array<{ uid: string; name: string; joinedAt: number }>;
    if (!liveLobby.hostOptOut) return liveLobbyPlayers;
    return liveLobbyPlayers.filter((player) => player.uid !== liveLobby.hostId);
  }, [liveLobby, liveLobbyPlayers]);

  const liveLobbyPlayerCount = liveLobbyPlayers.length;
  const liveLobbyParticipantCount = liveLobbyParticipants.length;
  const liveLobbyCanStart = liveLobbyParticipantCount > 0 && liveLobbyParticipantCount % 3 === 0;
  const userIsLiveLobbyHost = Boolean(liveLobby && userData?.uid && liveLobby.hostId === userData.uid);
  const myLiveAssignment = useMemo(() => {
    if (!userData?.uid) return null;
    return liveAssignments[userData.uid] || null;
  }, [liveAssignments, userData?.uid]);
  const liveSubmittedCount = useMemo(() => {
    if (!liveLobby) return 0;
    const submissions = liveSubmissions || {};
    if (!liveLobby.hostOptOut) return Object.keys(submissions).length;
    const participantIds = new Set(liveLobbyParticipants.map((player) => player.uid));
    return Object.keys(submissions).filter((uid) => participantIds.has(uid)).length;
  }, [liveLobby, liveLobbyParticipants, liveSubmissions]);
  const myLiveTeamMembers = useMemo(() => {
    if (!myLiveAssignment) return [] as Array<{ uid: string; name: string; assignment: LiveAssignment }>;
    return liveLobbyPlayers
      .map((player) => {
        const assignment = liveAssignments[player.uid];
        if (!assignment) return null;
        if (assignment.groupIndex !== myLiveAssignment.groupIndex) return null;
        return { uid: player.uid, name: player.name, assignment };
      })
      .filter((row): row is { uid: string; name: string; assignment: LiveAssignment } => Boolean(row))
      .sort((a, b) => a.assignment.robotIndex - b.assignment.robotIndex);
  }, [liveAssignments, liveLobbyPlayers, myLiveAssignment]);

  const hideLiveLobbyVideo = Boolean(selectedDifficulty === "live" && liveLobby?.hostVideo && !userIsLiveLobbyHost);
  const hostOptedOut = Boolean(selectedDifficulty === "live" && liveLobby?.hostOptOut && userIsLiveLobbyHost);
  const showLiveLobbyForm = !hostOptedOut;

  function getLocalLobbyStore() {
    if (typeof window === "undefined") return {} as Record<string, LivePracticeLobbyStorage>;
    try {
      const raw = localStorage.getItem("practice-live-lobbies");
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Record<string, LivePracticeLobbyStorage>;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function setLocalLobbyStore(store: Record<string, LivePracticeLobbyStorage>) {
    if (typeof window === "undefined") return;
    localStorage.setItem("practice-live-lobbies", JSON.stringify(store));
  }

  function upsertLocalLobby(code: string, lobby: LivePracticeLobbyStorage) {
    const store = getLocalLobbyStore();
    store[code] = lobby;
    setLocalLobbyStore(store);
  }

  function readLocalLobby(code: string) {
    const store = getLocalLobbyStore();
    return store[code] || null;
  }

  function removeLocalLobby(code: string) {
    const store = getLocalLobbyStore();
    delete store[code];
    setLocalLobbyStore(store);
  }

  async function authHeaders(extra: HeadersInit = {}) {
    const token = await auth.currentUser?.getIdToken();
    if (!token) return extra;
    return {
      ...extra,
      Authorization: `Bearer ${token}`,
    } as HeadersInit;
  }

  useEffect(() => {
    async function loadTeamEventCatalog() {
      if (!userData?.teamId) {
        setTeamEventCatalog([]);
        setTbaAuth({ encryptedKey: "", plainKey: "" });
        return;
      }
      try {
        const events = await getTeamEventOptions(userData.teamId);
        setTeamEventCatalog(events);
        const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
        if (teamDoc.exists()) {
          const data = teamDoc.data() as Record<string, unknown>;
          setTbaAuth({
            encryptedKey: String(data.tbaApiKeyEncrypted || "").trim(),
            plainKey: String(data.tbaApiKey || "").trim(),
          });
        } else {
          setTbaAuth({ encryptedKey: "", plainKey: "" });
        }
      } catch (error) {
        console.error("Failed loading team event catalog for practice scouting:", error);
        setTeamEventCatalog([]);
        setTbaAuth({ encryptedKey: "", plainKey: "" });
      }
    }
    void loadTeamEventCatalog();
  }, [userData?.teamId]);

  useEffect(() => {
    async function loadLiveTbaStatuses() {
      if (selectedDifficulty !== "live") {
        setLiveTbaMatches([]);
        return;
      }
      const eventKey =
        String(liveEventKeyHint || "").trim().toLowerCase()
        || String(currentMatch ? getPracticeEventKey(currentMatch) : "").trim().toLowerCase();
      if (!eventKey) {
        setLiveTbaMatches([]);
        return;
      }

      try {
        let matches: TBAMatch[] = [];
        const response = await fetch("/api/tba/matches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventKey,
            encryptedKey: tbaAuth.encryptedKey,
            plainKey: tbaAuth.plainKey,
          }),
        });
        if (response.ok) {
          const payload = (await response.json()) as { matches?: TBAMatch[] };
          if (Array.isArray(payload.matches)) matches = payload.matches;
        }
        if (matches.length === 0) {
          matches = await getEventMatches(eventKey);
        }
        setLiveTbaMatches(matches);
      } catch (error) {
        console.error("Failed loading FIRST/TBA live match statuses:", error);
        setLiveTbaMatches([]);
      }
    }
    void loadLiveTbaStatuses();
  }, [currentMatch, liveEventKeyHint, selectedDifficulty, tbaAuth.encryptedKey, tbaAuth.plainKey]);

  useEffect(() => {
    if (!liveLobbyId) {
      setLiveLobby(null);
      return;
    }
    if (liveLobbyId.startsWith("local:") || !liveLobby?.code) return;

    let cancelled = false;
    const loadLobby = async () => {
      try {
        const headers = await authHeaders();
        const response = await fetch(`/api/live-lobbies?code=${encodeURIComponent(liveLobby.code)}`, {
          headers,
          cache: "no-store",
        });
        if (!response.ok) {
          if (!cancelled) setLiveLobbyError(`Live lobby sync unavailable (${response.status}). Retrying...`);
          return;
        }
        const payload = (await response.json()) as { lobby?: LivePracticeLobby };
        if (!cancelled) {
          if (payload.lobby) {
            setLiveLobby(payload.lobby);
            setLiveLobbyError("");
          }
        }
      } catch (error) {
        console.error("Failed to load live practice lobby:", error);
        if (!cancelled) setLiveLobbyError("Live lobby sync temporarily unavailable. Retrying...");
      }
    };

    void loadLobby();
    const timer = window.setInterval(() => {
      void loadLobby();
    }, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [liveLobbyId, liveLobby?.code]);

  useEffect(() => {
    const parsedMatch = parseLobbyJson<LiveMatchBundle | null>(liveLobby?.matchJson, null);
    const parsedAssignments = parseLobbyJson<Record<string, LiveAssignment>>(liveLobby?.assignmentsJson, {});
    const parsedSubmissions = parseLobbyJson<Record<string, Record<string, unknown>>>(liveLobby?.submissionsJson, {});
    setLiveMatchBundle(parsedMatch);
    setLiveAssignments(parsedAssignments);
    setLiveSubmissions(parsedSubmissions);
  }, [liveLobby?.assignmentsJson, liveLobby?.matchJson, liveLobby?.submissionsJson]);

  useEffect(() => {
    if (!liveLobby?.revealUntil || liveLobby.status !== "in_progress") {
      setLiveRevealCountdown(0);
      return;
    }
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((liveLobby.revealUntil! - Date.now()) / 1000));
      setLiveRevealCountdown(remaining);
    };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [liveLobby?.revealUntil, liveLobby?.status]);

  useEffect(() => {
    if (!liveLobby || liveLobby.status !== "in_progress") return;
    if (!liveMatchBundle || !myLiveAssignment) return;
    if (currentStep === "select" && liveRevealCountdown > 0) {
      setCurrentStep("live_reveal");
      return;
    }
    if (currentStep !== "live_reveal") return;
    const sessionKey = `${liveLobby.code}:${liveLobby.startedAt || 0}`;
    if (liveStartedSessionKey === sessionKey) return;
    if (liveRevealCountdown > 0) return;
    const match = myLiveAssignment.alliance === "blue" ? liveMatchBundle.blue : liveMatchBundle.red;
    const selected = { ...match, progress: "fresh" as const };
    setSelectedDifficulty("live");
    startPracticeMatch(selected, { robotIndex: myLiveAssignment.robotIndex, teamNumber: myLiveAssignment.teamNumber });
    setLiveStartedSessionKey(sessionKey);
  }, [
    liveLobby,
    liveMatchBundle,
    myLiveAssignment,
    liveStartedSessionKey,
    liveRevealCountdown,
    currentStep,
    startPracticeMatch,
  ]);

  useEffect(() => {
    if (!liveLobby || !liveMatchBundle) return;
    if (!userIsLiveLobbyHost) return;
    if (!liveLobby.hostOptOut || !liveLobby.hostVideo) return;
    if (currentStep !== "select" && currentStep !== "live_reveal") return;
    const hostMatch = liveMatchBundle.red || liveMatchBundle.blue;
    if (!hostMatch) return;
    setSelectedDifficulty("live");
    startPracticeMatch({ ...hostMatch, progress: "fresh" as const }, { liveMode: true, robotIndex: 0, teamNumber: "" });
  }, [currentStep, liveLobby, liveMatchBundle, startPracticeMatch, userIsLiveLobbyHost]);

  useEffect(() => {
    if (!liveLobby || liveLobby.status !== "completed") return;
    if (!liveMatchBundle) return;
    const board = computeLiveLeaderboardFromLobby(liveMatchBundle, liveAssignments, liveSubmissions);
    setLiveLeaderboard(board.map((row) => ({ team: row.team, accuracy: row.accuracy, completed: row.completed })));
    const mine = userData?.uid ? liveAssignments[userData.uid] : null;
    if (mine) {
      const myRow = board.find((row) => row.groupIndex === mine.groupIndex);
      setLiveTeamAccuracy(myRow ? myRow.accuracy : null);
    } else {
      setLiveTeamAccuracy(null);
    }
    setCurrentStep("results");
  }, [computeLiveLeaderboardFromLobby, liveAssignments, liveLobby, liveMatchBundle, liveSubmissions, userData?.uid]);

  function createLobbyCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i += 1) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  async function fetchLobbyMatchCandidates(): Promise<CandidatePracticeMatch[]> {
    if (!activeMatchGame) return [];
    let matches: PracticeMatch[] = [];
    try {
      const matchesSnapshot = await getDocs(collection(db, "practiceMatches"));
      matches = matchesSnapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })) as PracticeMatch[];
    } catch (queryError) {
      const allSnapshot = await getDocs(collection(db, "practiceMatches"));
      matches = allSnapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })) as PracticeMatch[];
      console.warn("Lobby match load query failed; using fallback practice match load.", queryError);
    }

    if (matches.length === 0) return [];

    const gameFiltered = matches.filter((match) => matchBelongsToSelectedGame(match));
    if (gameFiltered.length === 0) return [];

    const normalized = gameFiltered
      .map((match) => ({ ...match, allianceTeams: getMatchTeams(match as unknown as PracticeMatch & Record<string, unknown>) }))
      .filter((match) => match.allianceTeams.length >= 3);

    let candidateMatches = normalized;
    if (candidateMatches.length === 0) {
      candidateMatches = buildLegacyGroupedMatches(gameFiltered);
    }
    if (candidateMatches.length === 0) return [];

    candidateMatches = dedupePracticeMatches(candidateMatches);
    return candidateMatches.map((match) => ({ ...match, progress: "fresh" as const }));
  }

  async function loadLobbyMatchCandidates(): Promise<CandidatePracticeMatch[]> {
    setLobbyMatchBusy(true);
    setLobbyMatchError("");
    try {
      const loaded = await fetchLobbyMatchCandidates();
      if (loaded.length === 0) {
        setLobbyMatchError("No matches available for lobby selection.");
      }
      setLobbyMatchCandidates(loaded);
      return loaded;
    } catch (error) {
      console.error("Failed loading lobby match candidates:", error);
      setLobbyMatchError("Could not load matches for lobby selection.");
      return [];
    } finally {
      setLobbyMatchBusy(false);
    }
  }

  async function loadLiveMatchBundleFromPastMatches(input?: {
    matchId?: string;
    matchBase?: string;
  }): Promise<LiveMatchBundle | null> {
    const candidates = await fetchLobbyMatchCandidates();
    if (candidates.length === 0) return null;

    const byBase = new Map<string, { red?: PracticeMatch; blue?: PracticeMatch }>();
    for (const match of candidates) {
      const base = getPracticeBaseIdentity(match);
      const alliance = normalizeAllianceSide((match as unknown as Record<string, unknown>).alliance);
      if (!alliance) continue;
      const bucket = byBase.get(base) || {};
      bucket[alliance] = match;
      byBase.set(base, bucket);
    }

    const bundled = Array.from(byBase.entries())
      .filter(([, row]) => row.red && row.blue)
      .map(([base, row]) => ({ base, red: row.red!, blue: row.blue! }));

    if (bundled.length === 0) return null;

    let preferredBase = input?.matchBase || "";
    if (!preferredBase && input?.matchId) {
      const picked = candidates.find((match) => match.id === input.matchId);
      if (!picked) return null;
      preferredBase = getPracticeBaseIdentity(picked);
    }

    if (preferredBase) {
      const preferred = bundled.find((row) => row.base === preferredBase);
      if (!preferred) return null;
      return { red: preferred.red, blue: preferred.blue };
    }

    const picked = bundled[Math.floor(Math.random() * bundled.length)];
    return { red: picked.red, blue: picked.blue };
  }

  async function updateLiveLobbySettings(update: Partial<Pick<LivePracticeLobby,
    "hostOptOut" | "hostVideo" | "selectedMatchId" | "selectedMatchBase" | "selectedMatchLabel" | "selectedMatchDifficulty">>) {
    if (!liveLobby || !userData?.uid || !userIsLiveLobbyHost) return;
    const nextLobby = { ...liveLobby, ...update };
    setLiveLobby(nextLobby);

    if (liveLobby.id.startsWith("local:")) {
      upsertLocalLobby(liveLobby.code, { ...nextLobby, id: liveLobby.id });
      return;
    }

    setLiveLobbyBusy(true);
    try {
      const payload: Record<string, unknown> = {
        action: "update",
        code: liveLobby.code,
        uid: userData.uid,
      };
      if (Object.prototype.hasOwnProperty.call(update, "hostOptOut")) payload.hostOptOut = update.hostOptOut;
      if (Object.prototype.hasOwnProperty.call(update, "hostVideo")) payload.hostVideo = update.hostVideo;
      if (Object.prototype.hasOwnProperty.call(update, "selectedMatchId")) payload.selectedMatchId = update.selectedMatchId ?? "";
      if (Object.prototype.hasOwnProperty.call(update, "selectedMatchBase")) payload.selectedMatchBase = update.selectedMatchBase ?? "";
      if (Object.prototype.hasOwnProperty.call(update, "selectedMatchLabel")) payload.selectedMatchLabel = update.selectedMatchLabel ?? "";
      if (Object.prototype.hasOwnProperty.call(update, "selectedMatchDifficulty")) payload.selectedMatchDifficulty = update.selectedMatchDifficulty ?? "";

      const response = await fetch("/api/live-lobbies", {
        method: "POST",
        headers: await authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const fail = (await response.json().catch(() => ({}))) as { error?: string };
        setLiveLobbyError(fail.error || "Could not update lobby settings.");
        return;
      }
      const updated = (await response.json()) as { lobby?: LivePracticeLobby };
      if (updated.lobby) {
        setLiveLobby(updated.lobby);
        setLiveLobbyError("");
      }
    } catch (error) {
      console.error("Failed updating lobby settings:", error);
      setLiveLobbyError("Could not update lobby settings.");
    } finally {
      setLiveLobbyBusy(false);
    }
  }

  function buildLiveAssignments(players: Array<{ uid: string }>, bundle: LiveMatchBundle) {
    const result: Record<string, LiveAssignment> = {};
    const redTeams = (bundle.red.allianceTeams || []).map((team) => String(team || "").trim());
    const blueTeams = (bundle.blue.allianceTeams || []).map((team) => String(team || "").trim());
    players.forEach((player, index) => {
      const group = Math.floor(index / 3);
      const robotIndex = index % 3;
      const alliance: "red" | "blue" = group % 2 === 0 ? "red" : "blue";
      const teamNumber = alliance === "red" ? redTeams[robotIndex] || "" : blueTeams[robotIndex] || "";
      result[player.uid] = { alliance, robotIndex, teamNumber, groupIndex: group };
    });
    return result;
  }

  async function createLiveLobby() {
    if (!userData?.uid || !selectedMode || !activeMatchGame) return;
    setLiveLobbyBusy(true);
    setLiveLobbyError("");
    try {
      let code = createLobbyCode();
      const payload: Omit<LivePracticeLobby, "id"> = {
        code,
        hostId: userData.uid,
        hostName: userData.displayName || "Host",
        teamId: userData.teamId || "",
        game: activeMatchGame,
        mode: selectedMode,
        status: "waiting",
        createdAt: Date.now(),
        hostOptOut: false,
        hostVideo: false,
        selectedMatchId: "",
        selectedMatchBase: "",
        selectedMatchLabel: "",
        selectedMatchDifficulty: "",
        playersByUid: {
          [userData.uid]: { name: userData.displayName || "Host", joinedAt: Date.now() },
        },
      };

      try {
        let createdLobby: LivePracticeLobby | null = null;
        for (let attempt = 0; attempt < 6; attempt += 1) {
          const headers = await authHeaders({ "Content-Type": "application/json" });
          const response = await fetch("/api/live-lobbies", {
            method: "POST",
            headers,
            body: JSON.stringify({
              action: "create",
              code,
              hostId: payload.hostId,
              hostName: payload.hostName,
              teamId: payload.teamId,
              game: payload.game,
              mode: payload.mode,
              hostOptOut: payload.hostOptOut,
              hostVideo: payload.hostVideo,
            }),
          });
          if (response.status === 409) {
            code = createLobbyCode();
            continue;
          }
          if (!response.ok) {
            const fail = (await response.json().catch(() => ({}))) as { error?: string };
            throw new Error(fail.error || `create_failed_${response.status}`);
          }
          const created = (await response.json()) as { lobby?: LivePracticeLobby };
          createdLobby = created.lobby || null;
          break;
        }
        if (!createdLobby) throw new Error("create_failed");
        setLiveLobbyId(createdLobby.id);
        setLiveLobby(createdLobby);
      } catch (cloudError) {
        console.warn("Cloud live lobby unavailable; falling back to local lobby.", cloudError);
        const localId = `local:${Date.now()}`;
        const localCode = code.startsWith("LOCAL-") ? code : `LOCAL-${code}`;
        payload.code = localCode;
        setLiveLobbyId(localId);
        const localLobby = { id: localId, ...payload };
        setLiveLobby(localLobby);
        upsertLocalLobby(localCode, localLobby);
        setLiveLobbyError("Cloud lobby storage is unavailable. This lobby is local-only (same browser/device).");
      }
    } catch (error) {
      console.error("Failed creating live lobby:", error);
      alert("Could not create live lobby.");
    } finally {
      setLiveLobbyBusy(false);
    }
  }

  async function joinLiveLobby() {
    if (!userData?.uid) return;
    const code = liveLobbyCodeInput.trim().toUpperCase();
    if (!code) {
      alert("Enter a lobby code.");
      return;
    }
    setLiveLobbyBusy(true);
    setLiveLobbyError("");
    try {
      if (code.startsWith("LOCAL-")) {
        const localOnly = readLocalLobby(code);
        if (!localOnly) {
          setLiveLobbyError("This is a local-only lobby code and can only be joined on the host device/browser.");
          return;
        }
      }
      const localLobby = readLocalLobby(code);
      if (localLobby) {
        const localId = String(localLobby.id || `local:${Date.now()}`);
        const joinedLobby: LivePracticeLobby = {
          ...localLobby,
          id: localId,
          playersByUid: {
            ...(localLobby.playersByUid || {}),
            [userData.uid]: { name: userData.displayName || "Player", joinedAt: Date.now() },
          },
        };
        setLiveLobby(joinedLobby);
        setLiveLobbyId(localId);
        setActiveMatchGame(joinedLobby.game);
        setSelectedMode(joinedLobby.mode);
        upsertLocalLobby(code, joinedLobby);
        return;
      }
      const response = await fetch("/api/live-lobbies", {
        method: "POST",
        headers: await authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          action: "join",
          code,
          uid: userData.uid,
          name: userData.displayName || "Player",
          teamId: userData.teamId || "",
        }),
      });
      if (!response.ok) {
        const fail = (await response.json().catch(() => ({}))) as { error?: string };
        setLiveLobbyError(fail.error || `Could not join lobby (${response.status}).`);
        return;
      }
      const payload = (await response.json()) as { lobby?: LivePracticeLobby };
      if (!payload.lobby) {
        setLiveLobbyError("Could not join lobby.");
        return;
      }
      setActiveMatchGame(payload.lobby.game);
      setSelectedMode(payload.lobby.mode);
      setLiveLobbyId(payload.lobby.id);
      setLiveLobby(payload.lobby);
    } catch (error) {
      console.error("Failed joining live lobby:", error);
      const codeValue = (error as { code?: string })?.code || "";
      if (String(codeValue).toLowerCase().includes("permission")) {
        setLiveLobbyError("Join blocked by Firestore permissions for live lobbies in this deployment.");
        return;
      }
      setLiveLobbyError(`Could not join lobby${codeValue ? ` (${codeValue})` : ""}.`);
    } finally {
      setLiveLobbyBusy(false);
    }
  }

  async function leaveLiveLobby() {
    if (!liveLobby || !userData?.uid) return;
    setLiveLobbyBusy(true);
    try {
      if (liveLobby.id.startsWith("local:")) {
        if (userIsLiveLobbyHost) {
          removeLocalLobby(liveLobby.code);
          setLiveLobby(null);
          setLiveLobbyId("");
          return;
        }
        const nextPlayers = { ...(liveLobby.playersByUid || {}) };
        delete nextPlayers[userData.uid];
        const nextLobby = { ...liveLobby, playersByUid: nextPlayers };
        setLiveLobby(nextLobby);
        upsertLocalLobby(liveLobby.code, nextLobby);
        return;
      }
      const response = await fetch("/api/live-lobbies", {
        method: "POST",
        headers: await authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          action: "leave",
          code: liveLobby.code,
          uid: userData.uid,
        }),
      });
      if (!response.ok) {
        const fail = (await response.json().catch(() => ({}))) as { error?: string };
        setLiveLobbyError(fail.error || "Could not leave lobby.");
      }
      setLiveLobby(null);
      setLiveLobbyId("");
    } catch (error) {
      console.error("Failed leaving live lobby:", error);
      alert("Could not leave lobby.");
    } finally {
      setLiveLobbyBusy(false);
    }
  }

  async function startLiveLobbySession() {
    if (!liveLobby || !userIsLiveLobbyHost) return;
    if (!liveLobbyCanStart) {
      alert("Live practice requires participants in multiples of 3.");
      return;
    }
    setLiveLobbyBusy(true);
    try {
      const bundle = await loadLiveMatchBundleFromPastMatches({
        matchId: liveLobby.selectedMatchId || "",
        matchBase: liveLobby.selectedMatchBase || "",
      });
      if (!bundle) {
        setLiveLobbyError(
          liveLobby.selectedMatchId || liveLobby.selectedMatchBase
            ? "Selected match is unavailable. Choose another or clear the selection."
            : "No past matches available with both alliances for live practice."
        );
        return;
      }
      const participants = [...liveLobbyParticipants];
      const assignments = buildLiveAssignments(participants, bundle);
      const matchJson = JSON.stringify(bundle);
      const assignmentsJson = JSON.stringify(assignments);

      if (liveLobby.id.startsWith("local:")) {
        setLiveLobby({
          ...liveLobby,
          status: "in_progress",
          startedAt: Date.now(),
          revealUntil: Date.now() + 12000,
          matchJson,
          assignmentsJson,
          submissionsJson: "{}",
        });
        if (!liveLobby.hostOptOut) {
          setCurrentStep("live_reveal");
        }
        return;
      }
      const response = await fetch("/api/live-lobbies", {
        method: "POST",
        headers: await authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          action: "start",
          code: liveLobby.code,
          uid: userData?.uid || "",
          matchJson,
          assignmentsJson,
        }),
      });
      if (!response.ok) {
        const fail = (await response.json().catch(() => ({}))) as { error?: string };
        setLiveLobbyError(fail.error || "Could not start lobby.");
        return;
      }
      const payload = (await response.json()) as { lobby?: LivePracticeLobby };
      if (payload.lobby) {
        setLiveLobby(payload.lobby);
        if (!payload.lobby.hostOptOut) {
          setCurrentStep("live_reveal");
        }
      }
    } catch (error) {
      console.error("Failed starting live lobby:", error);
      alert("Could not start live lobby.");
    } finally {
      setLiveLobbyBusy(false);
    }
  }

  function getPracticeIdentity(match: {
    matchKey?: unknown;
    matchNumber?: unknown;
    matchType?: unknown;
    alliance?: unknown;
    compLevel?: unknown;
  }) {
    const key = String(match.matchKey || "").trim().toLowerCase();
    const stage = getPracticeStage(match);
    const baseIdentity = key || `${stage}:${Number(match.matchNumber || 0)}`;
    const alliance = normalizeAllianceSide(match.alliance);
    if (!alliance) return baseIdentity;
    return `${baseIdentity}:${alliance}`;
  }

  function getPracticeBaseIdentity(match: {
    matchKey?: unknown;
    matchNumber?: unknown;
    matchType?: unknown;
    compLevel?: unknown;
  }) {
    const key = String(match.matchKey || "").trim().toLowerCase();
    const stage = getPracticeStage(match);
    return key || `${stage}:${Number(match.matchNumber || 0)}`;
  }

  function parseLobbyJson<T>(raw: string | undefined, fallback: T): T {
    if (!raw) return fallback;
    try {
      const parsed = JSON.parse(raw) as T;
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  }

function getPracticeLabel(match: Pick<PracticeMatch, "matchType" | "matchNumber" | "allianceTeams" | "alliance" | "matchKey">) {
  const stage = getPracticeStage(match);
  const baseTypeLabel = getPracticeStageLabel(stage);
  const { setNumber, matchNumber } = parseBracketNumbers(match as { matchKey?: unknown; setNumber?: unknown; matchNumber?: unknown });
  const normalizedNumber = parsePracticeMatchNumber(match as { matchKey?: unknown; matchNumber?: unknown });
  const matchTypeLabel =
    stage === "semifinal"
      ? `${baseTypeLabel} ${Number(setNumber || matchNumber || match.matchNumber || 1)}`
      : stage === "finals" && setNumber > 1
      ? `${baseTypeLabel} ${setNumber}-${matchNumber || Number(match.matchNumber || 1)}`
      : `${baseTypeLabel} ${normalizedNumber}`;
  const alliance = normalizeAllianceSide(match.alliance);
  const allianceLabel = alliance ? `  •  ${alliance === "red" ? "Red" : "Blue"} Alliance` : "";
  const teams = Array.isArray(match.allianceTeams) ? match.allianceTeams.slice(0, 3).join(", ") : "";
  return `${matchTypeLabel}${allianceLabel}${teams ? `  •  [${teams}]` : ""}`;
}

  function comparePracticeMatchesInOrder(a: CandidatePracticeMatch, b: CandidatePracticeMatch) {
    const stageOrder = { qualification: 0, semifinal: 1, finals: 2, practice: 3 } as const;
    const aStage = getPracticeStage(a);
    const bStage = getPracticeStage(b);
    const stageDiff = stageOrder[aStage] - stageOrder[bStage];
    if (stageDiff !== 0) return stageDiff;

    if (aStage === "semifinal" || aStage === "finals") {
      const aBracket = parseBracketNumbers(a as { matchKey?: unknown; setNumber?: unknown; matchNumber?: unknown });
      const bBracket = parseBracketNumbers(b as { matchKey?: unknown; setNumber?: unknown; matchNumber?: unknown });
      const aSet = Number(aBracket.setNumber || a.matchNumber || 0);
      const bSet = Number(bBracket.setNumber || b.matchNumber || 0);
      if (aSet !== bSet) return aSet - bSet;
      const aMatch = Number(aBracket.matchNumber || a.matchNumber || 0);
      const bMatch = Number(bBracket.matchNumber || b.matchNumber || 0);
      if (aMatch !== bMatch) return aMatch - bMatch;
    } else {
      const numberDiff = Number(a.matchNumber || 0) - Number(b.matchNumber || 0);
      if (numberDiff !== 0) return numberDiff;
    }

    const allianceOrder = { red: 0, blue: 1 };
    const aAlliance = normalizeAllianceSide(a.alliance);
    const bAlliance = normalizeAllianceSide(b.alliance);
    const aAllianceRank = aAlliance ? allianceOrder[aAlliance] : 9;
    const bAllianceRank = bAlliance ? allianceOrder[bAlliance] : 9;
    if (aAllianceRank !== bAllianceRank) return aAllianceRank - bAllianceRank;

    return String(a.id || "").localeCompare(String(b.id || ""));
  }

  function compareCandidateMatches(a: CandidatePracticeMatch, b: CandidatePracticeMatch) {
    const ordered = comparePracticeMatchesInOrder(a, b);
    if (ordered !== 0) return ordered;
    const progressRank = { fresh: 0, partial: 1, complete: 2 } as const;
    return progressRank[a.progress] - progressRank[b.progress];
  }

  function inferGameFromEventYear(eventKey: string): AnalyticsGame | null {
    const year = parseInt(eventKey.slice(0, 4), 10);
    if (year === 2026) return "REBUILT";
    if (year === 2025) return "REEFSCAPE";
    return null;
  }

  function resolveMatchEventKey(match: PracticeMatch): string {
    const rawEventKey = String((match as unknown as Record<string, unknown>).eventKey || "").trim().toLowerCase();
    if (rawEventKey) return rawEventKey;
    const matchKey = String((match as unknown as Record<string, unknown>).matchKey || "").trim().toLowerCase();
    if (matchKey.includes("_")) return matchKey.split("_")[0] || "";
    return "";
  }

  function matchBelongsToSelectedGame(match: PracticeMatch): boolean {
    const matchGame = String((match as unknown as Record<string, unknown>).game || "").toUpperCase();
    const eventKey = resolveMatchEventKey(match);
    const eventGame = eventKey ? inferGameFromEventYear(eventKey) : null;

    if (activeMatchGame === "REBUILT") {
      if (matchGame === "REEFSCAPE") return false;
      if (eventKey === REBUILT_WEEK0_EVENT_KEY) return true;
      if (eventGame) return eventGame === "REBUILT";
      if (matchGame) return matchGame === "REBUILT";
      return true;
    }

    if (matchGame === "REBUILT") return false;
    if (eventKey === REBUILT_WEEK0_EVENT_KEY) return false;
    if (eventGame) return eventGame === "REEFSCAPE";
    if (matchGame) return matchGame === "REEFSCAPE";
    return true;
  }

  function getYouTubeEmbedUrl(url: string): string {
    if (!url) return "";
    
    let videoId = "";
    
    if (url.includes("youtube.com/watch?v=")) {
      videoId = url.split("v=")[1]?.split("&")[0] || "";
    } else if (url.includes("youtube.com/live/")) {
      videoId = url.split("youtube.com/live/")[1]?.split("?")[0] || "";
    } else if (url.includes("youtu.be/")) {
      videoId = url.split("youtu.be/")[1]?.split("?")[0] || "";
    } else if (url.includes("youtube.com/embed/")) {
      videoId = url.split("embed/")[1]?.split("?")[0] || "";
    }
    
    if (!videoId) return url;
    
    const controls = selectedMode === 'trial' ? 1 : 0;
    const muted = selectedMode === "competitive" ? 1 : 0;
    
    return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=${muted}&controls=${controls}&disablekb=${controls === 0 ? 1 : 0}&modestbranding=1&rel=0&fs=0&enablejsapi=1&playsinline=1`;
  }

  function inferEventKeyFromStreamTitle(title: string, game?: AnalyticsGame | null): string {
    const normalizedTitle = normalizeEventValue(title);
    if (!normalizedTitle) return "";
    const gamesToCheck: AnalyticsGame[] = game ? [game] : ["REEFSCAPE", "REBUILT"];
    const staticEvents = gamesToCheck.flatMap((entryGame) =>
      getEventsForGame(entryGame).filter((event) => event.id !== "app-testing")
    );
    const dynamicEvents = teamEventCatalog.map((event) => ({ id: event.key, name: event.name }));
    const byId = new Map<string, { id: string; name: string }>();
    [...staticEvents, ...dynamicEvents].forEach((event) => {
      const key = String(event.id || "").trim().toLowerCase();
      if (!key || byId.has(key)) return;
      byId.set(key, { id: event.id, name: event.name });
    });
    const events = Array.from(byId.values());
    for (const event of events) {
      const normalizedName = normalizeEventValue(event.name);
      if (normalizedName && normalizedTitle.includes(normalizedName)) return event.id;
    }
    for (const event of events) {
      const shortCode = normalizeEventValue(event.id.slice(4));
      if (shortCode && normalizedTitle.includes(shortCode)) return event.id;
    }
    return "";
  }

  function inferGameFromEventKey(eventKey: string): AnalyticsGame | null {
    const normalizedKey = String(eventKey || "").trim().toLowerCase();
    if (!normalizedKey) return null;
    if (getEventsForGame("REEFSCAPE").some((event) => event.id.toLowerCase() === normalizedKey)) return "REEFSCAPE";
    if (getEventsForGame("REBUILT").some((event) => event.id.toLowerCase() === normalizedKey)) return "REBUILT";
    return null;
  }

  async function hydrateLiveStreamContext(url: string): Promise<string> {
    const trimmed = String(url || "").trim();
    if (!trimmed) return "";
    setLiveStreamTitle("");
    setLiveEventKeyHint("");
    setLiveEventTeamSuggestions([]);
    setLiveEventTeamNameMap({});

    try {
      const titleResponse = await fetch("/api/live-stream/title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });
      const titlePayload = (await titleResponse.json().catch(() => ({}))) as { title?: string };
      const title = String(titlePayload.title || "").trim();
      if (title) {
        setLiveStreamTitle(title);
      }

    const inferredFromTitle = title ? inferEventKeyFromStreamTitle(title, activeMatchGame) : "";
    let inferredEventKey = inferredFromTitle;
    if (!inferredEventKey && title) {
      const normalizedTitle = normalizeEventValue(title);
      const years = Array.from(new Set([new Date().getFullYear(), new Date().getFullYear() - 1]));
      for (const year of years) {
        try {
          const response = await fetch("/api/tba/events", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ year, encryptedKey: tbaAuth.encryptedKey, plainKey: tbaAuth.plainKey }),
          });
          if (!response.ok) continue;
          const payload = (await response.json()) as { events?: Array<Record<string, unknown>> };
          const events = Array.isArray(payload.events) ? payload.events : [];
          const matched = events.find((event) => {
            const key = String(event.key || "").trim();
            if (!key) return false;
            const nameCandidates = [
              String(event.name || ""),
              String(event.short_name || ""),
              String(event.event_code || ""),
              key.slice(4),
            ];
            return nameCandidates.some((candidate) => {
              const normalized = normalizeEventValue(candidate);
              return normalized && normalizedTitle.includes(normalized);
            });
          });
          if (matched?.key) {
            inferredEventKey = String(matched.key || "").trim();
            break;
          }
        } catch {
          // Ignore and continue.
        }
      }
    }
    const fallbackEventKey = teamEventCatalog.length > 0 ? pickDetectedEventKey(teamEventCatalog) : "";
    if (!inferredEventKey) inferredEventKey = fallbackEventKey;
    if (!inferredEventKey) return "";
      if (!activeMatchGame) {
        const inferredGame = inferGameFromEventKey(inferredEventKey);
        if (inferredGame) setActiveMatchGame(inferredGame);
      }
      setLiveEventKeyHint(inferredEventKey);

      const teamResponse = await fetch("/api/tba/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventKey: inferredEventKey,
          encryptedKey: tbaAuth.encryptedKey,
          plainKey: tbaAuth.plainKey,
        }),
      });
      if (!teamResponse.ok) return "";
      const teamPayload = (await teamResponse.json()) as { teams?: Array<{ teamNumber?: number; nameShort?: string }> };
      const teams = Array.isArray(teamPayload.teams)
        ? teamPayload.teams
            .map((row) => Number(row.teamNumber || 0))
            .filter((n) => Number.isFinite(n) && n > 0)
        : [];
      const nextNameMap: Record<string, string> = {};
      if (Array.isArray(teamPayload.teams)) {
        teamPayload.teams.forEach((row) => {
          const teamNumber = Number(row.teamNumber || 0);
          if (!Number.isFinite(teamNumber) || teamNumber <= 0) return;
          const nameShort = String(row.nameShort || "").trim();
          if (!nameShort) return;
          nextNameMap[String(teamNumber)] = nameShort;
        });
      }
      setLiveEventTeamSuggestions(Array.from(new Set(teams)).sort((a, b) => a - b));
      setLiveEventTeamNameMap(nextNameMap);
      return inferredEventKey;
    } catch {
      // Best effort only.
      return "";
    }
  }

  useEffect(() => {
    if (selectedMode !== "competitive") return;

    const interval = setInterval(() => {
      iframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: "command", func: "playVideo", args: [] }),
        "*"
      );
    }, 900);

    return () => {
      clearInterval(interval);
    };
  }, [selectedMode, currentMatch?.id]);

  useEffect(() => {
    if (!currentMatch) return;
    if (selectedDifficulty === "live" && liveLobby) return;
    const expectedTeam = currentMatch.allianceTeams[currentRobotIndex]?.toString() || "";
    if (activeMatchGame === "REBUILT") {
      setRebuiltFormData((prev) => (prev.teamNumber === expectedTeam ? prev : { ...prev, teamNumber: expectedTeam }));
      return;
    }
    setFormData((prev) => (prev.teamNumber === expectedTeam ? prev : { ...prev, teamNumber: expectedTeam }));
  }, [activeMatchGame, currentMatch, currentRobotIndex, selectedDifficulty, liveLobby]);

  function clearPracticeDraft() {
    if (typeof window === "undefined" || !userData?.uid) return;
    localStorage.removeItem(getPracticeDraftKey(userData.uid));
  }

  function savePracticeDraft(overrides: Partial<PracticeSessionDraft> = {}) {
    if (typeof window === "undefined" || !userData?.uid || !currentMatch) return;

    const nextStep = (overrides.currentStep || currentStep) as PracticeStep;
    if (nextStep !== "practice" && nextStep !== "break") return;

    const draft: PracticeSessionDraft = {
      version: 1,
      savedAt: Date.now(),
      scoutId: userData.uid,
      selectedGame: overrides.selectedGame ?? activeMatchGame,
      selectedDifficulty: overrides.selectedDifficulty ?? selectedDifficulty,
      selectedMode: overrides.selectedMode ?? selectedMode,
      currentStep: nextStep,
      currentMatch: (overrides.currentMatch ?? currentMatch) as PracticeMatch,
      currentRobotIndex: overrides.currentRobotIndex ?? currentRobotIndex,
      breakCompletedRobotIndex: overrides.breakCompletedRobotIndex ?? breakCompletedRobotIndex,
      robotSessions: overrides.robotSessions ?? robotSessions,
      rebuiltRobotSessions: overrides.rebuiltRobotSessions ?? rebuiltRobotSessions,
      humanPlayerRobot: overrides.humanPlayerRobot ?? humanPlayerRobot,
      formData: overrides.formData ?? formData,
      rebuiltFormData: overrides.rebuiltFormData ?? rebuiltFormData,
    };
    localStorage.setItem(getPracticeDraftKey(userData.uid), JSON.stringify(draft));
  }

  function restorePracticeDraft(draft: PracticeSessionDraft) {
    const safeStep: PracticeStep = draft.currentStep === "break" ? "break" : "practice";
    const inferredGame =
      draft.selectedGame
      || (String((draft.currentMatch as unknown as Record<string, unknown>)?.eventKey || "").toLowerCase() === REBUILT_WEEK0_EVENT_KEY
          ? "REBUILT"
          : "REEFSCAPE");
    setActiveMatchGame(inferredGame);
    setSelectedDifficulty(draft.selectedDifficulty || null);
    setSelectedMode(draft.selectedMode || null);
    setCurrentMatch(draft.currentMatch);
    setCurrentRobotIndex(Math.max(0, Math.min(2, Number(draft.currentRobotIndex) || 0)));
    setBreakCompletedRobotIndex(
      typeof draft.breakCompletedRobotIndex === "number" ? Math.max(0, Math.min(2, draft.breakCompletedRobotIndex)) : null
    );
    setRobotSessions(Array.isArray(draft.robotSessions) ? draft.robotSessions.slice(0, 3) : []);
    setRebuiltRobotSessions(Array.isArray(draft.rebuiltRobotSessions) ? draft.rebuiltRobotSessions.slice(0, 3) : []);
    setHumanPlayerRobot(
      typeof draft.humanPlayerRobot === "number" ? Math.max(0, Math.min(2, draft.humanPlayerRobot)) : null
    );
    setFormData(draft.formData || createEmptyScoutedData());
    setRebuiltFormData({
      ...createEmptyRebuiltScoutedData(),
      ...(draft.rebuiltFormData || {}),
    });
    setCurrentStep(safeStep);
    setPendingDraft(null);
  }

  useEffect(() => {
    if (typeof window === "undefined" || !userData?.uid) return;
    const raw = localStorage.getItem(getPracticeDraftKey(userData.uid));
    if (!raw) {
      setPendingDraft(null);
      return;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<PracticeSessionDraft>;
      if (
        parsed &&
        parsed.version === 1 &&
        parsed.currentMatch &&
        (parsed.currentStep === "practice" || parsed.currentStep === "break")
      ) {
        setPendingDraft(parsed as PracticeSessionDraft);
      } else {
        localStorage.removeItem(getPracticeDraftKey(userData.uid));
        setPendingDraft(null);
      }
    } catch {
      localStorage.removeItem(getPracticeDraftKey(userData.uid));
      setPendingDraft(null);
    }
  }, [userData?.uid]);

  async function selectPracticeMatch(
    difficulty: 'easy' | 'medium' | 'hard' | 'live',
    mode: PracticeMode,
    liveEventOverride?: string
  ): Promise<CandidatePracticeMatch[]> {
    clearPracticeDraft();
    setPendingDraft(null);
    setLoading(true);
    setSelectedDifficulty(difficulty);
    setSelectedMode(mode);
    setCandidateMatches([]);
    setShowDifficultyMatchModal(false);

    try {
      let matches: PracticeMatch[] = [];
      try {
        const matchesSnapshot = await getDocs(collection(db, "practiceMatches"));
        matches = matchesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as PracticeMatch[];
      } catch (queryError) {
        const allSnapshot = await getDocs(collection(db, "practiceMatches"));
        matches = allSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as PracticeMatch[];
        console.warn("Practice match load query failed; using fallback practice match load.", queryError);
      }

      if (matches.length === 0) {
        alert('No matches exist to scout yet for this game/difficulty.');
        setLoading(false);
        return [];
      }

      const gameFilteredMatches = matches.filter((match) => matchBelongsToSelectedGame(match));
      if (gameFilteredMatches.length === 0) {
        alert("No matches exist to scout yet for the selected game.");
        setLoading(false);
        return [];
      }

      const normalizedMatches = gameFilteredMatches
        .map((match) => {
          const parsedTeams = getMatchTeams(match as unknown as PracticeMatch & Record<string, unknown>);
          return { ...match, allianceTeams: parsedTeams };
        })
        .filter((match) => match.allianceTeams.length >= 3);

      let candidateMatches = normalizedMatches;
      if (candidateMatches.length === 0) {
        candidateMatches = buildLegacyGroupedMatches(gameFilteredMatches);
      }
      if (candidateMatches.length === 0) {
        alert("No practice matches have valid alliance team data. Please add team numbers to practice match docs.");
        return [];
      }
      candidateMatches = dedupePracticeMatches(candidateMatches);
      if (difficulty === "live") {
        const hintedEventKey = String(liveEventOverride || liveEventKeyHint || "").trim().toLowerCase();
        if (hintedEventKey) {
          try {
            let tbaMatches: TBAMatch[] = [];
            const response = await fetch("/api/tba/matches", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                eventKey: hintedEventKey,
                encryptedKey: tbaAuth.encryptedKey,
                plainKey: tbaAuth.plainKey,
              }),
            });
            if (response.ok) {
              const payload = (await response.json()) as { matches?: TBAMatch[] };
              if (Array.isArray(payload.matches)) tbaMatches = payload.matches;
            }
            if (tbaMatches.length === 0) {
              tbaMatches = await getEventMatches(hintedEventKey);
            }

            const tbaCandidates = tbaMatches.flatMap((match) => {
              const matchKey = String(match.key || "").trim();
              const scheduleTime = Number(match.actual_time || match.predicted_time || match.time || 0);
                const isCompleted = isTbaMatchCompleted(match);
              const stageMatchType = match.comp_level === "qm" ? "qualification" : "playoff";
              const perAlliance = (["red", "blue"] as const).map((alliance) => {
                const teams = (match.alliances?.[alliance]?.team_keys || [])
                  .map((teamKey) => parseInt(String(teamKey || "").replace(/[^\d]/g, ""), 10))
                  .filter((team) => Number.isFinite(team) && team > 0);
                if (teams.length < 3) return null;
                const allianceScore = Number(match.alliances?.[alliance]?.score);
                const normalizedAllianceScore = Number.isFinite(allianceScore) && allianceScore >= 0 ? allianceScore : 0;
                const normalizedDifficulty = scoreToDifficulty(normalizedAllianceScore);
                return {
                  id: `${matchKey}:${alliance}`,
                  eventKey: hintedEventKey,
                  eventName: liveStreamTitle || hintedEventKey,
                  matchKey,
                  matchNumber: Number(match.match_number || 0),
                  setNumber: Number(match.set_number || 0),
                  compLevel: String(match.comp_level || "").trim().toLowerCase(),
                  matchType: stageMatchType,
                  difficulty: normalizedDifficulty,
                  alliance,
                  allianceScore: normalizedAllianceScore,
                  allianceTeams: teams.slice(0, 3),
                  scheduleTime: Number.isFinite(scheduleTime) ? scheduleTime : 0,
                  time: Number.isFinite(scheduleTime) ? scheduleTime : 0,
                  videoUrl: liveVideoUrl.trim(),
                  officialData: {
                    score: normalizedAllianceScore,
                    penaltyPoints: 0,
                    breakdown: {},
                  },
                  actualScore: normalizedAllianceScore,
                  createdAt: Number.isFinite(scheduleTime) && scheduleTime > 0 ? scheduleTime * 1000 : Date.now(),
                  isCompleted,
                } as PracticeMatch & { scheduleTime: number; time: number; setNumber: number; compLevel: string; isCompleted: boolean };
              });
              return perAlliance.filter((row): row is PracticeMatch & { scheduleTime: number; time: number; setNumber: number; compLevel: string; isCompleted: boolean } => Boolean(row));
            });

            if (tbaCandidates.length > 0) {
              candidateMatches = dedupePracticeMatches(tbaCandidates);
            }
          } catch (error) {
            console.error("Failed loading live candidates from FIRST/TBA:", error);
          }
        }
      }
      if (difficulty !== "live") {
        candidateMatches = candidateMatches.filter((match) => matchMatchesDifficulty(match, difficulty));
      }
      if (candidateMatches.length === 0) {
        alert(`No ${difficulty} matches found for the selected game.`);
        return [];
      }

      const userCompletedIdentities = new Set<string>();
      const userPartialCounts = new Map<string, number>();
      if (userData?.uid) {
        const sessionsSnap = await getDocs(query(collection(db, "practiceSessions"), where("scoutId", "==", userData.uid)));
        sessionsSnap.docs.forEach((docSnap) => {
          const row = docSnap.data() as Record<string, unknown>;
          const game = String(row.game || "REEFSCAPE").toUpperCase();
          if (activeMatchGame && game !== activeMatchGame) return;
          const identity = getPracticeIdentity({
            matchKey: row.matchKey,
            matchNumber: row.matchNumber,
            matchType: row.matchType,
            alliance: row.alliance,
            compLevel: row.compLevel,
          });
          if (identity) userCompletedIdentities.add(identity);
        });

        const scoutingSnap = await getDocs(query(collection(db, "scouting"), where("scoutId", "==", userData.uid)));
        scoutingSnap.docs.forEach((docSnap) => {
          const row = docSnap.data() as Record<string, unknown>;
          if (!row.isPracticeScouting) return;
          const game = String(row.game || "REEFSCAPE").toUpperCase();
          if (activeMatchGame && game !== activeMatchGame) return;
          const identity = getPracticeIdentity({
            matchKey: row.matchKey,
            matchNumber: row.matchNumber,
            matchType: row.matchType,
            alliance: row.alliance || row.allianceColor,
            compLevel: row.compLevel,
          });
          if (!identity) return;
          userPartialCounts.set(identity, (userPartialCounts.get(identity) || 0) + 1);
        });
      }

      const rankedMatches = candidateMatches
        .map((match) => {
          const identity = getPracticeIdentity(match);
          const progress = userCompletedIdentities.has(identity)
            ? "complete"
            : (userPartialCounts.get(identity) || 0) > 0
            ? "partial"
            : "fresh";
          return { ...match, progress } as CandidatePracticeMatch;
        })
        .sort(compareCandidateMatches);

      setCandidateMatches(rankedMatches);
      if (difficulty === "live") {
        setShowDifficultyMatchModal(false);
        setShowMatchSelectModal(false);
      } else {
        setShowDifficultyMatchModal(true);
      }
      return rankedMatches;
    } catch (error) {
      console.error('Error loading practice match:', error);
      const details = (error as { code?: string; message?: string })?.message || "";
      if (details.toLowerCase().includes("permission")) {
        alert("Error loading practice match. Check Firestore rules for read access to practiceMatches.");
      } else {
        alert('Error loading practice match.');
      }
      return [];
    } finally {
      setLoading(false);
    }
  }

  function startPracticeMatch(
    selected: CandidatePracticeMatch,
    options?: { robotIndex?: number; teamNumber?: string; liveMode?: boolean }
  ) {
    const fallbackTeams = selected.allianceTeams.slice(0, 3);
    const official = readOfficialData(selected.officialData);
    const safeOfficialScore =
      typeof official.score === "number" && official.score > 0
        ? official.score
        : typeof (selected as unknown as Record<string, unknown>).officialScore === "number"
        ? Number((selected as unknown as Record<string, unknown>).officialScore)
        : typeof selected.actualScore === "number"
        ? selected.actualScore
        : 0;

    const normalizedMatchType = normalizePracticeMatchType(
      selected.matchType,
      (selected as unknown as Record<string, unknown>).matchKey,
      (selected as unknown as Record<string, unknown>).compLevel
    );

    const isLiveSession = options?.liveMode || selectedDifficulty === "live";
    const safeMatch: PracticeMatch = {
      ...selected,
      matchType: normalizedMatchType,
      videoUrl: isLiveSession && liveVideoUrl.trim() ? liveVideoUrl.trim() : selected.videoUrl,
      allianceTeams: fallbackTeams,
      officialData: {
        score: safeOfficialScore,
        penaltyPoints: Number(official.penaltyPoints || 0),
        breakdown: official.breakdown || {},
      },
    };

    setCurrentMatch(safeMatch);
    const initialRobotIndex = Math.max(0, Math.min(2, Number(options?.robotIndex ?? 0)));
    setCurrentRobotIndex(initialRobotIndex);
    setBreakCompletedRobotIndex(null);
    setRobotSessions([]);
    setRebuiltRobotSessions([]);
    const defaultTeam = safeMatch.allianceTeams[initialRobotIndex]?.toString() || "";
    const hasExplicitTeam = typeof options?.teamNumber === "string";
    const initialTeamNumber = hasExplicitTeam ? String(options?.teamNumber) : (isLiveSession && liveLobby ? "" : defaultTeam);
    setFormData(createEmptyScoutedData(initialTeamNumber));
    setRebuiltFormData(createEmptyRebuiltScoutedData(initialTeamNumber));
    setHumanPlayerRobot(Math.floor(Math.random() * 3));
    setCurrentStep("practice");
    setShowDifficultyMatchModal(false);
  }

  function getAllianceOfficialScore(match: PracticeMatch) {
    const official = readOfficialData(match.officialData);
    if (typeof official.score === "number" && Number.isFinite(official.score)) return official.score;
    if (typeof match.actualScore === "number" && Number.isFinite(match.actualScore)) return match.actualScore;
    return 0;
  }

  function computeLiveLeaderboardFromLobby(
    bundle: LiveMatchBundle,
    assignments: Record<string, LiveAssignment>,
    submissions: Record<string, Record<string, unknown>>
  ) {
    const byGroup = new Map<number, Array<{ assignment: LiveAssignment; submission: Record<string, unknown> }>>();
    Object.entries(submissions).forEach(([uid, submission]) => {
      const assignment = assignments[uid];
      if (!assignment) return;
      const bucket = byGroup.get(assignment.groupIndex) || [];
      bucket.push({ assignment, submission });
      byGroup.set(assignment.groupIndex, bucket);
    });

    const rows: Array<{ team: string; accuracy: number; completed: number; alliance: "red" | "blue"; groupIndex: number }> = [];
    for (const [groupIndex, entries] of byGroup.entries()) {
      if (entries.length === 0) continue;
      const alliance = entries[0].assignment.alliance;
      const officialScore = getAllianceOfficialScore(alliance === "blue" ? bundle.blue : bundle.red);
      const penaltyPoints = Number(readOfficialData((alliance === "blue" ? bundle.blue : bundle.red).officialData).penaltyPoints || 0);
      let accuracy = 0;
      if (activeMatchGame === "REBUILT") {
        const rebuiltRobots = entries
          .map((entry) => (entry.submission.rebuiltData || null) as RebuiltScoutedData | null)
          .filter((row): row is RebuiltScoutedData => Boolean(row));
        if (rebuiltRobots.length > 0) {
          const baseScore = calculateBestRebuiltSessionBaseScore(rebuiltRobots, officialScore, penaltyPoints);
          accuracy = calculateAccuracy(baseScore + penaltyPoints, officialScore);
        }
      } else {
        const reefRobots = entries
          .map((entry) => (entry.submission.scoutedData || null) as ScoutedData | null)
          .filter((row): row is ScoutedData => Boolean(row));
        if (reefRobots.length > 0) {
          const score = reefRobots.reduce((sum, row) => sum + calculateScoutedScore(row), 0) + penaltyPoints;
          accuracy = calculateAccuracy(score, officialScore);
        }
      }
      rows.push({
        team: `${alliance.toUpperCase()} Team ${groupIndex + 1}`,
        accuracy,
        completed: entries.length,
        alliance,
        groupIndex,
      });
    }
    rows.sort((a, b) => b.accuracy - a.accuracy);
    return rows;
  }

  async function syncLiveGroupAccuracyToScoutingRows(input: {
    bundle: LiveMatchBundle;
    assignments: Record<string, LiveAssignment>;
    submissions: Record<string, Record<string, unknown>>;
    groupIndex: number;
    matchKey: string;
    matchId: string;
    matchNumber: string;
    alliance: "red" | "blue" | "";
  }) {
    const { bundle, assignments, submissions, groupIndex, matchKey, matchId, matchNumber, alliance } = input;
    if (groupIndex < 0) return;
    if (!matchId && !matchKey) return;

    const groupMembers = Object.entries(assignments)
      .filter(([, assignment]) => assignment.groupIndex === groupIndex)
      .map(([uid]) => uid);
    if (groupMembers.length !== 3) return;

    const board = computeLiveLeaderboardFromLobby(bundle, assignments, submissions);
    const groupRow = board.find((row) => row.groupIndex === groupIndex);
    if (!groupRow) return;

    const groupSubmissionCount = Object.entries(submissions).filter(([uid]) => groupMembers.includes(uid)).length;
    if (groupSubmissionCount < 3) return;

    await Promise.all(
      groupMembers.map(async (uid) => {
        try {
          const scoutRowsSnap = await getDocs(query(collection(db, "scouting"), where("scoutId", "==", uid)));
          const candidates = scoutRowsSnap.docs
            .map((docSnap) => ({ id: docSnap.id, data: docSnap.data() as Record<string, unknown> }))
            .filter((row) => {
              const data = row.data;
              if (!data.isLivePracticeScouting) return false;
              const rowMatchKey = String(data.matchKey || "");
              const rowMatchId = String(data.matchId || "");
              const rowMatchNumber = String(data.matchNumber || "");
              const rowAlliance = normalizeAllianceSide(data.alliance);
              const matchKeyMatches = Boolean(matchKey) && rowMatchKey === matchKey;
              const matchIdMatches = Boolean(matchId) && rowMatchId === matchId;
              const matchNumberMatches = Boolean(matchNumber) && rowMatchNumber === matchNumber;
              if (!matchKeyMatches && !matchIdMatches && !matchNumberMatches) return false;
              if (alliance && rowAlliance && rowAlliance !== alliance) return false;
              return true;
            })
            .sort((a, b) => Number(b.data.submittedAt || b.data.timestamp || 0) - Number(a.data.submittedAt || a.data.timestamp || 0));
          const latest = candidates[0];
          if (!latest) return;
          await updateDoc(doc(db, "scouting", latest.id), {
            accuracy: groupRow.accuracy,
          });
        } catch {
          // Best-effort sync only; keep live flow moving even if one row cannot be updated.
        }
      })
    );
  }

  function openLiveRobotPicker(match: CandidatePracticeMatch) {
    const baseIdentity = getPracticeBaseIdentity(match);
    const siblings = candidateMatches.filter((candidate) => getPracticeBaseIdentity(candidate) === baseIdentity);
    const pool = siblings.length > 0 ? siblings : [match];

    const redMatch = pool.find((candidate) => normalizeAllianceSide(candidate.alliance) === "red");
    const blueMatch = pool.find((candidate) => normalizeAllianceSide(candidate.alliance) === "blue");
    const fallbackAlliance = normalizeAllianceSide(match.alliance);

    const buildOptions = (source: CandidatePracticeMatch | undefined, alliance: "red" | "blue") => {
      if (!source) return [] as LiveRobotPickOption[];
      return [0, 1, 2].map((robotIndex) => ({
        match: source,
        alliance,
        robotIndex,
        teamNumber: source.allianceTeams[robotIndex]?.toString() || "",
      }));
    };

    const pending: PendingLiveRobotPick = {
      stageLabel: getPracticeStageLabel(getPracticeStage(match)),
      matchNumber: match.matchNumber,
      red: buildOptions(redMatch || (fallbackAlliance === "red" ? match : undefined), "red"),
      blue: buildOptions(blueMatch || (fallbackAlliance === "blue" ? match : undefined), "blue"),
    };
    setPendingLiveMatchPick(pending);
    setShowLiveRobotModal(true);
  }

  function handleSelectLiveRobot(option: LiveRobotPickOption) {
    const safeRobotIndex = Math.max(0, Math.min(2, option.robotIndex));
    const teamNumber = option.teamNumber || "";
    setShowLiveRobotModal(false);
    setPendingLiveMatchPick(null);
    startPracticeMatch(option.match, { liveMode: true, robotIndex: safeRobotIndex, teamNumber });
  }

  async function handleChooseLiveMatchClick(overrideMatches?: CandidatePracticeMatch[]) {
    if (!liveVideoUrl.trim()) {
      alert("Paste a live video URL first.");
      return;
    }
    setShowMatchSelectModal(false);
    const inferredEventKey = await hydrateLiveStreamContext(liveVideoUrl.trim());

    const pickFrom = overrideMatches || candidateMatches;
    if (pickFrom.length === 0) {
      alert("No live matches loaded yet. Select Live difficulty first.");
      return;
    }

    const hintedEvent = inferredEventKey.trim().toLowerCase();
    const hintedMatches =
      hintedEvent.length > 0
        ? pickFrom.filter((match) => getPracticeEventKey(match).trim().toLowerCase() === hintedEvent)
        : [];

    const pool = hintedMatches.length > 0 ? hintedMatches : pickFrom;
    const sortedPool = [...pool].sort((a, b) => {
      const aTime = Number((a as unknown as Record<string, unknown>).scheduleTime || 0);
      const bTime = Number((b as unknown as Record<string, unknown>).scheduleTime || 0);
      const aCompleted = Boolean((a as unknown as Record<string, unknown>).isCompleted);
      const bCompleted = Boolean((b as unknown as Record<string, unknown>).isCompleted);
      if (aCompleted !== bCompleted) return aCompleted ? 1 : -1;
      if (aTime > 0 && bTime > 0) return aTime - bTime;
      if (aTime > 0 && bTime <= 0) return -1;
      if (aTime <= 0 && bTime > 0) return 1;
      return Number(a.matchNumber || 0) - Number(b.matchNumber || 0);
    });
    const nowSec = getEffectiveNowSec(teamTimeOverride);
    const active = sortedPool.find((match) => {
      const time = Number((match as unknown as Record<string, unknown>).scheduleTime || 0);
      const done = Boolean((match as unknown as Record<string, unknown>).isCompleted);
      return !done && time > 0 && nowSec >= time && nowSec <= time + 8 * 60;
    });
    const next = sortedPool.find((match) => {
      const time = Number((match as unknown as Record<string, unknown>).scheduleTime || 0);
      const done = Boolean((match as unknown as Record<string, unknown>).isCompleted);
      return !done && time > 0 && time >= nowSec;
    });
    let preferred = active;
    if (!preferred) {
      const preferredModalId = liveTbaMatches.length > 0
        ? pickNextModalIdFromTba(liveTbaMatches, nowSec, Boolean(teamTimeOverride?.enabled))
        : (() => {
            const { options, completed } = buildModalOptionsFromCandidates(pool);
            return pickNextModalIdFromOptions(options, completed, nowSec);
          })();
      if (preferredModalId) {
        preferred =
          sortedPool.find((match) => getModalIdForMatch(match) === preferredModalId && !Boolean((match as unknown as Record<string, unknown>).isCompleted))
          || sortedPool.find((match) => getModalIdForMatch(match) === preferredModalId);
      }
    }
    const chosen =
      preferred
      || next
      || sortedPool.find((match) => !Boolean((match as unknown as Record<string, unknown>).isCompleted))
      || sortedPool[0];
    if (!chosen) {
      alert("Could not pick a live match.");
      return;
    }

    startPracticeMatch(chosen, { liveMode: true });
  }

  async function handleLiveCardClick() {
    setShowLiveLinkModal(true);
  }

  async function handleStartLiveFromLink() {
    if (!selectedMode) {
      alert("Select a practice mode first.");
      return;
    }
    if (!liveVideoUrl.trim()) {
      alert("Paste a live video URL first.");
      return;
    }

    setLiveLobby(null);
    setLiveLobbyId("");
    setLiveLobbyError("");
    setShowMatchSelectModal(false);
    const inferredEventKey = await hydrateLiveStreamContext(liveVideoUrl.trim());
    if (inferredEventKey) {
      setLiveEventKeyHint(inferredEventKey);
    }
    setShowLiveLinkModal(false);
    const matches = await selectPracticeMatch("live", selectedMode, inferredEventKey);
    if (matches.length === 0) return;
    await handleChooseLiveMatchClick(matches);
  }

  async function handleOpenLiveCorrection() {
    if (liveLobby) {
      alert("Match/robot corrections are disabled during live lobby sessions.");
      return;
    }
    if (!selectedMode) return;
    let inferredEventKey = "";
    if (liveVideoUrl.trim()) {
      inferredEventKey = await hydrateLiveStreamContext(liveVideoUrl.trim());
    }
    let matches = candidateMatches;
    if (matches.length === 0) {
      matches = await selectPracticeMatch("live", selectedMode, inferredEventKey);
    }
    if (matches.length === 0) return;
    setShowMatchSelectModal(true);
  }

  function handleOpenCurrentLiveRobotPicker() {
    if (!currentMatch) return;
    if (liveLobby) {
      alert("Robot/team overrides are disabled during live lobby sessions.");
      return;
    }
    const picked = { ...currentMatch, progress: "fresh" as const } as CandidatePracticeMatch;
    openLiveRobotPicker(picked);
  }

  async function submitCurrentRobot() {
    if (!currentMatch || !userData) return;
    if (selectedDifficulty === "live") {
      await submitLiveRobot();
      return;
    }

    if (activeMatchGame === "REBUILT") {
      const robotData = { ...rebuiltFormData };
      const nextRobotSessions = [...rebuiltRobotSessions, robotData];
      setRebuiltRobotSessions(nextRobotSessions);

      if (currentRobotIndex === 2) {
        await submitRebuiltPracticeSession(nextRobotSessions);
        return;
      }

      setBreakCompletedRobotIndex(currentRobotIndex);
      setCurrentStep('break');
      savePracticeDraft({
        selectedGame: "REBUILT",
        currentStep: "break",
        breakCompletedRobotIndex: currentRobotIndex,
        rebuiltRobotSessions: nextRobotSessions,
        rebuiltFormData: robotData,
      });
      return;
    }

    const robotData = { ...formData };
    const nextRobotSessions = [...robotSessions, robotData];
    setRobotSessions(nextRobotSessions);

    if (currentRobotIndex === 2) {
      await submitPracticeSession(nextRobotSessions);
      return;
    }

    setBreakCompletedRobotIndex(currentRobotIndex);
    setCurrentStep('break');
    savePracticeDraft({
      selectedGame: "REEFSCAPE",
      currentStep: "break",
      breakCompletedRobotIndex: currentRobotIndex,
      robotSessions: nextRobotSessions,
    });
  }

  function continueToNextRobot() {
    if (!currentMatch) return;
    const nextRobotIndex = currentRobotIndex + 1;
    if (selectedDifficulty !== "live" && nextRobotIndex > 2) return;

    setCurrentRobotIndex(nextRobotIndex);
    const defaultTeam = currentMatch.allianceTeams[nextRobotIndex]?.toString() || "";
    const nextTeamNumber = selectedDifficulty === "live" && liveLobby ? "" : defaultTeam;
    setFormData(createEmptyScoutedData(nextTeamNumber));
    setRebuiltFormData(createEmptyRebuiltScoutedData(nextTeamNumber));
    setCurrentStep('practice');
    setMobileNotesOpen(false);
    formPaneRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submitRebuiltPracticeSession(allRobotData: RebuiltScoutedData[]) {
    if (!currentMatch || !userData) return;
    if (allRobotData.length === 0) return;

    setLoading(true);
    try {
      const penaltyPoints = Number(currentMatch.officialData?.penaltyPoints || 0);
      const officialAllianceScore =
        typeof currentMatch.officialData?.score === "number"
          ? currentMatch.officialData.score
          : typeof currentMatch.actualScore === "number"
          ? currentMatch.actualScore
          : 0;
      const baseScoutedScore = calculateBestRebuiltSessionBaseScore(allRobotData, officialAllianceScore, penaltyPoints);
      const totalScoutedScore = baseScoutedScore + penaltyPoints;
      const sessionAccuracy = calculateAccuracy(totalScoutedScore, officialAllianceScore);

      const now = Date.now();
      const device = getScoutDevice();
      const { eventKey, eventName } = resolvePracticeEvent(currentMatch, "REBUILT", teamEventCatalog);
      const matchStage = getPracticeStage(currentMatch);
      const analyticsMatchType: "practice" | "qualification" | "finals" =
        matchStage === "practice" ? "practice" : matchStage === "qualification" ? "qualification" : "finals";
      const matchIdPrefix = analyticsMatchType === "practice" ? "p" : analyticsMatchType === "finals" ? "f" : "q";
      const normalizedMatchType = normalizePracticeMatchType(
        currentMatch.matchType,
        currentMatch.matchKey,
        (currentMatch as unknown as Record<string, unknown>).compLevel
      );

      const session: Partial<PracticeSession> & Record<string, unknown> = {
        scoutName: userData.displayName,
        scoutId: userData.uid,
        matchId: currentMatch.id || '',
        matchKey: currentMatch.matchKey || "",
        matchNumber: currentMatch.matchNumber,
        matchType: normalizedMatchType,
        alliance: normalizeAllianceSide(currentMatch.alliance),
        difficulty: persistedDifficulty,
        mode: selectedMode || 'trial',
        isLivePracticeScouting: selectedDifficulty === "live",
        liveVideoUrl: selectedDifficulty === "live" ? liveVideoUrl.trim() : "",
        scoutedData: allRobotData[0] as unknown as ScoutedData,
        allScoutedData: allRobotData,
        eventKey,
        eventName,
        game: "REBUILT",
        officialScore: officialAllianceScore,
        actualScore: officialAllianceScore,
        scoutedScore: totalScoutedScore,
        penaltyPoints,
        accuracy: sessionAccuracy,
        scoringWeights: {
          autoFuel: 1,
          autoClimbLevel1: 15,
          teleopFuel: 1,
          teleopClimbLevel1: 10,
          teleopClimbLevel2: 20,
          teleopClimbLevel3: 30,
        },
        deviceType: device.deviceType,
        deviceDetails: device.details,
        timestamp: now,
        startedAt: now,
        completedAt: now,
      };

      const docRef = await addDoc(collection(db, 'practiceSessions'), session);

      await Promise.all(
        allRobotData.map((robotData) => {
          const preloadCap = REBUILT_PRELOAD[Math.max(0, Math.min(4, robotData.autoPreloadScale))] || 0;
          const autoCarryCap = REBUILT_CARRY[Math.max(0, Math.min(CARRY_MAX, robotData.autoCarryScale))] || 0;
          const teleCarryCap = REBUILT_CARRY[Math.max(0, Math.min(CARRY_MAX, robotData.teleCarryScale))] || 0;
          const autoEstimatedFuel = robotData.autoCycles.reduce((sum, seconds, index) => {
            const capacity = index === 0 && preloadCap > 0 ? preloadCap : autoCarryCap;
            return sum + estimateRebuiltBalls(seconds, robotData.autoBpsScale, capacity);
          }, 0);
          const transitionEstimatedFuel = robotData.transitionCycles.reduce(
            (sum, seconds) => sum + estimateRebuiltBalls(seconds, robotData.teleBpsScale, teleCarryCap),
            0
          );
          const shift1EstimatedFuel = robotData.shift1Cycles.reduce((sum, seconds) => sum + estimateRebuiltBalls(seconds, robotData.teleBpsScale, teleCarryCap), 0);
          const shift2EstimatedFuel = robotData.shift2Cycles.reduce((sum, seconds) => sum + estimateRebuiltBalls(seconds, robotData.teleBpsScale, teleCarryCap), 0);
          const shift3EstimatedFuel = robotData.shift3Cycles.reduce((sum, seconds) => sum + estimateRebuiltBalls(seconds, robotData.teleBpsScale, teleCarryCap), 0);
          const shift4EstimatedFuel = robotData.shift4Cycles.reduce((sum, seconds) => sum + estimateRebuiltBalls(seconds, robotData.teleBpsScale, teleCarryCap), 0);
          const endgameEstimatedFuel = robotData.endgameCycles.reduce(
            (sum, seconds) => sum + estimateRebuiltBalls(seconds, robotData.teleBpsScale, teleCarryCap),
            0
          );

          const autoFuelSection = resolveSectionFuel(autoEstimatedFuel, robotData.autoCounterOverride, robotData.autoCounterMissedFuel);
          const transitionFuel = resolveSectionFuel(transitionEstimatedFuel, robotData.transitionCounterOverride, robotData.transitionCounterMissedFuel);
          const shift1Fuel = resolveSectionFuel(shift1EstimatedFuel, robotData.shift1CounterOverride, robotData.shift1CounterMissedFuel);
          const shift2Fuel = resolveSectionFuel(shift2EstimatedFuel, robotData.shift2CounterOverride, robotData.shift2CounterMissedFuel);
          const shift3Fuel = resolveSectionFuel(shift3EstimatedFuel, robotData.shift3CounterOverride, robotData.shift3CounterMissedFuel);
          const shift4Fuel = resolveSectionFuel(shift4EstimatedFuel, robotData.shift4CounterOverride, robotData.shift4CounterMissedFuel);
          const endgameFuelSection = resolveSectionFuel(endgameEstimatedFuel, robotData.endgameCounterOverride, robotData.endgameCounterMissedFuel);
          const autoFuelWithHuman = autoFuelSection + Number(robotData.autoHumanPlayerFuel || 0);
          const teleEstimatedFuel = transitionFuel + (robotData.wonAuto ? shift2Fuel + shift4Fuel : shift1Fuel + shift3Fuel) + Number(robotData.teleopHumanPlayerFuel || 0);
          const endgameFuelWithHuman = endgameFuelSection + Number(robotData.endgameHumanPlayerFuel || 0);

          return addDoc(collection(db, "scouting"), {
            scoutName: userData.displayName,
            scoutId: userData.uid,
            teamNumber: robotData.teamNumber,
            startingPosition: robotData.startingPosition,
            incidents: robotData.incidents,
            notes: robotData.notes,
            auto: {
              preloadScale: robotData.autoPreloadScale,
              bpsScale: robotData.autoBpsScale,
              carryingScale: robotData.autoCarryScale,
              cycleTimes: robotData.autoCycles,
              failedClimb: robotData.autoFailedClimb,
              estimatedFuel: autoFuelWithHuman,
              counterOverride: robotData.autoCounterOverride,
              counterOverrideMissedFuel: robotData.autoCounterMissedFuel,
              humanPlayerFuel: robotData.autoHumanPlayerFuel,
              successfulClimb: robotData.autoSuccessfulClimb,
              wonAuto: robotData.wonAuto,
            },
            teleop: {
              bpsScale: robotData.teleBpsScale,
              carryingScale: robotData.teleCarryScale,
              transitionCycles: robotData.transitionCycles,
              shift1Cycles: robotData.shift1Cycles,
              shift2Cycles: robotData.shift2Cycles,
              shift3Cycles: robotData.shift3Cycles,
              shift4Cycles: robotData.shift4Cycles,
              transitionOverride: robotData.transitionCounterOverride,
              transitionMissedFuel: robotData.transitionCounterMissedFuel,
              shift1Override: robotData.shift1CounterOverride,
              shift1MissedFuel: robotData.shift1CounterMissedFuel,
              shift2Override: robotData.shift2CounterOverride,
              shift2MissedFuel: robotData.shift2CounterMissedFuel,
              shift3Override: robotData.shift3CounterOverride,
              shift3MissedFuel: robotData.shift3CounterMissedFuel,
              shift4Override: robotData.shift4CounterOverride,
              shift4MissedFuel: robotData.shift4CounterMissedFuel,
              humanPlayerFuel: robotData.teleopHumanPlayerFuel,
              estimatedFuel: teleEstimatedFuel,
            },
            endgame: {
              status: robotData.endgameStatus,
              failedClimb: robotData.endgameFailedClimb,
              cycleTimes: robotData.endgameCycles,
              counterOverride: robotData.endgameCounterOverride,
              counterOverrideMissedFuel: robotData.endgameCounterMissedFuel,
              humanPlayerFuel: robotData.endgameHumanPlayerFuel,
              estimatedFuel: endgameFuelWithHuman,
            },
            matchId: `${matchIdPrefix}${currentMatch.matchNumber}`,
            matchNumber: String(currentMatch.matchNumber),
            matchType: analyticsMatchType,
            alliance: normalizeAllianceSide(currentMatch.alliance),
            allianceColor: normalizeAllianceSide(currentMatch.alliance),
            matchKey: currentMatch.matchKey || "",
            eventKey,
            eventName,
            game: "REBUILT",
            accuracy: sessionAccuracy,
            timestamp: now,
            submittedAt: now,
            practiceMode: selectedMode || "trial",
            difficulty: persistedDifficulty,
            isLivePracticeScouting: selectedDifficulty === "live",
            liveVideoUrl: selectedDifficulty === "live" ? liveVideoUrl.trim() : "",
            isPracticeScouting: true,
            practiceSessionId: docRef.id,
            penaltyPoints,
            deviceType: device.deviceType,
            deviceDetails: device.details,
          });
        })
      );

      setSessionResults({ ...(session as PracticeSession), id: docRef.id });
      setCurrentStep('results');
      clearPracticeDraft();
      setPendingDraft(null);
    } catch (error) {
      console.error('Error submitting REBUILT practice session:', error);
      alert('Error submitting practice session: ' + (error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function submitPracticeSession(allRobotData: ScoutedData[]) {
    if (!currentMatch || !userData) return;
    if (allRobotData.length === 0) return;

    setLoading(true);
    try {
      const scores = allRobotData.map(data => calculateScoutedScore(data));
      const baseScoutedScore = scores.reduce((a, b) => a + b, 0);
      const penaltyPoints = Number(currentMatch.officialData?.penaltyPoints || 0);
      const totalScoutedScore = baseScoutedScore + penaltyPoints;
      const officialAllianceScore =
        typeof currentMatch.officialData?.score === "number"
          ? currentMatch.officialData.score
          : typeof currentMatch.actualScore === "number"
          ? currentMatch.actualScore
          : 0;
      const sessionAccuracy = calculateAccuracy(totalScoutedScore, officialAllianceScore);

      const now = Date.now();
      const device = getScoutDevice();
      const { eventKey, eventName } = resolvePracticeEvent(currentMatch, activeMatchGame || "REEFSCAPE", teamEventCatalog);
      const matchStage = getPracticeStage(currentMatch);
      const analyticsMatchType: "practice" | "qualification" | "finals" =
        matchStage === "practice" ? "practice" : matchStage === "qualification" ? "qualification" : "finals";
      const matchIdPrefix = analyticsMatchType === "practice" ? "p" : analyticsMatchType === "finals" ? "f" : "q";
      const normalizedMatchType = normalizePracticeMatchType(
        currentMatch.matchType,
        currentMatch.matchKey,
        (currentMatch as unknown as Record<string, unknown>).compLevel
      );

      const session: Partial<PracticeSession> & Record<string, unknown> = {
        scoutName: userData.displayName,
        scoutId: userData.uid,
        matchId: currentMatch.id || '',
        matchKey: currentMatch.matchKey || "",
        matchNumber: currentMatch.matchNumber,
        matchType: normalizedMatchType,
        alliance: normalizeAllianceSide(currentMatch.alliance),
        difficulty: persistedDifficulty,
        mode: selectedMode || 'trial',
        isLivePracticeScouting: selectedDifficulty === "live",
        liveVideoUrl: selectedDifficulty === "live" ? liveVideoUrl.trim() : "",
        scoutedData: allRobotData[0],
        allScoutedData: allRobotData,
        eventKey,
        eventName,
        game: activeMatchGame,
        officialScore: officialAllianceScore,
        actualScore: officialAllianceScore,
        scoutedScore: totalScoutedScore,
        penaltyPoints,
        accuracy: sessionAccuracy,
        deviceType: device.deviceType,
        deviceDetails: device.details,
        timestamp: now,
        startedAt: now,
        completedAt: now,
      };

      const docRef = await addDoc(collection(db, 'practiceSessions'), session);

      await Promise.all(
        allRobotData.map((robotData) =>
          addDoc(collection(db, "scouting"), {
            ...robotData,
            scoutName: userData.displayName,
            scoutId: userData.uid,
            matchId: `${matchIdPrefix}${currentMatch.matchNumber}`,
            matchNumber: String(currentMatch.matchNumber),
            matchType: analyticsMatchType,
            alliance: normalizeAllianceSide(currentMatch.alliance),
            allianceColor: normalizeAllianceSide(currentMatch.alliance),
            matchKey: currentMatch.matchKey || "",
            eventKey,
            eventName,
            game: activeMatchGame,
            accuracy: sessionAccuracy,
            timestamp: now,
            submittedAt: now,
            practiceMode: selectedMode || "trial",
            difficulty: persistedDifficulty,
            isLivePracticeScouting: selectedDifficulty === "live",
            liveVideoUrl: selectedDifficulty === "live" ? liveVideoUrl.trim() : "",
            isPracticeScouting: true,
            practiceSessionId: docRef.id,
            penaltyPoints,
            deviceType: device.deviceType,
            deviceDetails: device.details,
          })
        )
      );

      setSessionResults({ ...(session as PracticeSession), id: docRef.id });
      setCurrentStep('results');
      clearPracticeDraft();
      setPendingDraft(null);
    } catch (error) {
      console.error('Error submitting practice session:', error);
      alert('Error submitting practice session: ' + (error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function resetPractice() {
    setCurrentStep('select');
    setSelectedDifficulty(null);
    setSelectedMode(null);
    setCandidateMatches([]);
    setShowMatchSelectModal(false);
    setShowDifficultyMatchModal(false);
    setShowLiveLinkModal(false);
    setShowLiveRobotModal(false);
    setShowLobbyMatchModal(false);
    setPendingLiveMatchPick(null);
    setLiveVideoUrl("");
    setLobbyMatchCandidates([]);
    setLobbyMatchError("");
    setLobbyMatchBusy(false);
    setLobbyMatchDifficultyFilter("all");
    setCurrentMatch(null);
    setCurrentRobotIndex(0);
    setBreakCompletedRobotIndex(null);
    setRobotSessions([]);
    setRebuiltRobotSessions([]);
    setHumanPlayerRobot(null);
    setSessionResults(null);
    setMobileNotesOpen(false);
    setFormData(createEmptyScoutedData());
    setRebuiltFormData(createEmptyRebuiltScoutedData());
    setLiveTeamAccuracy(null);
    setLiveLeaderboard([]);
    setLiveStartedSessionKey("");
    setLiveMatchBundle(null);
    setLiveAssignments({});
    setLiveSubmissions({});
    clearPracticeDraft();
    setPendingDraft(null);
  }

  async function endCurrentSession() {
    if (selectedDifficulty === "live" && liveLobby) {
      try {
        await leaveLiveLobby();
      } finally {
        setLiveLobby(null);
        setLiveLobbyId("");
      }
    }
    resetPractice();
  }

  async function submitLiveRobot() {
    if (!currentMatch || !userData) return;
    if (liveLobby?.hostOptOut && userIsLiveLobbyHost) {
      alert("Host opted out of scouting for this lobby.");
      return;
    }

    setLoading(true);
    try {
      const now = Date.now();
      const device = getScoutDevice();
      const { eventKey, eventName } = resolvePracticeEvent(currentMatch, activeMatchGame || "REEFSCAPE", teamEventCatalog);
      const matchStage = getPracticeStage(currentMatch);
      const analyticsMatchType: "practice" | "qualification" | "finals" =
        matchStage === "practice" ? "practice" : matchStage === "qualification" ? "qualification" : "finals";
      const matchIdPrefix = analyticsMatchType === "practice" ? "p" : analyticsMatchType === "finals" ? "f" : "q";
      const liveEventName = toLiveEventName(eventName);
      const alliance = normalizeAllianceSide(currentMatch.alliance);
      const penaltyPoints = Number(currentMatch.officialData?.penaltyPoints || 0);
      let submissionPayload: Record<string, unknown> = {};

      if (activeMatchGame === "REBUILT") {
        const robotData = { ...rebuiltFormData };
        const preloadCap = REBUILT_PRELOAD[Math.max(0, Math.min(4, robotData.autoPreloadScale))] || 0;
        const autoCarryCap = REBUILT_CARRY[Math.max(0, Math.min(CARRY_MAX, robotData.autoCarryScale))] || 0;
        const teleCarryCap = REBUILT_CARRY[Math.max(0, Math.min(CARRY_MAX, robotData.teleCarryScale))] || 0;
        const autoEstimatedFuel = robotData.autoCycles.reduce((sum, seconds, index) => {
          const capacity = index === 0 && preloadCap > 0 ? preloadCap : autoCarryCap;
          return sum + estimateRebuiltBalls(seconds, robotData.autoBpsScale, capacity);
        }, 0);
        const transitionEstimatedFuel = robotData.transitionCycles.reduce(
          (sum, seconds) => sum + estimateRebuiltBalls(seconds, robotData.teleBpsScale, teleCarryCap),
          0
        );
        const shift1EstimatedFuel = robotData.shift1Cycles.reduce((sum, seconds) => sum + estimateRebuiltBalls(seconds, robotData.teleBpsScale, teleCarryCap), 0);
        const shift2EstimatedFuel = robotData.shift2Cycles.reduce((sum, seconds) => sum + estimateRebuiltBalls(seconds, robotData.teleBpsScale, teleCarryCap), 0);
        const shift3EstimatedFuel = robotData.shift3Cycles.reduce((sum, seconds) => sum + estimateRebuiltBalls(seconds, robotData.teleBpsScale, teleCarryCap), 0);
        const shift4EstimatedFuel = robotData.shift4Cycles.reduce((sum, seconds) => sum + estimateRebuiltBalls(seconds, robotData.teleBpsScale, teleCarryCap), 0);
        const endgameEstimatedFuel = robotData.endgameCycles.reduce(
          (sum, seconds) => sum + estimateRebuiltBalls(seconds, robotData.teleBpsScale, teleCarryCap),
          0
        );

        const autoFuelSection = resolveSectionFuel(autoEstimatedFuel, robotData.autoCounterOverride, robotData.autoCounterMissedFuel);
        const transitionFuel = resolveSectionFuel(transitionEstimatedFuel, robotData.transitionCounterOverride, robotData.transitionCounterMissedFuel);
        const shift1Fuel = resolveSectionFuel(shift1EstimatedFuel, robotData.shift1CounterOverride, robotData.shift1CounterMissedFuel);
        const shift2Fuel = resolveSectionFuel(shift2EstimatedFuel, robotData.shift2CounterOverride, robotData.shift2CounterMissedFuel);
        const shift3Fuel = resolveSectionFuel(shift3EstimatedFuel, robotData.shift3CounterOverride, robotData.shift3CounterMissedFuel);
        const shift4Fuel = resolveSectionFuel(shift4EstimatedFuel, robotData.shift4CounterOverride, robotData.shift4CounterMissedFuel);
        const endgameFuelSection = resolveSectionFuel(endgameEstimatedFuel, robotData.endgameCounterOverride, robotData.endgameCounterMissedFuel);
        const autoFuelWithHuman = autoFuelSection + Number(robotData.autoHumanPlayerFuel || 0);
        const teleEstimatedFuel = transitionFuel + (robotData.wonAuto ? shift2Fuel + shift4Fuel : shift1Fuel + shift3Fuel) + Number(robotData.teleopHumanPlayerFuel || 0);
        const endgameFuelWithHuman = endgameFuelSection + Number(robotData.endgameHumanPlayerFuel || 0);

        await addDoc(collection(db, "scouting"), {
          scoutName: userData.displayName,
          scoutId: userData.uid,
          teamNumber: robotData.teamNumber,
          startingPosition: robotData.startingPosition,
          incidents: robotData.incidents,
          notes: robotData.notes,
          auto: {
            preloadScale: robotData.autoPreloadScale,
            bpsScale: robotData.autoBpsScale,
            carryingScale: robotData.autoCarryScale,
            cycleTimes: robotData.autoCycles,
            failedClimb: robotData.autoFailedClimb,
            estimatedFuel: autoFuelWithHuman,
            counterOverride: robotData.autoCounterOverride,
            counterOverrideMissedFuel: robotData.autoCounterMissedFuel,
            humanPlayerFuel: robotData.autoHumanPlayerFuel,
            successfulClimb: robotData.autoSuccessfulClimb,
            wonAuto: robotData.wonAuto,
          },
          teleop: {
            bpsScale: robotData.teleBpsScale,
            carryingScale: robotData.teleCarryScale,
            transitionCycles: robotData.transitionCycles,
            shift1Cycles: robotData.shift1Cycles,
            shift2Cycles: robotData.shift2Cycles,
            shift3Cycles: robotData.shift3Cycles,
            shift4Cycles: robotData.shift4Cycles,
            transitionOverride: robotData.transitionCounterOverride,
            transitionMissedFuel: robotData.transitionCounterMissedFuel,
            shift1Override: robotData.shift1CounterOverride,
            shift1MissedFuel: robotData.shift1CounterMissedFuel,
            shift2Override: robotData.shift2CounterOverride,
            shift2MissedFuel: robotData.shift2CounterMissedFuel,
            shift3Override: robotData.shift3CounterOverride,
            shift3MissedFuel: robotData.shift3CounterMissedFuel,
            shift4Override: robotData.shift4CounterOverride,
            shift4MissedFuel: robotData.shift4CounterMissedFuel,
            humanPlayerFuel: robotData.teleopHumanPlayerFuel,
            estimatedFuel: teleEstimatedFuel,
          },
          endgame: {
            status: robotData.endgameStatus,
            failedClimb: robotData.endgameFailedClimb,
            cycleTimes: robotData.endgameCycles,
            counterOverride: robotData.endgameCounterOverride,
            counterOverrideMissedFuel: robotData.endgameCounterMissedFuel,
            humanPlayerFuel: robotData.endgameHumanPlayerFuel,
            estimatedFuel: endgameFuelWithHuman,
          },
          matchId: `${matchIdPrefix}${currentMatch.matchNumber}`,
          matchNumber: String(currentMatch.matchNumber),
          matchType: analyticsMatchType,
          alliance,
          allianceColor: alliance,
          matchKey: currentMatch.matchKey || "",
          eventKey,
          eventName: liveEventName,
          game: "REBUILT",
          timestamp: now,
          submittedAt: now,
          practiceMode: selectedMode || "trial",
          difficulty: persistedDifficulty,
          isLivePracticeScouting: true,
          liveVideoUrl: liveVideoUrl.trim(),
          isPracticeScouting: true,
          penaltyPoints,
          deviceType: device.deviceType,
          deviceDetails: device.details,
        });
        submissionPayload = {
          game: "REBUILT",
          alliance,
          teamNumber: robotData.teamNumber,
          rebuiltData: robotData,
        };
      } else {
        const robotData = { ...formData };
        await addDoc(collection(db, "scouting"), {
          ...robotData,
          scoutName: userData.displayName,
          scoutId: userData.uid,
          matchId: `${matchIdPrefix}${currentMatch.matchNumber}`,
          matchNumber: String(currentMatch.matchNumber),
          matchType: analyticsMatchType,
          alliance,
          allianceColor: alliance,
          matchKey: currentMatch.matchKey || "",
          eventKey,
          eventName: liveEventName,
          game: activeMatchGame,
          timestamp: now,
          submittedAt: now,
          practiceMode: selectedMode || "trial",
          difficulty: persistedDifficulty,
          isLivePracticeScouting: true,
          liveVideoUrl: liveVideoUrl.trim(),
          isPracticeScouting: true,
          penaltyPoints,
          deviceType: device.deviceType,
          deviceDetails: device.details,
        });
        submissionPayload = {
          game: activeMatchGame,
          alliance,
          teamNumber: robotData.teamNumber,
          scoutedData: robotData,
        };
      }

      if (liveLobby?.code && userData?.uid) {
        const nextSubmissions = {
          ...(liveSubmissions || {}),
          [userData.uid]: { ...submissionPayload, submittedAt: Date.now() },
        };
        setLiveSubmissions((prev) => ({
          ...prev,
          [userData.uid]: { ...submissionPayload, submittedAt: Date.now() },
        }));
        if (liveLobby.id.startsWith("local:")) {
          const next = { ...nextSubmissions };
          const totalPlayers = liveLobby.hostOptOut
            ? Math.max(0, Object.keys(liveLobby.playersByUid || {}).length - 1)
            : Object.keys(liveLobby.playersByUid || {}).length;
          const completed = Object.keys(next).length >= totalPlayers;
          const nextLobby: LivePracticeLobby = {
            ...liveLobby,
            submissionsJson: JSON.stringify(next),
            status: completed ? "completed" : "in_progress",
          };
          setLiveLobby(nextLobby);
          upsertLocalLobby(liveLobby.code, nextLobby);
          const myAssignment = liveAssignments[userData.uid];
          if (myAssignment && liveMatchBundle) {
            await syncLiveGroupAccuracyToScoutingRows({
              bundle: liveMatchBundle,
              assignments: liveAssignments,
              submissions: next,
              groupIndex: myAssignment.groupIndex,
              matchKey: String(currentMatch.matchKey || ""),
              matchId: `${matchIdPrefix}${currentMatch.matchNumber}`,
              matchNumber: String(currentMatch.matchNumber || ""),
              alliance,
            });
          }
        } else {
          const response = await fetch("/api/live-lobbies", {
            method: "POST",
            headers: await authHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({
              action: "submit",
              code: liveLobby.code,
              uid: userData.uid,
              submissionJson: JSON.stringify(submissionPayload),
            }),
          });
          if (!response.ok) {
            const fail = (await response.json().catch(() => ({}))) as { error?: string };
            setLiveLobbyError(fail.error || "Could not submit live robot.");
          } else {
            const payload = (await response.json()) as { lobby?: LivePracticeLobby };
            if (payload.lobby) {
              setLiveLobby(payload.lobby);
              const myAssignment = liveAssignments[userData.uid];
              const parsedSubmissions = parseLobbyJson<Record<string, Record<string, unknown>>>(payload.lobby.submissionsJson, nextSubmissions);
              if (myAssignment && liveMatchBundle) {
                await syncLiveGroupAccuracyToScoutingRows({
                  bundle: liveMatchBundle,
                  assignments: liveAssignments,
                  submissions: parsedSubmissions,
                  groupIndex: myAssignment.groupIndex,
                  matchKey: String(currentMatch.matchKey || ""),
                  matchId: `${matchIdPrefix}${currentMatch.matchNumber}`,
                  matchNumber: String(currentMatch.matchNumber || ""),
                  alliance,
                });
              }
            }
          }
        }
      }

      setBreakCompletedRobotIndex(currentRobotIndex);
      setCurrentStep("break");
    } catch (error) {
      console.error("Error submitting live practice robot:", error);
      alert("Error submitting live practice robot: " + (error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function pausePracticeSession() {
    if (!currentMatch) return;
    savePracticeDraft({ currentStep: currentStep === "break" ? "break" : "practice" });
    router.push("/dashboard");
  }

  const difficultyModalOptions = useMemo<PracticeDifficultyModalOption[]>(() => {
    if (selectedDifficulty === "live" || !selectedDifficulty) return [];
    return candidateMatches.map((match) => {
      const matchLabel = getPracticeLabel(match);
      const teamLabel = (match.allianceTeams || []).join(", ");
      const { eventKey, eventName } = resolvePracticeEvent(match, activeMatchGame || "REEFSCAPE", teamEventCatalog);
      const resolvedEventName = eventName || eventKey || "Unknown Event";
      const resolvedEventKey = eventKey || "";
      const stage = getPracticeStage(match);
      const stageNumber = parsePracticeMatchNumber(match as { matchKey?: unknown; matchNumber?: unknown; setNumber?: unknown; compLevel?: unknown });
      const alliance = normalizeAllianceSide(match.alliance);
      return {
        id: match.id,
        label: matchLabel,
        eventName: resolvedEventName,
        eventKey: resolvedEventKey,
        teamLabel: teamLabel ? `Teams: ${teamLabel}` : "Teams: -",
        stage,
        stageNumber,
        alliance,
        progress: match.progress,
      };
    });
  }, [activeMatchGame, candidateMatches, selectedDifficulty, teamEventCatalog]);

  const lobbyMatchByBase = useMemo(() => {
    const map = new Map<string, { red?: CandidatePracticeMatch; blue?: CandidatePracticeMatch }>();
    lobbyMatchCandidates.forEach((match) => {
      const base = getPracticeBaseIdentity(match);
      const alliance = normalizeAllianceSide(match.alliance);
      if (!alliance) return;
      const bucket = map.get(base) || {};
      bucket[alliance] = match;
      map.set(base, bucket);
    });
    return map;
  }, [lobbyMatchCandidates]);

  const lobbyMatchOptions = useMemo<PracticeDifficultyModalOption[]>(() => {
    if (!activeMatchGame) return [];
    return lobbyMatchCandidates
      .filter((match) => {
        const base = getPracticeBaseIdentity(match);
        const siblings = lobbyMatchByBase.get(base);
        return Boolean(siblings?.red && siblings?.blue);
      })
      .map((match) => {
        const matchLabel = getPracticeLabel(match);
        const teamLabel = (match.allianceTeams || []).join(", ");
        const { eventKey, eventName } = resolvePracticeEvent(match, activeMatchGame || "REEFSCAPE", teamEventCatalog);
        const resolvedEventName = eventName || eventKey || "Unknown Event";
        const resolvedEventKey = eventKey || "";
        const stage = getPracticeStage(match);
        const stageNumber = parsePracticeMatchNumber(match as { matchKey?: unknown; matchNumber?: unknown; setNumber?: unknown; compLevel?: unknown });
        const alliance = normalizeAllianceSide(match.alliance);
        const score = getPracticeMatchScore(match);
        const difficulty = score !== null ? scoreToDifficulty(score) : "";
        return {
          id: match.id,
          label: matchLabel,
          eventName: resolvedEventName,
          eventKey: resolvedEventKey,
          teamLabel: teamLabel ? `Teams: ${teamLabel}` : "Teams: -",
          stage,
          stageNumber,
          alliance,
          progress: match.progress,
          difficulty,
        };
      });
  }, [activeMatchGame, lobbyMatchByBase, lobbyMatchCandidates, teamEventCatalog]);

  function continueLiveSoloSession() {
    if (!currentMatch) return;
    const selected = { ...currentMatch, progress: "fresh" as const } as CandidatePracticeMatch;
    startPracticeMatch(selected, { liveMode: true, robotIndex: 0, teamNumber: "" });
  }

  function handleDifficultyModalPick(matchId: string) {
    const picked = candidateMatches.find((match) => match.id === matchId);
    if (!picked) return;
    setShowDifficultyMatchModal(false);
    startPracticeMatch(picked);
  }

  function handleDifficultyModalRandomize(visibleIds: string[]) {
    const pool = candidateMatches.filter((match) => visibleIds.includes(match.id));
    if (pool.length === 0) return;
    const randomIndex = Math.floor(Math.random() * pool.length);
    const picked = pool[randomIndex];
    if (!picked) return;
    setShowDifficultyMatchModal(false);
    startPracticeMatch(picked);
  }

  async function openLobbyMatchPicker() {
    if (!activeMatchGame) return;
    const loaded = await loadLobbyMatchCandidates();
    if (loaded.length === 0) return;
    setShowLobbyMatchModal(true);
  }

  function handleLobbyMatchPick(matchId: string) {
    const picked = lobbyMatchCandidates.find((match) => match.id === matchId);
    if (!picked) return;
    const base = getPracticeBaseIdentity(picked);
    const siblings = lobbyMatchByBase.get(base);
    if (!siblings?.red || !siblings?.blue) {
      alert("Selected match needs both red and blue alliances for live practice.");
      return;
    }
    const score = getPracticeMatchScore(picked);
    const difficulty = score !== null ? scoreToDifficulty(score) : "";
    void updateLiveLobbySettings({
      selectedMatchId: picked.id,
      selectedMatchBase: base,
      selectedMatchLabel: getPracticeLabel(picked),
      selectedMatchDifficulty: difficulty,
    });
    setShowLobbyMatchModal(false);
  }

  function handleLobbyMatchRandomize(visibleIds: string[]) {
    const pool = lobbyMatchCandidates.filter((match) => visibleIds.includes(match.id));
    if (pool.length === 0) return;
    const randomIndex = Math.floor(Math.random() * pool.length);
    const picked = pool[randomIndex];
    if (!picked) return;
    handleLobbyMatchPick(picked.id);
  }

  const liveScopedCandidateMatches = useMemo(() => {
    if (selectedDifficulty !== "live") return candidateMatches;
    const scopedEventKey =
      String(liveEventKeyHint || "").trim().toLowerCase()
      || String(currentMatch ? getPracticeEventKey(currentMatch) : "").trim().toLowerCase();
    if (!scopedEventKey) return candidateMatches;
    const filtered = candidateMatches.filter(
      (match) => String(getPracticeEventKey(match) || "").trim().toLowerCase() === scopedEventKey
    );
    return filtered.length > 0 ? filtered : candidateMatches;
  }, [candidateMatches, currentMatch, liveEventKeyHint, selectedDifficulty]);

  const liveTbaScheduleById = useMemo(() => {
    if (selectedDifficulty !== "live" || liveTbaMatches.length === 0) return new Map<string, number>();
    const map = new Map<string, number>();
    buildReefscapeModalOptions(liveTbaMatches).forEach((option) => {
      const scheduleTime = Number(option.scheduleTime || 0);
      if (!Number.isFinite(scheduleTime) || scheduleTime <= 0) return;
      const existing = Number(map.get(option.id) || 0);
      if (existing <= 0 || scheduleTime < existing) {
        map.set(option.id, scheduleTime);
      }
    });
    return map;
  }, [liveTbaMatches, selectedDifficulty]);

  const sharedModalOptions = useMemo<PracticeSelectorOption[]>(() => {
    const byModalId = new Map<string, { match: CandidatePracticeMatch; scheduleTime: number }>();

    liveScopedCandidateMatches.forEach((match) => {
      const stage = getPracticeStage(match);
      const modalType: ReefscapeMatchOption["type"] =
        stage === "practice" ? "practice" : stage === "qualification" ? "qualification" : "finals";
      const bracketSlot = modalType === "finals"
        ? mapPlayoffToBracketSlot(match as { matchKey?: unknown; setNumber?: unknown; matchNumber?: unknown; compLevel?: unknown })
        : null;
      const parsedNumber =
        bracketSlot !== null
          ? bracketSlot
          : parsePracticeMatchNumber(match as { matchKey?: unknown; matchNumber?: unknown; setNumber?: unknown; compLevel?: unknown });
      const finalsKind = modalType === "finals" ? (bracketSlot !== null ? "bracket" : "series") : undefined;
      const modalId =
        modalType === "practice"
          ? `p${parsedNumber}`
          : modalType === "qualification"
          ? `q${parsedNumber}`
          : finalsKind === "bracket"
          ? `sf${parsedNumber}`
          : `f${parsedNumber}`;
      const matchData = match as unknown as Record<string, unknown>;
      const rawScheduleTime =
        Number(matchData.scheduleTime || 0)
        || Number(matchData.time || 0)
        || Number(matchData.predictedTime || 0)
        || Number(matchData.predicted_time || 0)
        || Number(matchData.actualTime || 0)
        || Number(matchData.actual_time || 0);
      const scheduleTime = Number.isFinite(rawScheduleTime) ? rawScheduleTime : 0;
      const existing = byModalId.get(modalId);
      if (!existing) {
        byModalId.set(modalId, { match, scheduleTime });
        return;
      }
      const existingTime = Number(existing.scheduleTime || 0);
      if (existingTime <= 0 && scheduleTime > 0) {
        byModalId.set(modalId, { match, scheduleTime });
        return;
      }
      if (existingTime > 0 && scheduleTime > 0 && scheduleTime < existingTime) {
        byModalId.set(modalId, { match, scheduleTime });
      }
    });

    return Array.from(byModalId.entries())
      .map(([id, row]) => {
        const match = row.match;
        const stage = getPracticeStage(match);
        const modalType: ReefscapeMatchOption["type"] =
          stage === "practice" ? "practice" : stage === "qualification" ? "qualification" : "finals";
        const number = parsePracticeMatchNumber(match as { matchKey?: unknown; matchNumber?: unknown; setNumber?: unknown; compLevel?: unknown });
        const bracketSlot = modalType === "finals"
          ? mapPlayoffToBracketSlot(match as { matchKey?: unknown; setNumber?: unknown; matchNumber?: unknown; compLevel?: unknown })
          : null;
        const finalsKind: ReefscapeMatchOption["finalsKind"] =
          modalType === "finals" ? (bracketSlot !== null ? "bracket" : "series") : undefined;
        const label =
          modalType === "practice"
            ? `Practice ${number}`
            : modalType === "qualification"
            ? `Qualification ${number}`
            : finalsKind === "series"
            ? `Finals ${number}`
            : `Match ${number}`;
        const liveOverride = selectedDifficulty === "live" ? Number(liveTbaScheduleById.get(id) || 0) : 0;
        const scheduleTime = liveOverride > 0 ? liveOverride : row.scheduleTime;
        return {
          id,
          label,
          type: modalType,
          matchNumber: number,
          scheduleTime,
          finalsKind,
          sourceId: match.id,
          progress: match.progress,
        };
      })
      .sort((a, b) => {
        const typeOrder: Record<ReefscapeMatchOption["type"], number> = { practice: 0, qualification: 1, finals: 2 };
        const typeDiff = typeOrder[a.type] - typeOrder[b.type];
        if (typeDiff !== 0) return typeDiff;
        return a.matchNumber - b.matchNumber;
      });
  }, [liveScopedCandidateMatches, liveTbaScheduleById, selectedDifficulty]);

  const sharedModalCompleted = useMemo(() => {
    if (selectedDifficulty !== "live") {
      return new Set(sharedModalOptions.filter((option) => option.progress === "complete").map((option) => option.id));
    }

    if (liveTbaMatches.length === 0) {
      return new Set<string>();
    }

    const completionNow = teamTimeOverride?.enabled ? getEffectiveNowSec(teamTimeOverride) : undefined;
    return buildCompletedModalIdsFromTba(liveTbaMatches, completionNow);
  }, [liveTbaMatches, selectedDifficulty, sharedModalOptions, teamTimeOverride?.enabled, teamTimeOverride?.offsetMs]);

  function handleSharedModalPick(option: PracticeSelectorOption) {
    const picked = liveScopedCandidateMatches.find((match) => match.id === option.sourceId);
    if (!picked) return;
    if (selectedDifficulty === "live") {
      setShowMatchSelectModal(false);
      startPracticeMatch(picked, { liveMode: true });
    }
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        {/* STEP 1: MODE & DIFFICULTY SELECTION */}
        {currentStep === 'select' && (
          <div className="p-4 md:p-8 max-w-4xl mx-auto">
            <h1 className="text-2xl md:text-3xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>
              Practice Scouting
            </h1>
            <p className="text-gray-600 mb-8">Improve your accuracy by practicing with real match footage.</p>
            {pendingDraft && (
              <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4">
                <h2 className="font-semibold text-amber-900 mb-1">Resume Saved Session?</h2>
                {(() => {
                  const inferredGame =
                    pendingDraft.selectedGame
                    || (String((pendingDraft.currentMatch as unknown as Record<string, unknown>)?.eventKey || "").toLowerCase() === REBUILT_WEEK0_EVENT_KEY
                        ? "REBUILT"
                        : "REEFSCAPE");
                  const completedCount =
                    inferredGame === "REBUILT"
                      ? pendingDraft.rebuiltRobotSessions?.length || 0
                      : pendingDraft.robotSessions?.length || 0;
                  return (
                <p className="text-sm text-amber-800 mb-3">
                  You have an unfinished practice session with {completedCount} completed robot
                  {completedCount === 1 ? "" : "s"}.
                </p>
                  );
                })()}
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => restorePracticeDraft(pendingDraft)}
                    className="px-4 py-2 rounded text-white font-semibold"
                    style={{ backgroundColor: "var(--primary-color)" }}
                  >
                    Resume Session
                  </button>
                  <button
                    onClick={() => {
                      clearPracticeDraft();
                      setPendingDraft(null);
                    }}
                    className="px-4 py-2 rounded border font-semibold"
                    style={{
                      borderColor: "rgba(var(--primary-rgb), 0.35)",
                      backgroundColor: "rgba(var(--primary-rgb), 0.06)",
                      color: "var(--primary-color)",
                    }}
                  >
                    Discard Saved Session
                  </button>
                </div>
              </div>
            )}

            {!activeMatchGame ? (
              <>
                <h2 className="text-xl font-semibold mb-4">Select Game</h2>
                <div className="grid md:grid-cols-2 gap-4 mb-8">
                  <button
                    onClick={() => setActiveMatchGame("REEFSCAPE")}
                    className="p-6 border-2 border-sky-300 rounded-lg text-left transition-colors hover:bg-sky-500/10"
                  >
                    <div className="text-sm font-semibold mb-2 text-sky-700">REEFSCAPE</div>
                    <h3 className="font-semibold text-lg mb-1">Scout REEFSCAPE</h3>
                    <p className="text-sm text-gray-600">Use REEFSCAPE practice videos and scoring.</p>
                  </button>
                  <button
                    onClick={() => setActiveMatchGame("REBUILT")}
                    className="p-6 border-2 rounded-lg text-left transition-colors hover:bg-emerald-500/10"
                    style={{ borderColor: "#059669" }}
                  >
                    <div className="text-sm font-semibold mb-2" style={{ color: "#047857" }}>REBUILT</div>
                    <h3 className="font-semibold text-lg mb-1">Scout REBUILT</h3>
                    <p className="text-sm text-gray-600">Use REBUILT practice videos and scoring.</p>
                  </button>
                </div>
              </>
            ) : !selectedMode ? (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-semibold">Select Mode</h2>
                  <button
                    onClick={() => {
                      setActiveMatchGame(null);
                      setSelectedMode(null);
                      setSelectedDifficulty(null);
                      setCandidateMatches([]);
                      setLiveVideoUrl("");
                      setShowMatchSelectModal(false);
                      setShowDifficultyMatchModal(false);
                      setShowLiveRobotModal(false);
                      setPendingLiveMatchPick(null);
                    }}
                    className="text-sm text-gray-600 hover:text-gray-800"
                  >
                    ← Change Game
                  </button>
                </div>
                <div className="grid md:grid-cols-2 gap-4 mb-8">
                  <button
                    onClick={() => setSelectedMode('trial')}
                    className="p-6 border-2 border-blue-300 rounded-lg text-left transition-colors"
                    style={{ backgroundColor: "transparent" }}
                    onMouseEnter={(event) => {
                      event.currentTarget.style.backgroundColor = "rgba(59, 130, 246, 0.14)";
                    }}
                    onMouseLeave={(event) => {
                      event.currentTarget.style.backgroundColor = "transparent";
                    }}
                  >
                    <div className="text-sm font-semibold mb-2 text-blue-700">TRIAL</div>
                    <h3 className="font-semibold text-lg mb-1">Trial Mode</h3>
                    <p className="text-sm text-gray-600 mb-2">For Learning</p>
                    <ul className="text-xs text-gray-500 space-y-1">
                      <li>• Video can be paused</li>
                      <li>• Practice at your own pace</li>
                      <li>• Separate leaderboard</li>
                    </ul>
                  </button>

                  <button
                    onClick={() => setSelectedMode('competitive')}
                    className="p-6 border-2 rounded-lg text-left transition-colors"
                    style={{ borderColor: "#c42221", backgroundColor: "transparent" }}
                    onMouseEnter={(event) => {
                      event.currentTarget.style.backgroundColor = "rgba(196, 34, 33, 0.12)";
                    }}
                    onMouseLeave={(event) => {
                      event.currentTarget.style.backgroundColor = "transparent";
                    }}
                  >
                    <div className="text-sm font-semibold mb-2" style={{ color: "#c42221" }}>COMP</div>
                    <h3 className="font-semibold text-lg mb-1">Competitive Mode</h3>
                    <p className="text-sm text-gray-600 mb-2">Test Your Skills</p>
                    <ul className="text-xs text-gray-500 space-y-1">
                      <li>• Video cannot be paused</li>
                      <li>• Real match conditions</li>
                      <li>• Separate leaderboard</li>
                    </ul>
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-semibold">Select Difficulty</h2>
                  <button
                    onClick={() => {
                      setSelectedMode(null);
                      setSelectedDifficulty(null);
                      setCandidateMatches([]);
                      setLiveVideoUrl("");
                      setShowMatchSelectModal(false);
                      setShowDifficultyMatchModal(false);
                      setShowLiveRobotModal(false);
                      setPendingLiveMatchPick(null);
                    }}
                    className="text-sm text-gray-600 hover:text-gray-800"
                  >
                    ← Change Mode
                  </button>
                </div>
                <div className={`grid gap-4 ${activeMatchGame === "REBUILT" ? "md:grid-cols-4" : "md:grid-cols-3"}`}>
                  <button
                    onClick={() => selectPracticeMatch('easy', selectedMode)}
                    disabled={loading}
                    className="p-6 border-2 border-green-300 rounded-lg text-left transition-colors disabled:opacity-50"
                    style={{ backgroundColor: "transparent" }}
                    onMouseEnter={(event) => {
                      event.currentTarget.style.backgroundColor = "rgba(34, 197, 94, 0.14)";
                    }}
                    onMouseLeave={(event) => {
                      event.currentTarget.style.backgroundColor = "transparent";
                    }}
                  >
                    <div className="text-sm font-semibold mb-2 text-green-700">EASY</div>
                    <h3 className="font-semibold text-lg mb-1">Easy</h3>
                    <p className="text-sm text-gray-600">Low-scoring matches</p>
                  </button>

                  <button
                    onClick={() => selectPracticeMatch('medium', selectedMode)}
                    disabled={loading}
                    className="p-6 border-2 border-yellow-300 rounded-lg text-left transition-colors disabled:opacity-50"
                    style={{ backgroundColor: "transparent" }}
                    onMouseEnter={(event) => {
                      event.currentTarget.style.backgroundColor = "rgba(234, 179, 8, 0.16)";
                    }}
                    onMouseLeave={(event) => {
                      event.currentTarget.style.backgroundColor = "transparent";
                    }}
                  >
                    <div className="text-sm font-semibold mb-2 text-yellow-700">MEDIUM</div>
                    <h3 className="font-semibold text-lg mb-1">Medium</h3>
                    <p className="text-sm text-gray-600">Average matches</p>
                  </button>

                  <button
                    onClick={() => selectPracticeMatch('hard', selectedMode)}
                    disabled={loading}
                    className="p-6 border-2 rounded-lg text-left transition-colors disabled:opacity-50"
                    style={{ borderColor: "#c42221", backgroundColor: "transparent" }}
                    onMouseEnter={(event) => {
                      event.currentTarget.style.backgroundColor = "rgba(196, 34, 33, 0.12)";
                    }}
                    onMouseLeave={(event) => {
                      event.currentTarget.style.backgroundColor = "transparent";
                    }}
                  >
                    <div className="text-sm font-semibold mb-2" style={{ color: "#c42221" }}>HARD</div>
                    <h3 className="font-semibold text-lg mb-1">Hard</h3>
                    <p className="text-sm text-gray-600">High-scoring matches</p>
                  </button>

                  {activeMatchGame === "REBUILT" && (
                    <button
                      onClick={() => void handleLiveCardClick()}
                      disabled={loading}
                      className="p-6 border-2 border-cyan-300 rounded-lg text-left transition-colors disabled:opacity-50"
                      style={{ backgroundColor: "transparent" }}
                      onMouseEnter={(event) => {
                        event.currentTarget.style.backgroundColor = "rgba(34, 211, 238, 0.12)";
                      }}
                      onMouseLeave={(event) => {
                        event.currentTarget.style.backgroundColor = "transparent";
                      }}
                    >
                      <div className="text-sm font-semibold mb-2 text-cyan-700">LIVE</div>
                      <h3 className="font-semibold text-lg mb-1">Live</h3>
                      <p className="text-sm text-gray-600">Paste stream URL and pick match manually</p>
                    </button>
                  )}
                </div>
                <div className="mt-6 rounded-xl border border-indigo-300 bg-indigo-500/5 shadow-md p-4">
                  <h3 className="font-semibold mb-1 text-indigo-800">Live Practice Lobby (Beta)</h3>
                  <p className="text-sm text-gray-700 mb-3">
                    Host or join a live room. Match starts are only allowed when participants are in multiples of 3.
                  </p>
                  {!liveLobby ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void createLiveLobby()}
                          disabled={liveLobbyBusy || !selectedMode || !activeMatchGame}
                          className="px-4 py-2 rounded text-white font-semibold disabled:opacity-50"
                          style={{ backgroundColor: "var(--primary-color)" }}
                        >
                          Host Lobby
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <input
                          type="text"
                          value={liveLobbyCodeInput}
                          onChange={(event) => setLiveLobbyCodeInput(event.target.value.toUpperCase())}
                          placeholder="Enter lobby code"
                          className="border rounded p-2 w-56"
                        />
                        <button
                          type="button"
                          onClick={() => void joinLiveLobby()}
                          disabled={liveLobbyBusy}
                          className="px-4 py-2 rounded border border-indigo-400 text-indigo-800 font-semibold disabled:opacity-50"
                        >
                          Join Lobby
                        </button>
                      </div>
                      {liveLobbyError && <p className="text-sm text-amber-700">{liveLobbyError}</p>}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm">
                        <span className="font-semibold">Code:</span> {liveLobby.code} •{" "}
                        <span className="font-semibold">Game:</span> {liveLobby.game} •{" "}
                        <span className="font-semibold">Mode:</span> {liveLobby.mode}
                      </p>
                      {liveLobby.id.startsWith("local:") && (
                        <p className="text-xs text-amber-700">Local-only lobby fallback (same browser/device). Share code is disabled across different devices.</p>
                      )}
                      <div className="rounded border border-gray-300 p-3 bg-gray-50 text-gray-900">
                        <p className="text-sm font-semibold mb-2 text-gray-900">Players ({liveLobbyPlayerCount})</p>
                        {liveLobby.hostOptOut && (
                          <p className="text-xs text-gray-600 mb-2">Participants: {liveLobbyParticipantCount} (host opted out)</p>
                        )}
                        <div className="grid sm:grid-cols-2 gap-1 text-sm text-gray-900">
                          {liveLobbyPlayers.map((player) => (
                            <p key={player.uid}>
                              {player.name}
                              {player.uid === liveLobby.hostId ? ` (Host${liveLobby.hostOptOut ? ", Opted Out" : ""})` : ""}
                            </p>
                          ))}
                        </div>
                      </div>
                      <p className={`text-sm font-semibold ${liveLobbyCanStart ? "text-green-700" : "text-amber-700"}`}>
                        {liveLobbyCanStart
                          ? "Ready: participant count is a multiple of 3."
                          : "Need participant count in multiples of 3 before starting."}
                      </p>
                      {userIsLiveLobbyHost && liveLobby.status === "waiting" && (
                        <div className="rounded border border-indigo-200 bg-indigo-50 p-3 space-y-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-900">Host Options</p>
                          <label className="flex items-start gap-2 text-sm text-indigo-900">
                            <input
                              type="checkbox"
                              checked={Boolean(liveLobby.hostOptOut)}
                              onChange={(event) => {
                                void updateLiveLobbySettings({ hostOptOut: event.target.checked });
                              }}
                              disabled={liveLobbyBusy}
                              className="mt-0.5"
                            />
                            <span>
                              Opt out of scouting (host is not assigned to a robot).
                            </span>
                          </label>
                          <label className="flex items-start gap-2 text-sm text-indigo-900">
                            <input
                              type="checkbox"
                              checked={Boolean(liveLobby.hostVideo)}
                              onChange={(event) => {
                                void updateLiveLobbySettings({ hostVideo: event.target.checked });
                              }}
                              disabled={liveLobbyBusy}
                              className="mt-0.5"
                            />
                            <span>
                              Host video (only the host sees the video; others get the form only).
                            </span>
                          </label>
                          <div className="border-t border-indigo-200 pt-3 space-y-2">
                            <p className="text-sm font-semibold text-indigo-900">Match Selection</p>
                            {liveLobby.selectedMatchLabel ? (
                              <div className="text-xs text-indigo-800 space-y-1">
                                <p>Selected: {liveLobby.selectedMatchLabel}</p>
                                {liveLobby.selectedMatchDifficulty && <p>Difficulty: {liveLobby.selectedMatchDifficulty}</p>}
                              </div>
                            ) : (
                              <p className="text-xs text-gray-700">No match selected. A random match will be chosen at start.</p>
                            )}
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => void openLobbyMatchPicker()}
                                disabled={liveLobbyBusy || lobbyMatchBusy}
                                className="px-3 py-1.5 rounded border border-indigo-400 text-indigo-800 text-xs font-semibold disabled:opacity-50"
                              >
                                {lobbyMatchBusy ? "Loading..." : liveLobby.selectedMatchLabel ? "Change Match" : "Select Match"}
                              </button>
                              {(liveLobby.selectedMatchId || liveLobby.selectedMatchBase) && (
                                <button
                                  type="button"
                                  onClick={() => void updateLiveLobbySettings({
                                    selectedMatchId: "",
                                    selectedMatchBase: "",
                                    selectedMatchLabel: "",
                                    selectedMatchDifficulty: "",
                                  })}
                                  disabled={liveLobbyBusy}
                                  className="px-3 py-1.5 rounded border border-gray-300 text-xs font-semibold disabled:opacity-50"
                                >
                                  Use Random
                                </button>
                              )}
                            </div>
                            {lobbyMatchError && <p className="text-xs text-amber-700">{lobbyMatchError}</p>}
                          </div>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {userIsLiveLobbyHost && liveLobby.status === "waiting" && (
                          <button
                            type="button"
                            onClick={() => void startLiveLobbySession()}
                            disabled={liveLobbyBusy || !liveLobbyCanStart}
                            className="px-4 py-2 rounded text-white font-semibold disabled:opacity-50"
                            style={{ backgroundColor: "var(--primary-color)" }}
                          >
                            Start Live Session
                          </button>
                        )}
                        {liveLobby.status === "in_progress" && (
                          <div className="w-full rounded border border-indigo-300 bg-indigo-500/10 p-3">
                            <p className="text-sm font-semibold text-indigo-900">
                              Live match started. One shared past match is assigned to all players.
                            </p>
                            {myLiveAssignment && (
                              <p className="text-sm text-indigo-900 mt-1">
                                Your assignment: {myLiveAssignment.alliance.toUpperCase()} alliance • Robot {myLiveAssignment.robotIndex + 1} • Team {myLiveAssignment.teamNumber || "-"}
                              </p>
                            )}
                            {liveRevealCountdown > 0 ? (
                              <p className="text-sm text-indigo-800 mt-1">Starting in {liveRevealCountdown}s...</p>
                            ) : (
                              <p className="text-sm text-indigo-800 mt-1">Match started. Complete your scout and submit.</p>
                            )}
                            <p className="text-sm text-indigo-800 mt-1">
                              Submitted: {liveSubmittedCount}/{liveLobbyParticipantCount}
                            </p>
                          </div>
                        )}
                        {liveLobby.status === "completed" && (
                          <div className="w-full rounded border border-green-300 bg-green-500/10 p-3 text-sm text-green-900">
                            Live round complete. Opening results...
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => void leaveLiveLobby()}
                          disabled={liveLobbyBusy}
                          className="px-4 py-2 rounded border border-gray-300 font-semibold disabled:opacity-50"
                        >
                          {userIsLiveLobbyHost ? "Close Lobby" : "Leave Lobby"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {currentStep === "live_reveal" && liveLobby && myLiveAssignment && (
          <div className="p-4 md:p-8 max-w-3xl mx-auto min-h-[calc(100vh-4rem)] flex items-center">
            <div className="w-full bg-white rounded-2xl shadow-md border border-gray-200 p-8">
              <h1 className="text-2xl md:text-3xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>
                Live Match Assignment
              </h1>
              <p className="text-gray-700 text-lg mb-6">
                Your team will start in {liveRevealCountdown}s.
              </p>
              <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 mb-4">
                <p className="font-semibold text-indigo-900 mb-2">Your Team ({myLiveTeamMembers.length}/3)</p>
                <div className="space-y-2">
                  {myLiveTeamMembers.map((row) => (
                    <div key={row.uid} className="flex items-center justify-between text-sm">
                      <span className="font-medium text-indigo-900">{row.name}{row.uid === userData?.uid ? " (You)" : ""}</span>
                      <span className="text-indigo-800">
                        {row.assignment.alliance.toUpperCase()} • Robot {row.assignment.robotIndex + 1} • Team {row.assignment.teamNumber || "-"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <p className="text-sm text-gray-600">
                One uniform match is assigned for the whole lobby. Submit once for your assigned robot.
              </p>
            </div>
          </div>
        )}

        {currentStep === 'break' && currentMatch && breakCompletedRobotIndex !== null && (
          <div className="p-4 md:p-8 max-w-3xl mx-auto min-h-[calc(100vh-4rem)] flex items-center">
            <div className="w-full bg-white rounded-2xl shadow-md border border-gray-200 p-8">
              <h1 className="text-2xl md:text-3xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>
                {selectedDifficulty === "live" ? "Submission Received" : `Robot ${breakCompletedRobotIndex + 1} Complete`}
              </h1>
              <p className="text-gray-700 text-lg mb-3">
                Team {selectedDifficulty === "live"
                  ? (activeMatchGame === "REBUILT" ? rebuiltFormData.teamNumber || "Unknown" : formData.teamNumber || "Unknown")
                  : currentMatch.allianceTeams[breakCompletedRobotIndex]} scouting is complete.
              </p>
              <p className="text-gray-600 mb-8">
                {selectedDifficulty === "live"
                  ? liveLobby
                    ? `Waiting for all participants to submit (${liveSubmittedCount}/${liveLobbyParticipantCount}).`
                    : "Ready for the next team. You can keep scouting or end the session."
                  : "Take a short break before the next robot, just like normal scouting rotations between matches."}
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                {selectedDifficulty !== "live" && (
                  <button
                    onClick={continueToNextRobot}
                    className="flex-1 py-3 rounded-lg text-white font-semibold"
                    style={{ backgroundColor: "var(--primary-color)" }}
                  >
                    {`Continue To Robot ${currentRobotIndex + 2} (Team ${currentMatch.allianceTeams[currentRobotIndex + 1]})`}
                  </button>
                )}
                {selectedDifficulty === "live" && !liveLobby && (
                  <button
                    onClick={continueLiveSoloSession}
                    className="flex-1 py-3 rounded-lg text-white font-semibold"
                    style={{ backgroundColor: "var(--primary-color)" }}
                  >
                    Next Team
                  </button>
                )}
                {selectedDifficulty !== "live" && (
                  <button
                    onClick={pausePracticeSession}
                    className="flex-1 py-3 rounded-lg border-2 border-blue-300 text-blue-700 font-semibold hover:bg-blue-50"
                  >
                    Pause Session
                  </button>
                )}
                <button
                  onClick={() => void endCurrentSession()}
                  className="flex-1 py-3 rounded-lg border-2 border-gray-300 font-semibold hover:bg-gray-50"
                >
                  End Session
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: PRACTICE SCOUTING */}
        {currentStep === 'practice' && currentMatch && (
          <div className={`h-screen flex flex-col ${hideLiveLobbyVideo ? "" : "md:flex-row"}`}>
            {/* VIDEO PLAYER */}
            {!hideLiveLobbyVideo && (
              <div className="shrink-0 bg-black md:flex md:flex-col md:flex-1">
                <div className="relative w-full aspect-video md:aspect-auto md:flex-1">
                  <iframe
                    key={`${currentMatch.id}-${currentRobotIndex}`}
                    ref={iframeRef}
                    src={getYouTubeEmbedUrl(currentMatch.videoUrl)}
                    className="w-full h-full"
                    allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                    title="Practice Match Video"
                    frameBorder="0"
                  />
                  {selectedMode === "competitive" && (
                    <div className="absolute inset-0 z-10" aria-hidden="true" />
                  )}
                </div>

                {/* Match Info */}
                <div className="hidden md:block bg-black bg-opacity-90 text-white p-4">
                <h3 className="font-semibold text-lg">
                  {getPracticeStageLabel(getPracticeStage({
                    matchType: currentMatch.matchType,
                    matchKey: currentMatch.matchKey,
                    compLevel: (currentMatch as unknown as Record<string, unknown>).compLevel,
                  }))} Match {parsePracticeMatchNumber({
                    matchKey: currentMatch.matchKey,
                    matchNumber: currentMatch.matchNumber,
                    setNumber: (currentMatch as unknown as Record<string, unknown>).setNumber,
                    compLevel: (currentMatch as unknown as Record<string, unknown>).compLevel,
                  })}
                </h3>
                <p className="text-sm">
                  {selectedDifficulty === "live"
                    ? `Robot ${currentRobotIndex + 1}${
                        activeMatchGame === "REBUILT"
                          ? rebuiltFormData.teamNumber
                            ? ` • Team ${rebuiltFormData.teamNumber}`
                            : ""
                          : formData.teamNumber
                          ? ` • Team ${formData.teamNumber}`
                          : ""
                      }`
                    : `Robot ${currentRobotIndex + 1} of 3 • Team ${currentMatch.allianceTeams[currentRobotIndex]}`}
                </p>
                <p className="text-sm capitalize">{currentMatch.alliance} Alliance • {selectedMode} Mode</p>
                {selectedDifficulty !== "live" && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowDifficultyMatchModal(true);
                    }}
                    className="mt-2 px-3 py-1 rounded text-sm text-white"
                    style={{ backgroundColor: "var(--primary-color)" }}
                  >
                    Change Match
                  </button>
                )}
                {selectedDifficulty === "live" && !liveLobby && (
                  <button
                    type="button"
                    onClick={() => {
                      void handleOpenLiveCorrection();
                    }}
                    className="mt-2 px-3 py-1 rounded text-sm text-white"
                    style={{ backgroundColor: "var(--primary-color)" }}
                  >
                    Correct Match / Robot
                  </button>
                )}
                {selectedMode === 'competitive' && (
                  <p className="text-xs mt-2 text-yellow-300">Video cannot be paused in competitive mode.</p>
                )}
                </div>
              </div>
            )}

            {/* SCOUTING FORM */}
            {showLiveLobbyForm ? (
              <>
              <div
                ref={formPaneRef}
                className={`w-full flex-1 min-h-0 overflow-y-auto bg-gray-100 p-4 space-y-4 ${
                  hideLiveLobbyVideo ? "" : "md:w-[22rem] md:flex-none"
                }`}
              >
                {hideLiveLobbyVideo && (
                  <div className="bg-indigo-50 border border-indigo-200 text-indigo-900 text-sm rounded-lg p-3">
                    Video is hosted by {liveLobby?.hostName || "the host"}. Use the shared screen and fill out your form here.
                  </div>
                )}
              {selectedDifficulty !== "live" && (
                <button
                  type="button"
                  onClick={() => {
                    setShowDifficultyMatchModal(true);
                  }}
                  className="w-full py-2 rounded border border-emerald-300 text-emerald-800 bg-emerald-50 hover:bg-emerald-100 font-semibold"
                >
                  Match Select ({String(selectedDifficulty).toUpperCase()})
                </button>
              )}
              {selectedDifficulty === "live" && !liveLobby && (
                <div className="bg-white rounded-lg p-3 space-y-2">
                  <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Live Controls</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        void handleOpenLiveCorrection();
                      }}
                      className="py-2 rounded border border-cyan-300 text-cyan-800 bg-cyan-50 hover:bg-cyan-100 font-semibold text-sm"
                    >
                      Correct Match
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        handleOpenCurrentLiveRobotPicker();
                      }}
                      className="py-2 rounded border border-indigo-300 text-indigo-800 bg-indigo-50 hover:bg-indigo-100 font-semibold text-sm"
                    >
                      Select Robot/Team
                    </button>
                  </div>
                </div>
              )}
              {selectedDifficulty !== "live" && (
                <div className="bg-white rounded-lg p-4">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-semibold">Progress</span>
                    <span className="text-sm text-gray-600">Robot {currentRobotIndex + 1}/3</span>
                  </div>
                  <div className="flex gap-2">
                    {[0, 1, 2].map(i => (
                      <div
                        key={i}
                        className={`flex-1 h-2 rounded ${
                          i < currentRobotIndex ? 'bg-green-500' :
                          i === currentRobotIndex ? 'bg-blue-500' :
                          'bg-gray-200'
                        }`}
                      />
                    ))}
                  </div>
                </div>
              )}

              {humanPlayerRobot === currentRobotIndex && (
                <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-4">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="ml-3">
                      <p className="text-sm font-medium text-yellow-800">
                        This match, include the <strong>Human Player</strong> score
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {activeMatchGame === "REEFSCAPE" ? (
                <>
              {/* PRE-MATCH INFO */}
              <div className="bg-white rounded-xl shadow p-4">
                <h2 className="text-lg font-semibold mb-4" style={{ color: "var(--primary-color)" }}>Pre-Match Info</h2>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Team Number</label>
                    {selectedDifficulty === "live" ? (
                      <input type="text" value={formData.teamNumber} disabled className="w-full border rounded p-2 bg-gray-100 text-gray-600" />
                    ) : (
                      <input type="text" value={formData.teamNumber} disabled className="w-full border rounded p-2 bg-gray-100 text-gray-600" />
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Starting Position</label>
                    <select value={formData.startingPosition} onChange={(e) => setFormData({ ...formData, startingPosition: e.target.value })} className="w-full border rounded p-2">
                      <option value="">Select Position</option>
                      <option value="Not There">Not There</option>
                      <option value="Processor Side">Processor Side</option>
                      <option value="Middle">Middle</option>
                      <option value="Opposite Side">Opposite Side</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* AUTONOMOUS */}
              <div className="bg-white rounded-xl shadow p-4">
                <h2 className="text-lg font-semibold mb-4" style={{ color: "var(--primary-color)" }}>Autonomous</h2>
                <label className="flex items-center gap-2 cursor-pointer mb-3">
                  <input type="checkbox" checked={formData.leftStartingZone} onChange={(e) => setFormData({ ...formData, leftStartingZone: e.target.checked })} className="w-4 h-4" />
                  <span className="text-sm font-medium text-gray-700">Left Starting Zone</span>
                </label>
                <div className="border-t pt-3">
                  <h3 className="font-semibold text-base mb-2">Auto Coral</h3>
                  <Counter label="Missed" value={formData.autoCoralMissed} onChange={(val) => setFormData({ ...formData, autoCoralMissed: val })} />
                  <Counter label="Level 1" value={formData.autoCoralL1} onChange={(val) => setFormData({ ...formData, autoCoralL1: val })} />
                  <Counter label="Level 2" value={formData.autoCoralL2} onChange={(val) => setFormData({ ...formData, autoCoralL2: val })} />
                  <Counter label="Level 3" value={formData.autoCoralL3} onChange={(val) => setFormData({ ...formData, autoCoralL3: val })} />
                  <Counter label="Level 4" value={formData.autoCoralL4} onChange={(val) => setFormData({ ...formData, autoCoralL4: val })} />
                </div>
                <div className="border-t pt-3 mt-3">
                  <h3 className="font-semibold text-base mb-2">Auto Algae Processor</h3>
                  <Counter label="Missed" value={formData.autoAlgaeProcessorMissed} onChange={(val) => setFormData({ ...formData, autoAlgaeProcessorMissed: val })} />
                  <Counter label="Scored" value={formData.autoAlgaeProcessorScored} onChange={(val) => setFormData({ ...formData, autoAlgaeProcessorScored: val })} />
                </div>
                <div className="border-t pt-3 mt-3">
                  <h3 className="font-semibold text-base mb-2">Auto Algae Net</h3>
                  <Counter label="Missed" value={formData.autoAlgaeNetMissed} onChange={(val) => setFormData({ ...formData, autoAlgaeNetMissed: val })} />
                  <Counter label="Scored" value={formData.autoAlgaeNetScored} onChange={(val) => setFormData({ ...formData, autoAlgaeNetScored: val })} />
                </div>
              </div>

              {/* TELEOP */}
              <div className="bg-white rounded-xl shadow p-4">
                <h2 className="text-lg font-semibold mb-4" style={{ color: "var(--primary-color)" }}>Teleop</h2>
                <div className="border-b pb-3">
                  <h3 className="font-semibold text-base mb-2">Teleop Coral</h3>
                  <Counter label="Missed" value={formData.teleopCoralMissed} onChange={(val) => setFormData({ ...formData, teleopCoralMissed: val })} />
                  <Counter label="Level 1" value={formData.teleopCoralL1} onChange={(val) => setFormData({ ...formData, teleopCoralL1: val })} />
                  <Counter label="Level 2" value={formData.teleopCoralL2} onChange={(val) => setFormData({ ...formData, teleopCoralL2: val })} />
                  <Counter label="Level 3" value={formData.teleopCoralL3} onChange={(val) => setFormData({ ...formData, teleopCoralL3: val })} />
                  <Counter label="Level 4" value={formData.teleopCoralL4} onChange={(val) => setFormData({ ...formData, teleopCoralL4: val })} />
                </div>
                <label className="flex items-center gap-2 cursor-pointer my-3">
                  <input type="checkbox" checked={formData.teleopAlgaeRemoved} onChange={(e) => setFormData({ ...formData, teleopAlgaeRemoved: e.target.checked })} className="w-4 h-4" />
                  <span className="text-sm font-medium text-gray-700">Removed Algae from Reef</span>
                </label>
                <div className="border-t pt-3">
                  <h3 className="font-semibold text-base mb-2">Teleop Processor</h3>
                  <Counter label="Missed" value={formData.teleopProcessorMissed} onChange={(val) => setFormData({ ...formData, teleopProcessorMissed: val })} />
                  <Counter label="Scored" value={formData.teleopProcessorScored} onChange={(val) => setFormData({ ...formData, teleopProcessorScored: val })} />
                </div>
                <div className="border-t pt-3 mt-3">
                  <h3 className="font-semibold text-base mb-2">Teleop Algae Net – Robot</h3>
                  <Counter label="Missed" value={formData.teleopNetRobotMissed} onChange={(val) => setFormData({ ...formData, teleopNetRobotMissed: val })} />
                  <Counter label="Scored" value={formData.teleopNetRobotScored} onChange={(val) => setFormData({ ...formData, teleopNetRobotScored: val })} />
                </div>
                <div className="border-t pt-3 mt-3">
                  <h3 className="font-semibold text-base mb-2">Teleop Algae Net – Human</h3>
                  <Counter label="Missed" value={formData.teleopNetHumanMissed} onChange={(val) => setFormData({ ...formData, teleopNetHumanMissed: val })} />
                  <Counter label="Scored" value={formData.teleopNetHumanScored} onChange={(val) => setFormData({ ...formData, teleopNetHumanScored: val })} />
                </div>
              </div>

              {/* ENDGAME */}
              <div className="bg-white rounded-xl shadow p-4">
                <h2 className="text-lg font-semibold mb-4" style={{ color: "var(--primary-color)" }}>Endgame</h2>
                <Counter label="Failed Climb" value={formData.failedClimb} onChange={(val) => setFormData({ ...formData, failedClimb: val })} />
                <div className="mt-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Stage Status</label>
                  <select value={formData.stageStatus} onChange={(e) => setFormData({ ...formData, stageStatus: e.target.value })} className="w-full border rounded p-2">
                    <option value="">Select Status</option>
                    <option value="None">None</option>
                    <option value="Parked">Parked</option>
                    <option value="Shallow">Shallow</option>
                    <option value="Deep">Deep</option>
                  </select>
                </div>
              </div>

              {/* GENERAL */}
              <div className="bg-white rounded-xl shadow p-4">
                <h2 className="text-lg font-semibold mb-4" style={{ color: "var(--primary-color)" }}>General</h2>
                <div className="space-y-2">
                  {['Died During Match', 'Never Started Match', 'Disabled by FRC', 'Recovered from Freeze', 'Tipped Over', 'Yellow Card', 'Red Card'].map((incident) => (
                    <label key={incident} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.incidents.includes(incident)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setFormData({ ...formData, incidents: [...formData.incidents, incident] });
                          } else {
                            setFormData({ ...formData, incidents: formData.incidents.filter(i => i !== incident) });
                          }
                        }}
                        className="w-4 h-4"
                      />
                      <span className="text-sm">{incident}</span>
                    </label>
                  ))}
                </div>
              </div>
                </>
              ) : (
                <>
                  <div className="bg-white rounded-xl shadow p-4">
                    <h2 className="text-lg font-semibold mb-4" style={{ color: "var(--primary-color)" }}>Pre-Match Info</h2>
                    <div className="space-y-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Team Number</label>
                        {selectedDifficulty === "live" ? (
                          <input type="text" value={rebuiltFormData.teamNumber} disabled className="w-full border rounded p-2 bg-gray-100 text-gray-600" />
                        ) : (
                          <input type="text" value={rebuiltFormData.teamNumber} disabled className="w-full border rounded p-2 bg-gray-100 text-gray-600" />
                        )}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Starting Position</label>
                        <select
                          value={rebuiltFormData.startingPosition}
                          onChange={(e) => setRebuiltFormData({ ...rebuiltFormData, startingPosition: e.target.value })}
                          className="w-full border rounded p-2"
                        >
                          <option value="">Select Position</option>
                          <option value="outpost-side">Outpost Side</option>
                          <option value="middle">Middle</option>
                          <option value="depot-side">Depot Side</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-xl shadow p-4">
                    <h2 className="text-lg font-semibold mb-4" style={{ color: "var(--primary-color)" }}>Autonomous</h2>
                    <div className="space-y-3">
                      <label className="block text-sm font-medium text-gray-700">
                        Preload Capacity ({PRELOAD_LABELS[Math.max(0, Math.min(4, rebuiltFormData.autoPreloadScale))]})
                      </label>
                      <input
                        type="range"
                        min={0}
                        max={4}
                        value={rebuiltFormData.autoPreloadScale}
                        onChange={(e) => setRebuiltFormData({ ...rebuiltFormData, autoPreloadScale: Number(e.target.value) })}
                        className="w-full"
                      />
                      <label className="block text-sm font-medium text-gray-700">
                        Balls Per Second ({BPS_LABELS[Math.max(0, Math.min(BPS_MAX, rebuiltFormData.autoBpsScale))]})
                      </label>
                      <input
                        type="range"
                        min={0}
                        max={BPS_MAX}
                        value={rebuiltFormData.autoBpsScale}
                        onChange={(e) => setRebuiltFormData({ ...rebuiltFormData, autoBpsScale: Number(e.target.value) })}
                        className="w-full"
                      />
                      <label className="block text-sm font-medium text-gray-700">
                        Carrying Capacity ({CARRY_LABELS[Math.max(0, Math.min(CARRY_MAX, rebuiltFormData.autoCarryScale))]})
                      </label>
                      <input
                        type="range"
                        min={0}
                        max={CARRY_MAX}
                        value={rebuiltFormData.autoCarryScale}
                        onChange={(e) => setRebuiltFormData({ ...rebuiltFormData, autoCarryScale: Number(e.target.value) })}
                        className="w-full"
                      />
                      <RebuiltCycleTimer
                        title="Auto Cycle Timer"
                        values={rebuiltFormData.autoCycles}
                        onAdd={(value) => setRebuiltFormData({ ...rebuiltFormData, autoCycles: [...rebuiltFormData.autoCycles, value] })}
                        onDelete={(index) =>
                          setRebuiltFormData({
                            ...rebuiltFormData,
                            autoCycles: rebuiltFormData.autoCycles.filter((_, i) => i !== index),
                          })
                        }
                      />
                      <h3 className="text-sm font-semibold text-gray-700">Counter Override</h3>
                      <Counter
                        label="Scored Fuel"
                        value={rebuiltFormData.autoCounterOverride}
                        onChange={(value) => setRebuiltFormData({ ...rebuiltFormData, autoCounterOverride: value })}
                      />
                      <Counter
                        label="Missed Fuel"
                        value={rebuiltFormData.autoCounterMissedFuel}
                        onChange={(value) => setRebuiltFormData({ ...rebuiltFormData, autoCounterMissedFuel: value })}
                      />
                      <h3 className="text-sm font-semibold text-gray-700">Human Player</h3>
                      <Counter
                        label="Scored Fuel"
                        value={rebuiltFormData.autoHumanPlayerFuel}
                        onChange={(value) => setRebuiltFormData({ ...rebuiltFormData, autoHumanPlayerFuel: value })}
                      />
                      <Counter
                        label="Failed Climb"
                        value={rebuiltFormData.autoFailedClimb}
                        onChange={(value) => setRebuiltFormData({ ...rebuiltFormData, autoFailedClimb: value })}
                      />
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={rebuiltFormData.autoSuccessfulClimb}
                          onChange={(e) => setRebuiltFormData({ ...rebuiltFormData, autoSuccessfulClimb: e.target.checked })}
                          className="w-4 h-4"
                        />
                        <span className="text-sm font-medium text-gray-700">Successful Auto Climb</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={rebuiltFormData.wonAuto}
                          onChange={(e) => setRebuiltFormData({ ...rebuiltFormData, wonAuto: e.target.checked })}
                          className="w-4 h-4"
                        />
                        <span className="text-sm font-medium text-gray-700">Won Auto</span>
                      </label>
                    </div>
                  </div>

                  <div className="bg-white rounded-xl shadow p-4">
                    <h2 className="text-lg font-semibold mb-4" style={{ color: "var(--primary-color)" }}>Teleoperated</h2>
                    <div className="space-y-3">
                      <label className="block text-sm font-medium text-gray-700">
                        Balls Per Second ({BPS_LABELS[Math.max(0, Math.min(BPS_MAX, rebuiltFormData.teleBpsScale))]})
                      </label>
                      <input
                        type="range"
                        min={0}
                        max={BPS_MAX}
                        value={rebuiltFormData.teleBpsScale}
                        onChange={(e) => setRebuiltFormData({ ...rebuiltFormData, teleBpsScale: Number(e.target.value) })}
                        className="w-full"
                      />
                      <label className="block text-sm font-medium text-gray-700">
                        Carrying Capacity ({CARRY_LABELS[Math.max(0, Math.min(CARRY_MAX, rebuiltFormData.teleCarryScale))]})
                      </label>
                      <input
                        type="range"
                        min={0}
                        max={CARRY_MAX}
                        value={rebuiltFormData.teleCarryScale}
                        onChange={(e) => setRebuiltFormData({ ...rebuiltFormData, teleCarryScale: Number(e.target.value) })}
                        className="w-full"
                      />
                      <RebuiltCycleTimer
                        title="Transition Shift"
                        values={rebuiltFormData.transitionCycles}
                        onAdd={(value) => setRebuiltFormData({ ...rebuiltFormData, transitionCycles: [...rebuiltFormData.transitionCycles, value] })}
                        onDelete={(index) =>
                          setRebuiltFormData({
                            ...rebuiltFormData,
                            transitionCycles: rebuiltFormData.transitionCycles.filter((_, i) => i !== index),
                          })
                        }
                      />
                      <h3 className="text-sm font-semibold text-gray-700">Counter Override</h3>
                      <Counter
                        label="Scored Fuel"
                        value={rebuiltFormData.transitionCounterOverride}
                        onChange={(value) => setRebuiltFormData({ ...rebuiltFormData, transitionCounterOverride: value })}
                      />
                      <Counter
                        label="Missed Fuel"
                        value={rebuiltFormData.transitionCounterMissedFuel}
                        onChange={(value) => setRebuiltFormData({ ...rebuiltFormData, transitionCounterMissedFuel: value })}
                      />
                      <p className="text-xs text-gray-600">
                        Counted shifts right now: Transition + {rebuiltFormData.wonAuto ? "Shift 2 + Shift 4" : "Shift 1 + Shift 3"}.
                      </p>
                      <RebuiltCycleTimer
                        title={`Shift 1 ${rebuiltFormData.wonAuto ? "(Not Counted)" : "(Counted)"}`}
                        values={rebuiltFormData.shift1Cycles}
                        onAdd={(value) => setRebuiltFormData({ ...rebuiltFormData, shift1Cycles: [...rebuiltFormData.shift1Cycles, value] })}
                        onDelete={(index) =>
                          setRebuiltFormData({
                            ...rebuiltFormData,
                            shift1Cycles: rebuiltFormData.shift1Cycles.filter((_, i) => i !== index),
                          })
                        }
                      />
                      <h3 className="text-sm font-semibold text-gray-700">Counter Override</h3>
                      <Counter
                        label="Scored Fuel"
                        value={rebuiltFormData.shift1CounterOverride}
                        onChange={(value) => setRebuiltFormData({ ...rebuiltFormData, shift1CounterOverride: value })}
                      />
                      <Counter
                        label="Missed Fuel"
                        value={rebuiltFormData.shift1CounterMissedFuel}
                        onChange={(value) => setRebuiltFormData({ ...rebuiltFormData, shift1CounterMissedFuel: value })}
                      />
                      <RebuiltCycleTimer
                        title={`Shift 2 ${rebuiltFormData.wonAuto ? "(Counted)" : "(Not Counted)"}`}
                        values={rebuiltFormData.shift2Cycles}
                        onAdd={(value) => setRebuiltFormData({ ...rebuiltFormData, shift2Cycles: [...rebuiltFormData.shift2Cycles, value] })}
                        onDelete={(index) =>
                          setRebuiltFormData({
                            ...rebuiltFormData,
                            shift2Cycles: rebuiltFormData.shift2Cycles.filter((_, i) => i !== index),
                          })
                        }
                      />
                      <h3 className="text-sm font-semibold text-gray-700">Counter Override</h3>
                      <Counter
                        label="Scored Fuel"
                        value={rebuiltFormData.shift2CounterOverride}
                        onChange={(value) => setRebuiltFormData({ ...rebuiltFormData, shift2CounterOverride: value })}
                      />
                      <Counter
                        label="Missed Fuel"
                        value={rebuiltFormData.shift2CounterMissedFuel}
                        onChange={(value) => setRebuiltFormData({ ...rebuiltFormData, shift2CounterMissedFuel: value })}
                      />
                      <RebuiltCycleTimer
                        title={`Shift 3 ${rebuiltFormData.wonAuto ? "(Not Counted)" : "(Counted)"}`}
                        values={rebuiltFormData.shift3Cycles}
                        onAdd={(value) => setRebuiltFormData({ ...rebuiltFormData, shift3Cycles: [...rebuiltFormData.shift3Cycles, value] })}
                        onDelete={(index) =>
                          setRebuiltFormData({
                            ...rebuiltFormData,
                            shift3Cycles: rebuiltFormData.shift3Cycles.filter((_, i) => i !== index),
                          })
                        }
                      />
                      <h3 className="text-sm font-semibold text-gray-700">Counter Override</h3>
                      <Counter
                        label="Scored Fuel"
                        value={rebuiltFormData.shift3CounterOverride}
                        onChange={(value) => setRebuiltFormData({ ...rebuiltFormData, shift3CounterOverride: value })}
                      />
                      <Counter
                        label="Missed Fuel"
                        value={rebuiltFormData.shift3CounterMissedFuel}
                        onChange={(value) => setRebuiltFormData({ ...rebuiltFormData, shift3CounterMissedFuel: value })}
                      />
                      <RebuiltCycleTimer
                        title={`Shift 4 ${rebuiltFormData.wonAuto ? "(Counted)" : "(Not Counted)"}`}
                        values={rebuiltFormData.shift4Cycles}
                        onAdd={(value) => setRebuiltFormData({ ...rebuiltFormData, shift4Cycles: [...rebuiltFormData.shift4Cycles, value] })}
                        onDelete={(index) =>
                          setRebuiltFormData({
                            ...rebuiltFormData,
                            shift4Cycles: rebuiltFormData.shift4Cycles.filter((_, i) => i !== index),
                          })
                        }
                      />
                      <h3 className="text-sm font-semibold text-gray-700">Counter Override</h3>
                      <Counter
                        label="Scored Fuel"
                        value={rebuiltFormData.shift4CounterOverride}
                        onChange={(value) => setRebuiltFormData({ ...rebuiltFormData, shift4CounterOverride: value })}
                      />
                      <Counter
                        label="Missed Fuel"
                        value={rebuiltFormData.shift4CounterMissedFuel}
                        onChange={(value) => setRebuiltFormData({ ...rebuiltFormData, shift4CounterMissedFuel: value })}
                      />
                      <h3 className="text-sm font-semibold text-gray-700">Human Player</h3>
                      <Counter
                        label="Scored Fuel"
                        value={rebuiltFormData.teleopHumanPlayerFuel}
                        onChange={(value) => setRebuiltFormData({ ...rebuiltFormData, teleopHumanPlayerFuel: value })}
                      />
                    </div>
                  </div>

                  <div className="bg-white rounded-xl shadow p-4">
                    <h2 className="text-lg font-semibold mb-4" style={{ color: "var(--primary-color)" }}>Endgame</h2>
                    <RebuiltCycleTimer
                      title="Endgame Cycle Timer"
                      values={rebuiltFormData.endgameCycles}
                      onAdd={(value) => setRebuiltFormData({ ...rebuiltFormData, endgameCycles: [...rebuiltFormData.endgameCycles, value] })}
                      onDelete={(index) =>
                        setRebuiltFormData({
                          ...rebuiltFormData,
                          endgameCycles: rebuiltFormData.endgameCycles.filter((_, i) => i !== index),
                        })
                      }
                    />
                    <h3 className="text-sm font-semibold text-gray-700">Counter Override</h3>
                    <Counter
                      label="Scored Fuel"
                      value={rebuiltFormData.endgameCounterOverride}
                      onChange={(value) => setRebuiltFormData({ ...rebuiltFormData, endgameCounterOverride: value })}
                    />
                    <Counter
                      label="Missed Fuel"
                      value={rebuiltFormData.endgameCounterMissedFuel}
                      onChange={(value) => setRebuiltFormData({ ...rebuiltFormData, endgameCounterMissedFuel: value })}
                    />
                    <h3 className="text-sm font-semibold text-gray-700">Human Player</h3>
                    <Counter
                      label="Scored Fuel"
                      value={rebuiltFormData.endgameHumanPlayerFuel}
                      onChange={(value) => setRebuiltFormData({ ...rebuiltFormData, endgameHumanPlayerFuel: value })}
                    />
                    <Counter
                      label="Failed Climb"
                      value={rebuiltFormData.endgameFailedClimb}
                      onChange={(value) => setRebuiltFormData({ ...rebuiltFormData, endgameFailedClimb: value })}
                    />
                    <label className="block text-sm font-medium text-gray-700 mb-1">Status At End of Match</label>
                    <select
                      value={rebuiltFormData.endgameStatus}
                      onChange={(e) => setRebuiltFormData({ ...rebuiltFormData, endgameStatus: e.target.value })}
                      className="w-full border rounded p-2"
                    >
                      <option value="">Select Status</option>
                      <option value="parked">Parked</option>
                      <option value="level-1">Level 1</option>
                      <option value="level-2">Level 2</option>
                      <option value="level-3">Level 3</option>
                    </select>
                  </div>

                  <div className="bg-white rounded-xl shadow p-4">
                    <h2 className="text-lg font-semibold mb-4" style={{ color: "var(--primary-color)" }}>General</h2>
                    <div className="space-y-2">
                      {['Died During Match', 'Never Started Match', 'Disabled by FRC', 'Recovered from Freeze', 'Tipped Over', 'Yellow Card', 'Red Card'].map((incident) => (
                        <label key={incident} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={rebuiltFormData.incidents.includes(incident)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setRebuiltFormData({ ...rebuiltFormData, incidents: [...rebuiltFormData.incidents, incident] });
                              } else {
                                setRebuiltFormData({ ...rebuiltFormData, incidents: rebuiltFormData.incidents.filter(i => i !== incident) });
                              }
                            }}
                            className="w-4 h-4"
                          />
                          <span className="text-sm">{incident}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* SUBMIT BUTTON */}
              <div className="sticky bottom-0 bg-gray-100 pt-4 pb-2 space-y-2">
                <button
                  onClick={submitCurrentRobot}
                  disabled={loading}
                  className="w-full py-3 rounded-lg text-white font-semibold disabled:opacity-50"
                  style={{ backgroundColor: "var(--primary-color)" }}
                >
                  {loading
                    ? "Submitting..."
                    : selectedDifficulty === "live"
                    ? "Submit Robot"
                    : currentRobotIndex === 2
                    ? "Finish Session"
                    : `Next Robot (${currentRobotIndex + 2}/3)`}
                </button>
                <button
                  onClick={() => void endCurrentSession()}
                  className="w-full py-2 rounded-lg border-2 border-gray-300 font-semibold hover:bg-gray-50"
                >
                  {selectedDifficulty === "live" ? "End Session" : "Cancel"}
                </button>
              </div>
            </div>

            {/* NOTES TOGGLE BUTTON */}
            <button
              onClick={() => setNotesOpen(!notesOpen)}
              className="hidden md:block fixed right-0 top-1/2 -translate-y-1/2 bg-red-600 text-white px-2 py-8 rounded-l-lg shadow-lg hover:bg-red-700 z-10"
            >
              {notesOpen ? <ChevronRight /> : <ChevronLeft />}
            </button>

            {/* NOTES PANEL */}
            <div className={`bg-white shadow-xl transition-all duration-300 overflow-y-auto ${notesOpen ? 'w-80' : 'w-0'} hidden md:block`}>
              {notesOpen && (
                <div className="p-4">
                  <h2 className="text-lg font-semibold mb-4" style={{ color: "var(--primary-color)" }}>Notes</h2>
                  <textarea
                    value={activeMatchGame === "REBUILT" ? rebuiltFormData.notes : formData.notes}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (activeMatchGame === "REBUILT") {
                        setRebuiltFormData({ ...rebuiltFormData, notes: value });
                      } else {
                        setFormData({ ...formData, notes: value });
                      }
                    }}
                    className="w-full border rounded p-2 h-96"
                    placeholder="Optional notes..."
                  />
                </div>
              )}
            </div>

            {/* MOBILE STICKY NOTES */}
            <button
              onClick={() => setMobileNotesOpen(true)}
              className="md:hidden fixed right-2 top-1/2 -translate-y-1/2 bg-red-600 text-white px-2 py-5 rounded-l-lg shadow-lg z-30"
              aria-label="Open notes"
            >
              <ChevronLeft />
            </button>
            {mobileNotesOpen && (
              <div className="md:hidden fixed inset-0 z-40">
                <button
                  className="absolute inset-0 bg-black/40"
                  onClick={() => setMobileNotesOpen(false)}
                  aria-label="Close notes overlay"
                />
                <div className="absolute bottom-0 left-0 right-0 h-[38vh] min-h-[220px] max-h-[45vh] bg-white shadow-2xl rounded-t-2xl overflow-y-auto">
                  <div className="sticky top-0 z-10 bg-white border-b p-3 flex items-center justify-between">
                    <h2 className="text-base font-semibold" style={{ color: "var(--primary-color)" }}>Notes</h2>
                    <button
                      onClick={() => setMobileNotesOpen(false)}
                      className="p-1 rounded hover:bg-gray-100"
                      aria-label="Close notes"
                    >
                      <X size={18} />
                    </button>
                  </div>
                  <div className="p-3">
                    <textarea
                      value={activeMatchGame === "REBUILT" ? rebuiltFormData.notes : formData.notes}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (activeMatchGame === "REBUILT") {
                          setRebuiltFormData({ ...rebuiltFormData, notes: value });
                        } else {
                          setFormData({ ...formData, notes: value });
                        }
                      }}
                      className="w-full border rounded p-2 h-[26vh] min-h-[140px]"
                      placeholder="Optional notes..."
                    />
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="w-full flex-1 min-h-0 overflow-y-auto bg-gray-100 p-6">
            <div className="max-w-xl mx-auto bg-white rounded-xl border border-gray-200 p-6 text-center text-gray-700">
              <h2 className="text-lg font-semibold mb-2">Hosting Only</h2>
              <p className="text-sm">
                You opted out of scouting for this lobby. Keep the video running for the team.
              </p>
            </div>
          </div>
        )}
          </div>
        )}

        {/* STEP 3: RESULTS */}
        {currentStep === 'results' && selectedDifficulty === "live" && (
          <div className="p-4 md:p-8 max-w-4xl mx-auto">
            <h1 className="text-2xl md:text-3xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>
              Live Round Complete
            </h1>
            <p className="text-gray-600 mb-8">All players submitted. Team accuracy and leaderboard are ready.</p>

            <div className="bg-white rounded-xl shadow-md p-8 mb-6 text-center">
              <h2 className="text-xl font-semibold mb-2">Your Team Accuracy</h2>
              <div className="text-6xl font-bold mb-4" style={{ color: (liveTeamAccuracy || 0) >= 90 ? "#22c55e" : (liveTeamAccuracy || 0) >= 75 ? "#eab308" : "#ef4444" }}>
                {liveTeamAccuracy !== null ? `${liveTeamAccuracy}%` : "-"}
              </div>
              <p className="text-gray-600">Calculated from your 3-player team on one alliance.</p>
            </div>

            <div className="bg-white rounded-xl shadow-md p-8 mb-6">
              <h2 className="text-xl font-semibold mb-4">Accuracy Leaderboard</h2>
              {liveLeaderboard.length === 0 ? (
                <p className="text-gray-600">No completed teams yet.</p>
              ) : (
                <div className="space-y-2">
                  {liveLeaderboard.map((row, index) => (
                    <div key={`${row.team}-${index}`} className="flex items-center justify-between rounded border border-gray-200 px-4 py-3">
                      <p className="font-semibold">{index + 1}. {row.team}</p>
                      <p className="font-bold">{row.accuracy}%</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-4">
              <button onClick={resetPractice} className="flex-1 py-3 rounded-lg text-white font-semibold" style={{ backgroundColor: "var(--primary-color)" }}>
                Back To Lobby
              </button>
            </div>
          </div>
        )}
        {currentStep === 'results' && selectedDifficulty !== "live" && sessionResults && (
          <div className="p-4 md:p-8 max-w-4xl mx-auto">
            <h1 className="text-2xl md:text-3xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>
              Practice Complete!
            </h1>
            <p className="text-gray-600 mb-8">You&apos;ve completed all 3 robots. Here&apos;s your score:</p>

            <div className="bg-white rounded-xl shadow-md p-8 mb-6 text-center">
              <div className="inline-block px-4 py-1 bg-blue-100 text-blue-800 rounded-full text-sm mb-4">
                {selectedMode === 'trial' ? 'Trial Mode' : 'Competitive Mode'}
              </div>
              <h2 className="text-xl font-semibold mb-2">Your Accuracy</h2>
              <div className="text-6xl font-bold mb-4" style={{ color: sessionResults.accuracy >= 90 ? "#22c55e" : sessionResults.accuracy >= 75 ? "#eab308" : "#ef4444" }}>
                {sessionResults.accuracy}%
              </div>
              <p className="text-gray-600">Based on total alliance score from all 3 robots</p>
            </div>

            <div className="bg-white rounded-xl shadow-md p-8 mb-6">
              <h2 className="text-xl font-semibold mb-4">Score Comparison</h2>
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h3 className="font-semibold mb-2">Your Scouted Score</h3>
                  <p className="text-4xl font-bold" style={{ color: "var(--primary-color)" }}>{sessionResults.scoutedScore}</p>
                </div>
                <div>
                  <h3 className="font-semibold mb-2">Actual Score</h3>
                  <p className="text-4xl font-bold text-gray-700">{sessionResults.officialScore}</p>
                </div>
              </div>
            </div>

            <div className="flex gap-4">
              <button onClick={resetPractice} className="flex-1 py-3 rounded-lg text-white font-semibold" style={{ backgroundColor: "var(--primary-color)" }}>
                Practice Again
              </button>
              <button onClick={() => router.push("/match-scout-dashboard")} className="flex-1 py-3 rounded-lg border-2 border-gray-300 font-semibold hover:bg-gray-50">
                Dashboard
              </button>
            </div>
          </div>
        )}
        {showLiveLinkModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => setShowLiveLinkModal(false)}
            />
            <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-xl p-6">
              <h2 className="text-xl font-semibold mb-2" style={{ color: "var(--primary-color)" }}>
                Start Live Practice
              </h2>
              <p className="text-sm text-gray-600 mb-4">
                Paste a live stream URL to load a live practice match.
              </p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleStartLiveFromLink();
                }}
                className="space-y-4"
              >
                <input
                  type="url"
                  value={liveVideoUrl}
                  onChange={(event) => setLiveVideoUrl(event.target.value)}
                  placeholder="https://youtube.com/live/..."
                  className="w-full border rounded p-2"
                  autoFocus
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowLiveLinkModal(false)}
                    className="px-4 py-2 rounded border border-gray-300 font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-4 py-2 rounded text-white font-semibold disabled:opacity-50"
                    style={{ backgroundColor: "var(--primary-color)" }}
                  >
                    Continue
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
        {showLiveRobotModal && pendingLiveMatchPick && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => {
                setShowLiveRobotModal(false);
                setPendingLiveMatchPick(null);
              }}
            />
            <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-xl p-6">
              <h2 className="text-xl font-semibold mb-2" style={{ color: "var(--primary-color)" }}>
                Select Robot To Scout
              </h2>
              <p className="text-sm text-gray-600 mb-4">
                {pendingLiveMatchPick.stageLabel} Match {pendingLiveMatchPick.matchNumber}
              </p>
              <div className="space-y-4">
                {([
                  { key: "red", label: "Red Alliance", options: pendingLiveMatchPick.red },
                  { key: "blue", label: "Blue Alliance", options: pendingLiveMatchPick.blue },
                ] as const).map((section) => {
                  if (section.options.length === 0) return null;
                  return (
                    <div key={section.key}>
                      <p className={`text-xs font-semibold uppercase tracking-wide mb-2 ${section.key === "red" ? "text-red-700" : "text-blue-700"}`}>
                        {section.label}
                      </p>
                      <div className="space-y-2">
                        {section.options.map((option) => {
                          const teamNumber = option.teamNumber || "-";
                          const teamName = liveEventTeamNameMap[teamNumber] || "";
                          return (
                            <button
                              key={`live-robot-${section.key}-${option.robotIndex}-${teamNumber}`}
                              type="button"
                              onClick={() => handleSelectLiveRobot(option)}
                              className="w-full text-left px-4 py-3 rounded border border-gray-300 hover:bg-gray-50"
                            >
                              <span className="font-semibold">Robot {option.robotIndex + 1}</span>
                              <span className="text-gray-600"> - Team {teamNumber}{teamName ? ` (${teamName})` : ""}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-end mt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowLiveRobotModal(false);
                    setPendingLiveMatchPick(null);
                  }}
                  className="px-4 py-2 rounded border border-gray-300 font-semibold"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
        <ReefscapeMatchSelectModal
          open={showMatchSelectModal && selectedDifficulty === "live"}
          onClose={() => setShowMatchSelectModal(false)}
          options={sharedModalOptions}
          completed={sharedModalCompleted}
          onPick={handleSharedModalPick}
        />
        <PracticeDifficultyMatchModal
          open={showLobbyMatchModal}
          onClose={() => setShowLobbyMatchModal(false)}
          difficulty="easy"
          titleOverride="Lobby Match Select"
          options={lobbyMatchOptions}
          onPick={handleLobbyMatchPick}
          onRandomize={handleLobbyMatchRandomize}
          showDifficultyFilters
          difficultyFilter={lobbyMatchDifficultyFilter}
          onDifficultyFilterChange={setLobbyMatchDifficultyFilter}
        />
        <PracticeDifficultyMatchModal
          open={showDifficultyMatchModal && selectedDifficulty !== "live" && selectedDifficulty !== null}
          onClose={() => setShowDifficultyMatchModal(false)}
          difficulty={(selectedDifficulty && selectedDifficulty !== "live" ? selectedDifficulty : "easy")}
          options={difficultyModalOptions}
          onPick={handleDifficultyModalPick}
          onRandomize={handleDifficultyModalRandomize}
        />
      </div>
    </div>
  );
}

export default function PracticeScouting() {
  return (
    <ProtectedRoute requireAuth={true}>
      <PracticeScoutingContent />
    </ProtectedRoute>
  );
}
