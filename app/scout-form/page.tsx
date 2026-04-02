"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { addDoc, collection, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";
import { Check, Hourglass, X as XIcon } from "lucide-react";
import Sidebar from "@/app/components/Sidebar";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import ReefscapeStyleModal from "@/app/components/ReefscapeStyleModal";
import ReefscapeMatchSelectModal from "@/app/components/ReefscapeMatchSelectModal";
import { useAuth } from "@/app/AuthContext";
import { db } from "@/app/firebase";
import { type TBAMatch } from "@/app/utils/tba-api";
import { resolveDetectedTeamEventKey } from "@/app/utils/eventDetection";
import { getEventsForGame, isInEventWindow } from "@/app/utils/analyticsEvents";
import { getEffectiveNowSec } from "@/app/utils/teamTime";
import { expandEventKeyAliases, normalizeEventKey } from "@/app/utils/events";
import { fetchFirstSchedule, splitFirstAllianceTeams } from "@/app/utils/firstSchedule";
import {
  buildCompletedModalIdsFromTba,
  buildReefscapeModalOptions,
  fetchEventMatchesWithTeamAuth,
  getTbaScheduleTime,
  mapTbaMatchToModalId,
} from "@/app/utils/reefscapeMatchSync";

type MatchType = "practice" | "qualification" | "finals";
type MatchStatus = "completed" | "next" | "upcoming";

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
      <h2 className="text-xl font-semibold mb-4" style={{ color: "var(--primary-color)" }}>Select Team</h2>
      <div className="max-h-[60vh] overflow-y-auto border rounded p-2">
        {teams.length === 0 ? (
          <p className="p-3 text-sm text-gray-600">No robots detected for this match.</p>
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
                  className={`rounded-lg border p-3 text-sm text-left ${
                    done
                      ? "bg-gray-100 text-gray-400 cursor-not-allowed border-gray-300"
                      : highlighted
                        ? "bg-indigo-50 hover:bg-indigo-100"
                        : "hover:bg-gray-50 border-red-400"
                  }`}
                  style={!done && highlighted ? { borderColor: "var(--primary-color)" } : undefined}
                >
                  {label}
                </button>
              );
            })}
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

function LeadScaleSelector({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const safeValue = Math.min(5, Math.max(1, value || 1));
  return (
    <div className="space-y-1">
      <input
        type="range"
        min={1}
        max={5}
        value={safeValue}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full"
      />
      <div className="flex justify-between text-[11px] text-gray-500">
        {LEAD_SKILL_LEVELS.map((level) => (
          <span key={level}>{level}</span>
        ))}
      </div>
    </div>
  );
}

function buildFallbackScoutOptions(): MatchOption[] {
  const rows: MatchOption[] = [];
  for (let n = 1; n <= 20; n += 1) {
    rows.push({
      id: `p${n}`,
      label: `Practice ${n}`,
      type: "practice",
      matchNumber: n,
      scheduleTime: 0,
      teams: [],
      redTeams: [],
      blueTeams: [],
    });
  }
  for (let n = 1; n <= 80; n += 1) {
    rows.push({
      id: `q${n}`,
      label: `Qualification ${n}`,
      type: "qualification",
      matchNumber: n,
      scheduleTime: 0,
      teams: [],
      redTeams: [],
      blueTeams: [],
    });
  }
  for (let n = 1; n <= 3; n += 1) {
    rows.push({
      id: `f${n}`,
      label: `Finals ${n}`,
      type: "finals",
      matchNumber: n,
      scheduleTime: 0,
      teams: [],
      redTeams: [],
      blueTeams: [],
    });
  }
  return rows;
}

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

function estimateBalls(seconds: number, bpsScale: number, capacityBalls: number) {
  return Math.max(0, Math.round(Math.min(Math.max(0, capacityBalls), (BPS[bpsScale] || 0) * seconds)));
}

function CycleTimer({
  title,
  values,
  onAdd,
  onDelete,
}: {
  title: string;
  values: number[];
  onAdd: (value: number) => void;
  onDelete: (index: number) => void;
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
          <span>Cycle {i + 1}: {v.toFixed(2)}</span>
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
}
function ClimbCounter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <div className="flex items-center gap-2">
      <button type="button" onClick={() => onChange(Math.max(0, value - 1))} className="theme-stepper-btn">
        -
      </button>
      <span className="w-8 text-center font-semibold">{value}</span>
      <button type="button" onClick={() => onChange(value + 1)} className="theme-stepper-btn">
        +
      </button>
      </div>
    </div>
  );
}

function FinalsMatchBox({
  number,
  row,
  col,
  status,
  onPick,
  label,
  allowCompletedPick = false,
}: {
  number: number;
  row: number;
  col: number;
  status: MatchStatus;
  onPick: (matchNumber: number) => void;
  label?: string;
  allowCompletedPick?: boolean;
}) {
  const borderStyles: Record<MatchStatus, React.CSSProperties> = {
    completed: { borderColor: "#16a34a" },
    next: { borderColor: "#ca8a04" },
    upcoming: { borderColor: "#ef4444" },
  };
  const badgeBg: Record<MatchStatus, string> = {
    completed: "#16a34a",
    next: "#ca8a04",
    upcoming: "#ef4444",
  };

  return (
    <button
      type="button"
      onClick={() => {
        if (status === "completed" && !allowCompletedPick) return;
        onPick(number);
      }}
      disabled={status === "completed" && !allowCompletedPick}
      className={`absolute w-[120px] min-h-[62px] text-xs rounded border text-left bg-white ${
        status === "completed" && !allowCompletedPick ? "opacity-45 cursor-not-allowed bg-gray-100 border-gray-300" : "hover:bg-gray-50"
      }`}
      style={{ left: col, top: row, ...(status === "completed" && !allowCompletedPick ? {} : borderStyles[status]) }}
    >
      <div
        className="absolute top-0.5 right-0.5 text-[10px] px-1 py-0.5 rounded-full text-white inline-flex items-center justify-center"
        style={{ backgroundColor: badgeBg[status] }}
      >
        {status === "completed" ? <Check size={10} /> : status === "next" ? <Hourglass size={10} /> : <XIcon size={10} />}
      </div>
      <div className="pt-1.5 pb-1 px-1.5">
        <div className="font-semibold text-[11px] leading-tight">{label || `Match ${number}`}</div>
      </div>
    </button>
  );
}

function FinalsBracket({
  completed,
  onPick,
}: {
  completed: Set<string>;
  onPick: (matchNumber: number) => void;
}) {
  const B = { w: 120, h: 62, colGap: 60, row: 90 };
  const col = (c: number) => (B.w + B.colGap) * c;
  const r1_1 = 20;
  const r1_2 = r1_1 + B.row;
  const r1_3 = r1_2 + B.row + 30;
  const r1_4 = r1_3 + B.row;
  const r2_7 = (r1_1 + r1_2 + B.h) / 2 - B.h / 2;
  const r2_8 = (r1_3 + r1_4 + B.h) / 2 - B.h / 2;
  const r3_11 = (r2_7 + r2_8 + B.h) / 2 - B.h / 2;
  const lower_5 = r1_4 + B.row + 50;
  const lower_6 = lower_5 + B.row;
  const lower_9 = lower_5 - 30;
  const lower_10 = lower_6 - 30;
  const lower_12 = (lower_9 + lower_10 + B.h) / 2 - B.h / 2;
  const y13 = lower_9;
  const yFinals = (r3_11 + y13 + B.h) / 2 - B.h / 2;
  const c0 = 0;
  const c1 = col(1);
  const c2 = col(2);
  const c3 = col(3);
  const c4 = col(4);
  const c5 = col(5);
  const join1 = c0 + B.w + 30;
  const join2 = c1 + B.w + 30;
  const join3 = c2 + B.w + 30;
  const join4 = c3 + B.w + 30;
  const join5 = c4 + B.w + 30;
  const totalWidth = c5 + B.w;
  const firstOpen = Array.from({ length: 14 }, (_, i) => i + 1).find((n) => !completed.has(`f${n}`)) || -1;
  const statusOf = (n: number): MatchStatus => (completed.has(`f${n}`) ? "completed" : n === firstOpen ? "next" : "upcoming");

  return (
    <div className="relative w-full flex justify-center py-6 overflow-x-auto">
      <div style={{ width: totalWidth }}>
        <div className="flex mb-4 gap-[60px] pl-0">
          {[1, 2, 3, 4, 5, 6].map((r) => (
            <div key={r} className="text-xs font-semibold text-gray-600 uppercase tracking-wide text-center" style={{ width: B.w }}>
              Round {r}
            </div>
          ))}
        </div>

        <div className="relative" style={{ width: totalWidth, height: 600 }}>
          <svg className="absolute inset-0 pointer-events-none overflow-visible" width={totalWidth} height={600}>
            <g stroke="#9ca3af" strokeWidth="2" fill="none">
              <path d={`M ${c0 + B.w} ${r1_1 + B.h / 2} H ${join1} V ${r1_2 + B.h / 2} H ${c0 + B.w}`} />
              <path d={`M ${join1} ${r2_7 + B.h / 2} H ${c1}`} />
              <path d={`M ${c0 + B.w} ${r1_3 + B.h / 2} H ${join1} V ${r1_4 + B.h / 2} H ${c0 + B.w}`} />
              <path d={`M ${join1} ${r2_8 + B.h / 2} H ${c1}`} />
              <path d={`M ${c1 + B.w} ${r2_7 + B.h / 2} H ${join2} V ${r2_8 + B.h / 2} H ${c1 + B.w}`} />
              <path d={`M ${join2} ${r3_11 + B.h / 2} H ${c3}`} />
              <path d={`M ${c1 + B.w} ${lower_5 + B.h / 2} H ${join2} V ${lower_9 + B.h / 2} H ${c2}`} />
              <path d={`M ${c1 + B.w} ${lower_6 + B.h / 2} H ${join2} V ${lower_10 + B.h / 2} H ${c2}`} />
              <path d={`M ${c2 + B.w} ${lower_9 + B.h / 2} H ${join3} V ${lower_10 + B.h / 2} H ${c2 + B.w}`} />
              <path d={`M ${join3} ${lower_12 + B.h / 2} H ${c3}`} />
              <path d={`M ${c3 + B.w} ${lower_12 + B.h / 2} H ${join4} V ${y13 + B.h / 2} H ${c4}`} />
              <path d={`M ${c3 + B.w} ${r3_11 + B.h / 2} H ${join5} V ${yFinals + B.h / 2} H ${c5}`} />
              <path d={`M ${c4 + B.w} ${y13 + B.h / 2} H ${join5} V ${yFinals + B.h / 2}`} />
            </g>
          </svg>

          <FinalsMatchBox number={1} row={r1_1} col={c0} status={statusOf(1)} onPick={onPick} />
          <FinalsMatchBox number={2} row={r1_2} col={c0} status={statusOf(2)} onPick={onPick} />
          <FinalsMatchBox number={3} row={r1_3} col={c0} status={statusOf(3)} onPick={onPick} />
          <FinalsMatchBox number={4} row={r1_4} col={c0} status={statusOf(4)} onPick={onPick} />
          <FinalsMatchBox number={5} row={lower_5} col={c1} status={statusOf(5)} onPick={onPick} />
          <FinalsMatchBox number={6} row={lower_6} col={c1} status={statusOf(6)} onPick={onPick} />
          <FinalsMatchBox number={7} row={r2_7} col={c1} status={statusOf(7)} onPick={onPick} />
          <FinalsMatchBox number={8} row={r2_8} col={c1} status={statusOf(8)} onPick={onPick} />
          <FinalsMatchBox number={9} row={lower_9} col={c2} status={statusOf(9)} onPick={onPick} />
          <FinalsMatchBox number={10} row={lower_10} col={c2} status={statusOf(10)} onPick={onPick} />
          <FinalsMatchBox number={11} row={r3_11} col={c3} status={statusOf(11)} onPick={onPick} />
          <FinalsMatchBox number={12} row={lower_12} col={c3} status={statusOf(12)} onPick={onPick} />
          <FinalsMatchBox number={13} row={y13} col={c4} status={statusOf(13)} onPick={onPick} />
          <FinalsMatchBox
            number={14}
            row={yFinals}
            col={c5}
            label="FINALS"
            status={completed.has("f1") && completed.has("f2") && completed.has("f3") ? "completed" : "upcoming"}
            allowCompletedPick
            onPick={onPick}
          />
        </div>
      </div>
    </div>
  );
}

function MatchModal({
  open,
  onClose,
  options,
  completed,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  options: MatchOption[];
  completed: Set<string>;
  onPick: (m: MatchOption) => void;
}) {
  const [step, setStep] = useState<"type" | MatchType>("type");
  const [finalsStep, setFinalsStep] = useState<"bracket" | "number">("bracket");

  useEffect(() => {
    if (!open) {
      setStep("type");
      setFinalsStep("bracket");
    }
  }, [open]);

  const current = options.filter((m) => m.type === step);
  const firstOpen = current.find((m) => !completed.has(m.id))?.id || "";
  const finalsById = new Map(options.filter((m) => m.type === "finals").map((m) => [m.id, m] as const));

  return (
    <ReefscapeStyleModal open={open} onClose={onClose} step={step}>
        {step === "type" ? (
          <>
            <h2 className="text-xl font-semibold mb-4" style={{ color: "var(--primary-color)" }}>Select Match Type</h2>
            <div className="space-y-3">
              <button type="button" className="w-full py-2 rounded text-white" style={{ backgroundColor: "var(--primary-color)" }} onClick={() => setStep("practice")}>Practice</button>
              <button type="button" className="w-full py-2 rounded text-white" style={{ backgroundColor: "var(--primary-color)" }} onClick={() => setStep("qualification")}>Qualification</button>
              <button type="button" className="w-full py-2 rounded text-white" style={{ backgroundColor: "var(--primary-color)" }} onClick={() => setStep("finals")}>Finals</button>
            </div>
          </>
        ) : (
          <>
            {(step === "practice" || step === "qualification") && (
              <>
                <h2 className="text-xl font-semibold mb-4" style={{ color: "var(--primary-color)" }}>
                  {step === "practice" ? "Practice Matches" : "Qualification Matches"}
                </h2>
                <div className="grid grid-cols-3 gap-2 max-h-[60vh] overflow-y-auto pr-1">
                  {current.length === 0 && (
                    <div className="col-span-full border rounded p-3 text-sm text-gray-600">
                      No matches available for this type yet.
                    </div>
                  )}
                  {current.map((m) => {
                    const done = completed.has(m.id);
                    const status: MatchStatus = done ? "completed" : m.id === firstOpen ? "next" : "upcoming";
                    const color = status === "completed" ? "#16a34a" : status === "next" ? "#ca8a04" : "#ef4444";
                    return (
                      <button
                        key={m.id}
                        type="button"
                        disabled={done}
                        onClick={() => {
                          if (done) return;
                          onPick(m);
                          onClose();
                        }}
                        className={`relative h-[86px] p-2 rounded-lg border text-left ${done ? "opacity-45 cursor-not-allowed bg-gray-100 border-gray-300" : "hover:bg-gray-50"}`}
                        style={done ? undefined : { borderColor: color }}
                      >
                        <div className="absolute top-0.5 left-0.5 text-[10px] px-1 py-0.5 rounded-full text-white inline-flex items-center justify-center" style={{ backgroundColor: color }}>
                          {status === "completed" ? <Check size={10} /> : status === "next" ? <Hourglass size={10} /> : <XIcon size={10} />}
                        </div>
                        <div className="mt-3">
                          <div className="font-semibold text-sm">{m.label}</div>
                          <div className="text-xs text-gray-600">{m.scheduleTime > 0 ? new Date(m.scheduleTime * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "TBD"}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className="w-full mt-4 py-2 rounded text-white"
                  style={{ backgroundColor: "var(--primary-color)" }}
                  onClick={onClose}
                >
                  Close
                </button>
              </>
            )}

            {step === "finals" && (
              <>
                {finalsStep === "bracket" && (
                  <FinalsBracket
                    completed={new Set(Array.from(completed).filter((id) => id.startsWith("f")))}
                    onPick={(matchNumber) => {
                      if (matchNumber === 14) {
                        setFinalsStep("number");
                        return;
                      }
                      const key = `f${matchNumber}`;
                      const picked = finalsById.get(key) || {
                        id: key,
                        label: `Finals ${matchNumber}`,
                        type: "finals" as const,
                        matchNumber,
                        scheduleTime: 0,
                        teams: [],
                      };
                      onPick(picked);
                      onClose();
                    }}
                  />
                )}
                {finalsStep === "number" && (
                  <>
                    <div className="flex items-center justify-between mb-6">
                      <button
                        type="button"
                        onClick={() => setFinalsStep("bracket")}
                        className="text-gray-600 hover:text-gray-900 flex items-center gap-2"
                      >
                        ← Back to Bracket
                      </button>
                      <h2 className="text-xl font-semibold">Select Finals Match Number</h2>
                      <div className="w-32" />
                    </div>
                    <p className="text-gray-600 mb-6 text-center">Which finals match are you scouting?</p>
                    <div className="grid grid-cols-3 gap-6 max-w-2xl mx-auto">
                      {[1, 2, 3].map((matchNum) => (
                        <button
                          key={matchNum}
                          type="button"
                          onClick={() => {
                            const key = `f${matchNum}`;
                            const picked = finalsById.get(key) || {
                              id: key,
                              label: `Finals ${matchNum}`,
                              type: "finals" as const,
                              matchNumber: matchNum,
                              scheduleTime: 0,
                              teams: [],
                            };
                            onPick(picked);
                            onClose();
                          }}
                          disabled={completed.has(`f${matchNum}`)}
                          className={`group relative p-8 border-2 border-gray-300 rounded-2xl transition-all ${completed.has(`f${matchNum}`) ? "opacity-45 cursor-not-allowed bg-gray-100" : "hover:border-red-500 hover:bg-red-50 hover:shadow-lg"}`}
                        >
                          <div className="text-center">
                            <div className="text-5xl font-bold mb-3 group-hover:scale-110 transition-transform" style={{ color: "var(--primary-color)" }}>
                              F{matchNum}
                            </div>
                            <div className="text-sm font-medium text-gray-600 group-hover:text-gray-900">{`Finals ${matchNum}`}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}
    </ReefscapeStyleModal>
  );
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

function getPlayoffSlot(match: TBAMatch): number {
  const fromKey = parsePlayoffSlotFromKey(String(match.key || ""), "sf");
  if (fromKey !== null) return fromKey;
  const fromSet = Number(match.set_number || 0);
  if (fromSet > 0) return fromSet;
  const fromMatch = Number(match.match_number || 0);
  if (fromMatch > 0) return fromMatch;
  return 1;
}

function getFinalsSeriesNumber(match: TBAMatch): number {
  const fromKey = parseFinalsSeriesNumberFromKey(String(match.key || ""));
  if (fromKey !== null) return fromKey;
  const fromMatch = Number(match.match_number || 0);
  if (fromMatch >= 1 && fromMatch <= 3) return fromMatch;
  const fromSet = Number(match.set_number || 0);
  if (fromSet >= 14 && fromSet <= 16) return fromSet - 13;
  if (fromSet >= 1 && fromSet <= 3) return fromSet;
  return 1;
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

async function fetchCompletedMatchIds(eventKey: string, teamId?: string): Promise<Set<string>> {
  const completed = new Set<string>();
  const collections = ["scouting", "leadScouting", "matchStrategyPlans", "driveScouting"];
  const normalizedTarget = normalizeEventKey(eventKey);
  const snaps = await Promise.all(
    collections.map((name) => {
      if (teamId) {
        return getDocs(query(collection(db, name), where("teamId", "==", teamId)));
      }
      const keys = expandEventKeyAliases(eventKey);
      return Promise.all(keys.map((key) => getDocs(query(collection(db, name), where("eventKey", "==", key)))));
    })
  );
  const docs = snaps.reduce<typeof snaps[number] extends (infer T)[] ? T[] : never[]>((acc, snap) => {
    if (Array.isArray(snap)) {
      snap.forEach((inner) => acc.push(...inner.docs));
      return acc;
    }
    acc.push(...snap.docs);
    return acc;
  }, []);
  docs.forEach((docSnap) => {
    const row = docSnap.data() as Record<string, unknown>;
    const rowEventKey = normalizeEventKey(String(row.eventKey || "").trim());
    if (normalizedTarget && rowEventKey && rowEventKey !== normalizedTarget) return;
    const entryType = String(row.entryType || row.formType || "").toLowerCase().trim();
    if (entryType === "sub-in-request" || entryType === "sub-in-claim") return;
    const matchId = normalizeScoutedMatchId(row.matchId || row.matchKey || row.matchLabel);
    if (matchId) completed.add(matchId);
  });
  return completed;
}
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
          // Fall through to load matches for the detected event even without assignments.
        }

        const assignedEvent =
          assignedEventCounts.size === 0
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
        if (firstSchedule.length > 0) {
          const existingPracticeNumbers = new Set(
            matches.filter((match) => match.comp_level === "pr").map((match) => match.match_number)
          );
          const practiceFromFirst = firstSchedule
            .filter((match) => !existingPracticeNumbers.has(match.matchNumber))
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
          matches = [...matches, ...practiceFromFirst];
        }

        const modalOptions = buildReefscapeModalOptions(matches);
        const teamsById = new Map<string, { teams: string[]; scheduleTime: number; redTeams: string[]; blueTeams: string[] }>();
        matches.forEach((match) => {
          const modalId = mapTbaMatchToModalId(match);
          if (!modalId) return;
          const redTeams = match.alliances.red.team_keys
            .map((k) => k.replace("frc", "").trim())
            .filter(Boolean);
          const blueTeams = match.alliances.blue.team_keys
            .map((k) => k.replace("frc", "").trim())
            .filter(Boolean);
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
        const completedFromForms = await fetchCompletedMatchIds(assignedEvent, userData.teamId || "");
        completedFromForms.forEach((id) => completedSet.add(id));
        setModalCompleted(completedSet);

        if (overrideEvent) {
          setAssignedTeams({});
          setAssignedMatchIds(new Set());
          setAssignedHumanPlayerMatches(new Set());
        } else {
          const assignmentDocsByEvent = (
            await Promise.all(
              expandEventKeyAliases(assignedEvent).map((eventKey) =>
                getDocs(
                  query(
                    collection(db, "matchAssignments"),
                    where("eventKey", "==", eventKey),
                    where("scoutId", "==", userData.uid)
                  )
                )
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

        if (overrideEvent) {
          setAssignedTeamsByMatch({});
        } else {
          try {
            const assignmentDocsAll = (
              await Promise.all(
                expandEventKeyAliases(assignedEvent).map((eventKey) =>
                  getDocs(query(collection(db, "matchAssignments"), where("eventKey", "==", eventKey)))
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
          if (forceAssignedMatch && nextMatch && !assignedMatchIds.has(current.id)) return nextMatch;
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
  }, [userData?.teamId, userData?.uid, teamTimeOverride?.enabled, teamTimeOverride?.offsetMs, editMode, editEventKey, editMatchId]);
  useEffect(() => {
    async function loadScouted() {
      if (!eventKey) return;
      const scoutingDocs = (
        await Promise.all(
          expandEventKeyAliases(eventKey).map((key) =>
            getDocs(query(collection(db, "scouting"), where("eventKey", "==", key)))
          )
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
      const completedFromForms = await fetchCompletedMatchIds(eventKey, userData?.teamId || "");
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
      if (Object.keys(userClaims).length > 0) {
        setAssignedTeams((prev) => ({ ...prev, ...userClaims }));
        setAssignedMatchIds((prev) => {
          const next = new Set(prev);
          Object.keys(userClaims).forEach((match) => next.add(match));
          return next;
        });
      }
    }
    void loadScouted();
  }, [eventKey, userData?.uid]);

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
    const next =
      assignedMatches.length > 0
        ? pickFirstIncomplete(assignedMatches) || pickNextBySchedule(assignedMatches)
        : pickFirstIncomplete(options) || pickNextBySchedule(options);
    if (!next) return;
    setSelectedMatch((current) => {
      if (!current) return next;
      if (!options.some((match) => match.id === current.id)) return next;
      if (modalCompleted.has(current.id)) return next;
      if (assignedMatches.length > 0 && !assignedMatchIds.has(current.id)) return next;
      return current;
    });
  }, [modalCompleted, options, assignedMatchIds, editMode]);

  const selectedMatchId = selectedMatch?.id || "";
  const selectedTeams = selectedMatch?.teams || [];
  const selectedScoutedTeams = useMemo(() => new Set(scoutedTeamsByMatch[selectedMatchId] || []), [scoutedTeamsByMatch, selectedMatchId]);
  const effectiveAssignedTeams = useMemo(
    () => ({ ...assignedTeams, ...subInClaimsForUser }),
    [assignedTeams, subInClaimsForUser]
  );
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
    if (pitSync.preloadRaw !== null && !pitPreloadFits) {
      messages.push(`Preload Capacity scale does not include pit value ${pitSync.preloadRaw}.`);
    }
    if (pitSync.bpsRaw !== null && !pitBpsFitsAuto) {
      messages.push(`Autonomous Balls Per Second scale does not include pit value ${pitSync.bpsRaw}.`);
    }
    if (pitSync.bpsRaw !== null && !pitBpsFitsTele) {
      messages.push(`Teleop Balls Per Second scale does not include pit value ${pitSync.bpsRaw}.`);
    }
    if (pitSync.carryRaw !== null && !pitCarryFitsAuto) {
      messages.push(`Autonomous Carrying Capacity scale does not include pit value ${pitSync.carryRaw}.`);
    }
    if (pitSync.carryRaw !== null && !pitCarryFitsTele) {
      messages.push(`Teleop Carrying Capacity scale does not include pit value ${pitSync.carryRaw}.`);
    }
    return messages;
  }, [
    pitSync.eventSynced,
    pitSync.preloadRaw,
    pitSync.bpsRaw,
    pitSync.carryRaw,
    pitPreloadFits,
    pitBpsFitsAuto,
    pitBpsFitsTele,
    pitCarryFitsAuto,
    pitCarryFitsTele,
  ]);

  function getFinalsDisplayLabel(match: MatchOption) {
    const id = String(match.id || "").toLowerCase();
    if (!id.startsWith("sf") && !id.startsWith("qf")) {
      return `Finals ${match.matchNumber}`;
    }
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
    const matchesInRange = options.filter(
      (match) => match.type === subInRangeType && match.matchNumber >= min && match.matchNumber <= max
    );
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
    const teamList = [leadForm.robot1TeamNumber, leadForm.robot2TeamNumber, leadForm.robot3TeamNumber]
      .map((team) => team.trim())
      .filter(Boolean);
    if (teamList.length === 0) return;
    const allianceLabel = leadForm.alliance.toUpperCase();
    setLeadForm((prev) => ({
      ...prev,
      overallAllianceTeams: `${allianceLabel} / ${teamList.join(", ")}`,
    }));
  }, [
    leadForm.alliance,
    leadForm.robot1TeamNumber,
    leadForm.robot2TeamNumber,
    leadForm.robot3TeamNumber,
    overallAllianceTeamsTouched,
  ]);

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
    const estimated = endgameCycles.reduce(
      (sum, sec) => sum + Math.max(0, Math.round(Math.min(Math.max(0, carryCap), teleBps * sec))),
      0
    );
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
    if (!editMode && selectedScoutedTeams.has(form.teamNumber.trim())) return alert("That robot has already been scouted for this match.");
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
          {
            teamNumber: leadForm.robot1TeamNumber.trim(),
            notes: leadForm.robot1Notes.trim(),
            skillLevel: leadForm.robot1SkillLevel || 0,
          },
          {
            teamNumber: leadForm.robot2TeamNumber.trim(),
            notes: leadForm.robot2Notes.trim(),
            skillLevel: leadForm.robot2SkillLevel || 0,
          },
          {
            teamNumber: leadForm.robot3TeamNumber.trim(),
            notes: leadForm.robot3Notes.trim(),
            skillLevel: leadForm.robot3SkillLevel || 0,
          },
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
  const leadMode = searchParams.get("lead") === "1";

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="min-h-screen bg-gray-100 flex flex-col md:flex-row justify-center">
          <div className="flex-1 p-4 space-y-6 max-w-3xl">
            <div className="bg-white rounded-xl shadow p-4">
              <h1 className="text-3xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>
                {leadMode ? "Lead Scout Form" : "Match Scout Form"}
              </h1>
              {leadMode ? (
                <p className="text-sm text-gray-600 mb-2">Alliance-level observations for strategy and notes.</p>
              ) : (
                <>
                  {fromPractice && (
                    <p className="text-sm text-gray-600 mb-2">Opened from Practice Scouting.</p>
                  )}
                  {isHumanPlayerAssigned && (
                    <div className="bg-yellow-50 border-l-4 border-yellow-400 p-3 mb-2">
                      <p className="text-sm font-medium text-yellow-800">
                        This match, include the <strong>Human Player</strong> score.
                      </p>
                    </div>
                  )}
                  {pitSync.eventSynced ? (
                    <p className="text-sm text-green-700 mb-2">Detected pit scout form is synced for this team and event.</p>
                  ) : (
                    <p className="text-sm text-amber-700 mb-2">No pit scout form synced for this team in this event yet.</p>
                  )}
                  {pitMismatchMessages.length > 0 && (
                    <div className="mb-2 rounded border border-red-200 bg-red-50 px-3 py-2">
                      <p className="text-sm font-medium text-red-700">
                        Warning: match scout scales do not match synced pit scout values for this team.
                      </p>
                      {pitMismatchMessages.map((message) => (
                        <p key={message} className="text-xs text-red-700">
                          {message}
                        </p>
                      ))}
                    </div>
                  )}
                  <div className="mt-3 max-w-sm">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Form Select</label>
                    <select
                      className="w-full border rounded p-2"
                      value="REBUILT"
                      onChange={(e) => {
                        if (e.target.value === "REEFSCAPE") {
                          router.push("/scout-form-reefscape");
                        }
                      }}
                    >
                      <option value="REEFSCAPE">REEFSCAPE Form</option>
                      <option value="REBUILT">REBUILT Form</option>
                    </select>
                  </div>
                </>
              )}
            </div>

            <div className="bg-white rounded-xl shadow p-4 border-l-4" style={{ borderColor: "var(--primary-color)" }}>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-lg font-semibold">Assigned Match:</span>
                <span className="text-lg font-semibold" style={{ color: "var(--primary-color)" }}>{getSelectedMatchDisplay()}</span>
                <button type="button" onClick={() => setModalOpen(true)} className="px-2 py-0.5 text-xs rounded text-white" style={{ backgroundColor: "var(--primary-color)" }}>Fix</button>
                  {!leadMode && (
                    <button
                      type="button"
                      onClick={() => setSubInRequestOpen(true)}
                      className="px-2 py-0.5 text-xs rounded text-white"
                      style={{ backgroundColor: "#c2410c" }}
                      disabled={subInSubmitting}
                    >
                      {subInSubmitting ? "Requesting..." : "Request Sub-In"}
                  </button>
                )}
              </div>
            </div>

            {!leadMode && (
              <form
                className="space-y-6"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
                }}
              >
                <div className="bg-white rounded-xl shadow p-4 space-y-3">
                  <h2 className="text-lg font-semibold" style={{ color: "var(--primary-color)" }}>Pre-Match Info</h2>
                  <label className="block text-sm font-medium text-gray-700">Scout Name</label>
                  <input className="w-full border rounded p-2 bg-gray-100 text-gray-600" value={form.scoutName} disabled />
                  <label className="block text-sm font-medium text-gray-700">Team Number</label>
                  <div className="flex gap-2">
                    <input
                      className="flex-1 border rounded p-2"
                      placeholder={selectedTeams.length > 0 ? "Select team" : "Enter team number"}
                      value={form.teamNumber}
                      onChange={(e) => setForm((p) => ({ ...p, teamNumber: e.target.value.replace(/[^\d]/g, "") }))}
                    />
                    <button
                      type="button"
                      className="px-4 rounded border disabled:opacity-50"
                      onClick={() => setShowTeamPicker(true)}
                      disabled={selectedTeams.length === 0}
                    >
                      Pick
                    </button>
                  </div>
                  <label className="block text-sm font-medium text-gray-700">Starting Position</label>
                  <select className="w-full border rounded p-2" value={form.startingPosition} onChange={(e) => setForm((p) => ({ ...p, startingPosition: e.target.value }))}>
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

                <div className="bg-white rounded-xl shadow p-4 space-y-3">
                  <h2 className="text-lg font-semibold" style={{ color: "var(--primary-color)" }}>Autonomous</h2>
                  <label className="block text-sm font-medium text-gray-700">
                    Preload Capacity ({PRELOAD_LABELS[Math.max(0, Math.min(4, form.autoPreloadScale))]})
                    {pitSync.preloadRaw !== null ? ` | Pit: ${pitSync.preloadRaw}` : ""}
                  </label>
                  <input type="range" min={0} max={4} value={form.autoPreloadScale} onChange={(e) => setForm((p) => ({ ...p, autoPreloadScale: Number(e.target.value) }))} className="w-full" />
                  <label className="block text-sm font-medium text-gray-700">
                    Balls Per Second ({BPS_LABELS[Math.max(0, Math.min(BPS_MAX, form.autoBpsScale))]})
                    {pitSync.bpsRaw !== null ? ` | Pit: ${pitSync.bpsRaw}` : ""}
                  </label>
                  <input type="range" min={0} max={BPS_MAX} value={form.autoBpsScale} onChange={(e) => setForm((p) => ({ ...p, autoBpsScale: Number(e.target.value) }))} className="w-full" />
                  <label className="block text-sm font-medium text-gray-700">
                    Carrying Capacity ({CARRY_LABELS[Math.max(0, Math.min(CARRY_MAX, form.autoCarryScale))]})
                    {pitSync.carryRaw !== null ? ` | Pit: ${pitSync.carryRaw}` : ""}
                  </label>
                  <input type="range" min={0} max={CARRY_MAX} value={form.autoCarryScale} onChange={(e) => setForm((p) => ({ ...p, autoCarryScale: Number(e.target.value) }))} className="w-full" />
                  <CycleTimer
                    title="Auto Cycle Timer"
                    values={autoCycles}
                    onAdd={(v) => setAutoCycles((p) => [...p, v])}
                    onDelete={(index) => setAutoCycles((p) => p.filter((_, i) => i !== index))}
                  />
                  <h3 className="text-sm font-semibold text-gray-700">Counter Override</h3>
                  <ClimbCounter label="Scored Fuel" value={form.autoCounterOverride} onChange={(next) => setForm((p) => ({ ...p, autoCounterOverride: next }))} />
                  <ClimbCounter label="Missed Fuel" value={form.autoCounterMissedFuel} onChange={(next) => setForm((p) => ({ ...p, autoCounterMissedFuel: next }))} />
                  <h3 className="text-sm font-semibold text-gray-700">Human Player</h3>
                  <ClimbCounter label="Scored Fuel" value={form.autoHumanPlayerFuel} onChange={(next) => setForm((p) => ({ ...p, autoHumanPlayerFuel: next }))} />
                  <h3 className="text-sm font-semibold text-gray-700">Climb</h3>
                  <ClimbCounter label="Failed Climb" value={form.autoFailedClimb} onChange={(next) => setForm((p) => ({ ...p, autoFailedClimb: next }))} />
                  <label className="flex items-center gap-2"><input type="checkbox" checked={form.autoSuccessfulClimb} onChange={(e) => setForm((p) => ({ ...p, autoSuccessfulClimb: e.target.checked }))} />Successful Climb</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={form.wonAuto} onChange={(e) => setForm((p) => ({ ...p, wonAuto: e.target.checked }))} />Won Auto</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={form.hubActivationOverride} onChange={(e) => setForm((p) => ({ ...p, hubActivationOverride: e.target.checked }))} />Hub Activation Override</label>
                </div>

                <div className="bg-white rounded-xl shadow p-4 space-y-3">
                  <h2 className="text-lg font-semibold" style={{ color: "var(--primary-color)" }}>Teleoperated</h2>
                  <label className="block text-sm font-medium text-gray-700">
                    Balls Per Second ({BPS_LABELS[Math.max(0, Math.min(BPS_MAX, form.teleBpsScale))]})
                    {pitSync.bpsRaw !== null ? ` | Pit: ${pitSync.bpsRaw}` : ""}
                  </label>
                  <input type="range" min={0} max={BPS_MAX} value={form.teleBpsScale} onChange={(e) => setForm((p) => ({ ...p, teleBpsScale: Number(e.target.value) }))} className="w-full" />
                  <label className="block text-sm font-medium text-gray-700">
                    Carrying Capacity ({CARRY_LABELS[Math.max(0, Math.min(CARRY_MAX, form.teleCarryScale))]})
                    {pitSync.carryRaw !== null ? ` | Pit: ${pitSync.carryRaw}` : ""}
                  </label>
                  <input type="range" min={0} max={CARRY_MAX} value={form.teleCarryScale} onChange={(e) => setForm((p) => ({ ...p, teleCarryScale: Number(e.target.value) }))} className="w-full" />
                  <CycleTimer
                    title="Transition Shift"
                    values={transitionCycles}
                    onAdd={(v) => setTransitionCycles((p) => [...p, v])}
                    onDelete={(index) => setTransitionCycles((p) => p.filter((_, i) => i !== index))}
                  />
                  <h3 className="text-sm font-semibold text-gray-700">Counter Override</h3>
                  <ClimbCounter label="Scored Fuel" value={form.transitionCounterOverride} onChange={(next) => setForm((p) => ({ ...p, transitionCounterOverride: next }))} />
                  <ClimbCounter label="Missed Fuel" value={form.transitionCounterMissedFuel} onChange={(next) => setForm((p) => ({ ...p, transitionCounterMissedFuel: next }))} />
                  <h3 className="text-sm font-semibold text-gray-700">Human Player</h3>
                  <ClimbCounter label="Scored Fuel" value={form.teleopHumanPlayerFuel} onChange={(next) => setForm((p) => ({ ...p, teleopHumanPlayerFuel: next }))} />
                  <p className="text-xs text-gray-600">
                    Counted shifts right now: Transition + {form.wonAuto !== form.hubActivationOverride ? "Shift 2 + Shift 4" : "Shift 1 + Shift 3"}.
                    Toggle <span className="font-medium">Won Auto</span> or <span className="font-medium">Hub Activation Override</span> to flip counted shifts.
                  </p>
                  <CycleTimer
                    title={`Shift 1 ${form.wonAuto !== form.hubActivationOverride ? "(Not Counted)" : "(Counted)"}`}
                    values={shift1Cycles}
                    onAdd={(v) => setShift1Cycles((p) => [...p, v])}
                    onDelete={(index) => setShift1Cycles((p) => p.filter((_, i) => i !== index))}
                  />
                  <h3 className="text-sm font-semibold text-gray-700">Counter Override</h3>
                  <ClimbCounter label="Scored Fuel" value={form.shift1CounterOverride} onChange={(next) => setForm((p) => ({ ...p, shift1CounterOverride: next }))} />
                  <ClimbCounter label="Missed Fuel" value={form.shift1CounterMissedFuel} onChange={(next) => setForm((p) => ({ ...p, shift1CounterMissedFuel: next }))} />
                  <h3 className="text-sm font-semibold text-gray-700">Human Player</h3>
                  <ClimbCounter label="Scored Fuel" value={form.teleopHumanPlayerFuel} onChange={(next) => setForm((p) => ({ ...p, teleopHumanPlayerFuel: next }))} />
                  <CycleTimer
                    title={`Shift 2 ${form.wonAuto !== form.hubActivationOverride ? "(Counted)" : "(Not Counted)"}`}
                    values={shift2Cycles}
                    onAdd={(v) => setShift2Cycles((p) => [...p, v])}
                    onDelete={(index) => setShift2Cycles((p) => p.filter((_, i) => i !== index))}
                  />
                  <h3 className="text-sm font-semibold text-gray-700">Counter Override</h3>
                  <ClimbCounter label="Scored Fuel" value={form.shift2CounterOverride} onChange={(next) => setForm((p) => ({ ...p, shift2CounterOverride: next }))} />
                  <ClimbCounter label="Missed Fuel" value={form.shift2CounterMissedFuel} onChange={(next) => setForm((p) => ({ ...p, shift2CounterMissedFuel: next }))} />
                  <h3 className="text-sm font-semibold text-gray-700">Human Player</h3>
                  <ClimbCounter label="Scored Fuel" value={form.teleopHumanPlayerFuel} onChange={(next) => setForm((p) => ({ ...p, teleopHumanPlayerFuel: next }))} />
                  <CycleTimer
                    title={`Shift 3 ${form.wonAuto !== form.hubActivationOverride ? "(Not Counted)" : "(Counted)"}`}
                    values={shift3Cycles}
                    onAdd={(v) => setShift3Cycles((p) => [...p, v])}
                    onDelete={(index) => setShift3Cycles((p) => p.filter((_, i) => i !== index))}
                  />
                  <h3 className="text-sm font-semibold text-gray-700">Counter Override</h3>
                  <ClimbCounter label="Scored Fuel" value={form.shift3CounterOverride} onChange={(next) => setForm((p) => ({ ...p, shift3CounterOverride: next }))} />
                  <ClimbCounter label="Missed Fuel" value={form.shift3CounterMissedFuel} onChange={(next) => setForm((p) => ({ ...p, shift3CounterMissedFuel: next }))} />
                  <h3 className="text-sm font-semibold text-gray-700">Human Player</h3>
                  <ClimbCounter label="Scored Fuel" value={form.teleopHumanPlayerFuel} onChange={(next) => setForm((p) => ({ ...p, teleopHumanPlayerFuel: next }))} />
                  <CycleTimer
                    title={`Shift 4 ${form.wonAuto !== form.hubActivationOverride ? "(Counted)" : "(Not Counted)"}`}
                    values={shift4Cycles}
                    onAdd={(v) => setShift4Cycles((p) => [...p, v])}
                    onDelete={(index) => setShift4Cycles((p) => p.filter((_, i) => i !== index))}
                  />
                  <h3 className="text-sm font-semibold text-gray-700">Counter Override</h3>
                  <ClimbCounter label="Scored Fuel" value={form.shift4CounterOverride} onChange={(next) => setForm((p) => ({ ...p, shift4CounterOverride: next }))} />
                  <ClimbCounter label="Missed Fuel" value={form.shift4CounterMissedFuel} onChange={(next) => setForm((p) => ({ ...p, shift4CounterMissedFuel: next }))} />
                  <h3 className="text-sm font-semibold text-gray-700">Human Player</h3>
                  <ClimbCounter label="Scored Fuel" value={form.teleopHumanPlayerFuel} onChange={(next) => setForm((p) => ({ ...p, teleopHumanPlayerFuel: next }))} />
                </div>

                <div className="bg-white rounded-xl shadow p-4 space-y-3">
                  <h2 className="text-lg font-semibold" style={{ color: "var(--primary-color)" }}>Endgame</h2>
                  <CycleTimer
                    title="Endgame Cycle Timer"
                    values={endgameCycles}
                    onAdd={(v) => setEndgameCycles((p) => [...p, v])}
                    onDelete={(index) => setEndgameCycles((p) => p.filter((_, i) => i !== index))}
                  />
                  <h3 className="text-sm font-semibold text-gray-700">Counter Override</h3>
                  <ClimbCounter label="Scored Fuel" value={form.endgameCounterOverride} onChange={(next) => setForm((p) => ({ ...p, endgameCounterOverride: next }))} />
                  <ClimbCounter label="Missed Fuel" value={form.endgameCounterMissedFuel} onChange={(next) => setForm((p) => ({ ...p, endgameCounterMissedFuel: next }))} />
                  <h3 className="text-sm font-semibold text-gray-700">Human Player</h3>
                  <ClimbCounter label="Scored Fuel" value={form.endgameHumanPlayerFuel} onChange={(next) => setForm((p) => ({ ...p, endgameHumanPlayerFuel: next }))} />
                  <h3 className="text-sm font-semibold text-gray-700">Climb</h3>
                  <ClimbCounter label="Failed Climb" value={form.endgameFailedClimb} onChange={(next) => setForm((p) => ({ ...p, endgameFailedClimb: next }))} />
                  <select className="w-full border rounded p-2" value={form.endgameStatus} onChange={(e) => setForm((p) => ({ ...p, endgameStatus: e.target.value }))}>
                    <option value="">Status At End of Match</option>
                    <option value="parked">Parked</option>
                    <option value="level-1">Level 1</option>
                    <option value="level-2">Level 2</option>
                    <option value="level-3">Level 3</option>
                  </select>
                </div>

                <div className="bg-white rounded-xl shadow p-4 space-y-2">
                  <h2 className="text-lg font-semibold" style={{ color: "var(--primary-color)" }}>General</h2>
                  {INCIDENTS.map((incident) => (
                    <label key={incident.value} className="flex items-center gap-2">
                      <input type="checkbox" checked={form.incidents.includes(incident.value)} onChange={(e) => setForm((p) => ({ ...p, incidents: e.target.checked ? [...p.incidents, incident.value] : p.incidents.filter((v) => v !== incident.value) }))} />
                      {incident.label}
                    </label>
                  ))}
                </div>

                <button type="submit" disabled={saving} className="w-full py-3 rounded text-white font-semibold" style={{ backgroundColor: "var(--primary-color)" }}>
                  {saving ? "Submitting..." : editMode ? "Update Match Scout Form" : "Submit Match Scout Form"}
                </button>
              </form>
            )}

            {leadMode && (
              <form className="space-y-6" onSubmit={submitLead}>
              <div className="bg-white rounded-xl shadow p-4 space-y-3">
                <h2 className="text-lg font-semibold" style={{ color: "var(--primary-color)" }}>Pre-Match Info</h2>
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-sm font-medium text-gray-700">Match Select</span>
                  <span className="text-sm font-semibold" style={{ color: "var(--primary-color)" }}>{getSelectedMatchDisplay()}</span>
                  <button type="button" onClick={() => setModalOpen(true)} className="px-2 py-0.5 text-xs rounded text-white" style={{ backgroundColor: "var(--primary-color)" }}>Fix</button>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-gray-700">Red/Blue Alliance</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setLeadForm((prev) => ({ ...prev, alliance: "red" }))}
                      className={`px-3 py-1 rounded text-sm font-medium border ${leadForm.alliance === "red" ? "bg-red-600 text-white border-red-600" : "bg-gray-100 text-gray-700 border-gray-200"}`}
                    >
                      Red
                    </button>
                    <button
                      type="button"
                      onClick={() => setLeadForm((prev) => ({ ...prev, alliance: "blue" }))}
                      className={`px-3 py-1 rounded text-sm font-medium border ${leadForm.alliance === "blue" ? "bg-blue-600 text-white border-blue-600" : "bg-gray-100 text-gray-700 border-gray-200"}`}
                    >
                      Blue
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setLeadForm((prev) => ({
                        ...prev,
                        alliance: prev.alliance === "red" ? "blue" : "red",
                      }))
                    }
                    className="px-3 py-1 rounded text-sm border border-gray-200 text-gray-700 hover:bg-gray-100"
                  >
                    Swap
                  </button>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-1">Scout Name</h3>
                  <input className="w-full border rounded p-2 bg-gray-100 text-gray-600" value={leadForm.scoutName} disabled />
                </div>
              </div>

              <div className="bg-white rounded-xl shadow p-4 space-y-3">
                <h2 className="text-lg font-semibold" style={{ color: "var(--primary-color)" }}>Overall Alliance</h2>
                <h3 className="text-sm font-semibold text-gray-700">Alliance Color / Team</h3>
                <input
                  className="w-full border rounded p-2"
                  value={leadForm.overallAllianceTeams}
                  onChange={(e) => {
                    setOverallAllianceTeamsTouched(true);
                    setLeadForm((prev) => ({ ...prev, overallAllianceTeams: e.target.value }));
                  }}
                  placeholder="RED / 1111, 2222, 3333"
                />
                <h3 className="text-sm font-semibold text-gray-700">Notes</h3>
                <textarea
                  className="w-full border rounded p-2"
                  rows={3}
                  value={leadForm.overallAllianceNotes}
                  onChange={(e) => setLeadForm((prev) => ({ ...prev, overallAllianceNotes: e.target.value }))}
                />
                <h3 className="text-sm font-semibold text-gray-700">Skill Level</h3>
                <LeadScaleSelector value={leadForm.overallAllianceSkillLevel} onChange={(value) => setLeadForm((prev) => ({ ...prev, overallAllianceSkillLevel: value }))} />
              </div>

              <div className="bg-white rounded-xl shadow p-4 space-y-3">
                <h2 className="text-lg font-semibold" style={{ color: "var(--primary-color)" }}>Robot 1</h2>
                <h3 className="text-sm font-semibold text-gray-700">Team Number</h3>
                <div className="flex gap-2 items-center">
                  <input
                    className="flex-1 border rounded p-2"
                    value={leadForm.robot1TeamNumber}
                    onChange={(e) => setLeadForm((prev) => ({ ...prev, robot1TeamNumber: e.target.value.replace(/[^\d]/g, "") }))}
                    placeholder="Team #"
                  />
                  <button type="button" className="px-3 py-2 rounded border" onClick={() => openLeadTeamPicker("robot1")}>Pick</button>
                </div>
                <h3 className="text-sm font-semibold text-gray-700">Notes</h3>
                <textarea
                  className="w-full border rounded p-2"
                  rows={3}
                  value={leadForm.robot1Notes}
                  onChange={(e) => setLeadForm((prev) => ({ ...prev, robot1Notes: e.target.value }))}
                />
                <h3 className="text-sm font-semibold text-gray-700">Skill Level</h3>
                <LeadScaleSelector value={leadForm.robot1SkillLevel} onChange={(value) => setLeadForm((prev) => ({ ...prev, robot1SkillLevel: value }))} />
              </div>

              <div className="bg-white rounded-xl shadow p-4 space-y-3">
                <h2 className="text-lg font-semibold" style={{ color: "var(--primary-color)" }}>Robot 2</h2>
                <h3 className="text-sm font-semibold text-gray-700">Team Number</h3>
                <div className="flex gap-2 items-center">
                  <input
                    className="flex-1 border rounded p-2"
                    value={leadForm.robot2TeamNumber}
                    onChange={(e) => setLeadForm((prev) => ({ ...prev, robot2TeamNumber: e.target.value.replace(/[^\d]/g, "") }))}
                    placeholder="Team #"
                  />
                  <button type="button" className="px-3 py-2 rounded border" onClick={() => openLeadTeamPicker("robot2")}>Pick</button>
                </div>
                <h3 className="text-sm font-semibold text-gray-700">Notes</h3>
                <textarea
                  className="w-full border rounded p-2"
                  rows={3}
                  value={leadForm.robot2Notes}
                  onChange={(e) => setLeadForm((prev) => ({ ...prev, robot2Notes: e.target.value }))}
                />
                <h3 className="text-sm font-semibold text-gray-700">Skill Level</h3>
                <LeadScaleSelector value={leadForm.robot2SkillLevel} onChange={(value) => setLeadForm((prev) => ({ ...prev, robot2SkillLevel: value }))} />
              </div>

              <div className="bg-white rounded-xl shadow p-4 space-y-3">
                <h2 className="text-lg font-semibold" style={{ color: "var(--primary-color)" }}>Robot 3</h2>
                <h3 className="text-sm font-semibold text-gray-700">Team Number</h3>
                <div className="flex gap-2 items-center">
                  <input
                    className="flex-1 border rounded p-2"
                    value={leadForm.robot3TeamNumber}
                    onChange={(e) => setLeadForm((prev) => ({ ...prev, robot3TeamNumber: e.target.value.replace(/[^\d]/g, "") }))}
                    placeholder="Team #"
                  />
                  <button type="button" className="px-3 py-2 rounded border" onClick={() => openLeadTeamPicker("robot3")}>Pick</button>
                </div>
                <h3 className="text-sm font-semibold text-gray-700">Notes</h3>
                <textarea
                  className="w-full border rounded p-2"
                  rows={3}
                  value={leadForm.robot3Notes}
                  onChange={(e) => setLeadForm((prev) => ({ ...prev, robot3Notes: e.target.value }))}
                />
                <h3 className="text-sm font-semibold text-gray-700">Skill Level</h3>
                <LeadScaleSelector value={leadForm.robot3SkillLevel} onChange={(value) => setLeadForm((prev) => ({ ...prev, robot3SkillLevel: value }))} />
              </div>

              <button type="submit" disabled={leadSaving} className="w-full py-3 rounded text-white font-semibold" style={{ backgroundColor: "var(--primary-color)" }}>
                {leadSaving ? "Submitting..." : editMode ? "Update Lead Scout Form" : "Submit Lead Scout Form"}
              </button>
              </form>
            )}
          </div>

          {!leadMode && (
            <>
              <div className="hidden md:block w-80 p-4">
                <div className="bg-white rounded-xl shadow p-4 flex flex-col sticky top-4" style={{ height: "calc(100vh - 2rem)" }}>
                  <h2 className="text-xl font-semibold mb-2" style={{ color: "var(--primary-color)" }}>Notes</h2>
                  <textarea value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} className="flex-1 border rounded p-2 resize-none" placeholder="Optional notes..." />
                </div>
              </div>

              <div className="md:hidden fixed right-0 top-1/2 -translate-y-1/2 z-50">
                <button onClick={() => setMobileNotesOpen((p) => !p)} className="px-2 py-4 rounded-l-xl text-white" style={{ backgroundColor: "var(--primary-color)" }}>{mobileNotesOpen ? ">" : "<"}</button>
              </div>
              {mobileNotesOpen && (
                <div className="fixed inset-0 z-50 bg-white p-4">
                  <div className="flex items-center justify-between mb-2"><h2 className="text-xl font-semibold">Notes</h2><button onClick={() => setMobileNotesOpen(false)} className="px-3 py-1 rounded bg-gray-100">Close</button></div>
                  <textarea value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} className="w-full h-[calc(100%-3rem)] border rounded p-3 resize-none" />
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
                  <h2 className="text-xl font-semibold mb-3" style={{ color: "var(--primary-color)" }}>Request Sub-In</h2>
                  <p className="text-sm text-gray-600 mb-4">Pick a single match or request multiple matches.</p>
                  <div className="space-y-3">
                    <button
                      type="button"
                      className="w-full py-2 rounded text-white"
                      style={{ backgroundColor: "var(--primary-color)" }}
                      onClick={() => {
                        setSubInRequestOpen(false);
                        setSubInModalOpen(true);
                      }}
                    >
                      One Match
                    </button>
                    <button
                      type="button"
                      className="w-full py-2 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
                      onClick={() => setSubInRequestStep("range")}
                    >
                      Multiple Matches
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setSubInRequestStep("choice")}
                    className="text-sm text-gray-600 hover:text-gray-900 mb-3"
                  >
                    {"\u2190 Back"}
                  </button>
                  <h2 className="text-xl font-semibold mb-2" style={{ color: "var(--primary-color)" }}>Multiple Matches</h2>
                  <p className="text-sm text-gray-600 mb-4">
                    Enter a range (x-y, inclusive). We will only request sub-ins for matches in that range that you are assigned to.
                  </p>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Match Type</label>
                      <select
                        className="w-full border rounded p-2"
                        value={subInRangeType}
                        onChange={(event) => setSubInRangeType(event.target.value as MatchType)}
                      >
                        <option value="practice">Practice</option>
                        <option value="qualification">Qualification</option>
                        <option value="finals">Finals</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        className="flex-1 border rounded p-2"
                        placeholder="Start (x)"
                        value={subInRangeStart}
                        onChange={(event) => setSubInRangeStart(event.target.value.replace(/[^\d]/g, ""))}
                      />
                      <span className="text-sm text-gray-500">to</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        className="flex-1 border rounded p-2"
                        placeholder="End (y)"
                        value={subInRangeEnd}
                        onChange={(event) => setSubInRangeEnd(event.target.value.replace(/[^\d]/g, ""))}
                      />
                    </div>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <button
                      type="button"
                      className="flex-1 py-2 rounded text-white"
                      style={{ backgroundColor: "var(--primary-color)" }}
                      onClick={() => void submitSubInRange()}
                      disabled={subInSubmitting}
                    >
                      {subInSubmitting ? "Requesting..." : "Request Range"}
                    </button>
                    <button
                      type="button"
                      className="flex-1 py-2 rounded border border-gray-300 font-semibold hover:bg-gray-50"
                      onClick={() => setSubInRequestOpen(false)}
                    >
                      Cancel
                    </button>
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
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["coach", "scout"]}>
      <ScoutFormContent />
    </ProtectedRoute>
  );
}
