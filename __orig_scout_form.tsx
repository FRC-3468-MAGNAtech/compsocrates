"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { addDoc, collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { Check, Hourglass, X as XIcon } from "lucide-react";
import Sidebar from "@/app/components/Sidebar";
import ProtectedRoute from "@/app/components/ProtectedRoute";
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
  wonTeleop: boolean;
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

function convertPitScale(value: number, kind: "preload" | "bps" | "carry") {
  const n = Number(value || 0);
  if (kind === "preload") return n <= 0 ? 0 : n <= 2 ? 1 : n <= 4 ? 2 : n <= 6 ? 3 : 4;
  if (kind === "bps") return n <= 0 ? 0 : n <= 3 ? 1 : n <= 6 ? 2 : n <= 9 ? 3 : 4;
  return n <= 0 ? 0 : n <= 12 ? 1 : n <= 23 ? 2 : n <= 32 ? 3 : n <= 42 ? 4 : n <= 53 ? 5 : 6;
}

function estimateBalls(seconds: number, bpsScale: number, capScale: number) {
  return Math.max(0, Math.round(Math.min(CARRY[capScale] || 0, (BPS[bpsScale] || 0) * seconds)));
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
  useEffect(() => {
    if (!open) setStep("type");
  }, [open]);
  if (!open) return null;

  const current = options.filter((m) => m.type === step);
  const firstOpen = current.find((m) => !completed.has(m.id))?.id || "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-4xl p-4">
        {step === "type" ? (
          <>
            <h2 className="text-xl font-semibold mb-3" style={{ color: "var(--primary-color)" }}>Select Match Type</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button type="button" className="py-2 rounded text-white" style={{ backgroundColor: "var(--primary-color)" }} onClick={() => setStep("practice")}>Practice</button>
              <button type="button" className="py-2 rounded text-white" style={{ backgroundColor: "var(--primary-color)" }} onClick={() => setStep("qualification")}>Qualification</button>
              <button type="button" className="py-2 rounded text-white" style={{ backgroundColor: "var(--primary-color)" }} onClick={() => setStep("finals")}>Finals</button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <button type="button" className="text-sm underline" onClick={() => setStep("type")}>Back</button>
              <h2 className="text-xl font-semibold" style={{ color: "var(--primary-color)" }}>{step === "practice" ? "Practice Matches" : step === "qualification" ? "Qualification Matches" : "Finals"}</h2>
              <button type="button" className="text-sm underline" onClick={onClose}>Close</button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-[60vh] overflow-y-auto">
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
                    <div className="absolute top-1 left-1 text-[10px] px-1 py-0.5 rounded-full text-white" style={{ backgroundColor: color }}>
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
          </>
        )}
      </div>
    </div>
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
  const { userData } = useAuth();
  const searchParams = useSearchParams();
  const [mobileNotesOpen, setMobileNotesOpen] = useState(false);
  const [activeFormGame, setActiveFormGame] = useState<"REEFSCAPE" | "REBUILT">("REEFSCAPE");
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
    wonTeleop: false,
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
    async function loadPresetGame() {
      if (!userData?.teamId) return;
      const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
      if (!teamDoc.exists()) return;
      const presetId = teamDoc.data().activeMatchFormPresetId as string | undefined;
      if (!presetId) return;
      const presetDoc = await getDoc(doc(db, "formPresets", presetId));
      if (!presetDoc.exists()) return;
      const game = (presetDoc.data().game as string) || "REEFSCAPE";
      setActiveFormGame(game === "REBUILT" ? "REBUILT" : "REEFSCAPE");
    }
    void loadPresetGame();
  }, [userData?.teamId]);

  useEffect(() => {
    const gameParam = String(searchParams.get("game") || "").toUpperCase();
    if (gameParam === "REBUILT") {
      setActiveFormGame("REBUILT");
    } else if (gameParam === "REEFSCAPE") {
      setActiveFormGame("REEFSCAPE");
    }
  }, [searchParams]);

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
    return autoCycles.reduce((sum, seconds, i) => {
      const preloadCap = PRELOAD[Math.max(0, Math.min(4, form.autoPreloadScale))] || 0;
      const cap = i === 0 && preloadCap > 0 ? convertPitScale(preloadCap, "carry") : form.autoCarryScale;
      return sum + estimateBalls(seconds, form.autoBpsScale, cap);
    }, 0);
  }

  function estimateTeleTotal() {
    const transition = transitionCycles.reduce((sum, sec) => sum + estimateBalls(sec, form.teleBpsScale, form.teleCarryScale), 0);
    const s1 = shift1Cycles.reduce((sum, sec) => sum + estimateBalls(sec, form.teleBpsScale, form.teleCarryScale), 0);
    const s2 = shift2Cycles.reduce((sum, sec) => sum + estimateBalls(sec, form.teleBpsScale, form.teleCarryScale), 0);
    const s3 = shift3Cycles.reduce((sum, sec) => sum + estimateBalls(sec, form.teleBpsScale, form.teleCarryScale), 0);
    const s4 = shift4Cycles.reduce((sum, sec) => sum + estimateBalls(sec, form.teleBpsScale, form.teleCarryScale), 0);
    return transition + (form.wonTeleop ? s2 + s4 : s1 + s3);
  }

  function estimatedScore() {
    const autoClimb = form.autoSuccessfulClimb ? 15 : 0;
    const teleClimb = form.endgameStatus === "level-1" ? 10 : form.endgameStatus === "level-2" ? 20 : form.endgameStatus === "level-3" ? 30 : 0;
    return estimateAutoTotal() + estimateTeleTotal() + autoClimb + teleClimb;
  }

  async function submit() {
    if (!userData?.uid || !userData.teamId) return;
    if (activeFormGame === "REEFSCAPE") return alert("REEFSCAPE match form submissions are disabled.");
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
        teleop: { wonTeleop: form.wonTeleop, bpsScale: form.teleBpsScale, carryingScale: form.teleCarryScale, transitionCycles, shift1Cycles, shift2Cycles, shift3Cycles, shift4Cycles, estimatedFuel: estimateTeleTotal() },
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
      setForm((prev) => ({ ...prev, teamNumber: assignedTeam || "", startingPosition: "", autoFailedClimb: 0, autoSuccessfulClimb: false, wonAuto: false, wonTeleop: false, endgameFailedClimb: 0, endgameStatus: "", incidents: [], notes: "" }));
      setAutoCycles([]); setTransitionCycles([]); setShift1Cycles([]); setShift2Cycles([]); setShift3Cycles([]); setShift4Cycles([]); setEndgameCycles([]);
    } catch (error) {
      console.error(error);
      alert("Could not submit match scout form.");
    } finally {
      setSaving(false);
    }
  }
  const reefscapeMode = activeFormGame === "REEFSCAPE";
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
                <select className="w-full border rounded p-2" value={activeFormGame} onChange={(e) => setActiveFormGame(e.target.value === "REBUILT" ? "REBUILT" : "REEFSCAPE")}>
                  <option value="REEFSCAPE">REEFSCAPE Form</option>
                  <option value="REBUILT">REBUILT Form</option>
                </select>
              </div>
              {reefscapeMode && <p className="text-sm text-red-600 mt-2">REEFSCAPE submissions are disabled.</p>}
            </div>

            <div className="bg-white rounded-xl shadow p-4 border-l-4" style={{ borderColor: "var(--primary-color)" }}>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-lg font-semibold">Assigned Match:</span>
                <span className="text-lg font-semibold" style={{ color: "var(--primary-color)" }}>{selectedMatch?.label || "No match is set"}</span>
                <button type="button" onClick={() => setModalOpen(true)} className="px-2 py-0.5 text-xs rounded text-white" style={{ backgroundColor: "var(--primary-color)" }}>Fix</button>
              </div>
            </div>

            {reefscapeMode ? (
              <div className="bg-white rounded-xl shadow p-6"><p className="text-gray-700">REEFSCAPE form is view-only. Switch to REBUILT to submit scouting data.</p></div>
            ) : (
              <>
                <div className="bg-white rounded-xl shadow p-4 space-y-3">
                  <h2 className="text-lg font-semibold" style={{ color: "var(--primary-color)" }}>Pre-Match</h2>
                  <input className="w-full border rounded p-2 bg-gray-100 text-gray-600" value={form.scoutName} disabled />
                  {assignedTeam ? (
                    <input className="w-full border rounded p-2 bg-gray-100 text-gray-600" value={form.teamNumber} disabled />
                  ) : selectedTeams.length > 0 ? (
                    <select className="w-full border rounded p-2" value={form.teamNumber} onChange={(e) => setForm((p) => ({ ...p, teamNumber: e.target.value }))}>
                      <option value="">Select Team</option>
                      {selectedTeams.map((team) => <option key={team} value={team} disabled={selectedScoutedTeams.has(team)}>{selectedScoutedTeams.has(team) ? `${team} (Scouted)` : team}</option>)}
                    </select>
                  ) : (
                    <input className="w-full border rounded p-2" value={form.teamNumber} onChange={(e) => setForm((p) => ({ ...p, teamNumber: e.target.value.replace(/[^\d]/g, "") }))} />
                  )}
                  <select className="w-full border rounded p-2" value={form.startingPosition} onChange={(e) => setForm((p) => ({ ...p, startingPosition: e.target.value }))}>
                    <option value="">Starting Position</option>
                    <option value="outpost-side">Outpost Side</option>
                    <option value="middle">Middle</option>
                    <option value="depot-side">Depot Side</option>
                  </select>
                </div>

                <div className="bg-white rounded-xl shadow p-4 space-y-3">
                  <h2 className="text-lg font-semibold" style={{ color: "var(--primary-color)" }}>Autonomous</h2>
                  <input type="range" min={0} max={4} value={form.autoPreloadScale} disabled={pitLock.preload} onChange={(e) => setForm((p) => ({ ...p, autoPreloadScale: Number(e.target.value) }))} className={`w-full ${pitLock.preload ? "opacity-60" : ""}`} />
                  <input type="range" min={0} max={4} value={form.autoBpsScale} disabled={pitLock.bps} onChange={(e) => setForm((p) => ({ ...p, autoBpsScale: Number(e.target.value) }))} className={`w-full ${pitLock.bps ? "opacity-60" : ""}`} />
                  <input type="range" min={0} max={6} value={form.autoCarryScale} disabled={pitLock.carry} onChange={(e) => setForm((p) => ({ ...p, autoCarryScale: Number(e.target.value) }))} className={`w-full ${pitLock.carry ? "opacity-60" : ""}`} />
                  <CycleTimer title="Auto Cycle Timer" values={autoCycles} onAdd={(v) => setAutoCycles((p) => [...p, v])} />
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setForm((p) => ({ ...p, autoFailedClimb: p.autoFailedClimb - 1 }))} className="px-3 py-1 border rounded">-</button>
                    <span className="font-semibold">Failed Climb: {form.autoFailedClimb}</span>
                    <button type="button" onClick={() => setForm((p) => ({ ...p, autoFailedClimb: p.autoFailedClimb + 1 }))} className="px-3 py-1 border rounded">+</button>
                  </div>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={form.autoSuccessfulClimb} onChange={(e) => setForm((p) => ({ ...p, autoSuccessfulClimb: e.target.checked }))} />Successful Climb</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={form.wonAuto} onChange={(e) => setForm((p) => ({ ...p, wonAuto: e.target.checked }))} />Won Auto</label>
                </div>

                <div className="bg-white rounded-xl shadow p-4 space-y-3">
                  <h2 className="text-lg font-semibold" style={{ color: "var(--primary-color)" }}>Teleoperated</h2>
                  <input type="range" min={0} max={4} value={form.teleBpsScale} disabled={pitLock.bps} onChange={(e) => setForm((p) => ({ ...p, teleBpsScale: Number(e.target.value) }))} className={`w-full ${pitLock.bps ? "opacity-60" : ""}`} />
                  <input type="range" min={0} max={6} value={form.teleCarryScale} disabled={pitLock.carry} onChange={(e) => setForm((p) => ({ ...p, teleCarryScale: Number(e.target.value) }))} className={`w-full ${pitLock.carry ? "opacity-60" : ""}`} />
                  <CycleTimer title="Transition Shift" values={transitionCycles} onAdd={(v) => setTransitionCycles((p) => [...p, v])} />
                  <label className="flex items-center gap-2"><input type="checkbox" checked={form.wonTeleop} onChange={(e) => setForm((p) => ({ ...p, wonTeleop: e.target.checked }))} />Won Teleop</label>
                  <CycleTimer title="Shift 1" values={shift1Cycles} onAdd={(v) => setShift1Cycles((p) => [...p, v])} />
                  <CycleTimer title="Shift 2" values={shift2Cycles} onAdd={(v) => setShift2Cycles((p) => [...p, v])} />
                  <CycleTimer title="Shift 3" values={shift3Cycles} onAdd={(v) => setShift3Cycles((p) => [...p, v])} />
                  <CycleTimer title="Shift 4" values={shift4Cycles} onAdd={(v) => setShift4Cycles((p) => [...p, v])} />
                </div>

                <div className="bg-white rounded-xl shadow p-4 space-y-3">
                  <h2 className="text-lg font-semibold" style={{ color: "var(--primary-color)" }}>Endgame</h2>
                  <CycleTimer title="Endgame Cycle Timer" values={endgameCycles} onAdd={(v) => setEndgameCycles((p) => [...p, v])} />
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setForm((p) => ({ ...p, endgameFailedClimb: p.endgameFailedClimb - 1 }))} className="px-3 py-1 border rounded">-</button>
                    <span className="font-semibold">Failed Climb: {form.endgameFailedClimb}</span>
                    <button type="button" onClick={() => setForm((p) => ({ ...p, endgameFailedClimb: p.endgameFailedClimb + 1 }))} className="px-3 py-1 border rounded">+</button>
                  </div>
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
            )}
          </div>

          <div className="hidden md:block w-80 p-4">
            <div className="bg-white rounded-xl shadow p-4 flex flex-col sticky top-4" style={{ height: "calc(100vh - 2rem)" }}>
              <h2 className="text-xl font-semibold mb-2" style={{ color: "var(--primary-color)" }}>Notes</h2>
              <textarea value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} className="flex-1 border rounded p-2 resize-none" placeholder="Write notes here..." />
              {!reefscapeMode && <p className="text-xs text-gray-600 mt-2">Estimated score (hidden from scouts): {estimatedScore()}</p>}
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

          <MatchModal open={modalOpen} onClose={() => setModalOpen(false)} options={options} completed={completedMatches} onPick={setSelectedMatch} />
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

