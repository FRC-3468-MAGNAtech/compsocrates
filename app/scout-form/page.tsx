"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { addDoc, collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { Check, Hourglass, X as XIcon } from "lucide-react";
import Sidebar from "@/app/components/Sidebar";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import ReefscapeStyleModal from "@/app/components/ReefscapeStyleModal";
import ReefscapeMatchSelectModal from "@/app/components/ReefscapeMatchSelectModal";
import { useAuth } from "@/app/AuthContext";
import { db } from "@/app/firebase";
import { getEventMatches } from "@/app/utils/tba-api";

type MatchType = "practice" | "qualification" | "finals";
type MatchStatus = "completed" | "next" | "upcoming";

type MatchOption = {
  id: string;
  label: string;
  type: MatchType;
  matchNumber: number;
  scheduleTime: number;
  teams: string[];
};

type AssignmentRow = {
  matchKey?: string;
  matchLabel?: string;
  teamNumber?: number;
};

type FormState = {
  scoutName: string;
  teamNumber: string;
  startingPosition: string;
  autoPreloadScale: number;
  autoBpsScale: number;
  autoCarryScale: number;
  autoFailedClimb: number;
  autoSuccessfulClimb: boolean;
  wonAuto: boolean;
  teleBpsScale: number;
  teleCarryScale: number;
  endgameFailedClimb: number;
  endgameStatus: string;
  incidents: string[];
  notes: string;
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

const BPS = [0, 2, 5, 8, 10];
const CARRY = [0, 12, 23, 32, 42, 53, 54];
const PRELOAD = [0, 2, 4, 6, 8];
const PRELOAD_LABELS = ["0", "1-2", "3-4", "5-6", "7-8"];
const BPS_LABELS = ["0", "1-3", "4-6", "7-9", "10+"];
const CARRY_LABELS = ["0", "1-12", "13-23", "23-32", "33-42", "43-53", "54+"];

function convertPitScale(value: number, kind: "preload" | "bps" | "carry") {
  const n = Number(value || 0);
  if (kind === "preload") return n <= 0 ? 0 : n <= 2 ? 1 : n <= 4 ? 2 : n <= 6 ? 3 : 4;
  if (kind === "bps") return n <= 0 ? 0 : n <= 3 ? 1 : n <= 6 ? 2 : n <= 9 ? 3 : 4;
  return n <= 0 ? 0 : n <= 12 ? 1 : n <= 23 ? 2 : n <= 32 ? 3 : n <= 42 ? 4 : n <= 53 ? 5 : 6;
}

function estimateBalls(seconds: number, bpsScale: number, capacityBalls: number) {
  return Math.max(0, Math.round(Math.min(Math.max(0, capacityBalls), (BPS[bpsScale] || 0) * seconds)));
}

function CycleTimer({ title, values, onAdd }: { title: string; values: number[]; onAdd: (value: number) => void }) {
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
        <div key={`${title}-${i}-${v}`} className="text-xs text-gray-700">Cycle {i + 1}: {v.toFixed(2)}</div>
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
}: {
  number: number;
  row: number;
  col: number;
  status: MatchStatus;
  onPick: (matchNumber: number) => void;
  label?: string;
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
        if (status === "completed") return;
        onPick(number);
      }}
      disabled={status === "completed"}
      className={`absolute w-[120px] min-h-[62px] text-xs rounded border text-left bg-white ${
        status === "completed" ? "opacity-45 cursor-not-allowed bg-gray-100 border-gray-300" : "hover:bg-gray-50"
      }`}
      style={{ left: col, top: row, ...(status === "completed" ? {} : borderStyles[status]) }}
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

function mapAssignmentToMatchId(labelOrKey: string) {
  const raw = String(labelOrKey || "").toLowerCase();
  const qm = raw.match(/(?:_qm|qualification\s+)(\d+)/);
  if (qm) return `q${qm[1]}`;
  const practice = raw.match(/practice\s+(\d+)/);
  if (practice) return `p${practice[1]}`;
  const sf = raw.match(/(?:_sf\d+m|semifinal\s+\d+-)(\d+)/);
  if (sf) return `sf${sf[1]}`;
  const qf = raw.match(/(?:_qf\d+m|quarterfinal\s+\d+-)(\d+)/);
  if (qf) return `qf${qf[1]}`;
  const finals = raw.match(/(?:_f\d+m|finals\s+)(\d+)/);
  if (finals) return `f${finals[1]}`;
  return "";
}
function ScoutFormContent() {
  const router = useRouter();
  const { userData } = useAuth();
  const searchParams = useSearchParams();
  const [mobileNotesOpen, setMobileNotesOpen] = useState(false);
  const [eventKey, setEventKey] = useState("app-testing");
  const [modalOpen, setModalOpen] = useState(false);
  const [options, setOptions] = useState<MatchOption[]>([]);
  const [selectedMatch, setSelectedMatch] = useState<MatchOption | null>(null);
  const [assignedTeams, setAssignedTeams] = useState<Record<string, string>>({});
  const [scoutedTeamsByMatch, setScoutedTeamsByMatch] = useState<Record<string, string[]>>({});
  const [scoutedCounts, setScoutedCounts] = useState<Record<string, number>>({});
  const [targets, setTargets] = useState<Record<string, number>>({});
  const [pitLock, setPitLock] = useState({ preload: false, bps: false, carry: false });
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>({
    scoutName: userData?.displayName || "",
    teamNumber: "",
    startingPosition: "",
    autoPreloadScale: 0,
    autoBpsScale: 0,
    autoCarryScale: 0,
    autoFailedClimb: 0,
    autoSuccessfulClimb: false,
    wonAuto: false,
    teleBpsScale: 0,
    teleCarryScale: 0,
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
    setForm((prev) => ({ ...prev, scoutName: userData.displayName }));
  }, [userData?.displayName]);

  useEffect(() => {
    async function loadEventContext() {
      if (!userData?.teamId) return;
      const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
      const selectedEvents = (teamDoc.exists() ? teamDoc.data().selectedEvents : []) as string[] | undefined;
      const currentEvent = Array.isArray(selectedEvents) && selectedEvents.length > 0 ? String(selectedEvents[0]) : "app-testing";
      setEventKey(currentEvent);
      if (currentEvent === "app-testing") {
        setOptions([]);
        return;
      }

      const matches = await getEventMatches(currentEvent);
      const next: MatchOption[] = [];
      const nextTargets: Record<string, number> = {};
      matches.filter((m) => m.comp_level === "qm").sort((a, b) => a.match_number - b.match_number).forEach((m) => {
        const teams = [...m.alliances.red.team_keys, ...m.alliances.blue.team_keys].map((k) => k.replace("frc", "").trim()).filter(Boolean);
        const time = m.actual_time || m.predicted_time || m.time || 0;
        next.push({ id: `p${m.match_number}`, label: `Practice ${m.match_number}`, type: "practice", matchNumber: m.match_number, scheduleTime: time, teams });
        next.push({ id: `q${m.match_number}`, label: `Qualification ${m.match_number}`, type: "qualification", matchNumber: m.match_number, scheduleTime: time, teams });
        nextTargets[`p${m.match_number}`] = teams.length || 6;
        nextTargets[`q${m.match_number}`] = teams.length || 6;
      });
      matches.filter((m) => ["qf", "sf", "f"].includes(m.comp_level)).forEach((m) => {
        const teams = [...m.alliances.red.team_keys, ...m.alliances.blue.team_keys].map((k) => k.replace("frc", "").trim()).filter(Boolean);
        const time = m.actual_time || m.predicted_time || m.time || 0;
        const id = m.comp_level === "f" ? `f${m.match_number}` : m.comp_level === "sf" ? `sf${m.match_number}` : `qf${m.match_number}`;
        next.push({ id, label: m.comp_level === "f" ? `Finals ${m.match_number}` : m.comp_level === "sf" ? `Semifinal ${m.set_number}-${m.match_number}` : `Quarterfinal ${m.set_number}-${m.match_number}`, type: "finals", matchNumber: m.match_number, scheduleTime: time, teams });
        nextTargets[id] = teams.length || 6;
      });
      setOptions(next);
      setTargets(nextTargets);
      if (!selectedMatch && next.length > 0) setSelectedMatch(next.find((m) => m.type === "qualification") || next[0]);

      const assignmentSnap = await getDocs(query(collection(db, "matchAssignments"), where("eventKey", "==", currentEvent), where("scoutId", "==", userData.uid)));
      const assigned: Record<string, string> = {};
      assignmentSnap.docs.forEach((row) => {
        const data = row.data() as AssignmentRow;
        const matchId = mapAssignmentToMatchId(String(data.matchKey || data.matchLabel || ""));
        const team = String(data.teamNumber || "").trim();
        if (matchId && team) assigned[matchId] = team;
      });
      setAssignedTeams(assigned);
    }
    void loadEventContext();
  }, [userData?.teamId, userData?.uid, selectedMatch]);
  useEffect(() => {
    async function loadScouted() {
      if (!eventKey) return;
      const snap = await getDocs(query(collection(db, "scouting"), where("eventKey", "==", eventKey)));
      const counts: Record<string, number> = {};
      const teamsMap = new Map<string, Set<string>>();
      snap.docs.forEach((d) => {
        const row = d.data() as Record<string, unknown>;
        const matchId = String(row.matchId || "").toLowerCase().trim();
        const team = String(row.teamNumber || "").trim();
        if (!matchId) return;
        counts[matchId] = (counts[matchId] || 0) + 1;
        if (!teamsMap.has(matchId)) teamsMap.set(matchId, new Set<string>());
        if (team) teamsMap.get(matchId)?.add(team);
      });
      setScoutedCounts(counts);
      setScoutedTeamsByMatch(Object.fromEntries(Array.from(teamsMap.entries()).map(([k, v]) => [k, Array.from(v)])));
    }
    void loadScouted();
  }, [eventKey]);

  const selectedMatchId = selectedMatch?.id || "";
  const selectedTeams = selectedMatch?.teams || [];
  const selectedScoutedTeams = useMemo(() => new Set(scoutedTeamsByMatch[selectedMatchId] || []), [scoutedTeamsByMatch, selectedMatchId]);
  const assignedTeam = assignedTeams[selectedMatchId] || "";

  function getFinalsDisplayLabel(matchNum: number) {
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
    return `Finals ${matchNum}`;
  }

  function getSelectedMatchDisplay() {
    if (!selectedMatch) return "No match is set";
    if (selectedMatch.type === "practice") return `Practice Match ${selectedMatch.matchNumber}`;
    if (selectedMatch.type === "qualification") return `Qualification Match ${selectedMatch.matchNumber}`;
    if (selectedMatch.type === "finals") return getFinalsDisplayLabel(selectedMatch.matchNumber);
    return selectedMatch.label || "No match is set";
  }

  useEffect(() => {
    if (assignedTeam) setForm((prev) => ({ ...prev, teamNumber: assignedTeam }));
  }, [assignedTeam]);

  useEffect(() => {
    async function loadPitDefaults() {
      if (!userData?.teamId || !form.teamNumber.trim()) {
        setPitLock({ preload: false, bps: false, carry: false });
        return;
      }
      const pitSnap = await getDocs(
        query(collection(db, "pitScouting"), where("teamId", "==", userData.teamId), where("teamNumber", "==", form.teamNumber.trim()), where("game", "==", "REBUILT"))
      );
      if (pitSnap.empty) {
        setPitLock({ preload: false, bps: false, carry: false });
        return;
      }
      const latest = pitSnap.docs.map((r) => r.data() as Record<string, unknown>).sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))[0];
      const preloadRaw = Number(latest.fuelPreloadCapacity || 0);
      const bpsRaw = Number(latest.fuelBallsPerSecond || 0);
      const carryRaw = Number(latest.fuelCarryingCapacity || 0);
      const preload = preloadRaw > 0;
      const bps = bpsRaw > 0;
      const carry = carryRaw > 0;
      setPitLock({ preload, bps, carry });
      setForm((prev) => ({
        ...prev,
        autoPreloadScale: preload ? convertPitScale(preloadRaw, "preload") : prev.autoPreloadScale,
        autoBpsScale: bps ? convertPitScale(bpsRaw, "bps") : prev.autoBpsScale,
        autoCarryScale: carry ? convertPitScale(carryRaw, "carry") : prev.autoCarryScale,
        teleBpsScale: bps ? convertPitScale(bpsRaw, "bps") : prev.teleBpsScale,
        teleCarryScale: carry ? convertPitScale(carryRaw, "carry") : prev.teleCarryScale,
      }));
    }
    void loadPitDefaults();
  }, [userData?.teamId, form.teamNumber]);

  const completedMatches = useMemo(() => {
    return new Set(Object.keys(scoutedCounts).filter((id) => (scoutedCounts[id] || 0) >= (targets[id] || 6)));
  }, [scoutedCounts, targets]);

  function estimateAutoTotal() {
    const preloadCap = PRELOAD[Math.max(0, Math.min(4, form.autoPreloadScale))] || 0;
    const carryCap = CARRY[Math.max(0, Math.min(6, form.autoCarryScale))] || 0;
    return autoCycles.reduce((sum, seconds, i) => {
      const capacity = i === 0 && preloadCap > 0 ? preloadCap : carryCap;
      return sum + estimateBalls(seconds, form.autoBpsScale, capacity);
    }, 0);
  }

  function estimateTeleTotal() {
    const carryCap = CARRY[Math.max(0, Math.min(6, form.teleCarryScale))] || 0;
    const transition = transitionCycles.reduce((sum, sec) => sum + estimateBalls(sec, form.teleBpsScale, carryCap), 0);
    const s1 = shift1Cycles.reduce((sum, sec) => sum + estimateBalls(sec, form.teleBpsScale, carryCap), 0);
    const s2 = shift2Cycles.reduce((sum, sec) => sum + estimateBalls(sec, form.teleBpsScale, carryCap), 0);
    const s3 = shift3Cycles.reduce((sum, sec) => sum + estimateBalls(sec, form.teleBpsScale, carryCap), 0);
    const s4 = shift4Cycles.reduce((sum, sec) => sum + estimateBalls(sec, form.teleBpsScale, carryCap), 0);
    return transition + (form.wonAuto ? s2 + s4 : s1 + s3);
  }

  function estimatedScore() {
    const autoClimb = form.autoSuccessfulClimb ? 15 : 0;
    const teleClimb = form.endgameStatus === "level-1" ? 10 : form.endgameStatus === "level-2" ? 20 : form.endgameStatus === "level-3" ? 30 : 0;
    return estimateAutoTotal() + estimateTeleTotal() + autoClimb + teleClimb;
  }

  async function submit() {
    if (!userData?.uid || !userData.teamId) return;
    if (!selectedMatch) return alert("Select a match first.");
    if (!form.teamNumber.trim()) return alert("Team number required.");
    if (selectedScoutedTeams.has(form.teamNumber.trim())) return alert("That robot has already been scouted for this match.");

    setSaving(true);
    try {
      await addDoc(collection(db, "scouting"), {
        scoutName: userData.displayName || "",
        scoutId: userData.uid,
        teamId: userData.teamId,
        eventKey,
        game: "REBUILT",
        matchId: selectedMatch.id,
        matchType: selectedMatch.type,
        matchNumber: String(selectedMatch.matchNumber),
        teamNumber: form.teamNumber.trim(),
        startingPosition: form.startingPosition,
        auto: { preloadScale: form.autoPreloadScale, bpsScale: form.autoBpsScale, carryingScale: form.autoCarryScale, cycleTimes: autoCycles, estimatedFuel: estimateAutoTotal(), failedClimb: form.autoFailedClimb, successfulClimb: form.autoSuccessfulClimb, wonAuto: form.wonAuto },
        teleop: { shiftParityFromWonAuto: form.wonAuto, bpsScale: form.teleBpsScale, carryingScale: form.teleCarryScale, transitionCycles, shift1Cycles, shift2Cycles, shift3Cycles, shift4Cycles, estimatedFuel: estimateTeleTotal() },
        endgame: { cycleTimes: endgameCycles, failedClimb: form.endgameFailedClimb, status: form.endgameStatus },
        incidents: form.incidents,
        notes: form.notes,
        estimatedScore: estimatedScore(),
        scoringWeights: { autoFuel: 1, autoClimbLevel1: 15, teleopFuel: 1, teleopClimbLevel1: 10, teleopClimbLevel2: 20, teleopClimbLevel3: 30 },
        submittedAt: Date.now(),
        timestamp: Date.now(),
      });
      alert("Match scout form submitted.");
      setScoutedCounts((prev) => ({ ...prev, [selectedMatch.id]: (prev[selectedMatch.id] || 0) + 1 }));
      setScoutedTeamsByMatch((prev) => {
        const now = new Set(prev[selectedMatch.id] || []);
        now.add(form.teamNumber.trim());
        return { ...prev, [selectedMatch.id]: Array.from(now) };
      });
      setForm((prev) => ({ ...prev, teamNumber: assignedTeam || "", startingPosition: "", autoFailedClimb: 0, autoSuccessfulClimb: false, wonAuto: false, endgameFailedClimb: 0, endgameStatus: "", incidents: [], notes: "" }));
      setAutoCycles([]); setTransitionCycles([]); setShift1Cycles([]); setShift2Cycles([]); setShift3Cycles([]); setShift4Cycles([]); setEndgameCycles([]);
    } catch (error) {
      console.error(error);
      alert("Could not submit match scout form.");
    } finally {
      setSaving(false);
    }
  }
  const fromPractice = searchParams.get("practice") === "1";

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="min-h-screen bg-gray-100 flex flex-col md:flex-row justify-center">
          <div className="flex-1 p-4 space-y-6 max-w-3xl">
            <div className="bg-white rounded-xl shadow p-4">
              <h1 className="text-3xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>Match Scout Form</h1>
              {fromPractice && (
                <p className="text-sm text-gray-600 mb-2">Opened from Practice Scouting.</p>
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
            </div>

            <div className="bg-white rounded-xl shadow p-4 border-l-4" style={{ borderColor: "var(--primary-color)" }}>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-lg font-semibold">Assigned Match:</span>
                <span className="text-lg font-semibold" style={{ color: "var(--primary-color)" }}>{getSelectedMatchDisplay()}</span>
                <button type="button" onClick={() => setModalOpen(true)} className="px-2 py-0.5 text-xs rounded text-white" style={{ backgroundColor: "var(--primary-color)" }}>Fix</button>
              </div>
            </div>

            <>
                <div className="bg-white rounded-xl shadow p-4 space-y-3">
                  <h2 className="text-lg font-semibold" style={{ color: "var(--primary-color)" }}>Pre-Match Info</h2>
                  <label className="block text-sm font-medium text-gray-700">Scout Name</label>
                  <input className="w-full border rounded p-2 bg-gray-100 text-gray-600" value={form.scoutName} disabled />
                  <label className="block text-sm font-medium text-gray-700">Team Number</label>
                  {assignedTeam ? (
                    <input className="w-full border rounded p-2 bg-gray-100 text-gray-600" value={form.teamNumber} disabled />
                  ) : selectedTeams.length > 0 ? (
                    <select className="w-full border rounded p-2" value={form.teamNumber} onChange={(e) => setForm((p) => ({ ...p, teamNumber: e.target.value }))}>
                      <option value="">Select Team</option>
                      {selectedTeams.map((team) => <option key={team} value={team} disabled={selectedScoutedTeams.has(team)}>{selectedScoutedTeams.has(team) ? `${team} (Scouted)` : team}</option>)}
                    </select>
                  ) : (
                    <input className="w-full border rounded p-2" placeholder="Enter team number" value={form.teamNumber} onChange={(e) => setForm((p) => ({ ...p, teamNumber: e.target.value.replace(/[^\d]/g, "") }))} />
                  )}
                  <label className="block text-sm font-medium text-gray-700">Starting Position</label>
                  <select className="w-full border rounded p-2" value={form.startingPosition} onChange={(e) => setForm((p) => ({ ...p, startingPosition: e.target.value }))}>
                    <option value="">Select Position</option>
                    <option value="outpost-side">Outpost Side</option>
                    <option value="middle">Middle</option>
                    <option value="depot-side">Depot Side</option>
                  </select>
                </div>

                <div className="bg-white rounded-xl shadow p-4 space-y-3">
                  <h2 className="text-lg font-semibold" style={{ color: "var(--primary-color)" }}>Autonomous</h2>
                  <label className="block text-sm font-medium text-gray-700">Preload Capacity ({PRELOAD_LABELS[Math.max(0, Math.min(4, form.autoPreloadScale))]})</label>
                  <input type="range" min={0} max={4} value={form.autoPreloadScale} disabled={pitLock.preload} onChange={(e) => setForm((p) => ({ ...p, autoPreloadScale: Number(e.target.value) }))} className={`w-full ${pitLock.preload ? "opacity-60" : ""}`} />
                  <label className="block text-sm font-medium text-gray-700">Balls Per Second ({BPS_LABELS[Math.max(0, Math.min(4, form.autoBpsScale))]})</label>
                  <input type="range" min={0} max={4} value={form.autoBpsScale} disabled={pitLock.bps} onChange={(e) => setForm((p) => ({ ...p, autoBpsScale: Number(e.target.value) }))} className={`w-full ${pitLock.bps ? "opacity-60" : ""}`} />
                  <label className="block text-sm font-medium text-gray-700">Carrying Capacity ({CARRY_LABELS[Math.max(0, Math.min(6, form.autoCarryScale))]})</label>
                  <input type="range" min={0} max={6} value={form.autoCarryScale} disabled={pitLock.carry} onChange={(e) => setForm((p) => ({ ...p, autoCarryScale: Number(e.target.value) }))} className={`w-full ${pitLock.carry ? "opacity-60" : ""}`} />
                  <CycleTimer title="Auto Cycle Timer" values={autoCycles} onAdd={(v) => setAutoCycles((p) => [...p, v])} />
                  <ClimbCounter label="Failed Climb" value={form.autoFailedClimb} onChange={(next) => setForm((p) => ({ ...p, autoFailedClimb: next }))} />
                  <label className="flex items-center gap-2"><input type="checkbox" checked={form.autoSuccessfulClimb} onChange={(e) => setForm((p) => ({ ...p, autoSuccessfulClimb: e.target.checked }))} />Successful Climb</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={form.wonAuto} onChange={(e) => setForm((p) => ({ ...p, wonAuto: e.target.checked }))} />Won Auto</label>
                </div>

                <div className="bg-white rounded-xl shadow p-4 space-y-3">
                  <h2 className="text-lg font-semibold" style={{ color: "var(--primary-color)" }}>Teleoperated</h2>
                  <label className="block text-sm font-medium text-gray-700">Balls Per Second ({BPS_LABELS[Math.max(0, Math.min(4, form.teleBpsScale))]})</label>
                  <input type="range" min={0} max={4} value={form.teleBpsScale} disabled={pitLock.bps} onChange={(e) => setForm((p) => ({ ...p, teleBpsScale: Number(e.target.value) }))} className={`w-full ${pitLock.bps ? "opacity-60" : ""}`} />
                  <label className="block text-sm font-medium text-gray-700">Carrying Capacity ({CARRY_LABELS[Math.max(0, Math.min(6, form.teleCarryScale))]})</label>
                  <input type="range" min={0} max={6} value={form.teleCarryScale} disabled={pitLock.carry} onChange={(e) => setForm((p) => ({ ...p, teleCarryScale: Number(e.target.value) }))} className={`w-full ${pitLock.carry ? "opacity-60" : ""}`} />
                  <CycleTimer title="Transition Shift" values={transitionCycles} onAdd={(v) => setTransitionCycles((p) => [...p, v])} />
                  <p className="text-xs text-gray-600">
                    Counted shifts right now: Transition + {form.wonAuto ? "Shift 2 + Shift 4" : "Shift 1 + Shift 3"}.
                    Toggle <span className="font-medium">Won Auto</span> to flip counted shifts.
                  </p>
                  <CycleTimer title={`Shift 1 ${form.wonAuto ? "(Not Counted)" : "(Counted)"}`} values={shift1Cycles} onAdd={(v) => setShift1Cycles((p) => [...p, v])} />
                  <CycleTimer title={`Shift 2 ${form.wonAuto ? "(Counted)" : "(Not Counted)"}`} values={shift2Cycles} onAdd={(v) => setShift2Cycles((p) => [...p, v])} />
                  <CycleTimer title={`Shift 3 ${form.wonAuto ? "(Not Counted)" : "(Counted)"}`} values={shift3Cycles} onAdd={(v) => setShift3Cycles((p) => [...p, v])} />
                  <CycleTimer title={`Shift 4 ${form.wonAuto ? "(Counted)" : "(Not Counted)"}`} values={shift4Cycles} onAdd={(v) => setShift4Cycles((p) => [...p, v])} />
                </div>

                <div className="bg-white rounded-xl shadow p-4 space-y-3">
                  <h2 className="text-lg font-semibold" style={{ color: "var(--primary-color)" }}>Endgame</h2>
                  <CycleTimer title="Endgame Cycle Timer" values={endgameCycles} onAdd={(v) => setEndgameCycles((p) => [...p, v])} />
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

                <button type="button" disabled={saving} onClick={() => void submit()} className="w-full py-3 rounded text-white font-semibold" style={{ backgroundColor: "var(--primary-color)" }}>{saving ? "Submitting..." : "Submit Match Scout Form"}</button>
            </>
          </div>

          <div className="hidden md:block w-80 p-4">
            <div className="bg-white rounded-xl shadow p-4 flex flex-col sticky top-4" style={{ height: "calc(100vh - 2rem)" }}>
              <h2 className="text-xl font-semibold mb-2" style={{ color: "var(--primary-color)" }}>Notes</h2>
              <textarea value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} className="flex-1 border rounded p-2 resize-none" placeholder="Optional notes..." />
              {userData?.isTeamAdmin && (
                <p className="text-xs text-gray-600 mt-2">Estimated score (hidden from scouts): {estimatedScore()}</p>
              )}
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

          <ReefscapeMatchSelectModal open={modalOpen} onClose={() => setModalOpen(false)} options={options} completed={completedMatches} onPick={setSelectedMatch} />
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
