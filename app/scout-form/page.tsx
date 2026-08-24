"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { addDoc, collection, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Minus,
  Pencil,
  Plus,
  Radio,
  Repeat,
  Timer,
  Trash2,
  UserCog,
  X as XIcon,
} from "lucide-react";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import ReefscapeStyleModal from "@/app/components/ReefscapeStyleModal";
import ReefscapeMatchSelectModal from "@/app/components/ReefscapeMatchSelectModal";
import { useAuth } from "@/app/AuthContext";
import { db } from "@/app/firebase";
import { type TBAMatch } from "@/app/utils/tba-api";
import { resolveDetectedTeamEventKey } from "@/app/utils/eventDetection";
import { getEventsForGame, isInEventWindow } from "@/app/utils/analyticsEvents";
import { getEffectiveNowSec } from "@/app/utils/teamTime";
import { expandEventKeyAliases, normalizeEventKey as _normalizeEventKey } from "@/app/utils/events";
import { fetchFirstSchedule, splitFirstAllianceTeams } from "@/app/utils/firstSchedule";
import {
  buildCompletedModalIdsFromTba,
  buildReefscapeModalOptions,
  fetchEventMatchesWithTeamAuth,
  getTbaScheduleTime,
  mapTbaMatchToModalId,
} from "@/app/utils/reefscapeMatchSync";
import { HudCanvas, HudViewport, CommandBar, Surface, Deck, PageIntro, Chip, Action, StatTile } from "@/app/components/Hud";

/* ==========================================================================
   Types — mirrored 1:1 from the scouting-form business logic reference.
   ========================================================================== */

type MatchType = "practice" | "qualification" | "finals";

type MatchOption = {
  id: string;
  label: string;
  type: MatchType;
  matchNumber: number;
  scheduleTime: number;
  teams: string[];
  redTeams?: string[];
  blueTeams?: string[];
};

type AssignmentRow = {
  matchKey?: string;
  matchLabel?: string;
  eventKey?: string;
  teamNumber?: number;
  scoutHumanPlayer?: boolean;
};

type FormState = {
  scoutName: string;
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
  hubActivationOverride: boolean;
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
  incidents: string[];
  notes: string;
};

type LeadFormState = {
  scoutName: string;
  alliance: "red" | "blue" | "";
  robot1TeamNumber: string;
  robot1PickNumber: string;
  robot1Notes: string;
  robot1SkillLevel: number;
  robot2TeamNumber: string;
  robot2PickNumber: string;
  robot2Notes: string;
  robot2SkillLevel: number;
  robot3TeamNumber: string;
  robot3PickNumber: string;
  robot3Notes: string;
  robot3SkillLevel: number;
  overallAllianceTeams: string;
  overallAllianceNotes: string;
  overallAllianceSkillLevel: number;
};

const INCIDENTS = [
  { value: "died", label: "Died During Match" },
  { value: "never-started", label: "Never Started Match" },
  { value: "disabled", label: "Disabled by FRC" },
  { value: "recovered", label: "Recovered from Freeze" },
  { value: "tipped", label: "Tipped Over" },
  { value: "yellow-card", label: "Yellow Card" },
  { value: "red-card", label: "Red Card" },
];

const BPS = [0, 2, 5, 8, 12, 16, 20, 23, 25];
const CARRY = [0, 12, 23, 32, 42, 53, 64, 74, 75];
const PRELOAD = [0, 2, 4, 6, 8];
const PRELOAD_LABELS = ["0", "1-2", "3-4", "5-6", "7-8"];
const BPS_LABELS = ["0", "1-3", "4-6", "7-9", "10-13", "14-17", "18-21", "22-24", "25+"];
const CARRY_LABELS = ["0", "1-12", "13-23", "23-32", "33-42", "43-53", "54-64", "65-74", "75+"];
const BPS_MAX = BPS_LABELS.length - 1;
const CARRY_MAX = CARRY_LABELS.length - 1;
const LEAD_SKILL_LEVELS = [1, 2, 3, 4, 5];

/* ==========================================================================
   Pure helpers — ported verbatim from the reference business logic.
   ========================================================================== */

function convertPitScale(value: number, kind: "preload" | "bps" | "carry") {
  const n = Number(value || 0);
  if (kind === "preload") return n <= 0 ? 0 : n <= 2 ? 1 : n <= 4 ? 2 : n <= 6 ? 3 : 4;
  if (kind === "bps") {
    return n <= 0 ? 0
      : n <= 3 ? 1
      : n <= 6 ? 2
      : n <= 9 ? 3
      : n <= 13 ? 4
      : n <= 17 ? 5
      : n <= 21 ? 6
      : n <= 24 ? 7
      : 8;
  }
  return n <= 0 ? 0
    : n <= 12 ? 1
    : n <= 23 ? 2
    : n <= 32 ? 3
    : n <= 42 ? 4
    : n <= 53 ? 5
    : n <= 64 ? 6
    : n <= 74 ? 7
    : 8;
}

function scaleRangeForIndex(kind: "preload" | "bps" | "carry", index: number): { min: number; max: number } {
  if (kind === "preload") {
    if (index <= 0) return { min: 0, max: 0 };
    if (index === 1) return { min: 1, max: 2 };
    if (index === 2) return { min: 3, max: 4 };
    if (index === 3) return { min: 5, max: 6 };
    return { min: 7, max: 8 };
  }
  if (kind === "bps") {
    if (index <= 0) return { min: 0, max: 0 };
    if (index === 1) return { min: 1, max: 3 };
    if (index === 2) return { min: 4, max: 6 };
    if (index === 3) return { min: 7, max: 9 };
    if (index === 4) return { min: 10, max: 13 };
    if (index === 5) return { min: 14, max: 17 };
    if (index === 6) return { min: 18, max: 21 };
    if (index === 7) return { min: 22, max: 24 };
    return { min: 25, max: Number.POSITIVE_INFINITY };
  }
  if (index <= 0) return { min: 0, max: 0 };
  if (index === 1) return { min: 1, max: 12 };
  if (index === 2) return { min: 13, max: 23 };
  if (index === 3) return { min: 24, max: 32 };
  if (index === 4) return { min: 33, max: 42 };
  if (index === 5) return { min: 43, max: 53 };
  if (index === 6) return { min: 54, max: 64 };
  if (index === 7) return { min: 65, max: 74 };
  return { min: 75, max: Number.POSITIVE_INFINITY };
}

function pitValueFitsScale(kind: "preload" | "bps" | "carry", value: number | null, scaleIndex: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return false;
  const range = scaleRangeForIndex(kind, scaleIndex);
  return value >= range.min && value <= range.max;
}

function parsePitValue(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  const text = String(raw || "").trim();
  if (!text) return null;
  const range = text.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
  if (range) {
    const upper = Number(range[2]);
    return Number.isFinite(upper) && upper > 0 ? upper : null;
  }
  const numeric = text.match(/\d+(?:\.\d+)?/);
  if (!numeric) return null;
  const parsed = Number(numeric[0]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeTeamNumber(raw: unknown) {
  return String(raw || "").replace(/[^\d]/g, "");
}

function rowMatchesEvent(row: Record<string, unknown>, eventKey: string) {
  const target = String(eventKey || "").trim().toLowerCase();
  if (!target) return false;
  const key = String(row.eventKey || "").trim().toLowerCase();
  if (key) return key === target;

  const timestamp =
    Number(row.submittedAt || 0) ||
    Number(row.timestamp || 0) ||
    Number(row.createdAt || 0) ||
    Number(row.completedAt || 0) ||
    Number(row.startedAt || 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return false;

  const event = getEventsForGame("REBUILT").find((item) => item.id === target);
  if (!event?.startDate || !event?.endDate) return false;
  return isInEventWindow(timestamp, event.startDate, event.endDate);
}

function isUserAttendingEvent(
  attendeesByEvent: Record<string, string[]> | undefined,
  eventKey: string,
  user: { uid?: string | null; displayName?: string | null }
) {
  if (!attendeesByEvent) return false;
  const attendees = attendeesByEvent[eventKey] || [];
  const normalizedUid = String(user.uid || "").trim();
  const normalizedName = String(user.displayName || "").trim().toLowerCase();
  return attendees.some((value) => {
    const safe = String(value || "").trim();
    if (!safe) return false;
    return safe === normalizedUid || safe.toLowerCase() === normalizedName;
  });
}

function buildFallbackScoutOptions(): MatchOption[] {
  const rows: MatchOption[] = [];
  for (let n = 1; n <= 20; n += 1) {
    rows.push({ id: `p${n}`, label: `Practice ${n}`, type: "practice", matchNumber: n, scheduleTime: 0, teams: [], redTeams: [], blueTeams: [] });
  }
  for (let n = 1; n <= 80; n += 1) {
    rows.push({ id: `q${n}`, label: `Qualification ${n}`, type: "qualification", matchNumber: n, scheduleTime: 0, teams: [], redTeams: [], blueTeams: [] });
  }
  for (let n = 1; n <= 3; n += 1) {
    rows.push({ id: `f${n}`, label: `Finals ${n}`, type: "finals", matchNumber: n, scheduleTime: 0, teams: [], redTeams: [], blueTeams: [] });
  }
  return rows;
}

function parsePlayoffSlotFromKey(rawValue: string, compLevel: "sf" | "qf"): number | null {
  const match = rawValue.match(new RegExp(`_${compLevel}(\\d+)m(\\d+)`, "i"));
  if (!match) return null;
  const slot = Number(match[1]);
  return Number.isFinite(slot) && slot > 0 ? slot : null;
}

function parseFinalsSeriesNumberFromKey(rawValue: string): number | null {
  const match = rawValue.match(/_f(\d+)m(\d+)/i);
  if (!match) return null;
  const setNum = Number(match[1]);
  const matchNum = Number(match[2]);
  if (setNum >= 14 && setNum <= 16) return setNum - 13;
  if (setNum === 1 && matchNum >= 1 && matchNum <= 3) return matchNum;
  if (setNum >= 1 && setNum <= 3 && matchNum === 1) return setNum;
  return null;
}

function normalizeScoutedMatchId(value: unknown): string {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  const direct = raw.match(/^(p|q|qf|sf|f)(\d+)$/);
  if (direct) return `${direct[1]}${Number(direct[2])}`;
  const playoffSet = raw.match(/^(qf|sf|f)(\d+)m(\d+)$/);
  if (playoffSet) return `${playoffSet[1]}${Number(playoffSet[2])}`;

  const fromQmKey = raw.match(/_qm(\d+)/);
  if (fromQmKey) return `q${Number(fromQmKey[1])}`;
  const fromPracticeKey = raw.match(/_(?:pr|pm)(\d+)/);
  if (fromPracticeKey) return `p${Number(fromPracticeKey[1])}`;
  const fromPractice = raw.match(/practice(?:\s+match)?\s+(\d+)/);
  if (fromPractice) return `p${Number(fromPractice[1])}`;
  const fromQual = raw.match(/qualification(?:\s+match)?\s+(\d+)/);
  if (fromQual) return `q${Number(fromQual[1])}`;

  const sfSlot = parsePlayoffSlotFromKey(raw, "sf");
  if (sfSlot !== null) return `sf${sfSlot}`;
  const sfLabel = raw.match(/semifinal\s+(\d+)(?:-(\d+))?/);
  if (sfLabel) return `sf${Number(sfLabel[1])}`;

  const qfSlot = parsePlayoffSlotFromKey(raw, "qf");
  if (qfSlot !== null) return `qf${qfSlot}`;
  const qfLabel = raw.match(/quarterfinal\s+(\d+)(?:-(\d+))?/);
  if (qfLabel) return `qf${Number(qfLabel[1])}`;

  const finalsSeries = parseFinalsSeriesNumberFromKey(raw);
  if (finalsSeries !== null) return `f${finalsSeries}`;
  const finalsLabel = raw.match(/finals\s+(\d+)/);
  if (finalsLabel) {
    const n = Number(finalsLabel[1]);
    return `f${n >= 14 && n <= 16 ? n - 13 : n}`;
  }
  const genericMatch = raw.match(/\bmatch\s+(\d+)\b/);
  if (genericMatch) return `sf${Number(genericMatch[1])}`;
  return raw.replace(/\s+/g, "");
}

function mapAssignmentToMatchId(labelOrKey: string) {
  const raw = String(labelOrKey || "").toLowerCase();
  const direct = raw.match(/^(p|q|qf|sf|f)(\d+)$/);
  if (direct) return `${direct[1]}${direct[2]}`;
  const qm = raw.match(/(?:_qm|qualification(?:\s+match)?\s+)(\d+)/);
  if (qm) return `q${qm[1]}`;
  const practice = raw.match(/(?:_pr|_pm|practice(?:\s+match)?\s+)(\d+)/);
  if (practice) return `p${practice[1]}`;
  const sfFromKey = parsePlayoffSlotFromKey(raw, "sf");
  if (sfFromKey !== null) return `sf${sfFromKey}`;
  const sfFromLabel = raw.match(/semifinal\s+(\d+)(?:-\d+)?/);
  if (sfFromLabel) return `sf${sfFromLabel[1]}`;
  const qfFromKey = parsePlayoffSlotFromKey(raw, "qf");
  if (qfFromKey !== null) return `qf${qfFromKey}`;
  const qfFromLabel = raw.match(/quarterfinal\s+(\d+)(?:-\d+)?/);
  if (qfFromLabel) return `qf${qfFromLabel[1]}`;
  const finalsFromKey = parseFinalsSeriesNumberFromKey(raw);
  if (finalsFromKey !== null) return `f${finalsFromKey}`;
  const finals = raw.match(/finals\s+(\d+)/);
  if (finals) {
    const number = Number(finals[1]);
    return `f${number >= 14 && number <= 16 ? number - 13 : number}`;
  }
  return "";
}

async function fetchCompletedMatchIds(
  eventKey: string,
  teamId?: string,
  debug?: { enabled: boolean; label?: string }
): Promise<Set<string>> {
  const completed = new Set<string>();
  if (!eventKey) return completed;

  const response = await fetch("/api/scout/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventKey, teamId }),
    cache: "no-store",
  });
  if (!response.ok) return completed;
  const payload = (await response.json()) as { completedIds?: string[]; error?: string };
  (payload.completedIds || []).forEach((id) => {
    const matchId = normalizeScoutedMatchId(id);
    if (matchId) completed.add(matchId);
  });

  if (debug?.enabled && typeof window !== "undefined") {
    const debugPayload = {
      label: debug.label || "completion",
      eventKey,
      completedCount: completed.size,
      completed: Array.from(completed).slice(0, 50),
      error: payload.error || null,
    };
    (window as unknown as { __scoutCompletionDebug?: unknown }).__scoutCompletionDebug = debugPayload;
    console.log("Scout completion debug:", debugPayload);
  }
  return completed;
}

/* ==========================================================================
   Fresh visual primitives (HUD-native) — cycle timers, steppers, pickers.
   All composed from Deck / Surface / Action / Chip; no legacy card markup.
   ========================================================================== */

function CycleTimer({
  title,
  values,
  onAdd,
  onDelete,
  countedLabel,
}: {
  title: string;
  values: number[];
  onAdd: (value: number) => void;
  onDelete: (index: number) => void;
  countedLabel?: { counted: boolean };
}) {
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
    <Surface className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Timer className="h-4 w-4 text-red-800/70" aria-hidden="true" />
          <span className="text-sm font-bold text-slate-900">{title}</span>
          {countedLabel && (
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                countedLabel.counted ? "bg-amber-200/70 text-amber-950" : "bg-slate-200/60 text-slate-600"
              }`}
            >
              {countedLabel.counted ? "Counted" : "Not Counted"}
            </span>
          )}
        </div>
        <span className="font-data text-lg font-black text-red-800 tabular-nums">{elapsed.toFixed(2)}s</span>
      </div>
      <Action
        variant={running ? "danger" : "primary"}
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
        className="mt-3 min-h-[3rem] w-full"
      >
        {running ? "Stop Cycle" : "Start Cycle"}
      </Action>
      {values.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {values.map((v, i) => (
            <div
              key={`${title}-${i}-${v}`}
              className="flex items-center gap-2 rounded-full border border-amber-300/50 bg-white/50 px-3 py-1.5 font-data text-xs font-semibold text-slate-800"
            >
              <span>#{i + 1}: {v.toFixed(2)}s</span>
              <button
                type="button"
                onClick={() => onDelete(i)}
                aria-label={`Delete cycle ${i + 1}`}
                className="text-red-700 hover:text-red-900"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </Surface>
  );
}

function Stepper({ label, value, onChange }: { label: string; value: number; onChange: (next: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => onChange(Math.max(0, value - 1))} className="theme-stepper-btn" aria-label={`Decrease ${label}`}>
          <Minus className="h-4 w-4" />
        </button>
        <span className="font-data w-8 text-center text-lg font-black text-slate-900 tabular-nums">{value}</span>
        <button type="button" onClick={() => onChange(value + 1)} className="theme-stepper-btn" aria-label={`Increase ${label}`}>
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function CounterPair({
  scored,
  onScored,
  missed,
  onMissed,
}: {
  scored: number;
  onScored: (n: number) => void;
  missed: number;
  onMissed: (n: number) => void;
}) {
  return (
    <div className="mt-2 grid grid-cols-1 gap-1 rounded-2xl border border-white/60 bg-white/35 p-3 sm:grid-cols-2 sm:gap-4">
      <Stepper label="Scored Fuel" value={scored} onChange={onScored} />
      <Stepper label="Missed Fuel" value={missed} onChange={onMissed} />
    </div>
  );
}

function ScaleSlider({
  label,
  scaleValue,
  onChange,
  max,
  scaleLabel,
  pitValue,
}: {
  label: string;
  scaleValue: number;
  onChange: (n: number) => void;
  max: number;
  scaleLabel: string;
  pitValue: number | null;
}) {
  return (
    <div className="py-1.5">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-slate-700">{label}</span>
        <span className="font-data text-xs font-bold text-red-800">
          {scaleLabel}
          {pitValue !== null && <span className="ml-2 text-slate-500">Pit: {pitValue}</span>}
        </span>
      </div>
      <input type="range" min={0} max={max} value={scaleValue} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-red-700" />
    </div>
  );
}

function LeadScaleSelector({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const safeValue = Math.min(5, Math.max(1, value || 1));
  return (
    <div>
      <input type="range" min={1} max={5} value={safeValue} onChange={(event) => onChange(Number(event.target.value))} className="w-full accent-red-700" />
      <div className="mt-1 flex justify-between font-data text-[11px] font-semibold text-slate-500">
        {LEAD_SKILL_LEVELS.map((level) => (
          <span key={level}>{level}</span>
        ))}
      </div>
    </div>
  );
}

function TeamPickerModal({
  open,
  teams,
  scoutedTeams,
  assignedTeams,
  subInStatuses,
  highlightedTeams,
  onClose,
  onSelect,
}: {
  open: boolean;
  teams: string[];
  scoutedTeams: Set<string>;
  assignedTeams?: Set<string>;
  subInStatuses?: Record<string, "requested" | "assigned">;
  highlightedTeams?: Set<string>;
  onClose: () => void;
  onSelect: (team: string) => void;
}) {
  return (
    <ReefscapeStyleModal open={open} onClose={onClose} step="qualification">
      <h2 className="font-display text-2xl text-slate-950">Select Team</h2>
      <div className="mt-4 max-h-[60vh] overflow-y-auto rounded-2xl border border-amber-200/60 p-2">
        {teams.length === 0 ? (
          <p className="p-3 text-sm text-slate-600">No robots detected for this match.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {teams.map((team) => {
              const done = scoutedTeams.has(team);
              const assigned = assignedTeams?.has(team);
              const subStatus = subInStatuses?.[team];
              const highlighted = highlightedTeams?.has(team);
              const label = done
                ? `${team} (Scouted)`
                : subStatus === "assigned"
                  ? `${team} (Sub Assigned)`
                  : subStatus === "requested"
                    ? `${team} (Sub Req)`
                    : assigned
                      ? `${team} (Assigned)`
                      : team;
              return (
                <button
                  key={team}
                  type="button"
                  disabled={done}
                  onClick={() => {
                    onSelect(team);
                    onClose();
                  }}
                  className={`rounded-xl border p-3 text-left font-data text-sm font-bold ${
                    done
                      ? "cursor-not-allowed border-slate-300 bg-slate-100 text-slate-400"
                      : highlighted
                        ? "border-amber-400 bg-amber-50 text-amber-950"
                        : "border-red-300/60 bg-white hover:bg-red-50"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <Action variant="secondary" onClick={onClose} className="mt-4 w-full">
        Close
      </Action>
    </ReefscapeStyleModal>
  );
}

/* ==========================================================================
   Scout form content — full logic parity with the flagship reference,
   composed entirely from the floating-HUD primitive library.
   ========================================================================== */

function ScoutFormContent() {
  const router = useRouter();
  const { userData, teamTimeOverride } = useAuth();
  const searchParams = useSearchParams();
  const editId = searchParams.get("editId");
  const editCollectionParam = searchParams.get("editCollection");
  const editMode = Boolean(editId);
  const editCollectionName =
    editCollectionParam || (searchParams.get("lead") === "1" ? "leadScouting" : "scouting");
  const [editEntry, setEditEntry] = useState<Record<string, unknown> | null>(null);
  const [editEventKey, setEditEventKey] = useState<string | null>(null);
  const [editMatchId, setEditMatchId] = useState<string>("");
  const [mobileNotesOpen, setMobileNotesOpen] = useState(false);
  const [eventKey, setEventKey] = useState("app-testing");
  const [modalOpen, setModalOpen] = useState(false);
  const [subInRequestOpen, setSubInRequestOpen] = useState(false);
  const [subInModalOpen, setSubInModalOpen] = useState(false);
  const [subInRequestStep, setSubInRequestStep] = useState<"choice" | "range">("choice");
  const [subInRangeType, setSubInRangeType] = useState<MatchType>("qualification");
  const [subInRangeStart, setSubInRangeStart] = useState("");
  const [subInRangeEnd, setSubInRangeEnd] = useState("");
  const [subInSubmitting, setSubInSubmitting] = useState(false);
  const [showTeamPicker, setShowTeamPicker] = useState(false);
  const [options, setOptions] = useState<MatchOption[]>([]);
  const [modalCompleted, setModalCompleted] = useState<Set<string>>(new Set());
  const leadMode = searchParams.get("lead") === "1";
  const [selectedMatch, setSelectedMatch] = useState<MatchOption | null>(null);
  const [assignedTeams, setAssignedTeams] = useState<Record<string, string>>({});
  const [assignedTeamsByMatch, setAssignedTeamsByMatch] = useState<Record<string, string[]>>({});
  const [assignedMatchIds, setAssignedMatchIds] = useState<Set<string>>(new Set());
  const [assignedHumanPlayerMatches, setAssignedHumanPlayerMatches] = useState<Set<string>>(new Set());
  const [subInStatusByMatch, setSubInStatusByMatch] = useState<Record<string, Record<string, "requested" | "assigned">>>({});
  const [subInClaimsForUser, setSubInClaimsForUser] = useState<Record<string, string>>({});
  const [scoutedTeamsByMatch, setScoutedTeamsByMatch] = useState<Record<string, string[]>>({});
  const [scoutedCounts, setScoutedCounts] = useState<Record<string, number>>({});
  const [targets, setTargets] = useState<Record<string, number>>({});
  const [pitSync, setPitSync] = useState<{
    eventSynced: boolean;
    preloadRaw: number | null;
    bpsRaw: number | null;
    carryRaw: number | null;
  }>({
    eventSynced: false,
    preloadRaw: null,
    bpsRaw: null,
    carryRaw: null,
  });
  const [saving, setSaving] = useState(false);
  const [leadSaving, setLeadSaving] = useState(false);
  const [leadForm, setLeadForm] = useState<LeadFormState>({
    scoutName: userData?.displayName || "",
    alliance: "",
    robot1TeamNumber: "",
    robot1PickNumber: "",
    robot1Notes: "",
    robot1SkillLevel: 1,
    robot2TeamNumber: "",
    robot2PickNumber: "",
    robot2Notes: "",
    robot2SkillLevel: 1,
    robot3TeamNumber: "",
    robot3PickNumber: "",
    robot3Notes: "",
    robot3SkillLevel: 1,
    overallAllianceTeams: "",
    overallAllianceNotes: "",
    overallAllianceSkillLevel: 1,
  });
  const [overallAllianceTeamsTouched, setOverallAllianceTeamsTouched] = useState(false);
  const [leadTeamPickerOpen, setLeadTeamPickerOpen] = useState(false);
  const [leadTeamPickerTarget, setLeadTeamPickerTarget] = useState<"robot1" | "robot2" | "robot3" | null>(null);
  const [form, setForm] = useState<FormState>({
    scoutName: userData?.displayName || "",
    teamNumber: "",
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
    hubActivationOverride: false,
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
    incidents: [],
    notes: "",
  });

  const [autoCycles, setAutoCycles] = useState<number[]>([]);
  const [transitionCycles, setTransitionCycles] = useState<number[]>([]);
  const [shift1Cycles, setShift1Cycles] = useState<number[]>([]);
  const [shift2Cycles, setShift2Cycles] = useState<number[]>([]);
  const [shift3Cycles, setShift3Cycles] = useState<number[]>([]);
  const [shift4Cycles, setShift4Cycles] = useState<number[]>([]);
  const [endgameCycles, setEndgameCycles] = useState<number[]>([]);

  useEffect(() => {
    if (!userData?.displayName) return;
    if (!editMode) {
      setForm((prev) => ({ ...prev, scoutName: userData.displayName }));
      setLeadForm((prev) => ({ ...prev, scoutName: userData.displayName }));
    }
  }, [userData?.displayName]);

  useEffect(() => {
    if (!editId) return;
    let isActive = true;
    const editIdValue = editId;
    const collectionName: string = editCollectionName;
    async function loadEditEntry() {
      try {
        const snap = await getDoc(doc(db, collectionName, editIdValue));
        if (!snap.exists()) return;
        const data = snap.data() as Record<string, unknown>;
        if (!isActive) return;
        setEditEntry(data);
        const entryEventKey = String(data.eventKey || "").trim();
        setEditEventKey(entryEventKey || null);
        const matchId = normalizeScoutedMatchId(data.matchId || data.matchKey || data.matchLabel || "");
        setEditMatchId(matchId);
        if (searchParams.get("lead") === "1") {
          const robots = Array.isArray(data.robots) ? data.robots : [];
          const overall = (data.overallAlliance || {}) as Record<string, unknown>;
          const rawAlliance = String(data.alliance || "");
          const normalizedAlliance: LeadFormState["alliance"] =
            rawAlliance === "red" || rawAlliance === "blue" ? rawAlliance : "";
          setLeadForm((prev) => ({
            ...prev,
            scoutName: String(data.scoutName || prev.scoutName || ""),
            alliance: normalizedAlliance,
            robot1TeamNumber: String((robots[0] as { teamNumber?: string } | undefined)?.teamNumber || ""),
            robot1Notes: String((robots[0] as { notes?: string } | undefined)?.notes || ""),
            robot1SkillLevel: Number((robots[0] as { skillLevel?: number } | undefined)?.skillLevel || 1),
            robot2TeamNumber: String((robots[1] as { teamNumber?: string } | undefined)?.teamNumber || ""),
            robot2Notes: String((robots[1] as { notes?: string } | undefined)?.notes || ""),
            robot2SkillLevel: Number((robots[1] as { skillLevel?: number } | undefined)?.skillLevel || 1),
            robot3TeamNumber: String((robots[2] as { teamNumber?: string } | undefined)?.teamNumber || ""),
            robot3Notes: String((robots[2] as { notes?: string } | undefined)?.notes || ""),
            robot3SkillLevel: Number((robots[2] as { skillLevel?: number } | undefined)?.skillLevel || 1),
            overallAllianceTeams: String(overall.teams || data.overallAllianceTeams || ""),
            overallAllianceNotes: String(overall.notes || ""),
            overallAllianceSkillLevel: Number(overall.skillLevel || 1),
          }));
          setOverallAllianceTeamsTouched(true);
        } else {
          const auto = (data.auto || {}) as Record<string, unknown>;
          const teleop = (data.teleop || {}) as Record<string, unknown>;
          const endgame = (data.endgame || {}) as Record<string, unknown>;
          setForm((prev) => ({
            ...prev,
            scoutName: String(data.scoutName || prev.scoutName || ""),
            teamNumber: String(data.teamNumber || ""),
            startingPosition: String(data.startingPosition || ""),
            autoPreloadScale: Number(auto.preloadScale ?? prev.autoPreloadScale ?? 0),
            autoBpsScale: Number(auto.bpsScale ?? prev.autoBpsScale ?? 0),
            autoCarryScale: Number(auto.carryingScale ?? prev.autoCarryScale ?? 0),
            autoHumanPlayerFuel: Number(auto.humanPlayerFuel ?? prev.autoHumanPlayerFuel ?? 0),
            autoCounterOverride: Number(auto.counterOverride ?? prev.autoCounterOverride ?? 0),
            autoCounterMissedFuel: Number(auto.counterOverrideMissedFuel ?? prev.autoCounterMissedFuel ?? 0),
            autoFailedClimb: Number(auto.failedClimb ?? prev.autoFailedClimb ?? 0),
            autoSuccessfulClimb: Boolean(auto.successfulClimb),
            wonAuto: Boolean(auto.wonAuto),
            hubActivationOverride: Boolean(auto.hubActivationOverride),
            teleBpsScale: Number(teleop.bpsScale ?? prev.teleBpsScale ?? 0),
            teleCarryScale: Number(teleop.carryingScale ?? prev.teleCarryScale ?? 0),
            transitionCounterOverride: Number(teleop.transitionOverride ?? prev.transitionCounterOverride ?? 0),
            transitionCounterMissedFuel: Number(teleop.transitionMissedFuel ?? prev.transitionCounterMissedFuel ?? 0),
            shift1CounterOverride: Number(teleop.shift1Override ?? prev.shift1CounterOverride ?? 0),
            shift1CounterMissedFuel: Number(teleop.shift1MissedFuel ?? prev.shift1CounterMissedFuel ?? 0),
            shift2CounterOverride: Number(teleop.shift2Override ?? prev.shift2CounterOverride ?? 0),
            shift2CounterMissedFuel: Number(teleop.shift2MissedFuel ?? prev.shift2CounterMissedFuel ?? 0),
            shift3CounterOverride: Number(teleop.shift3Override ?? prev.shift3CounterOverride ?? 0),
            shift3CounterMissedFuel: Number(teleop.shift3MissedFuel ?? prev.shift3CounterMissedFuel ?? 0),
            shift4CounterOverride: Number(teleop.shift4Override ?? prev.shift4CounterOverride ?? 0),
            shift4CounterMissedFuel: Number(teleop.shift4MissedFuel ?? prev.shift4CounterMissedFuel ?? 0),
            teleopHumanPlayerFuel: Number(teleop.humanPlayerFuel ?? prev.teleopHumanPlayerFuel ?? 0),
            endgameCounterOverride: Number(endgame.counterOverride ?? prev.endgameCounterOverride ?? 0),
            endgameCounterMissedFuel: Number(endgame.counterOverrideMissedFuel ?? prev.endgameCounterMissedFuel ?? 0),
            endgameHumanPlayerFuel: Number(endgame.humanPlayerFuel ?? prev.endgameHumanPlayerFuel ?? 0),
            endgameFailedClimb: Number(endgame.failedClimb ?? prev.endgameFailedClimb ?? 0),
            endgameStatus: String(endgame.status || prev.endgameStatus || ""),
            incidents: Array.isArray(data.incidents) ? data.incidents.map((value) => String(value)) : [],
            notes: String(data.notes || ""),
          }));
          setAutoCycles(Array.isArray(auto.cycleTimes) ? auto.cycleTimes.map(Number) : []);
          setTransitionCycles(Array.isArray(teleop.transitionCycles) ? teleop.transitionCycles.map(Number) : []);
          setShift1Cycles(Array.isArray(teleop.shift1Cycles) ? teleop.shift1Cycles.map(Number) : []);
          setShift2Cycles(Array.isArray(teleop.shift2Cycles) ? teleop.shift2Cycles.map(Number) : []);
          setShift3Cycles(Array.isArray(teleop.shift3Cycles) ? teleop.shift3Cycles.map(Number) : []);
          setShift4Cycles(Array.isArray(teleop.shift4Cycles) ? teleop.shift4Cycles.map(Number) : []);
          setEndgameCycles(Array.isArray(endgame.cycleTimes) ? endgame.cycleTimes.map(Number) : []);
        }
      } catch (error) {
        console.error("Failed to load edit entry:", error);
      }
    }
    void loadEditEntry();
    return () => {
      isActive = false;
    };
  }, [editId, editCollectionParam, searchParams]);

  useEffect(() => {
    async function loadEventContext() {
      if (!userData?.teamId) {
        setEventKey("app-testing");
        const fallback = buildFallbackScoutOptions();
        setOptions(fallback);
        setTargets({});
        setModalCompleted(new Set());
        setAssignedHumanPlayerMatches(new Set());
        setAssignedMatchIds(new Set());
        setSelectedMatch((current) => current || fallback.find((m) => m.type === "qualification") || fallback[0] || null);
        return;
      }
      try {
        const overrideEvent = editMode ? editEventKey : null;
        const assignmentSnap = overrideEvent
          ? null
          : await getDocs(query(collection(db, "matchAssignments"), where("scoutId", "==", userData.uid)));
        const currentEvent = overrideEvent ? overrideEvent : await resolveDetectedTeamEventKey(userData.teamId);
        const normalizedCurrent = String(currentEvent || "").trim().toLowerCase();
        const assignedEventCounts = new Map<string, number>();
        assignmentSnap?.docs.forEach((row) => {
          const data = row.data() as AssignmentRow;
          const key = String(data.eventKey || "").trim().toLowerCase();
          if (!key) return;
          assignedEventCounts.set(key, (assignedEventCounts.get(key) || 0) + 1);
        });
        if (assignedEventCounts.size === 0) {
          const detectedEvent = normalizedCurrent || "app-testing";
          setEventKey(detectedEvent);
          if (detectedEvent === "app-testing") {
            const fallback = buildFallbackScoutOptions();
            setOptions(fallback);
            setTargets({});
            setModalCompleted(new Set());
            setAssignedHumanPlayerMatches(new Set());
            setAssignedMatchIds(new Set());
            setSelectedMatch((current) => current || fallback.find((m) => m.type === "qualification") || fallback[0] || null);
            return;
          }
        }

        const assignedEvent = leadMode && normalizedCurrent && normalizedCurrent !== "app-testing"
          ? normalizedCurrent
          : assignedEventCounts.size === 0
            ? (normalizedCurrent || "app-testing")
            : (normalizedCurrent && assignedEventCounts.has(normalizedCurrent))
              ? normalizedCurrent
              : Array.from(assignedEventCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "app-testing";
        setEventKey(assignedEvent);
        if (assignedEvent === "app-testing") {
          const fallback = buildFallbackScoutOptions();
          setOptions(fallback);
          setTargets({});
          setModalCompleted(new Set());
          setAssignedHumanPlayerMatches(new Set());
          setAssignedMatchIds(new Set());
          setSelectedMatch((current) => current || fallback.find((m) => m.type === "qualification") || fallback[0] || null);
          return;
        }

        const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
        const teamData = teamDoc.data() as Record<string, unknown> | undefined;
        const encryptedKey = String(teamData?.tbaApiKeyEncrypted || "").trim();
        const plainKey = String(teamData?.tbaApiKey || "").trim();
        const attendeesByEvent = (teamData?.eventAttendees || {}) as Record<string, string[]>;
        let matches = await fetchEventMatchesWithTeamAuth(assignedEvent, { encryptedKey, plainKey });
        const firstSchedule = await fetchFirstSchedule(assignedEvent, "Practice");
        const practiceFromFirst = firstSchedule
          .map((match) => {
            const { red, blue } = splitFirstAllianceTeams(match);
            const redScore = typeof match.redScore === "number" && Number.isFinite(match.redScore) ? match.redScore : -1;
            const blueScore = typeof match.blueScore === "number" && Number.isFinite(match.blueScore) ? match.blueScore : -1;
            const hasScore = redScore >= 0 && blueScore >= 0;
            return {
              key: `${assignedEvent}_pr${match.matchNumber}`,
              comp_level: "pr",
              set_number: 1,
              match_number: match.matchNumber,
              alliances: {
                red: { team_keys: red.map((team) => `frc${team}`), score: redScore },
                blue: { team_keys: blue.map((team) => `frc${team}`), score: blueScore },
              },
              time: match.startTime || 0,
              predicted_time: match.startTime || 0,
              actual_time: hasScore && match.startTime ? match.startTime : 0,
            } as TBAMatch;
          })
          .filter((match) => match.alliances.red.team_keys.length >= 3 && match.alliances.blue.team_keys.length >= 3);
        if (practiceFromFirst.length > 0) {
          matches = [...matches.filter((match) => match.comp_level !== "pr"), ...practiceFromFirst];
        }

        const modalOptions = buildReefscapeModalOptions(matches);
        const teamsById = new Map<string, { teams: string[]; scheduleTime: number; redTeams: string[]; blueTeams: string[] }>();
        matches.forEach((match) => {
          const modalId = mapTbaMatchToModalId(match);
          if (!modalId) return;
          const redTeams = match.alliances.red.team_keys.map((k) => k.replace("frc", "").trim()).filter(Boolean);
          const blueTeams = match.alliances.blue.team_keys.map((k) => k.replace("frc", "").trim()).filter(Boolean);
          const teams = [...redTeams, ...blueTeams];
          const scheduleTime = getTbaScheduleTime(match);
          const existing = teamsById.get(modalId);
          if (!existing) {
            teamsById.set(modalId, { teams, scheduleTime, redTeams, blueTeams });
            return;
          }
          if ((existing.scheduleTime <= 0 && scheduleTime > 0) || (scheduleTime > 0 && scheduleTime < existing.scheduleTime)) {
            teamsById.set(modalId, { teams, scheduleTime, redTeams, blueTeams });
          }
        });

        const nextTargets: Record<string, number> = {};
        const next = modalOptions.map((opt) => {
          const stored = teamsById.get(opt.id);
          const teams = stored?.teams || [];
          nextTargets[opt.id] = teams.length || 6;
          return { ...opt, teams, redTeams: stored?.redTeams || [], blueTeams: stored?.blueTeams || [] };
        });
        const resolved = next.length > 0 ? next : buildFallbackScoutOptions();
        setOptions(resolved);
        setTargets(next.length > 0 ? nextTargets : {});
        const completionNow = getEffectiveNowSec(teamTimeOverride);
        const completedSet = matches.length > 0 ? buildCompletedModalIdsFromTba(matches, completionNow) : new Set<string>();
        const debugEnabled =
          typeof window !== "undefined" &&
          new URLSearchParams(window.location.search).get("debug") === "1";
        const completedFromForms = await fetchCompletedMatchIds(assignedEvent, userData.teamId || "", {
          enabled: debugEnabled,
          label: "loadEventContext",
        });
        completedFromForms.forEach((id) => completedSet.add(id));
        setModalCompleted(completedSet);

        if (overrideEvent || leadMode) {
          setAssignedTeams({});
          setAssignedMatchIds(new Set());
          setAssignedHumanPlayerMatches(new Set());
        } else {
          const assignmentDocsByEvent = (
            await Promise.all(
              expandEventKeyAliases(assignedEvent).map((key) =>
                getDocs(query(collection(db, "matchAssignments"), where("eventKey", "==", key), where("scoutId", "==", userData.uid)))
              )
            )
          ).flatMap((snap) => snap.docs);
          const assigned: Record<string, string> = {};
          const assignedMatchIds = new Set<string>();
          const assignedHumanPlayer = new Set<string>();
          assignmentDocsByEvent.forEach((row) => {
            const data = row.data() as AssignmentRow;
            const matchId = mapAssignmentToMatchId(String(data.matchKey || data.matchLabel || ""));
            const team = String(data.teamNumber || "").trim();
            if (matchId) {
              assignedMatchIds.add(matchId);
              if (team) assigned[matchId] = team;
              if (data.scoutHumanPlayer) assignedHumanPlayer.add(matchId);
            }
          });
          setAssignedTeams(assigned);
          setAssignedMatchIds(assignedMatchIds);
          setAssignedHumanPlayerMatches(assignedHumanPlayer);
        }

        if (overrideEvent || leadMode) {
          setAssignedTeamsByMatch({});
        } else {
          try {
            const assignmentDocsAll = (
              await Promise.all(
                expandEventKeyAliases(assignedEvent).map((key) =>
                  getDocs(query(collection(db, "matchAssignments"), where("eventKey", "==", key)))
                )
              )
            ).flatMap((snap) => snap.docs);
            const byMatch = new Map<string, Set<string>>();
            assignmentDocsAll.forEach((row) => {
              const data = row.data() as AssignmentRow;
              const matchId = mapAssignmentToMatchId(String(data.matchKey || data.matchLabel || ""));
              const team = String(data.teamNumber || "").trim();
              if (!matchId || !team) return;
              if (!byMatch.has(matchId)) byMatch.set(matchId, new Set<string>());
              byMatch.get(matchId)?.add(team);
            });
            setAssignedTeamsByMatch(
              Object.fromEntries(Array.from(byMatch.entries()).map(([key, value]) => [key, Array.from(value)]))
            );
          } catch (error) {
            console.warn("Unable to load assigned teams for match list:", error);
            setAssignedTeamsByMatch({});
          }
        }

        const now = getEffectiveNowSec(teamTimeOverride);
        const graceSeconds = 10 * 60;
        const matchTypeOrder: Record<MatchType, number> = { qualification: 0, practice: 1, finals: 2 };
        const pickNextBySchedule = (rows: MatchOption[]) => {
          const scheduled = rows
            .map((match) => ({ match, time: Number(match.scheduleTime || 0) }))
            .filter((row) => row.time > 0 && row.time >= now - graceSeconds)
            .sort((a, b) => {
              const typeDiff = matchTypeOrder[a.match.type] - matchTypeOrder[b.match.type];
              if (typeDiff !== 0) return typeDiff;
              if (a.time !== b.time) return a.time - b.time;
              return a.match.matchNumber - b.match.matchNumber;
            });
          if (scheduled.length > 0) return scheduled[0]?.match || null;
          return rows
            .slice()
            .sort((a, b) => {
              const typeDiff = matchTypeOrder[a.type] - matchTypeOrder[b.type];
              if (typeDiff !== 0) return typeDiff;
              return a.matchNumber - b.matchNumber;
            })[0] || null;
        };
        const pickFirstIncomplete = (rows: MatchOption[]) => {
          const ordered = rows
            .slice()
            .sort((a, b) => {
              const typeDiff = matchTypeOrder[a.type] - matchTypeOrder[b.type];
              if (typeDiff !== 0) return typeDiff;
              return a.matchNumber - b.matchNumber;
            });
          return ordered.find((match) => !completedSet.has(match.id)) || null;
        };

        let nextMatch: MatchOption | null = null;
        let forceAssignedMatch = false;
        const editKey = editMatchId ? editMatchId.replace(/m\d+$/i, "") : "";
        const editTarget = editMatchId
          ? resolved.find((match) => {
              if (match.id === editMatchId || match.id === editKey) return true;
              const normalizedLabel = normalizeScoutedMatchId(match.label);
              return normalizedLabel === editMatchId || normalizedLabel === editKey;
            }) || null
          : null;
        if (editMode && editTarget) {
          nextMatch = editTarget;
        } else if (leadMode) {
          nextMatch = pickNextBySchedule(resolved) || pickFirstIncomplete(resolved);
        } else if (overrideEvent) {
          nextMatch = pickFirstIncomplete(resolved) || pickNextBySchedule(resolved);
        } else {
          const assignedMatches = resolved.filter((match) => assignedMatchIds.has(match.id));
          const isAttending = assignedMatchIds.size > 0 || isUserAttendingEvent(attendeesByEvent, assignedEvent, userData);
          if (assignedMatches.length > 0) {
            nextMatch = pickFirstIncomplete(assignedMatches) || pickNextBySchedule(assignedMatches);
            forceAssignedMatch = true;
          } else if (!isAttending) {
            nextMatch =
              resolved.find((match) => match.type === "qualification" && match.matchNumber === 1) ||
              resolved.find((match) => match.type === "qualification") ||
              resolved[0] ||
              null;
          } else {
            nextMatch = pickFirstIncomplete(resolved) || pickNextBySchedule(resolved);
          }
        }
        setSelectedMatch((current) => {
          if (editMode) {
            if (editTarget) return editTarget;
            return current || null;
          }
          if (!nextMatch) return current || null;
          if (!current) return nextMatch;
          const currentStillExists = resolved.some((match) => match.id === current.id);
          if (!currentStillExists) return nextMatch;
          if (!leadMode && forceAssignedMatch && nextMatch && !assignedMatchIds.has(current.id)) return nextMatch;
          if (completedSet.has(current.id)) return nextMatch;
          if (current.type === "practice" && nextMatch.type !== "practice") return nextMatch;
          return current;
        });
      } catch (error) {
        console.error("Failed to load match context:", error);
        const fallback = buildFallbackScoutOptions();
        setOptions(fallback);
        setTargets({});
        setModalCompleted(new Set());
        setAssignedHumanPlayerMatches(new Set());
        setAssignedMatchIds(new Set());
        setSelectedMatch((current) => current || fallback.find((m) => m.type === "qualification") || fallback[0] || null);
      }
    }
    void loadEventContext();
  }, [userData?.teamId, userData?.uid, teamTimeOverride?.enabled, teamTimeOverride?.offsetMs, editMode, editEventKey, editMatchId, leadMode]);

  useEffect(() => {
    async function loadScouted() {
      if (!eventKey) return;
      const scoutingDocs = (
        await Promise.all(
          expandEventKeyAliases(eventKey).map((key) => getDocs(query(collection(db, "scouting"), where("eventKey", "==", key))))
        )
      ).flatMap((snap) => snap.docs);
      const counts: Record<string, number> = {};
      const teamsMap = new Map<string, Set<string>>();
      const subStatuses: Record<string, Record<string, "requested" | "assigned">> = {};
      const userClaims: Record<string, string> = {};
      const completedFromScouting = new Set<string>();
      scoutingDocs.forEach((d) => {
        const row = d.data() as Record<string, unknown>;
        const entryType = String(row.entryType || row.formType || "").toLowerCase().trim();
        const matchId = normalizeScoutedMatchId(row.matchId || row.matchKey || row.matchLabel);
        const team = String(row.teamNumber || "").trim();
        if (entryType === "sub-in-request" || entryType === "sub-in-claim") {
          if (matchId && team) {
            if (!subStatuses[matchId]) subStatuses[matchId] = {};
            if (entryType === "sub-in-claim") {
              subStatuses[matchId][team] = "assigned";
            } else if (subStatuses[matchId][team] !== "assigned") {
              subStatuses[matchId][team] = "requested";
            }
          }
          if (entryType === "sub-in-claim" && userData?.uid) {
            const claimant = String(row.claimedById || row.scoutId || "").trim();
            if (claimant && claimant === userData.uid && matchId && team) {
              userClaims[matchId] = team;
            }
          }
          return;
        }
        if (!matchId) return;
        completedFromScouting.add(matchId);
        counts[matchId] = (counts[matchId] || 0) + 1;
        if (!teamsMap.has(matchId)) teamsMap.set(matchId, new Set<string>());
        if (team) teamsMap.get(matchId)?.add(team);
      });
      const debugEnabled =
        typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).get("debug") === "1";
      const completedFromForms = await fetchCompletedMatchIds(eventKey, userData?.teamId || "", {
        enabled: debugEnabled,
        label: "loadScouted",
      });
      completedFromForms.forEach((id) => completedFromScouting.add(id));
      if (completedFromScouting.size > 0) {
        setModalCompleted((prev) => {
          const next = new Set(prev);
          completedFromScouting.forEach((id) => next.add(id));
          return next;
        });
      }
      setScoutedCounts(counts);
      setScoutedTeamsByMatch(Object.fromEntries(Array.from(teamsMap.entries()).map(([k, v]) => [k, Array.from(v)])));
      setSubInStatusByMatch(subStatuses);
      setSubInClaimsForUser(userClaims);
      if (!leadMode && Object.keys(userClaims).length > 0) {
        setAssignedTeams((prev) => ({ ...prev, ...userClaims }));
        setAssignedMatchIds((prev) => {
          const next = new Set(prev);
          Object.keys(userClaims).forEach((match) => next.add(match));
          return next;
        });
      }
    }
    void loadScouted();
  }, [eventKey, userData?.uid, leadMode]);

  useEffect(() => {
    if (editMode) return;
    if (options.length === 0) return;
    const matchTypeOrder: Record<MatchType, number> = { practice: 0, qualification: 1, finals: 2 };
    const sortByTypeAndNumber = (a: MatchOption, b: MatchOption) => {
      const typeDiff = matchTypeOrder[a.type] - matchTypeOrder[b.type];
      if (typeDiff !== 0) return typeDiff;
      return a.matchNumber - b.matchNumber;
    };
    const pickFirstIncomplete = (rows: MatchOption[]) => {
      const ordered = rows.slice().sort(sortByTypeAndNumber);
      return ordered.find((match) => !modalCompleted.has(match.id)) || null;
    };
    const pickNextBySchedule = (rows: MatchOption[]) => {
      const nowSec = Math.floor(Date.now() / 1000);
      const graceSeconds = 10 * 60;
      const scheduled = rows
        .filter((match) => match.scheduleTime > 0 && match.scheduleTime >= nowSec - graceSeconds)
        .sort((a, b) => {
          const typeDiff = matchTypeOrder[a.type] - matchTypeOrder[b.type];
          if (typeDiff !== 0) return typeDiff;
          if (a.scheduleTime !== b.scheduleTime) return a.scheduleTime - b.scheduleTime;
          return a.matchNumber - b.matchNumber;
        });
      if (scheduled.length > 0) return scheduled[0];
      return rows.slice().sort(sortByTypeAndNumber)[0] || null;
    };
    const assignedMatches = options.filter((match) => assignedMatchIds.has(match.id));
    const next = leadMode
      ? pickNextBySchedule(options) || pickFirstIncomplete(options)
      : assignedMatches.length > 0
        ? pickFirstIncomplete(assignedMatches) || pickNextBySchedule(assignedMatches)
        : pickFirstIncomplete(options) || pickNextBySchedule(options);
    if (!next) return;
    setSelectedMatch((current) => {
      if (!current) return next;
      if (!options.some((match) => match.id === current.id)) return next;
      if (modalCompleted.has(current.id)) return next;
      if (!leadMode && assignedMatches.length > 0 && !assignedMatchIds.has(current.id)) return next;
      return current;
    });
  }, [modalCompleted, options, assignedMatchIds, editMode, leadMode]);

  const selectedMatchId = selectedMatch?.id || "";
  const selectedTeams = selectedMatch?.teams || [];
  const selectedScoutedTeams = useMemo(() => new Set(scoutedTeamsByMatch[selectedMatchId] || []), [scoutedTeamsByMatch, selectedMatchId]);
  const effectiveAssignedTeams = useMemo(() => ({ ...assignedTeams, ...subInClaimsForUser }), [assignedTeams, subInClaimsForUser]);
  const effectiveAssignedMatchIds = useMemo(() => {
    const next = new Set(assignedMatchIds);
    Object.keys(subInClaimsForUser).forEach((matchId) => next.add(matchId));
    return next;
  }, [assignedMatchIds, subInClaimsForUser]);
  const assignedTeam = effectiveAssignedTeams[selectedMatchId] || "";
  const selectedAssignedTeams = useMemo(() => new Set(assignedTeamsByMatch[selectedMatchId] || []), [assignedTeamsByMatch, selectedMatchId]);
  const selectedSubInStatuses = useMemo(() => subInStatusByMatch[selectedMatchId] || {}, [subInStatusByMatch, selectedMatchId]);
  const highlightedAssignedTeams = useMemo(() => (assignedTeam ? new Set([assignedTeam]) : new Set<string>()), [assignedTeam]);
  const isHumanPlayerAssigned = assignedHumanPlayerMatches.has(selectedMatchId);
  const selectedRedTeams = selectedMatch?.redTeams || [];
  const selectedBlueTeams = selectedMatch?.blueTeams || [];
  const leadAllianceTeams = useMemo(() => {
    if (leadForm.alliance === "red") return selectedRedTeams;
    if (leadForm.alliance === "blue") return selectedBlueTeams;
    return [] as string[];
  }, [leadForm.alliance, selectedRedTeams, selectedBlueTeams]);
  const pitPreloadFits = pitValueFitsScale("preload", pitSync.preloadRaw, form.autoPreloadScale);
  const pitBpsFitsAuto = pitValueFitsScale("bps", pitSync.bpsRaw, form.autoBpsScale);
  const pitBpsFitsTele = pitValueFitsScale("bps", pitSync.bpsRaw, form.teleBpsScale);
  const pitCarryFitsAuto = pitValueFitsScale("carry", pitSync.carryRaw, form.autoCarryScale);
  const pitCarryFitsTele = pitValueFitsScale("carry", pitSync.carryRaw, form.teleCarryScale);
  const pitMismatchMessages = useMemo(() => {
    if (!pitSync.eventSynced) return [] as string[];
    const messages: string[] = [];
    if (pitSync.preloadRaw !== null && !pitPreloadFits) messages.push(`Preload Capacity scale does not include pit value ${pitSync.preloadRaw}.`);
    if (pitSync.bpsRaw !== null && !pitBpsFitsAuto) messages.push(`Autonomous Balls Per Second scale does not include pit value ${pitSync.bpsRaw}.`);
    if (pitSync.bpsRaw !== null && !pitBpsFitsTele) messages.push(`Teleop Balls Per Second scale does not include pit value ${pitSync.bpsRaw}.`);
    if (pitSync.carryRaw !== null && !pitCarryFitsAuto) messages.push(`Autonomous Carrying Capacity scale does not include pit value ${pitSync.carryRaw}.`);
    if (pitSync.carryRaw !== null && !pitCarryFitsTele) messages.push(`Teleop Carrying Capacity scale does not include pit value ${pitSync.carryRaw}.`);
    return messages;
  }, [pitSync.eventSynced, pitSync.preloadRaw, pitSync.bpsRaw, pitSync.carryRaw, pitPreloadFits, pitBpsFitsAuto, pitBpsFitsTele, pitCarryFitsAuto, pitCarryFitsTele]);

  function getFinalsDisplayLabel(match: MatchOption) {
    const id = String(match.id || "").toLowerCase();
    if (!id.startsWith("sf") && !id.startsWith("qf")) return `Finals ${match.matchNumber}`;
    const matchNum = match.matchNumber;
    if (matchNum === 1) return "Upper Bracket Match 1";
    if (matchNum === 2) return "Upper Bracket Match 2";
    if (matchNum === 3) return "Upper Bracket Match 3";
    if (matchNum === 4) return "Upper Bracket Match 4";
    if (matchNum === 5) return "Lower Bracket Match 5";
    if (matchNum === 6) return "Lower Bracket Match 6";
    if (matchNum === 7) return "Upper Bracket Match 7";
    if (matchNum === 8) return "Upper Bracket Match 8";
    if (matchNum === 9) return "Lower Bracket Match 9";
    if (matchNum === 10) return "Lower Bracket Match 10";
    if (matchNum === 11) return "Upper Bracket Match 11";
    if (matchNum === 12) return "Lower Bracket Match 12";
    if (matchNum === 13) return "Lower Bracket Match 13";
    return `Match ${matchNum}`;
  }

  function getSelectedMatchDisplay() {
    if (!selectedMatch) return "No match is set";
    if (selectedMatch.type === "practice") return `Practice Match ${selectedMatch.matchNumber}`;
    if (selectedMatch.type === "qualification") return `Qualification Match ${selectedMatch.matchNumber}`;
    if (selectedMatch.type === "finals") return getFinalsDisplayLabel(selectedMatch);
    return selectedMatch.label || "No match is set";
  }

  function getMatchDisplay(match: MatchOption) {
    if (match.type === "practice") return `Practice Match ${match.matchNumber}`;
    if (match.type === "qualification") return `Qualification Match ${match.matchNumber}`;
    if (match.type === "finals") return getFinalsDisplayLabel(match);
    return match.label || "Match";
  }

  async function submitSubInRequest(
    match: MatchOption,
    options?: { silent?: boolean; bypassSubmitting?: boolean }
  ): Promise<"requested" | "skipped" | "error"> {
    if (!userData?.teamId || !userData?.uid) {
      if (!options?.silent) alert("You must be signed in to request a sub-in.");
      return "error";
    }
    if (!eventKey || eventKey === "app-testing") {
      if (!options?.silent) alert("Select an event before requesting a sub-in.");
      return "error";
    }
    if (!effectiveAssignedMatchIds.has(match.id)) {
      if (!options?.silent) alert("You can only request a sub-in for matches assigned to you.");
      return "skipped";
    }
    if (!options?.bypassSubmitting && subInSubmitting) return "skipped";
    if (!options?.bypassSubmitting) setSubInSubmitting(true);
    try {
      const fallbackTeam = effectiveAssignedTeams[match.id] || assignedTeam || form.teamNumber;
      const parsedTeam = String(fallbackTeam || "").match(/\d+/)?.[0] || "";
      const teamValue = parsedTeam ? parsedTeam : "";
      if (!teamValue) {
        if (!options?.silent) alert("Team number missing for this match.");
        return "skipped";
      }
      const existingSub = subInStatusByMatch[match.id]?.[teamValue];
      if (existingSub === "requested") {
        if (!options?.silent) alert("A sub-in has already been requested for this team.");
        return "skipped";
      }
      if (existingSub === "assigned") {
        if (!options?.silent) alert("A sub-in has already been assigned for this team.");
        return "skipped";
      }
      const now = Date.now();
      await addDoc(collection(db, "scouting"), {
        entryType: "sub-in-request",
        formType: "sub-in-request",
        game: "REBUILT",
        teamId: userData.teamId,
        eventKey,
        matchId: match.id,
        matchKey: match.id,
        matchLabel: getMatchDisplay(match),
        matchType: match.type,
        matchNumber: String(match.matchNumber),
        teamNumber: teamValue,
        scoutId: userData.uid,
        scoutName: userData.displayName || "Scout",
        requestedById: userData.uid,
        requestedByName: userData.displayName || "Scout",
        submittedAt: now,
        requestedAt: now,
        timestamp: now,
      });
      setSubInStatusByMatch((prev) => {
        const next = { ...prev };
        const existing = next[match.id] || {};
        next[match.id] = { ...existing, [teamValue]: "requested" };
        return next;
      });
      if (!options?.silent) alert(`Sub-in requested for ${getMatchDisplay(match)}.`);
      return "requested";
    } catch (error) {
      console.error("Failed to submit sub-in request:", error);
      const message = error instanceof Error && error.message ? error.message : "Could not submit sub-in request.";
      if (!options?.silent) alert(message);
      return "error";
    } finally {
      if (!options?.bypassSubmitting) setSubInSubmitting(false);
    }
  }

  async function submitSubInRange() {
    if (!userData?.teamId || !userData?.uid) {
      alert("You must be signed in to request a sub-in.");
      return;
    }
    if (!eventKey || eventKey === "app-testing") {
      alert("Select an event before requesting a sub-in.");
      return;
    }
    const start = Number(String(subInRangeStart || "").replace(/[^\d]/g, ""));
    const end = Number(String(subInRangeEnd || "").replace(/[^\d]/g, ""));
    if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= 0) {
      alert("Enter a valid match range (e.g., 45-65).");
      return;
    }
    const min = Math.min(start, end);
    const max = Math.max(start, end);
    const matchesInRange = options.filter((match) => match.type === subInRangeType && match.matchNumber >= min && match.matchNumber <= max);
    const assignedInRange = matchesInRange.filter((match) => effectiveAssignedMatchIds.has(match.id));
    if (assignedInRange.length === 0) {
      alert("No assigned matches found in that range.");
      return;
    }
    if (subInSubmitting) return;
    setSubInSubmitting(true);
    let requested = 0;
    let skipped = 0;
    let errored = 0;
    for (const match of assignedInRange) {
      const result = await submitSubInRequest(match, { silent: true, bypassSubmitting: true });
      if (result === "requested") requested += 1;
      else if (result === "error") errored += 1;
      else skipped += 1;
    }
    setSubInSubmitting(false);
    alert(`Sub-in requests: ${requested} requested, ${skipped} skipped, ${errored} failed.`);
    setSubInRequestOpen(false);
  }

  useEffect(() => {
    if (!subInRequestOpen) return;
    setSubInRequestStep("choice");
    if (selectedMatch?.type) setSubInRangeType(selectedMatch.type);
    setSubInRangeStart("");
    setSubInRangeEnd("");
  }, [subInRequestOpen, selectedMatch?.type]);

  useEffect(() => {
    if (editMode) return;
    if (assignedTeam) setForm((prev) => ({ ...prev, teamNumber: assignedTeam }));
  }, [assignedTeam, editMode]);

  useEffect(() => {
    if (!leadForm.alliance) return;
    if (leadAllianceTeams.length === 0) return;
    setLeadForm((prev) => ({
      ...prev,
      robot1TeamNumber: leadAllianceTeams[0] || "",
      robot2TeamNumber: leadAllianceTeams[1] || "",
      robot3TeamNumber: leadAllianceTeams[2] || "",
    }));
  }, [leadForm.alliance, leadAllianceTeams]);

  useEffect(() => {
    if (overallAllianceTeamsTouched) return;
    if (!leadForm.alliance) return;
    const teamList = [leadForm.robot1TeamNumber, leadForm.robot2TeamNumber, leadForm.robot3TeamNumber].map((team) => team.trim()).filter(Boolean);
    if (teamList.length === 0) return;
    const allianceLabel = leadForm.alliance.toUpperCase();
    setLeadForm((prev) => ({ ...prev, overallAllianceTeams: `${allianceLabel} / ${teamList.join(", ")}` }));
  }, [leadForm.alliance, leadForm.robot1TeamNumber, leadForm.robot2TeamNumber, leadForm.robot3TeamNumber, overallAllianceTeamsTouched]);

  useEffect(() => {
    async function loadPitDefaults() {
      if (!userData?.teamId || !form.teamNumber.trim()) {
        setPitSync({ eventSynced: false, preloadRaw: null, bpsRaw: null, carryRaw: null });
        return;
      }
      const team = form.teamNumber.trim();
      const normalizedEventKey = String(eventKey || "").trim();
      const strictQuery = query(
        collection(db, "pitScouting"),
        where("teamId", "==", userData.teamId),
        where("teamNumber", "==", team),
        where("game", "==", "REBUILT")
      );
      const eventQuery = normalizedEventKey ? query(collection(db, "pitScouting"), where("eventKey", "==", normalizedEventKey)) : null;
      const rebuiltQuery = query(collection(db, "pitScouting"), where("game", "==", "REBUILT"));

      let rows = (await getDocs(strictQuery)).docs.map((r) => r.data() as Record<string, unknown>);
      if (rows.length === 0 && eventQuery) {
        rows = (await getDocs(eventQuery)).docs.map((r) => r.data() as Record<string, unknown>);
      }
      if (rows.length === 0) {
        rows = (await getDocs(rebuiltQuery)).docs.map((r) => r.data() as Record<string, unknown>);
      }
      const eventScopedRows = rows
        .filter((row) => normalizeTeamNumber(row.teamNumber) === normalizeTeamNumber(team))
        .filter((row) => {
          const rowTeamId = String(row.teamId || "").trim();
          return !rowTeamId || rowTeamId === userData.teamId;
        })
        .filter((row) => rowMatchesEvent(row, normalizedEventKey));
      if (eventScopedRows.length === 0) {
        setPitSync({ eventSynced: false, preloadRaw: null, bpsRaw: null, carryRaw: null });
        return;
      }
      const latest = eventScopedRows.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))[0];
      const preload = parsePitValue(latest.fuelPreloadCapacity);
      const bps = parsePitValue(latest.fuelBallsPerSecond);
      const carry = parsePitValue(latest.fuelCarryingCapacity);
      setPitSync({ eventSynced: true, preloadRaw: preload, bpsRaw: bps, carryRaw: carry });
      setForm((prev) => ({
        ...prev,
        autoPreloadScale: preload !== null ? convertPitScale(preload, "preload") : prev.autoPreloadScale,
        autoBpsScale: bps !== null ? convertPitScale(bps, "bps") : prev.autoBpsScale,
        autoCarryScale: carry !== null ? convertPitScale(carry, "carry") : prev.autoCarryScale,
        teleBpsScale: bps !== null ? convertPitScale(bps, "bps") : prev.teleBpsScale,
        teleCarryScale: carry !== null ? convertPitScale(carry, "carry") : prev.teleCarryScale,
      }));
    }
    void loadPitDefaults();
  }, [userData?.teamId, form.teamNumber, eventKey]);

  const completedMatches = modalCompleted;

  function resolveSectionFuel(estimated: number, scoredOverride: number, missedFuel: number) {
    if (scoredOverride > 0) return scoredOverride;
    return Math.max(0, estimated - Math.max(0, Number(missedFuel || 0)));
  }

  function estimateAutoSectionFuel() {
    const preloadCapFromScale = PRELOAD[Math.max(0, Math.min(4, form.autoPreloadScale))] || 0;
    const carryCapFromScale = CARRY[Math.max(0, Math.min(CARRY_MAX, form.autoCarryScale))] || 0;
    const preloadCap = pitSync.preloadRaw !== null && pitPreloadFits ? pitSync.preloadRaw : preloadCapFromScale;
    const carryCap = pitSync.carryRaw !== null && pitCarryFitsAuto ? pitSync.carryRaw : carryCapFromScale;
    const autoBps = pitSync.bpsRaw !== null && pitBpsFitsAuto ? pitSync.bpsRaw : (BPS[form.autoBpsScale] || 0);
    const estimated = autoCycles.reduce((sum, seconds, i) => {
      const capacity = i === 0 && preloadCap > 0 ? preloadCap : carryCap;
      return sum + Math.max(0, Math.round(Math.min(Math.max(0, capacity), autoBps * seconds)));
    }, 0);
    return resolveSectionFuel(estimated, form.autoCounterOverride, form.autoCounterMissedFuel);
  }

  function estimateTeleSectionFuel() {
    const carryCapFromScale = CARRY[Math.max(0, Math.min(CARRY_MAX, form.teleCarryScale))] || 0;
    const carryCap = pitSync.carryRaw !== null && pitCarryFitsTele ? pitSync.carryRaw : carryCapFromScale;
    const teleBps = pitSync.bpsRaw !== null && pitBpsFitsTele ? pitSync.bpsRaw : (BPS[form.teleBpsScale] || 0);
    const countShiftsTwoFour = form.wonAuto !== form.hubActivationOverride;
    const estimateSection = (sec: number) => Math.max(0, Math.round(Math.min(Math.max(0, carryCap), teleBps * sec)));
    const transitionEstimated = transitionCycles.reduce((sum, sec) => sum + estimateSection(sec), 0);
    const s1Estimated = shift1Cycles.reduce((sum, sec) => sum + estimateSection(sec), 0);
    const s2Estimated = shift2Cycles.reduce((sum, sec) => sum + estimateSection(sec), 0);
    const s3Estimated = shift3Cycles.reduce((sum, sec) => sum + estimateSection(sec), 0);
    const s4Estimated = shift4Cycles.reduce((sum, sec) => sum + estimateSection(sec), 0);
    const transition = resolveSectionFuel(transitionEstimated, form.transitionCounterOverride, form.transitionCounterMissedFuel);
    const s1 = resolveSectionFuel(s1Estimated, form.shift1CounterOverride, form.shift1CounterMissedFuel);
    const s2 = resolveSectionFuel(s2Estimated, form.shift2CounterOverride, form.shift2CounterMissedFuel);
    const s3 = resolveSectionFuel(s3Estimated, form.shift3CounterOverride, form.shift3CounterMissedFuel);
    const s4 = resolveSectionFuel(s4Estimated, form.shift4CounterOverride, form.shift4CounterMissedFuel);
    return transition + (countShiftsTwoFour ? s2 + s4 : s1 + s3);
  }

  function estimateEndgameSectionFuel() {
    const carryCapFromScale = CARRY[Math.max(0, Math.min(CARRY_MAX, form.teleCarryScale))] || 0;
    const carryCap = pitSync.carryRaw !== null && pitCarryFitsTele ? pitSync.carryRaw : carryCapFromScale;
    const teleBps = pitSync.bpsRaw !== null && pitBpsFitsTele ? pitSync.bpsRaw : (BPS[form.teleBpsScale] || 0);
    const estimated = endgameCycles.reduce((sum, sec) => sum + Math.max(0, Math.round(Math.min(Math.max(0, carryCap), teleBps * sec))), 0);
    return resolveSectionFuel(estimated, form.endgameCounterOverride, form.endgameCounterMissedFuel);
  }

  function estimateAutoTotal() {
    return estimateAutoSectionFuel() + Number(form.autoHumanPlayerFuel || 0);
  }

  function estimateTeleTotal() {
    return estimateTeleSectionFuel() + Number(form.teleopHumanPlayerFuel || 0);
  }

  function estimateEndgameTotal() {
    return estimateEndgameSectionFuel() + Number(form.endgameHumanPlayerFuel || 0);
  }

  async function submit() {
    if (!userData?.uid) {
      alert("You must be logged in to submit.");
      return;
    }
    if (!selectedMatch) return alert("Select a match first.");
    if (!form.teamNumber.trim()) return alert("Team number required.");
    if (!editMode && selectedScoutedTeams.has(form.teamNumber.trim())) {
      const proceed = window.confirm("That robot has already been scouted for this match. Submit anyway?");
      if (!proceed) return;
    }
    if (pitMismatchMessages.length > 0) {
      const proceed = window.confirm(
        `Warning: match scout scales do not match synced pit scout values for this event:\n${pitMismatchMessages.join("\n")}\n\nSubmit anyway?`
      );
      if (!proceed) return;
    }

    setSaving(true);
    try {
      const payload = {
        scoutName: userData.displayName || "",
        scoutId: userData.uid,
        teamId: userData.teamId || "",
        eventKey,
        game: "REBUILT",
        matchId: selectedMatch.id,
        matchType: selectedMatch.type,
        matchNumber: String(selectedMatch.matchNumber),
        teamNumber: form.teamNumber.trim(),
        startingPosition: form.startingPosition,
        auto: {
          preloadScale: form.autoPreloadScale,
          bpsScale: form.autoBpsScale,
          carryingScale: form.autoCarryScale,
          cycleTimes: autoCycles,
          estimatedFuel: estimateAutoTotal(),
          counterOverride: form.autoCounterOverride,
          counterOverrideMissedFuel: form.autoCounterMissedFuel,
          humanPlayerFuel: form.autoHumanPlayerFuel,
          failedClimb: form.autoFailedClimb,
          successfulClimb: form.autoSuccessfulClimb,
          wonAuto: form.wonAuto,
          hubActivationOverride: form.hubActivationOverride,
        },
        teleop: {
          shiftParityFromWonAuto: form.wonAuto !== form.hubActivationOverride,
          bpsScale: form.teleBpsScale,
          carryingScale: form.teleCarryScale,
          transitionCycles,
          shift1Cycles,
          shift2Cycles,
          shift3Cycles,
          shift4Cycles,
          transitionOverride: form.transitionCounterOverride,
          transitionMissedFuel: form.transitionCounterMissedFuel,
          shift1Override: form.shift1CounterOverride,
          shift1MissedFuel: form.shift1CounterMissedFuel,
          shift2Override: form.shift2CounterOverride,
          shift2MissedFuel: form.shift2CounterMissedFuel,
          shift3Override: form.shift3CounterOverride,
          shift3MissedFuel: form.shift3CounterMissedFuel,
          shift4Override: form.shift4CounterOverride,
          shift4MissedFuel: form.shift4CounterMissedFuel,
          humanPlayerFuel: form.teleopHumanPlayerFuel,
          estimatedFuel: estimateTeleTotal(),
        },
        endgame: {
          cycleTimes: endgameCycles,
          counterOverride: form.endgameCounterOverride,
          counterOverrideMissedFuel: form.endgameCounterMissedFuel,
          humanPlayerFuel: form.endgameHumanPlayerFuel,
          estimatedFuel: estimateEndgameTotal(),
          failedClimb: form.endgameFailedClimb,
          status: form.endgameStatus,
        },
        incidents: form.incidents,
        notes: form.notes,
        scoringWeights: { autoFuel: 1, autoClimbLevel1: 15, teleopFuel: 1, teleopClimbLevel1: 10, teleopClimbLevel2: 20, teleopClimbLevel3: 30 },
        submittedAt: Date.now(),
        timestamp: Date.now(),
      };
      if (editMode && editId) {
        await setDoc(doc(db, editCollectionName, editId), payload, { merge: true });
        alert("Match scout form updated.");
      } else {
        await addDoc(collection(db, "scouting"), payload);
        alert("Match scout form submitted.");
        if (typeof window !== "undefined") {
          window.location.reload();
        }
      }
      setScoutedCounts((prev) => ({ ...prev, [selectedMatch.id]: (prev[selectedMatch.id] || 0) + 1 }));
      setScoutedTeamsByMatch((prev) => {
        const now = new Set(prev[selectedMatch.id] || []);
        now.add(form.teamNumber.trim());
        return { ...prev, [selectedMatch.id]: Array.from(now) };
      });
      if (!editMode) {
        setForm((prev) => ({
          ...prev,
          teamNumber: assignedTeam || "",
          startingPosition: "",
          autoHumanPlayerFuel: 0,
          autoCounterOverride: 0,
          autoCounterMissedFuel: 0,
          autoFailedClimb: 0,
          autoSuccessfulClimb: false,
          wonAuto: false,
          hubActivationOverride: false,
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
          incidents: [],
          notes: "",
        }));
        setAutoCycles([]); setTransitionCycles([]); setShift1Cycles([]); setShift2Cycles([]); setShift3Cycles([]); setShift4Cycles([]); setEndgameCycles([]);
      }
    } catch (error) {
      console.error(error);
      alert("Could not submit match scout form.");
    } finally {
      setSaving(false);
    }
  }

  async function submitLead(event: React.FormEvent) {
    event.preventDefault();
    if (!userData?.uid) {
      alert("You must be logged in to submit.");
      return;
    }
    if (!selectedMatch) return alert("Select a match first.");
    const safeEventKey = String(eventKey || "").trim();
    if (!safeEventKey) {
      alert("Event not set yet. Please refresh and try again.");
      return;
    }
    const safeMatchId = String(selectedMatch.id || "").trim();
    if (!safeMatchId) {
      alert("Select a match first.");
      return;
    }
    if (!leadForm.alliance) return alert("Select an alliance first.");
    if (!leadForm.robot1TeamNumber.trim() || !leadForm.robot2TeamNumber.trim() || !leadForm.robot3TeamNumber.trim()) {
      alert("Enter all three team numbers for the alliance.");
      return;
    }

    setLeadSaving(true);
    try {
      const matchLabel = selectedMatch.label || getSelectedMatchDisplay() || "";
      const matchType = selectedMatch.type || "qualification";
      const matchNumber = Number.isFinite(selectedMatch.matchNumber) ? selectedMatch.matchNumber : 0;
      const payload = {
        scoutName: leadForm.scoutName || userData.displayName || "",
        scoutId: userData.uid,
        teamId: userData.teamId || "",
        eventKey: safeEventKey,
        game: "REBUILT",
        matchKey: safeMatchId,
        matchId: safeMatchId,
        matchType,
        matchNumber: String(matchNumber),
        matchLabel,
        alliance: leadForm.alliance,
        isPracticeScouting: matchType === "practice",
        isLeadScouting: true,
        entryType: "lead",
        robots: [
          { teamNumber: leadForm.robot1TeamNumber.trim(), notes: leadForm.robot1Notes.trim(), skillLevel: leadForm.robot1SkillLevel || 0 },
          { teamNumber: leadForm.robot2TeamNumber.trim(), notes: leadForm.robot2Notes.trim(), skillLevel: leadForm.robot2SkillLevel || 0 },
          { teamNumber: leadForm.robot3TeamNumber.trim(), notes: leadForm.robot3Notes.trim(), skillLevel: leadForm.robot3SkillLevel || 0 },
        ],
        overallAlliance: {
          teams: leadForm.overallAllianceTeams.trim(),
          notes: leadForm.overallAllianceNotes.trim(),
          skillLevel: leadForm.overallAllianceSkillLevel || 0,
        },
        createdAt: Date.now(),
        submittedAt: Date.now(),
        timestamp: Date.now(),
      };
      if (editMode && editId) {
        await setDoc(doc(db, editCollectionName, editId), payload, { merge: true });
        alert("Lead scout form updated.");
      } else {
        try {
          await addDoc(collection(db, "leadScouting"), payload);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!/missing or insufficient permissions/i.test(message)) {
            throw error;
          }
          await addDoc(collection(db, "scouting"), payload);
        }
        alert("Lead scout form submitted.");
        if (typeof window !== "undefined") {
          window.location.reload();
        }
      }
      if (!editMode) {
        setLeadForm((prev) => ({
          ...prev,
          alliance: "",
          robot1TeamNumber: "",
          robot1PickNumber: "",
          robot1Notes: "",
          robot1SkillLevel: 1,
          robot2TeamNumber: "",
          robot2PickNumber: "",
          robot2Notes: "",
          robot2SkillLevel: 1,
          robot3TeamNumber: "",
          robot3PickNumber: "",
          robot3Notes: "",
          robot3SkillLevel: 1,
          overallAllianceTeams: "",
          overallAllianceNotes: "",
          overallAllianceSkillLevel: 1,
        }));
        setOverallAllianceTeamsTouched(false);
      }
    } catch (error) {
      console.error("Error submitting lead scout form:", error);
      const message = error instanceof Error ? error.message : String(error);
      alert(`Could not submit lead scout form. ${message}`);
    } finally {
      setLeadSaving(false);
    }
  }

  function openLeadTeamPicker(target: "robot1" | "robot2" | "robot3") {
    setLeadTeamPickerTarget(target);
    setLeadTeamPickerOpen(true);
  }

  function closeLeadTeamPicker() {
    setLeadTeamPickerOpen(false);
    setLeadTeamPickerTarget(null);
  }

  function handleLeadTeamPick(team: string) {
    setLeadForm((prev) => {
      if (leadTeamPickerTarget === "robot1") return { ...prev, robot1TeamNumber: team };
      if (leadTeamPickerTarget === "robot2") return { ...prev, robot2TeamNumber: team };
      if (leadTeamPickerTarget === "robot3") return { ...prev, robot3TeamNumber: team };
      return prev;
    });
    closeLeadTeamPicker();
  }
  const fromPractice = searchParams.get("practice") === "1";
  const countsShiftsTwoFour = form.wonAuto !== form.hubActivationOverride;

  /* ------------------------------------------------------------------
     Render — floating HUD composition. Asymmetric offsets only bite on
     large viewports; on phones every deck stacks full-width for one-
     handed live-match use.
     ------------------------------------------------------------------ */

  return (
    <HudCanvas>
      <CommandBar>
        <Action variant="ghost" onClick={() => router.push("/dashboard")} className="!px-4">
          <ChevronLeft className="h-4 w-4" /> Dashboard
        </Action>
        <Chip label="Mode" value={leadMode ? "Lead" : "Match"} tone="crimson" icon={leadMode ? UserCog : Radio} />
        <Chip label="Event" value={eventKey} tone="gold" />
      </CommandBar>

      <HudViewport>
        <PageIntro
          eyebrow={leadMode ? "Alliance Intelligence" : "Live Match Capture"}
          title={leadMode ? "Lead Scout Form" : "Match Scout Form"}
          subtitle={
            leadMode
              ? "Alliance-level observations for strategy and pick-list notes."
              : fromPractice
                ? "Opened from Practice Scouting."
                : "Cycle-by-cycle fuel and climb capture for the assigned robot."
          }
          actions={
            <>
              <Chip label="Match" value={getSelectedMatchDisplay()} tone="crimson" />
              <Action variant="secondary" onClick={() => setModalOpen(true)}>
                <Pencil className="h-4 w-4" /> Fix Match
              </Action>
              {!leadMode && (
                <Action variant="secondary" onClick={() => setSubInRequestOpen(true)} disabled={subInSubmitting}>
                  <ArrowLeftRight className="h-4 w-4" />
                  {subInSubmitting ? "Requesting..." : "Request Sub-In"}
                </Action>
              )}
            </>
          }
        />

        {!leadMode && isHumanPlayerAssigned && (
          <Deck priority="high" className="mt-8">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-700" />
              <p className="text-sm font-bold text-amber-950">
                This match, include the Human Player score.
              </p>
            </div>
          </Deck>
        )}

        {!leadMode && (
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <StatTile
              label="Pit Sync"
              value={pitSync.eventSynced ? "Synced" : "Not Synced"}
              unit={pitSync.eventSynced ? "detected" : "for this event"}
            />
            <StatTile label="Fuel Estimate" value={`${estimateAutoTotal() + estimateTeleTotal() + estimateEndgameTotal()}`} unit="projected total" />
          </div>
        )}

        {!leadMode && pitMismatchMessages.length > 0 && (
          <Deck priority="critical" className="mt-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-800" />
              <div>
                <p className="text-sm font-bold text-red-950">Match scales do not match the synced pit scout values.</p>
                <ul className="mt-1 space-y-0.5 text-xs font-semibold text-red-800/90">
                  {pitMismatchMessages.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </div>
            </div>
          </Deck>
        )}

        {!leadMode ? (
          <form
            className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div className="flex flex-col gap-6">
              <Deck priority="high" offset="lg:mr-10">
                <h2 className="font-display text-2xl text-slate-950">Pre-Match</h2>
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Scout Name</label>
                    <input className="w-full" value={form.scoutName} disabled />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Team Number</label>
                    <div className="flex gap-2">
                      <input
                        className="flex-1"
                        inputMode="numeric"
                        placeholder={selectedTeams.length > 0 ? "Select team" : "Enter team number"}
                        value={form.teamNumber}
                        onChange={(e) => setForm((p) => ({ ...p, teamNumber: e.target.value.replace(/[^\d]/g, "") }))}
                      />
                      <Action type="button" variant="secondary" onClick={() => setShowTeamPicker(true)} disabled={selectedTeams.length === 0} className="shrink-0">
                        Pick
                      </Action>
                    </div>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Starting Position</label>
                    <select className="w-full" value={form.startingPosition} onChange={(e) => setForm((p) => ({ ...p, startingPosition: e.target.value }))}>
                      <option value="">Select Position</option>
                      <option value="not-there">Not There</option>
                      <option value="outpost-trench">Outpost Trench</option>
                      <option value="outpost-side">Outpost Side</option>
                      <option value="outpost-bump">Outpost Bump</option>
                      <option value="middle">Middle</option>
                      <option value="depot-bump">Depot Bump</option>
                      <option value="depot-side">Depot Side</option>
                      <option value="depot-trench">Depot Trench</option>
                    </select>
                  </div>
                </div>
              </Deck>

              <Deck priority="critical" offset="lg:ml-10">
                <h2 className="font-display text-2xl text-slate-950">Autonomous</h2>
                <div className="mt-3">
                  <ScaleSlider label="Preload Capacity" scaleValue={form.autoPreloadScale} onChange={(n) => setForm((p) => ({ ...p, autoPreloadScale: n }))} max={4} scaleLabel={PRELOAD_LABELS[Math.max(0, Math.min(4, form.autoPreloadScale))]} pitValue={pitSync.preloadRaw} />
                  <ScaleSlider label="Balls Per Second" scaleValue={form.autoBpsScale} onChange={(n) => setForm((p) => ({ ...p, autoBpsScale: n }))} max={BPS_MAX} scaleLabel={BPS_LABELS[Math.max(0, Math.min(BPS_MAX, form.autoBpsScale))]} pitValue={pitSync.bpsRaw} />
                  <ScaleSlider label="Carrying Capacity" scaleValue={form.autoCarryScale} onChange={(n) => setForm((p) => ({ ...p, autoCarryScale: n }))} max={CARRY_MAX} scaleLabel={CARRY_LABELS[Math.max(0, Math.min(CARRY_MAX, form.autoCarryScale))]} pitValue={pitSync.carryRaw} />
                </div>
                <div className="mt-4">
                  <CycleTimer title="Auto Cycle Timer" values={autoCycles} onAdd={(v) => setAutoCycles((p) => [...p, v])} onDelete={(i) => setAutoCycles((p) => p.filter((_, idx) => idx !== i))} />
                </div>
                <div className="mt-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Counter Override</p>
                  <CounterPair scored={form.autoCounterOverride} onScored={(n) => setForm((p) => ({ ...p, autoCounterOverride: n }))} missed={form.autoCounterMissedFuel} onMissed={(n) => setForm((p) => ({ ...p, autoCounterMissedFuel: n }))} />
                </div>
                <div className="mt-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Human Player</p>
                  <div className="mt-2 rounded-2xl border border-white/60 bg-white/35 p-3">
                    <Stepper label="Scored Fuel" value={form.autoHumanPlayerFuel} onChange={(n) => setForm((p) => ({ ...p, autoHumanPlayerFuel: n }))} />
                  </div>
                </div>
                <div className="mt-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Climb</p>
                  <div className="mt-2 rounded-2xl border border-white/60 bg-white/35 p-3">
                    <Stepper label="Failed Climb" value={form.autoFailedClimb} onChange={(n) => setForm((p) => ({ ...p, autoFailedClimb: n }))} />
                  </div>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    <label className="inline-flex min-h-[2.75rem] items-center gap-2 rounded-full border border-amber-300/60 bg-white/45 px-4 text-sm font-bold text-slate-800">
                      <input type="checkbox" checked={form.autoSuccessfulClimb} onChange={(e) => setForm((p) => ({ ...p, autoSuccessfulClimb: e.target.checked }))} />
                      Successful Climb
                    </label>
                    <label className="inline-flex min-h-[2.75rem] items-center gap-2 rounded-full border border-amber-300/60 bg-white/45 px-4 text-sm font-bold text-slate-800">
                      <input type="checkbox" checked={form.wonAuto} onChange={(e) => setForm((p) => ({ ...p, wonAuto: e.target.checked }))} />
                      Won Auto
                    </label>
                    <label className="inline-flex min-h-[2.75rem] items-center gap-2 rounded-full border border-amber-300/60 bg-white/45 px-4 text-sm font-bold text-slate-800">
                      <input type="checkbox" checked={form.hubActivationOverride} onChange={(e) => setForm((p) => ({ ...p, hubActivationOverride: e.target.checked }))} />
                      Hub Activation Override
                    </label>
                  </div>
                </div>
              </Deck>

              <Deck priority="critical" offset="lg:mr-14">
                <h2 className="font-display text-2xl text-slate-950">Teleoperated</h2>
                <div className="mt-3">
                  <ScaleSlider label="Balls Per Second" scaleValue={form.teleBpsScale} onChange={(n) => setForm((p) => ({ ...p, teleBpsScale: n }))} max={BPS_MAX} scaleLabel={BPS_LABELS[Math.max(0, Math.min(BPS_MAX, form.teleBpsScale))]} pitValue={pitSync.bpsRaw} />
                  <ScaleSlider label="Carrying Capacity" scaleValue={form.teleCarryScale} onChange={(n) => setForm((p) => ({ ...p, teleCarryScale: n }))} max={CARRY_MAX} scaleLabel={CARRY_LABELS[Math.max(0, Math.min(CARRY_MAX, form.teleCarryScale))]} pitValue={pitSync.carryRaw} />
                </div>

                <div className="mt-4">
                  <CycleTimer title="Transition Shift" values={transitionCycles} onAdd={(v) => setTransitionCycles((p) => [...p, v])} onDelete={(i) => setTransitionCycles((p) => p.filter((_, idx) => idx !== i))} />
                  <div className="mt-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Counter Override</p>
                    <CounterPair scored={form.transitionCounterOverride} onScored={(n) => setForm((p) => ({ ...p, transitionCounterOverride: n }))} missed={form.transitionCounterMissedFuel} onMissed={(n) => setForm((p) => ({ ...p, transitionCounterMissedFuel: n }))} />
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-amber-300/50 bg-amber-50/40 p-3 text-xs font-semibold text-amber-950">
                  Counted shifts right now: Transition + {countsShiftsTwoFour ? "Shift 2 + Shift 4" : "Shift 1 + Shift 3"}. Toggle{" "}
                  <span className="font-black">Won Auto</span> or <span className="font-black">Hub Activation Override</span> to flip counted shifts.
                </div>

                <div className="mt-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Human Player (Teleop)</p>
                  <div className="mt-2 rounded-2xl border border-white/60 bg-white/35 p-3">
                    <Stepper label="Scored Fuel" value={form.teleopHumanPlayerFuel} onChange={(n) => setForm((p) => ({ ...p, teleopHumanPlayerFuel: n }))} />
                  </div>
                </div>

                <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-3">
                    <CycleTimer title="Shift 1" countedLabel={{ counted: !countsShiftsTwoFour }} values={shift1Cycles} onAdd={(v) => setShift1Cycles((p) => [...p, v])} onDelete={(i) => setShift1Cycles((p) => p.filter((_, idx) => idx !== i))} />
                    <CounterPair scored={form.shift1CounterOverride} onScored={(n) => setForm((p) => ({ ...p, shift1CounterOverride: n }))} missed={form.shift1CounterMissedFuel} onMissed={(n) => setForm((p) => ({ ...p, shift1CounterMissedFuel: n }))} />
                  </div>
                  <div className="flex flex-col gap-3">
                    <CycleTimer title="Shift 2" countedLabel={{ counted: countsShiftsTwoFour }} values={shift2Cycles} onAdd={(v) => setShift2Cycles((p) => [...p, v])} onDelete={(i) => setShift2Cycles((p) => p.filter((_, idx) => idx !== i))} />
                    <CounterPair scored={form.shift2CounterOverride} onScored={(n) => setForm((p) => ({ ...p, shift2CounterOverride: n }))} missed={form.shift2CounterMissedFuel} onMissed={(n) => setForm((p) => ({ ...p, shift2CounterMissedFuel: n }))} />
                  </div>
                  <div className="flex flex-col gap-3">
                    <CycleTimer title="Shift 3" countedLabel={{ counted: !countsShiftsTwoFour }} values={shift3Cycles} onAdd={(v) => setShift3Cycles((p) => [...p, v])} onDelete={(i) => setShift3Cycles((p) => p.filter((_, idx) => idx !== i))} />
                    <CounterPair scored={form.shift3CounterOverride} onScored={(n) => setForm((p) => ({ ...p, shift3CounterOverride: n }))} missed={form.shift3CounterMissedFuel} onMissed={(n) => setForm((p) => ({ ...p, shift3CounterMissedFuel: n }))} />
                  </div>
                  <div className="flex flex-col gap-3">
                    <CycleTimer title="Shift 4" countedLabel={{ counted: countsShiftsTwoFour }} values={shift4Cycles} onAdd={(v) => setShift4Cycles((p) => [...p, v])} onDelete={(i) => setShift4Cycles((p) => p.filter((_, idx) => idx !== i))} />
                    <CounterPair scored={form.shift4CounterOverride} onScored={(n) => setForm((p) => ({ ...p, shift4CounterOverride: n }))} missed={form.shift4CounterMissedFuel} onMissed={(n) => setForm((p) => ({ ...p, shift4CounterMissedFuel: n }))} />
                  </div>
                </div>
              </Deck>

              <Deck priority="high" offset="lg:ml-6">
                <h2 className="font-display text-2xl text-slate-950">Endgame</h2>
                <div className="mt-4">
                  <CycleTimer title="Endgame Cycle Timer" values={endgameCycles} onAdd={(v) => setEndgameCycles((p) => [...p, v])} onDelete={(i) => setEndgameCycles((p) => p.filter((_, idx) => idx !== i))} />
                </div>
                <div className="mt-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Counter Override</p>
                  <CounterPair scored={form.endgameCounterOverride} onScored={(n) => setForm((p) => ({ ...p, endgameCounterOverride: n }))} missed={form.endgameCounterMissedFuel} onMissed={(n) => setForm((p) => ({ ...p, endgameCounterMissedFuel: n }))} />
                </div>
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Human Player</p>
                    <div className="mt-2 rounded-2xl border border-white/60 bg-white/35 p-3">
                      <Stepper label="Scored Fuel" value={form.endgameHumanPlayerFuel} onChange={(n) => setForm((p) => ({ ...p, endgameHumanPlayerFuel: n }))} />
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Climb</p>
                    <div className="mt-2 rounded-2xl border border-white/60 bg-white/35 p-3">
                      <Stepper label="Failed Climb" value={form.endgameFailedClimb} onChange={(n) => setForm((p) => ({ ...p, endgameFailedClimb: n }))} />
                    </div>
                  </div>
                </div>
                <div className="mt-4">
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Status At End of Match</label>
                  <select className="w-full" value={form.endgameStatus} onChange={(e) => setForm((p) => ({ ...p, endgameStatus: e.target.value }))}>
                    <option value="">Status At End of Match</option>
                    <option value="parked">Parked</option>
                    <option value="level-1">Level 1</option>
                    <option value="level-2">Level 2</option>
                    <option value="level-3">Level 3</option>
                  </select>
                </div>
              </Deck>

              <Deck priority="normal">
                <h2 className="font-display text-2xl text-slate-950">General</h2>
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {INCIDENTS.map((incident) => (
                    <label
                      key={incident.value}
                      className="inline-flex min-h-[2.75rem] items-center gap-2 rounded-full border border-red-300/50 bg-white/45 px-4 text-sm font-bold text-slate-800"
                    >
                      <input
                        type="checkbox"
                        checked={form.incidents.includes(incident.value)}
                        onChange={(e) =>
                          setForm((p) => ({
                            ...p,
                            incidents: e.target.checked ? [...p.incidents, incident.value] : p.incidents.filter((v) => v !== incident.value),
                          }))
                        }
                      />
                      {incident.label}
                    </label>
                  ))}
                </div>
              </Deck>

              <Action type="submit" disabled={saving} className="min-h-[3.5rem] w-full text-base">
                {saving ? "Submitting..." : editMode ? "Update Match Scout Form" : "Submit Match Scout Form"}
              </Action>
            </div>

            <div className="flex flex-col gap-4 lg:sticky lg:top-28 lg:self-start">
              <Deck priority="normal" className="hidden lg:flex lg:h-[calc(100vh-9rem)] lg:flex-col">
                <h2 className="font-display text-xl text-slate-950">Notes</h2>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                  className="mt-3 flex-1 resize-none"
                  placeholder="Optional notes..."
                />
              </Deck>
            </div>
          </form>
        ) : (
          <form className="mt-8 grid grid-cols-1 gap-6" onSubmit={submitLead}>
            <Deck priority="high" offset="lg:mr-10">
              <h2 className="font-display text-2xl text-slate-950">Pre-Match</h2>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <span className="text-sm font-semibold text-slate-700">Match Select</span>
                <Chip label="Match" value={getSelectedMatchDisplay()} tone="crimson" />
                <Action type="button" variant="secondary" onClick={() => setModalOpen(true)}>
                  <Pencil className="h-4 w-4" /> Fix
                </Action>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-slate-700">Alliance</span>
                <Action type="button" variant={leadForm.alliance === "red" ? "danger" : "ghost"} onClick={() => setLeadForm((prev) => ({ ...prev, alliance: "red" }))}>
                  Red
                </Action>
                <Action
                  type="button"
                  variant={leadForm.alliance === "blue" ? "primary" : "ghost"}
                  onClick={() => setLeadForm((prev) => ({ ...prev, alliance: "blue" }))}
                  className={leadForm.alliance === "blue" ? "!from-blue-700 !to-blue-900 !border-blue-800/50 !shadow-[0_12px_42px_rgba(30,64,175,0.28)]" : ""}
                >
                  Blue
                </Action>
                <Action type="button" variant="ghost" onClick={() => setLeadForm((prev) => ({ ...prev, alliance: prev.alliance === "red" ? "blue" : "red" }))}>
                  <Repeat className="h-4 w-4" /> Swap
                </Action>
              </div>
              <div className="mt-4">
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Scout Name</label>
                <input className="w-full" value={leadForm.scoutName} disabled />
              </div>
            </Deck>

            <Deck priority="normal" offset="lg:ml-8">
              <h2 className="font-display text-2xl text-slate-950">Overall Alliance</h2>
              <label className="mb-1 mt-3 block text-xs font-bold uppercase tracking-wide text-slate-500">Alliance Color / Team</label>
              <input
                className="w-full"
                value={leadForm.overallAllianceTeams}
                onChange={(e) => {
                  setOverallAllianceTeamsTouched(true);
                  setLeadForm((prev) => ({ ...prev, overallAllianceTeams: e.target.value }));
                }}
                placeholder="RED / 1111, 2222, 3333"
              />
              <label className="mb-1 mt-4 block text-xs font-bold uppercase tracking-wide text-slate-500">Notes</label>
              <textarea className="w-full" rows={3} value={leadForm.overallAllianceNotes} onChange={(e) => setLeadForm((prev) => ({ ...prev, overallAllianceNotes: e.target.value }))} />
              <label className="mb-1 mt-4 block text-xs font-bold uppercase tracking-wide text-slate-500">Skill Level</label>
              <LeadScaleSelector value={leadForm.overallAllianceSkillLevel} onChange={(value) => setLeadForm((prev) => ({ ...prev, overallAllianceSkillLevel: value }))} />
            </Deck>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              {(
                [
                  { key: "robot1" as const, team: leadForm.robot1TeamNumber, notes: leadForm.robot1Notes, skill: leadForm.robot1SkillLevel, offset: "lg:-mt-4" },
                  { key: "robot2" as const, team: leadForm.robot2TeamNumber, notes: leadForm.robot2Notes, skill: leadForm.robot2SkillLevel, offset: "lg:mt-6" },
                  { key: "robot3" as const, team: leadForm.robot3TeamNumber, notes: leadForm.robot3Notes, skill: leadForm.robot3SkillLevel, offset: "lg:-mt-2" },
                ]
              ).map((robot, index) => (
                <Deck key={robot.key} priority="high" offset={robot.offset}>
                  <h2 className="font-display text-xl text-slate-950">Robot {index + 1}</h2>
                  <label className="mb-1 mt-3 block text-xs font-bold uppercase tracking-wide text-slate-500">Team Number</label>
                  <div className="flex gap-2">
                    <input
                      className="flex-1"
                      inputMode="numeric"
                      value={robot.team}
                      onChange={(e) => {
                        const value = e.target.value.replace(/[^\d]/g, "");
                        setLeadForm((prev) => ({ ...prev, [`${robot.key}TeamNumber`]: value }));
                      }}
                      placeholder="Team #"
                    />
                    <Action type="button" variant="secondary" onClick={() => openLeadTeamPicker(robot.key)}>
                      Pick
                    </Action>
                  </div>
                  <label className="mb-1 mt-4 block text-xs font-bold uppercase tracking-wide text-slate-500">Notes</label>
                  <textarea
                    className="w-full"
                    rows={3}
                    value={robot.notes}
                    onChange={(e) => setLeadForm((prev) => ({ ...prev, [`${robot.key}Notes`]: e.target.value }))}
                  />
                  <label className="mb-1 mt-4 block text-xs font-bold uppercase tracking-wide text-slate-500">Skill Level</label>
                  <LeadScaleSelector value={robot.skill} onChange={(value) => setLeadForm((prev) => ({ ...prev, [`${robot.key}SkillLevel`]: value }))} />
                </Deck>
              ))}
            </div>

            <Action type="submit" disabled={leadSaving} className="min-h-[3.5rem] w-full text-base">
              {leadSaving ? "Submitting..." : editMode ? "Update Lead Scout Form" : "Submit Lead Scout Form"}
            </Action>
          </form>
        )}
      </HudViewport>

      {!leadMode && (
        <>
          <button
            onClick={() => setMobileNotesOpen((p) => !p)}
            className="fixed right-0 top-1/2 z-50 -translate-y-1/2 rounded-l-2xl border border-amber-300/50 bg-white/60 px-2 py-5 text-red-800 shadow-2xl shadow-red-900/20 backdrop-blur-xl lg:hidden"
            aria-label="Toggle notes"
          >
            {mobileNotesOpen ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
          </button>
          {mobileNotesOpen && (
            <div className="fixed inset-0 z-50 bg-white/70 p-4 backdrop-blur-2xl lg:hidden">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-display text-2xl text-slate-950">Notes</h2>
                <Action variant="secondary" onClick={() => setMobileNotesOpen(false)}>
                  <XIcon className="h-4 w-4" /> Close
                </Action>
              </div>
              <textarea
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                className="h-[calc(100%-4rem)] w-full resize-none"
              />
            </div>
          )}
        </>
      )}

      <ReefscapeMatchSelectModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        options={options}
        completed={completedMatches}
        assigned={effectiveAssignedMatchIds}
        onPick={setSelectedMatch}
      />

      <ReefscapeStyleModal open={subInRequestOpen} onClose={() => setSubInRequestOpen(false)} step="qualification">
        {subInRequestStep === "choice" ? (
          <>
            <h2 className="font-display text-2xl text-slate-950">Request Sub-In</h2>
            <p className="mt-2 text-sm text-slate-600">Pick a single match or request multiple matches.</p>
            <div className="mt-4 flex flex-col gap-3">
              <Action
                onClick={() => {
                  setSubInRequestOpen(false);
                  setSubInModalOpen(true);
                }}
              >
                One Match
              </Action>
              <Action variant="secondary" onClick={() => setSubInRequestStep("range")}>
                Multiple Matches
              </Action>
            </div>
          </>
        ) : (
          <>
            <Action variant="ghost" onClick={() => setSubInRequestStep("choice")} className="mb-3">
              <ChevronLeft className="h-4 w-4" /> Back
            </Action>
            <h2 className="font-display text-2xl text-slate-950">Multiple Matches</h2>
            <p className="mt-2 text-sm text-slate-600">
              Enter a range (x-y, inclusive). Only matches in that range that you are assigned to will be requested.
            </p>
            <div className="mt-4 flex flex-col gap-3">
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Match Type</label>
                <select className="w-full" value={subInRangeType} onChange={(event) => setSubInRangeType(event.target.value as MatchType)}>
                  <option value="practice">Practice</option>
                  <option value="qualification">Qualification</option>
                  <option value="finals">Finals</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  className="flex-1"
                  placeholder="Start (x)"
                  value={subInRangeStart}
                  onChange={(event) => setSubInRangeStart(event.target.value.replace(/[^\d]/g, ""))}
                />
                <span className="text-sm font-semibold text-slate-500">to</span>
                <input
                  type="text"
                  inputMode="numeric"
                  className="flex-1"
                  placeholder="End (y)"
                  value={subInRangeEnd}
                  onChange={(event) => setSubInRangeEnd(event.target.value.replace(/[^\d]/g, ""))}
                />
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <Action onClick={() => void submitSubInRange()} disabled={subInSubmitting} className="flex-1">
                {subInSubmitting ? "Requesting..." : "Request Range"}
              </Action>
              <Action variant="ghost" onClick={() => setSubInRequestOpen(false)} className="flex-1">
                Cancel
              </Action>
            </div>
          </>
        )}
      </ReefscapeStyleModal>

      <ReefscapeMatchSelectModal
        open={subInModalOpen}
        onClose={() => setSubInModalOpen(false)}
        options={options}
        completed={completedMatches}
        assigned={effectiveAssignedMatchIds}
        onPick={(match) => {
          void submitSubInRequest(match);
          setSubInModalOpen(false);
        }}
      />

      <TeamPickerModal
        open={showTeamPicker}
        teams={selectedTeams}
        scoutedTeams={selectedScoutedTeams}
        assignedTeams={selectedAssignedTeams}
        subInStatuses={selectedSubInStatuses}
        highlightedTeams={highlightedAssignedTeams}
        onClose={() => setShowTeamPicker(false)}
        onSelect={(team) => setForm((prev) => ({ ...prev, teamNumber: team }))}
      />
      <TeamPickerModal
        open={leadTeamPickerOpen}
        teams={leadAllianceTeams}
        scoutedTeams={new Set()}
        assignedTeams={new Set()}
        subInStatuses={{}}
        highlightedTeams={new Set()}
        onClose={closeLeadTeamPicker}
        onSelect={handleLeadTeamPick}
      />
    </HudCanvas>
  );
}

function ScoutFormGate() {
  const searchParams = useSearchParams();
  const leadMode = searchParams.get("lead") === "1";
  return (
    <ProtectedRoute
      requireAuth={true}
      allowedRoles={leadMode ? ["coach", "lead-scout"] : ["coach", "scout"]}
      formKey={leadMode ? "lead-scout-form" : undefined}
    >
      <ScoutFormContent />
    </ProtectedRoute>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingSpinner message="Loading scout form..." />}>
      <ScoutFormGate />
    </Suspense>
  );
}
