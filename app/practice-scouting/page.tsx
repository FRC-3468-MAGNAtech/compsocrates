"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addDoc, collection, deleteField, doc, getDoc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import ReefscapeStyleModal from "@/app/components/ReefscapeStyleModal";
import ReefscapeMatchSelectModal, { type ReefscapeMatchOption } from "@/app/components/ReefscapeMatchSelectModal";
import PracticeDifficultyMatchModal, { type PracticeDifficultyModalOption } from "@/app/components/PracticeDifficultyMatchModal";
import { useAuth } from "@/app/AuthContext";
import { PracticeMatch, PracticeSession, calculateScoutedScore, calculateAccuracy } from "@/app/utils/practiceTypes";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { getEventsForGame, type AnalyticsGame } from "@/app/utils/analyticsEvents";
import { getTeamEventOptions, pickDetectedEventKey, type DetectedEventOption } from "@/app/utils/eventDetection";

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
}: {
  title: string;
  values: number[];
  onAdd: (value: number) => void;
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
        <div key={`${title}-${i}-${v}`} className="text-xs text-gray-700">
          Cycle {i + 1}: {v.toFixed(2)}
        </div>
      ))}
    </div>
  );
};

function TeamPickerModal({
  open,
  teams,
  onClose,
  onSelect,
}: {
  open: boolean;
  teams: string[];
  onClose: () => void;
  onSelect: (team: string) => void;
}) {
  return (
    <ReefscapeStyleModal open={open} onClose={onClose} step="qualification">
      <h2 className="text-xl font-semibold mb-4" style={{ color: "var(--primary-color)" }}>Select Team</h2>
      <div className="max-h-[60vh] overflow-y-auto border rounded p-2">
        {teams.length === 0 ? (
          <p className="p-3 text-sm text-gray-600">No robots detected. Client may be offline.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {teams.map((team) => (
              <button
                key={team}
                type="button"
                onClick={() => {
                  onSelect(team);
                  onClose();
                }}
                className="rounded-lg border border-red-400 p-3 text-sm text-left hover:bg-gray-50"
              >
                {team}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="mt-4 w-full py-2 rounded text-white"
        style={{ backgroundColor: "var(--primary-color)" }}
      >
        Close
      </button>
    </ReefscapeStyleModal>
  );
}

type PracticeMode = 'trial' | 'competitive';
type ScoutedData = PracticeSession["scoutedData"];
type PracticeStep = 'select' | 'practice' | 'break' | 'results';
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

const REBUILT_BPS = [0, 2, 5, 8, 10];
const REBUILT_CARRY = [0, 12, 23, 32, 42, 53, 54];
const REBUILT_PRELOAD = [0, 2, 4, 6, 8];
const PRELOAD_LABELS = ["0", "1-2", "3-4", "5-6", "7-8"];
const BPS_LABELS = ["0", "1-3", "4-6", "7-9", "10+"];
const CARRY_LABELS = ["0", "1-12", "13-23", "23-32", "33-42", "43-53", "54+"];

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
  playersByUid?: Record<string, { name?: string; joinedAt?: number }>;
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
  if (!Number.isFinite(score) || score <= 100) return "easy";
  if (score <= 200) return "medium";
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
  const autoCarryCap = REBUILT_CARRY[Math.max(0, Math.min(6, data.autoCarryScale))] || 0;
  const teleCarryCap = REBUILT_CARRY[Math.max(0, Math.min(6, data.teleCarryScale))] || 0;
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
  const i = Math.max(0, labels === "carry" ? Math.min(6, Number(index || 0)) : Math.min(4, Number(index || 0)));
  if (labels === "preload") return [[0], [1, 2], [3, 4], [5, 6], [7, 8]][i] || [0];
  if (labels === "bps") return [[0], [1, 2, 3], [4, 5, 6], [7, 8, 9], [10]][i] || [0];
  return [
    [0],
    Array.from({ length: 12 }, (_, n) => n + 1),
    Array.from({ length: 11 }, (_, n) => n + 13),
    Array.from({ length: 10 }, (_, n) => n + 23),
    Array.from({ length: 10 }, (_, n) => n + 33),
    Array.from({ length: 11 }, (_, n) => n + 43),
    [54],
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

function parsePracticeMatchNumber(match: { matchKey?: unknown; matchNumber?: unknown }): number {
  const key = String(match.matchKey || "").toLowerCase();
  const fromKey =
    key.match(/_qm(\d+)$/)?.[1] ||
    key.match(/_pm(\d+)$/)?.[1] ||
    key.match(/_pr(\d+)$/)?.[1] ||
    key.match(/_m(\d+)$/)?.[1];
  if (fromKey) return Number(fromKey);
  const number = Number(match.matchNumber || 0);
  if (Number.isFinite(number) && number > 0) return number;
  return 1;
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
  const { userData } = useAuth();
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
  const [showLiveTeamPicker, setShowLiveTeamPicker] = useState(false);
  const [liveTeamPickerTarget, setLiveTeamPickerTarget] = useState<"reefscape" | "rebuilt">("reefscape");
  const [liveVideoUrl, setLiveVideoUrl] = useState("");
  const [liveStreamTitle, setLiveStreamTitle] = useState("");
  const [liveEventKeyHint, setLiveEventKeyHint] = useState("");
  const [liveEventTeamSuggestions, setLiveEventTeamSuggestions] = useState<number[]>([]);
  const [liveLobbyId, setLiveLobbyId] = useState("");
  const [liveLobbyCodeInput, setLiveLobbyCodeInput] = useState("");
  const [liveLobby, setLiveLobby] = useState<LivePracticeLobby | null>(null);
  const [liveLobbyBusy, setLiveLobbyBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [mobileNotesOpen, setMobileNotesOpen] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<PracticeSessionDraft | null>(null);
  const [teamEventCatalog, setTeamEventCatalog] = useState<DetectedEventOption[]>([]);
  const [tbaAuth, setTbaAuth] = useState<{ encryptedKey: string; plainKey: string }>({ encryptedKey: "", plainKey: "" });
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const formPaneRef = useRef<HTMLDivElement | null>(null);

  const [formData, setFormData] = useState<ScoutedData>(createEmptyScoutedData());
  const [rebuiltFormData, setRebuiltFormData] = useState<RebuiltScoutedData>(createEmptyRebuiltScoutedData());
  const REBUILT_WEEK0_EVENT_KEY = "2026week0";

  const persistedDifficulty: "easy" | "medium" | "hard" = selectedDifficulty === "live"
    ? "hard"
    : (selectedDifficulty || "easy");

  const livePickerTeams = useMemo(() => {
    const detected = liveEventTeamSuggestions.map((team) => String(team).trim()).filter(Boolean);
    if (detected.length > 0) return Array.from(new Set(detected));
    const fromMatch = (currentMatch?.allianceTeams || []).map((team) => String(team).trim()).filter(Boolean);
    return Array.from(new Set(fromMatch));
  }, [currentMatch?.allianceTeams, liveEventTeamSuggestions]);

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

  const liveLobbyPlayerCount = liveLobbyPlayers.length;
  const liveLobbyCanStart = liveLobbyPlayerCount > 0 && liveLobbyPlayerCount % 3 === 0;
  const userIsLiveLobbyHost = Boolean(liveLobby && userData?.uid && liveLobby.hostId === userData.uid);

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
    if (!liveLobbyId) {
      setLiveLobby(null);
      return;
    }
    if (liveLobbyId.startsWith("local:")) return;

    let cancelled = false;
    const loadLobby = async () => {
      try {
        const snap = await getDoc(doc(db, "livePracticeLobbies", liveLobbyId));
        if (!snap.exists()) {
          if (!cancelled) {
            setLiveLobby(null);
            setLiveLobbyId("");
          }
          return;
        }
        if (!cancelled) {
          setLiveLobby({ id: snap.id, ...(snap.data() as Omit<LivePracticeLobby, "id">) });
        }
      } catch (error) {
        console.error("Failed to load live practice lobby:", error);
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
  }, [liveLobbyId]);

  function createLobbyCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i += 1) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  async function createLiveLobby() {
    if (!userData?.uid || !selectedMode || !activeMatchGame) return;
    setLiveLobbyBusy(true);
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
        playersByUid: {
          [userData.uid]: { name: userData.displayName || "Host", joinedAt: Date.now() },
        },
      };

      try {
        for (let attempt = 0; attempt < 6; attempt += 1) {
          const existing = await getDocs(query(collection(db, "livePracticeLobbies"), where("code", "==", code), where("status", "==", "waiting")));
          if (existing.empty) break;
          code = createLobbyCode();
        }
        payload.code = code;
        const lobbyRef = await addDoc(collection(db, "livePracticeLobbies"), payload);
        setLiveLobbyId(lobbyRef.id);
      } catch (cloudError) {
        console.warn("Cloud live lobby unavailable; falling back to local lobby.", cloudError);
        const localId = `local:${Date.now()}`;
        setLiveLobbyId(localId);
        setLiveLobby({ id: localId, ...payload });
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
    try {
      if (liveLobbyId.startsWith("local:") && liveLobby && liveLobby.code === code) {
        const joined = {
          ...liveLobby,
          playersByUid: {
            ...(liveLobby.playersByUid || {}),
            [userData.uid]: { name: userData.displayName || "Player", joinedAt: Date.now() },
          },
        };
        setLiveLobby(joined);
        setActiveMatchGame(joined.game);
        setSelectedMode(joined.mode);
        return;
      }
      const snap = await getDocs(query(collection(db, "livePracticeLobbies"), where("code", "==", code)));
      const lobbyDoc = snap.docs
        .map((row) => ({ id: row.id, ...(row.data() as Omit<LivePracticeLobby, "id">) }))
        .find((row) => row.status === "waiting" || row.status === "in_progress");
      if (!lobbyDoc) {
        alert("Lobby not found.");
        return;
      }

      if (userData.teamId && lobbyDoc.teamId && userData.teamId !== lobbyDoc.teamId) {
        alert("This lobby belongs to another team.");
        return;
      }

      await updateDoc(doc(db, "livePracticeLobbies", lobbyDoc.id), {
        [`playersByUid.${userData.uid}`]: {
          name: userData.displayName || "Player",
          joinedAt: Date.now(),
        },
      });
      setActiveMatchGame(lobbyDoc.game);
      setSelectedMode(lobbyDoc.mode);
      setLiveLobbyId(lobbyDoc.id);
    } catch (error) {
      console.error("Failed joining live lobby:", error);
      alert("Could not join lobby.");
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
          setLiveLobby(null);
          setLiveLobbyId("");
          return;
        }
        const nextPlayers = { ...(liveLobby.playersByUid || {}) };
        delete nextPlayers[userData.uid];
        setLiveLobby({ ...liveLobby, playersByUid: nextPlayers });
        return;
      }
      if (userIsLiveLobbyHost) {
        await updateDoc(doc(db, "livePracticeLobbies", liveLobby.id), { status: "closed" });
      } else {
        await updateDoc(doc(db, "livePracticeLobbies", liveLobby.id), {
          [`playersByUid.${userData.uid}`]: deleteField(),
        });
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
      alert("Live practice requires players in multiples of 3.");
      return;
    }
    setLiveLobbyBusy(true);
    try {
      if (liveLobby.id.startsWith("local:")) {
        setLiveLobby({ ...liveLobby, status: "in_progress", startedAt: Date.now() });
        return;
      }
      await updateDoc(doc(db, "livePracticeLobbies", liveLobby.id), {
        status: "in_progress",
        startedAt: Date.now(),
      });
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

  function matchBelongsToSelectedGame(match: PracticeMatch): boolean {
    const matchGame = String((match as unknown as Record<string, unknown>).game || "").toUpperCase();
    const eventKey = String((match as unknown as Record<string, unknown>).eventKey || "").toLowerCase();

    if (activeMatchGame === "REBUILT") {
      return eventKey === REBUILT_WEEK0_EVENT_KEY;
    }

    if (eventKey === REBUILT_WEEK0_EVENT_KEY) {
      return false;
    }
    if (!matchGame) return true;
    return matchGame === "REEFSCAPE";
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

  function inferEventKeyFromStreamTitle(title: string, game: AnalyticsGame): string {
    const normalizedTitle = normalizeEventValue(title);
    if (!normalizedTitle) return "";
    const staticEvents = getEventsForGame(game).filter((event) => event.id !== "app-testing");
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

  async function hydrateLiveStreamContext(url: string): Promise<string> {
    const trimmed = String(url || "").trim();
    if (!trimmed || !activeMatchGame) return "";
    setLiveStreamTitle("");
    setLiveEventKeyHint("");
    setLiveEventTeamSuggestions([]);

    try {
      const titleResponse = await fetch("/api/live-stream/title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });
      const titlePayload = (await titleResponse.json().catch(() => ({}))) as { title?: string };
      const title = String(titlePayload.title || "").trim();
      if (!title) return "";
      setLiveStreamTitle(title);

      const inferredFromTitle = inferEventKeyFromStreamTitle(title, activeMatchGame);
      const fallbackEventKey = teamEventCatalog.length > 0 ? pickDetectedEventKey(teamEventCatalog) : "";
      const inferredEventKey = inferredFromTitle || fallbackEventKey;
      if (!inferredEventKey) return "";
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
      const teamPayload = (await teamResponse.json()) as { teams?: Array<{ teamNumber?: number }> };
      const teams = Array.isArray(teamPayload.teams)
        ? teamPayload.teams
            .map((row) => Number(row.teamNumber || 0))
            .filter((n) => Number.isFinite(n) && n > 0)
        : [];
      setLiveEventTeamSuggestions(Array.from(new Set(teams)).sort((a, b) => a - b));
      return inferredEventKey;
    } catch {
      // Best effort only.
      return "";
    }
  }

  function handleLiveTeamSelect(teamNumber: string, target: "reefscape" | "rebuilt") {
    if (target === "rebuilt") {
      setRebuiltFormData((prev) => ({ ...prev, teamNumber }));
      return;
    }
    setFormData((prev) => ({ ...prev, teamNumber }));
  }

  function openLiveTeamPicker(target: "reefscape" | "rebuilt") {
    setLiveTeamPickerTarget(target);
    setShowLiveTeamPicker(true);
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
    if (!currentMatch || selectedDifficulty === "live") return;
    const expectedTeam = currentMatch.allianceTeams[currentRobotIndex]?.toString() || "";
    if (activeMatchGame === "REBUILT") {
      setRebuiltFormData((prev) => (prev.teamNumber === expectedTeam ? prev : { ...prev, teamNumber: expectedTeam }));
      return;
    }
    setFormData((prev) => (prev.teamNumber === expectedTeam ? prev : { ...prev, teamNumber: expectedTeam }));
  }, [activeMatchGame, currentMatch, currentRobotIndex, selectedDifficulty]);

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

  async function selectPracticeMatch(difficulty: 'easy' | 'medium' | 'hard' | 'live', mode: PracticeMode) {
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
        return;
      }

      const gameFilteredMatches = matches.filter((match) => matchBelongsToSelectedGame(match));
      if (gameFilteredMatches.length === 0) {
        alert("No matches exist to scout yet for the selected game.");
        setLoading(false);
        return;
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
        return;
      }
      candidateMatches = dedupePracticeMatches(candidateMatches);
      if (difficulty !== "live") {
        candidateMatches = candidateMatches.filter((match) => matchMatchesDifficulty(match, difficulty));
      }
      if (candidateMatches.length === 0) {
        alert(`No ${difficulty} matches found for the selected game.`);
        return;
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
    } catch (error) {
      console.error('Error loading practice match:', error);
      const details = (error as { code?: string; message?: string })?.message || "";
      if (details.toLowerCase().includes("permission")) {
        alert("Error loading practice match. Check Firestore rules for read access to practiceMatches.");
      } else {
        alert('Error loading practice match.');
      }
    } finally {
      setLoading(false);
    }
  }

  function startPracticeMatch(selected: CandidatePracticeMatch) {
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

    const safeMatch: PracticeMatch = {
      ...selected,
      matchType: normalizedMatchType,
      videoUrl: selectedDifficulty === "live" && liveVideoUrl.trim() ? liveVideoUrl.trim() : selected.videoUrl,
      allianceTeams: fallbackTeams,
      officialData: {
        score: safeOfficialScore,
        penaltyPoints: Number(official.penaltyPoints || 0),
        breakdown: official.breakdown || {},
      },
    };

    setCurrentMatch(safeMatch);
    setCurrentRobotIndex(0);
    setBreakCompletedRobotIndex(null);
    setRobotSessions([]);
    setRebuiltRobotSessions([]);
    const defaultFirstTeam = safeMatch.allianceTeams[0]?.toString() || "";
    const initialTeamNumber = selectedDifficulty === "live" ? "" : defaultFirstTeam;
    setFormData(createEmptyScoutedData(initialTeamNumber));
    setRebuiltFormData(createEmptyRebuiltScoutedData(initialTeamNumber));
    setHumanPlayerRobot(Math.floor(Math.random() * 3));
    setCurrentStep("practice");
    setShowDifficultyMatchModal(false);
  }

  async function handleChooseLiveMatchClick() {
    if (!liveVideoUrl.trim()) {
      alert("Paste a live video URL first.");
      return;
    }
    setShowMatchSelectModal(false);
    const inferredEventKey = await hydrateLiveStreamContext(liveVideoUrl.trim());

    const pickFrom = candidateMatches;
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
    const randomIndex = Math.floor(Math.random() * pool.length);
    const chosen = pool[randomIndex];
    if (!chosen) {
      alert("Could not pick a live match.");
      return;
    }

    startPracticeMatch(chosen);
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
    const nextTeamNumber = selectedDifficulty === "live" ? "" : defaultTeam;
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
          const autoCarryCap = REBUILT_CARRY[Math.max(0, Math.min(6, robotData.autoCarryScale))] || 0;
          const teleCarryCap = REBUILT_CARRY[Math.max(0, Math.min(6, robotData.teleCarryScale))] || 0;
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
    setLiveVideoUrl("");
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
    clearPracticeDraft();
    setPendingDraft(null);
  }

  async function submitLiveRobot() {
    if (!currentMatch || !userData) return;

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

      if (activeMatchGame === "REBUILT") {
        const robotData = { ...rebuiltFormData };
        const preloadCap = REBUILT_PRELOAD[Math.max(0, Math.min(4, robotData.autoPreloadScale))] || 0;
        const autoCarryCap = REBUILT_CARRY[Math.max(0, Math.min(6, robotData.autoCarryScale))] || 0;
        const teleCarryCap = REBUILT_CARRY[Math.max(0, Math.min(6, robotData.teleCarryScale))] || 0;
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
      return {
        id: match.id,
        label: matchLabel,
        teamLabel: teamLabel ? `Teams: ${teamLabel}` : "Teams: -",
        progress: match.progress,
      };
    });
  }, [candidateMatches, selectedDifficulty]);

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

  const sharedModalOptions = useMemo<PracticeSelectorOption[]>(() => {
    return candidateMatches.map((match) => {
      const stage = getPracticeStage(match);
      const modalType: ReefscapeMatchOption["type"] =
        stage === "practice" ? "practice" : stage === "qualification" ? "qualification" : "finals";
      const rawScheduleTime = Number((match as unknown as Record<string, unknown>).scheduleTime || 0);
      const scheduleTime = Number.isFinite(rawScheduleTime) ? rawScheduleTime : 0;

      return {
        id: `${modalType}-${match.matchNumber}-${match.id}`,
        label: getPracticeLabel(match),
        type: modalType,
        matchNumber: parsePracticeMatchNumber(match as { matchKey?: unknown; matchNumber?: unknown }),
        scheduleTime,
        sourceId: match.id,
        progress: match.progress,
      };
    });
  }, [candidateMatches]);

  const sharedModalCompleted = useMemo(() => {
    return new Set(sharedModalOptions.filter((option) => option.progress === "complete").map((option) => option.id));
  }, [sharedModalOptions]);

  function handleSharedModalPick(option: PracticeSelectorOption) {
    const picked = candidateMatches.find((match) => match.id === option.sourceId);
    if (!picked) return;
    if (selectedDifficulty === "live") {
      startPracticeMatch(picked);
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
                      onClick={() => selectPracticeMatch('live', selectedMode)}
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
                    Host or join a live room. Match starts are only allowed when players are in multiples of 3.
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
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm">
                        <span className="font-semibold">Code:</span> {liveLobby.code} •{" "}
                        <span className="font-semibold">Game:</span> {liveLobby.game} •{" "}
                        <span className="font-semibold">Mode:</span> {liveLobby.mode}
                      </p>
                      <div className="rounded border p-3 bg-white/80">
                        <p className="text-sm font-semibold mb-2">Players ({liveLobbyPlayerCount})</p>
                        <div className="grid sm:grid-cols-2 gap-1 text-sm">
                          {liveLobbyPlayers.map((player) => (
                            <p key={player.uid}>
                              {player.name}
                              {player.uid === liveLobby.hostId ? " (Host)" : ""}
                            </p>
                          ))}
                        </div>
                      </div>
                      <p className={`text-sm font-semibold ${liveLobbyCanStart ? "text-green-700" : "text-amber-700"}`}>
                        {liveLobbyCanStart
                          ? "Ready: player count is a multiple of 3."
                          : "Need player count in multiples of 3 before starting."}
                      </p>
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
                          <button
                            type="button"
                            onClick={() => void selectPracticeMatch("live", liveLobby.mode)}
                            disabled={loading}
                            className="px-4 py-2 rounded text-white font-semibold"
                            style={{ backgroundColor: "var(--primary-color)" }}
                          >
                            Enter Live Match Setup
                          </button>
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
                {selectedDifficulty === "live" && (
                  <div className="mt-6 rounded-xl border border-cyan-300 bg-cyan-500/5 shadow-md p-4">
                    <h3 className="font-semibold mb-1 text-cyan-700">Live Match Setup</h3>
                    <p className="text-sm text-gray-700 mb-3">
                      Paste a stream URL, then open match select to pick and start.
                    </p>
                    <div className="space-y-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Live Video URL</label>
                        <input
                          type="url"
                          value={liveVideoUrl}
                          onChange={(event) => {
                            setLiveVideoUrl(event.target.value);
                            setShowMatchSelectModal(false);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") event.preventDefault();
                          }}
                          className="w-full border rounded p-2"
                          placeholder="https://www.youtube.com/watch?v=..."
                        />
                        {(liveStreamTitle || liveEventKeyHint) && (
                          <p className="mt-2 text-xs text-gray-700">
                            {liveStreamTitle ? `Detected stream: ${liveStreamTitle}` : ""}
                            {liveEventKeyHint ? `${liveStreamTitle ? "  •  " : ""}Event hint: ${liveEventKeyHint.toUpperCase()}` : ""}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={handleChooseLiveMatchClick}
                          className="px-4 py-2 rounded text-white font-semibold"
                          style={{ backgroundColor: "var(--primary-color)" }}
                        >
                          Choose Live Match
                        </button>
                      </div>
                    </div>
                  </div>
                )}

              </>
            )}
          </div>
        )}

        {currentStep === 'break' && currentMatch && breakCompletedRobotIndex !== null && (
          <div className="p-4 md:p-8 max-w-3xl mx-auto min-h-[calc(100vh-4rem)] flex items-center">
            <div className="w-full bg-white rounded-2xl shadow-md border border-gray-200 p-8">
              <h1 className="text-2xl md:text-3xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>
                Robot {breakCompletedRobotIndex + 1} Complete
              </h1>
              <p className="text-gray-700 text-lg mb-3">
                Team {selectedDifficulty === "live"
                  ? (activeMatchGame === "REBUILT" ? rebuiltFormData.teamNumber || "Unknown" : formData.teamNumber || "Unknown")
                  : currentMatch.allianceTeams[breakCompletedRobotIndex]} scouting is complete.
              </p>
              <p className="text-gray-600 mb-8">
                Take a short break before the next robot, just like normal scouting rotations between matches.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={continueToNextRobot}
                  className="flex-1 py-3 rounded-lg text-white font-semibold"
                  style={{ backgroundColor: "var(--primary-color)" }}
                >
                  {selectedDifficulty === "live"
                    ? "Continue To Next Robot"
                    : `Continue To Robot ${currentRobotIndex + 2} (Team ${currentMatch.allianceTeams[currentRobotIndex + 1]})`}
                </button>
                {selectedDifficulty !== "live" && (
                  <button
                    onClick={pausePracticeSession}
                    className="flex-1 py-3 rounded-lg border-2 border-blue-300 text-blue-700 font-semibold hover:bg-blue-50"
                  >
                    Pause Session
                  </button>
                )}
                <button
                  onClick={resetPractice}
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
          <div className="h-screen flex flex-col md:flex-row">
            {/* VIDEO PLAYER */}
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
                  }))} Match {currentMatch.matchNumber}
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
                {selectedDifficulty === "live" && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowMatchSelectModal(true);
                    }}
                    className="mt-2 px-3 py-1 rounded text-sm text-white"
                    style={{ backgroundColor: "var(--primary-color)" }}
                  >
                    Change Live Match
                  </button>
                )}
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
                {selectedMode === 'competitive' && (
                  <p className="text-xs mt-2 text-yellow-300">Video cannot be paused in competitive mode.</p>
                )}
              </div>
            </div>

            {/* SCOUTING FORM */}
            <div ref={formPaneRef} className="w-full md:w-[22rem] md:flex-none flex-1 min-h-0 overflow-y-auto bg-gray-100 p-4 space-y-4">
              {selectedDifficulty === "live" && (
                <button
                  type="button"
                  onClick={() => {
                    setShowMatchSelectModal(true);
                  }}
                  className="w-full py-2 rounded border border-cyan-300 text-cyan-800 bg-cyan-50 hover:bg-cyan-100 font-semibold"
                >
                  Match Select (Live)
                </button>
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
                      <>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            inputMode="numeric"
                            list={liveEventTeamSuggestions.length > 0 ? "live-team-suggestions-reefscape" : undefined}
                            value={formData.teamNumber}
                            onChange={(e) => setFormData({ ...formData, teamNumber: e.target.value.replace(/[^\d]/g, "") })}
                            className="flex-1 border rounded p-2"
                            placeholder="Type team number"
                          />
                          <button
                            type="button"
                            className="px-4 rounded border"
                            onClick={() => openLiveTeamPicker("reefscape")}
                          >
                            Pick
                          </button>
                        </div>
                        {liveEventTeamSuggestions.length > 0 && (
                          <datalist id="live-team-suggestions-reefscape">
                            {liveEventTeamSuggestions
                              .slice()
                              .sort((a, b) => a - b)
                              .map((team) => (
                                <option key={`reef-live-${team}`} value={String(team)} />
                              ))}
                          </datalist>
                        )}
                      </>
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
                          <>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                inputMode="numeric"
                                list={liveEventTeamSuggestions.length > 0 ? "live-team-suggestions-rebuilt" : undefined}
                                value={rebuiltFormData.teamNumber}
                                onChange={(e) =>
                                  setRebuiltFormData({ ...rebuiltFormData, teamNumber: e.target.value.replace(/[^\d]/g, "") })
                                }
                                className="flex-1 border rounded p-2"
                                placeholder="Type team number"
                              />
                              <button
                                type="button"
                                className="px-4 rounded border"
                                onClick={() => openLiveTeamPicker("rebuilt")}
                              >
                                Pick
                              </button>
                            </div>
                            {liveEventTeamSuggestions.length > 0 && (
                              <datalist id="live-team-suggestions-rebuilt">
                                {liveEventTeamSuggestions
                                  .slice()
                                  .sort((a, b) => a - b)
                                  .map((team) => (
                                    <option key={`rebuilt-live-${team}`} value={String(team)} />
                                  ))}
                              </datalist>
                            )}
                          </>
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
                        Balls Per Second ({BPS_LABELS[Math.max(0, Math.min(4, rebuiltFormData.autoBpsScale))]})
                      </label>
                      <input
                        type="range"
                        min={0}
                        max={4}
                        value={rebuiltFormData.autoBpsScale}
                        onChange={(e) => setRebuiltFormData({ ...rebuiltFormData, autoBpsScale: Number(e.target.value) })}
                        className="w-full"
                      />
                      <label className="block text-sm font-medium text-gray-700">
                        Carrying Capacity ({CARRY_LABELS[Math.max(0, Math.min(6, rebuiltFormData.autoCarryScale))]})
                      </label>
                      <input
                        type="range"
                        min={0}
                        max={6}
                        value={rebuiltFormData.autoCarryScale}
                        onChange={(e) => setRebuiltFormData({ ...rebuiltFormData, autoCarryScale: Number(e.target.value) })}
                        className="w-full"
                      />
                      <RebuiltCycleTimer
                        title="Auto Cycle Timer"
                        values={rebuiltFormData.autoCycles}
                        onAdd={(value) => setRebuiltFormData({ ...rebuiltFormData, autoCycles: [...rebuiltFormData.autoCycles, value] })}
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
                        Balls Per Second ({BPS_LABELS[Math.max(0, Math.min(4, rebuiltFormData.teleBpsScale))]})
                      </label>
                      <input
                        type="range"
                        min={0}
                        max={4}
                        value={rebuiltFormData.teleBpsScale}
                        onChange={(e) => setRebuiltFormData({ ...rebuiltFormData, teleBpsScale: Number(e.target.value) })}
                        className="w-full"
                      />
                      <label className="block text-sm font-medium text-gray-700">
                        Carrying Capacity ({CARRY_LABELS[Math.max(0, Math.min(6, rebuiltFormData.teleCarryScale))]})
                      </label>
                      <input
                        type="range"
                        min={0}
                        max={6}
                        value={rebuiltFormData.teleCarryScale}
                        onChange={(e) => setRebuiltFormData({ ...rebuiltFormData, teleCarryScale: Number(e.target.value) })}
                        className="w-full"
                      />
                      <RebuiltCycleTimer
                        title="Transition Shift"
                        values={rebuiltFormData.transitionCycles}
                        onAdd={(value) => setRebuiltFormData({ ...rebuiltFormData, transitionCycles: [...rebuiltFormData.transitionCycles, value] })}
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
                  onClick={resetPractice}
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
          </div>
        )}

        {/* STEP 3: RESULTS */}
        {currentStep === 'results' && sessionResults && (
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
        <ReefscapeMatchSelectModal
          open={showMatchSelectModal && selectedDifficulty === "live"}
          onClose={() => setShowMatchSelectModal(false)}
          options={sharedModalOptions}
          completed={sharedModalCompleted}
          onPick={handleSharedModalPick}
        />
        <PracticeDifficultyMatchModal
          open={showDifficultyMatchModal && selectedDifficulty !== "live" && selectedDifficulty !== null}
          onClose={() => setShowDifficultyMatchModal(false)}
          difficulty={(selectedDifficulty && selectedDifficulty !== "live" ? selectedDifficulty : "easy")}
          options={difficultyModalOptions}
          onPick={handleDifficultyModalPick}
          onRandomize={handleDifficultyModalRandomize}
        />
        <TeamPickerModal
          open={showLiveTeamPicker}
          teams={livePickerTeams}
          onClose={() => setShowLiveTeamPicker(false)}
          onSelect={(team) => handleLiveTeamSelect(team, liveTeamPickerTarget)}
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
