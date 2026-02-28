"use client";

import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import ReefscapeMatchSelectModal, { type ReefscapeMatchOption } from "@/app/components/ReefscapeMatchSelectModal";
import { useAuth } from "@/app/AuthContext";
import { getEventMatches, type TBAMatch } from "@/app/utils/tba-api";
import { resolveDetectedTeamEventKey } from "@/app/utils/eventDetection";

type RobotReflection = {
  teamNumber: string;
  startingPosition: string;
  role: string;
  autoClimb: boolean;
  endgameClimb: string;
};

type MatchOption = {
  key: string;
  label: string;
  scheduleTime: number;
  teams: string[];
};

type ModalMatchOption = ReefscapeMatchOption & {
  sourceKey: string;
};

type StrategyRobot = {
  teamNumber?: string;
  startingPosition?: string;
  role?: string;
  autoClimb?: boolean;
  endgameClimb?: string;
};

type StrategyPlanDoc = {
  id: string;
  eventKey?: string;
  matchKey?: string;
  teamId?: string;
  game?: string;
  createdAt?: number;
  robots?: StrategyRobot[];
};

function strategyDocTime(doc: StrategyPlanDoc) {
  return Number(doc.createdAt || 0);
}

function buildFallbackDriveMatches(): MatchOption[] {
  const rows: MatchOption[] = [];
  for (let n = 1; n <= 20; n += 1) {
    rows.push({ key: `p${n}`, label: `Practice ${n}`, scheduleTime: 0, teams: [] });
  }
  for (let n = 1; n <= 80; n += 1) {
    rows.push({ key: `q${n}`, label: `Q${n}`, scheduleTime: 0, teams: [] });
  }
  for (let n = 1; n <= 3; n += 1) {
    rows.push({ key: `f${n}`, label: `F${n}`, scheduleTime: 0, teams: [] });
  }
  return rows;
}

function parseTeamNumber(raw: string) {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits ? Number(digits) : 0;
}

function labelForMatch(match: TBAMatch) {
  if (match.comp_level === "qm") return `Q${match.match_number}`;
  if (match.comp_level === "sf") return `SF${match.set_number}-${match.match_number}`;
  if (match.comp_level === "qf") return `QF${match.set_number}-${match.match_number}`;
  if (match.comp_level === "f") return `F${match.match_number}`;
  return match.key;
}

function extractMatchNumber(option: MatchOption): number {
  const key = String(option.key || "").toLowerCase();
  const fromKey =
    key.match(/_qm(\d+)$/)?.[1] ||
    key.match(/_sf\d+m(\d+)$/)?.[1] ||
    key.match(/_qf\d+m(\d+)$/)?.[1] ||
    key.match(/_f\d+m(\d+)$/)?.[1];
  if (fromKey) return Number(fromKey);

  const label = String(option.label || "");
  const fromLabel = label.match(/\d+(?:-\d+)?$/)?.[0];
  if (fromLabel) return Number(fromLabel.split("-").pop() || 0);
  return Number(option.matchNumber || 0);
}

function displayMatchLabel(option: MatchOption | null): string {
  if (!option) return "No match selected";
  const rawKey = String(option.key || "").toLowerCase();
  const number = extractMatchNumber(option) || 0;
  if (rawKey.startsWith("p")) return `Practice Match ${number || 1}`;
  if (rawKey.startsWith("q")) return `Qualification Match ${number || 1}`;
  if (rawKey.startsWith("f")) return `Finals ${number || 1}`;
  if (/^q/i.test(option.label)) return `Qualification Match ${number || 1}`;
  if (/^f/i.test(option.label)) return `Finals ${number || 1}`;
  if (/practice/i.test(option.label)) return `Practice Match ${number || 1}`;
  return option.label || "No match selected";
}

function normalizeText(value: string | undefined) {
  return String(value || "").trim().toLowerCase();
}

function compareRobotToPlan(actual: RobotReflection, planned: StrategyRobot) {
  const mismatches: string[] = [];
  const actualStarting = normalizeText(actual.startingPosition);
  const plannedStarting = normalizeText(planned.startingPosition);
  if (actualStarting && plannedStarting && actualStarting !== plannedStarting) {
    mismatches.push("Starting Position");
  }
  const actualRole = normalizeText(actual.role);
  const plannedRole = normalizeText(planned.role);
  if (actualRole && plannedRole && actualRole !== plannedRole) {
    mismatches.push("Role");
  }
  if (Boolean(actual.autoClimb) !== Boolean(planned.autoClimb)) {
    mismatches.push("Auto Climb");
  }
  const actualEndgame = normalizeText(actual.endgameClimb);
  const plannedEndgame = normalizeText(planned.endgameClimb);
  if (actualEndgame && plannedEndgame && actualEndgame !== plannedEndgame) {
    mismatches.push("Endgame Climb");
  }
  return mismatches;
}

function MatchPickerModal({
  open,
  onClose,
  matches,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  matches: ModalMatchOption[];
  onSelect: (key: string) => void;
}) {
  return (
    <ReefscapeMatchSelectModal
      open={open}
      onClose={onClose}
      options={matches}
      onPick={(match) => onSelect(match.sourceKey || match.id)}
    />
  );
}

function DriveReflectionFormContent() {
  const { userData } = useAuth();
  const [saving, setSaving] = useState(false);
  const [mobileNotesOpen, setMobileNotesOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [eventKey, setEventKey] = useState("app-testing");
  const [ourTeamNumber, setOurTeamNumber] = useState("");
  const [showMatchPicker, setShowMatchPicker] = useState(false);
  const [matchOptions, setMatchOptions] = useState<MatchOption[]>([]);
  const [selectedMatchKey, setSelectedMatchKey] = useState("");
  const [robot1, setRobot1] = useState<RobotReflection>({
    teamNumber: "",
    startingPosition: "",
    role: "",
    autoClimb: false,
    endgameClimb: "",
  });
  const [robot2, setRobot2] = useState<RobotReflection>({
    teamNumber: "",
    startingPosition: "",
    role: "",
    autoClimb: false,
    endgameClimb: "",
  });
  const [robot3, setRobot3] = useState<RobotReflection>({
    teamNumber: "",
    startingPosition: "",
    role: "",
    autoClimb: false,
    endgameClimb: "",
  });
  const [syncedPlan, setSyncedPlan] = useState<StrategyPlanDoc | null>(null);

  useEffect(() => {
    async function loadMatches() {
      if (!userData?.teamId) {
        setEventKey("app-testing");
        const fallback = buildFallbackDriveMatches();
        setMatchOptions(fallback);
        setSelectedMatchKey(fallback[0]?.key || "");
        return;
      }
      try {
        const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
        const resolvedEvent = await resolveDetectedTeamEventKey(userData.teamId);
        setEventKey(resolvedEvent);
        if (resolvedEvent === "app-testing") {
          const fallback = buildFallbackDriveMatches();
          setMatchOptions(fallback);
          setSelectedMatchKey(fallback[0]?.key || "");
          return;
        }

        const ourTeam = parseTeamNumber(
          String(teamDoc.data()?.teamNumber || teamDoc.data()?.teamName || userData.teamId)
        );
        const ourTeamStr = ourTeam > 0 ? String(ourTeam) : "";
        setOurTeamNumber(ourTeamStr);

        const matches = await getEventMatches(resolvedEvent);
        const options: MatchOption[] = matches
          .map((match) => {
            const teams = [...match.alliances.red.team_keys, ...match.alliances.blue.team_keys]
              .map((key) => key.replace("frc", "").trim())
              .filter(Boolean);
            return {
              key: match.key,
              label: labelForMatch(match),
              scheduleTime: match.actual_time || match.predicted_time || match.time || 0,
              teams,
            };
          })
          .filter((match) => (ourTeamStr ? match.teams.includes(ourTeamStr) : true))
          .sort((a, b) => a.scheduleTime - b.scheduleTime);
        const resolvedOptions = options.length > 0 ? options : [];
        setMatchOptions(resolvedOptions);
        const now = Date.now() / 1000;
        const next = resolvedOptions.find((match) => match.scheduleTime >= now) || resolvedOptions[0];
        if (next) {
          setSelectedMatchKey(next.key);
          setRobotTeamDefaults(next, ourTeamStr);
        } else {
          setSelectedMatchKey("");
          setRobot1((prev) => ({ ...prev, teamNumber: "" }));
          setRobot2((prev) => ({ ...prev, teamNumber: "" }));
          setRobot3((prev) => ({ ...prev, teamNumber: "" }));
        }
      } catch (error) {
        console.error("Failed to load drive reflection context:", error);
        const fallback = buildFallbackDriveMatches();
        setMatchOptions(fallback);
        setSelectedMatchKey(fallback[0]?.key || "");
      }
    }

    void loadMatches();
  }, [userData?.teamId]);

  function setRobotTeamDefaults(match: MatchOption, ourTeam: string) {
    const teammates = match.teams.slice(0, 3);
    const sorted = ourTeam && teammates.includes(ourTeam) ? [ourTeam, ...teammates.filter((team) => team !== ourTeam)] : teammates;
    setRobot1((prev) => ({ ...prev, teamNumber: sorted[0] || prev.teamNumber }));
    setRobot2((prev) => ({ ...prev, teamNumber: sorted[1] || prev.teamNumber }));
    setRobot3((prev) => ({ ...prev, teamNumber: sorted[2] || prev.teamNumber }));
  }

  const selectedMatch = useMemo(
    () => matchOptions.find((match) => match.key === selectedMatchKey) || null,
    [matchOptions, selectedMatchKey]
  );
  useEffect(() => {
    async function loadSyncedPlan() {
      if (!selectedMatch || !eventKey) {
        setSyncedPlan(null);
        return;
      }
      const plansSnap = await getDocs(collection(db, "matchStrategyPlans"));
      const plans = plansSnap.docs
        .map((row) => ({ id: row.id, ...row.data() }) as StrategyPlanDoc)
        .filter(
          (row) =>
            String(row.game || "REBUILT").toUpperCase() === "REBUILT" &&
            String(row.eventKey || "").trim() === String(eventKey || "").trim() &&
            String(row.matchKey || "").trim() === String(selectedMatch.key || "").trim() &&
            (!userData?.teamId || !row.teamId || String(row.teamId) === String(userData.teamId))
        )
        .sort((a, b) => strategyDocTime(b) - strategyDocTime(a));
      setSyncedPlan(plans[0] || null);
    }
    void loadSyncedPlan();
  }, [eventKey, selectedMatch, userData?.teamId]);

  const planMismatchMessages = useMemo(() => {
    if (!syncedPlan || !Array.isArray(syncedPlan.robots) || syncedPlan.robots.length === 0) return [];
    const plannedByTeam = new Map<string, StrategyRobot>();
    syncedPlan.robots.forEach((robot) => {
      const key = String(robot.teamNumber || "").trim();
      if (key) plannedByTeam.set(key, robot);
    });
    const actualRobots: RobotReflection[] = [robot1, robot2, robot3];
    const mismatchedTeams: string[] = [];
    actualRobots.forEach((robot) => {
      const key = String(robot.teamNumber || "").trim();
      if (!key) return;
      const planned = plannedByTeam.get(key);
      if (!planned) return;
      const fields = compareRobotToPlan(robot, planned);
      if (fields.length > 0) {
        mismatchedTeams.push(`${key} (${fields.join(", ")})`);
      }
    });
    return mismatchedTeams;
  }, [robot1, robot2, robot3, syncedPlan]);
  const plannedByTeam = useMemo(() => {
    const map = new Map<string, StrategyRobot>();
    if (!syncedPlan || !Array.isArray(syncedPlan.robots)) return map;
    syncedPlan.robots.forEach((robot) => {
      const key = String(robot.teamNumber || "").trim();
      if (key) map.set(key, robot);
    });
    return map;
  }, [syncedPlan]);

  const robotMismatchByIndex = useMemo(
    () =>
      [robot1, robot2, robot3].map((robot) => {
        const team = String(robot.teamNumber || "").trim();
        const planned = team ? plannedByTeam.get(team) : undefined;
        const mismatches = planned ? compareRobotToPlan(robot, planned) : [];
        const mismatchSet = new Set(mismatches);
        return {
          team,
          hasPlanForTeam: Boolean(planned),
          startingPosition: mismatchSet.has("Starting Position"),
          role: mismatchSet.has("Role"),
          autoClimb: mismatchSet.has("Auto Climb"),
          endgameClimb: mismatchSet.has("Endgame Climb"),
        };
      }),
    [plannedByTeam, robot1, robot2, robot3]
  );
  const modalMatchOptions = useMemo<ModalMatchOption[]>(() => {
    const mapped: ModalMatchOption[] = [];
    let finalsIndex = 1;
    for (const match of matchOptions) {
      const rawKey = String(match.key || "").toLowerCase();
      const keyNumber = Number(rawKey.replace(/\D/g, "")) || 0;
      if (rawKey.startsWith("p")) {
        const number = keyNumber || Number(match.label.replace(/\D/g, "")) || 1;
        mapped.push({ id: `p${number}`, label: `Practice ${number}`, type: "practice", matchNumber: number, scheduleTime: match.scheduleTime, sourceKey: match.key });
        continue;
      }
      if (rawKey.startsWith("q")) {
        const number = keyNumber || Number(match.label.replace(/\D/g, "")) || 1;
        mapped.push({ id: `q${number}`, label: `Qualification ${number}`, type: "qualification", matchNumber: number, scheduleTime: match.scheduleTime, sourceKey: match.key });
        continue;
      }
      if (rawKey.startsWith("f")) {
        const number = keyNumber || finalsIndex;
        mapped.push({ id: `f${number}`, label: `Finals ${number}`, type: "finals", matchNumber: number, scheduleTime: match.scheduleTime, sourceKey: match.key });
        finalsIndex = Math.max(finalsIndex, number + 1);
        continue;
      }

      const q = match.label.match(/^Q(\d+)$/i);
      if (q) {
        const number = Number(q[1]);
        mapped.push({ id: `q${number}`, label: `Qualification ${number}`, type: "qualification", matchNumber: number, scheduleTime: match.scheduleTime, sourceKey: match.key });
      } else {
        const finalsLike = match.label.match(/^(?:F|SF|QF)\s*(\d+)(?:[-M](\d+))?$/i);
        if (finalsLike) {
          const number = Number(finalsLike[2] || finalsLike[1] || finalsIndex);
          mapped.push({ id: `f${number}`, label: `Finals ${number}`, type: "finals", matchNumber: number, scheduleTime: match.scheduleTime, sourceKey: match.key });
          finalsIndex = Math.max(finalsIndex, number + 1);
          continue;
        }

        mapped.push({ id: `f${finalsIndex}`, label: match.label, type: "finals", matchNumber: finalsIndex, scheduleTime: match.scheduleTime, sourceKey: match.key });
        finalsIndex += 1;
      }
    }
    return mapped;
  }, [matchOptions]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!userData?.uid) {
      alert("You must be logged in to submit.");
      return;
    }
    if (!selectedMatch) {
      alert("Select a match first.");
      return;
    }
    setSaving(true);
    try {
      if (planMismatchMessages.length > 0) {
        const proceed = window.confirm(
          `Warning: drive reflection does not match synced match strategy plan for this match:\n${planMismatchMessages.join("\n")}\n\nSubmit anyway?`
        );
        if (!proceed) {
          setSaving(false);
          return;
        }
      }

      await addDoc(collection(db, "driveScouting"), {
        eventKey,
        matchKey: selectedMatch.key,
        matchLabel: displayMatchLabel(selectedMatch),
        scoutId: userData.uid,
        scoutName: userData.displayName || "",
        teamId: userData.teamId || "",
        game: "REBUILT",
        robots: [robot1, robot2, robot3],
        notes: notes.trim(),
        createdAt: Date.now(),
      });
      alert("Drive Reflection Form submitted.");
    } catch (error) {
      console.error("Failed to submit drive reflection form:", error);
      alert("Could not submit form.");
    } finally {
      setSaving(false);
    }
  }

  const robotBlock = (
    title: string,
    robot: RobotReflection,
    setRobot: (value: RobotReflection) => void,
    mismatch: { team: string; hasPlanForTeam: boolean; startingPosition: boolean; role: boolean; autoClimb: boolean; endgameClimb: boolean }
  ) => (
    <div className="bg-white rounded-xl shadow p-4 space-y-3">
      <h2 className="text-lg font-semibold" style={{ color: "var(--primary-color)" }}>
        {title}
      </h2>
      <label className="block text-sm font-medium text-gray-700">Team Number</label>
      <input
        className="w-full border rounded p-3"
        value={robot.teamNumber}
        onChange={(e) => setRobot({ ...robot, teamNumber: e.target.value.replace(/[^\d]/g, "") })}
      />
      {syncedPlan && mismatch.team && !mismatch.hasPlanForTeam && (
        <p className="text-xs text-amber-700">No synced match strategy data found for team {mismatch.team} in this match.</p>
      )}

      <label className="block text-sm font-medium text-gray-700">Starting Position</label>
      <select
        className="w-full border rounded p-3"
        value={robot.startingPosition}
        onChange={(e) => setRobot({ ...robot, startingPosition: e.target.value })}
      >
        <option value="">Select Position</option>
        <option value="outpost-side">Outpost Side</option>
        <option value="middle">Middle</option>
        <option value="depot-side">Depot Side</option>
      </select>
      {mismatch.startingPosition && (
        <p className="text-xs text-red-700">Does not match synced match strategy starting position.</p>
      )}

      <label className="block text-sm font-medium text-gray-700">Role</label>
      <select className="w-full border rounded p-3" value={robot.role} onChange={(e) => setRobot({ ...robot, role: e.target.value })}>
        <option value="">Select Role</option>
        <option value="cycler">Cycler</option>
        <option value="passer">Passer</option>
        <option value="shooter">Shooter</option>
        <option value="stealer">Stealer</option>
      </select>
      {mismatch.role && (
        <p className="text-xs text-red-700">Does not match synced match strategy role.</p>
      )}

      <label className="flex items-center gap-2">
        <input type="checkbox" checked={robot.autoClimb} onChange={(e) => setRobot({ ...robot, autoClimb: e.target.checked })} />
        Auto Climb
      </label>
      {mismatch.autoClimb && (
        <p className="text-xs text-red-700">Does not match synced match strategy auto climb value.</p>
      )}

      <label className="block text-sm font-medium text-gray-700">Endgame Climb</label>
      <select
        className="w-full border rounded p-3"
        value={robot.endgameClimb}
        onChange={(e) => setRobot({ ...robot, endgameClimb: e.target.value })}
      >
        <option value="">None</option>
        <option value="level-1">Level 1</option>
        <option value="level-2">Level 2</option>
        <option value="level-3">Level 3</option>
      </select>
      {mismatch.endgameClimb && (
        <p className="text-xs text-red-700">Does not match synced match strategy endgame climb.</p>
      )}
    </div>
  );

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="min-h-screen bg-gray-100 flex flex-col md:flex-row justify-center">
        <form onSubmit={submit} className="flex-1 p-4 space-y-4 max-w-3xl">
          <div className="bg-white rounded-xl shadow p-4">
            <h1 className="text-3xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>
              Drive Reflection Form
            </h1>
          </div>

          <div className="bg-white rounded-xl shadow p-4 space-y-3">
            <h2 className="text-lg font-semibold" style={{ color: "var(--primary-color)" }}>
              Information
            </h2>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-lg font-semibold">Match:</span>
              <span className="text-lg font-semibold" style={{ color: "var(--primary-color)" }}>{displayMatchLabel(selectedMatch)}</span>
              <button
                type="button"
                onClick={() => setShowMatchPicker(true)}
                className="px-2 py-0.5 text-xs rounded text-white"
                style={{ backgroundColor: "var(--primary-color)" }}
              >
                Fix
              </button>
            </div>
            <div className="text-sm">
              {matchOptions.length === 0 && (
                <div className="text-amber-700">No matches with Team {ourTeamNumber || "your team"} were found at this event. Use manual values if needed.</div>
              )}
              {syncedPlan ? (
                <div className="text-green-700">Detected match strategy form is synced for this match.</div>
              ) : (
                <div className="text-amber-700">No synced match strategy form found for this match yet.</div>
              )}
              <div className="text-gray-700">Alerts show up below each robot field.</div>
            </div>
            <label className="block text-sm font-medium text-gray-700">Scout Name</label>
            <input className="w-full border rounded p-3 bg-gray-100 text-gray-600" value={userData?.displayName || ""} disabled />
          </div>

          {robotBlock("Robot 1", robot1, setRobot1, robotMismatchByIndex[0])}
          {robotBlock("Robot 2", robot2, setRobot2, robotMismatchByIndex[1])}
          {robotBlock("Robot 3", robot3, setRobot3, robotMismatchByIndex[2])}

          <button
            type="submit"
            disabled={saving || !selectedMatch}
            className="w-full py-3 rounded text-white font-semibold disabled:opacity-60"
            style={{ backgroundColor: "var(--primary-color)" }}
          >
            {saving ? "Submitting..." : "Submit Drive Reflection Form"}
          </button>
        </form>

        <div className="hidden md:block w-80 p-4">
          <div className="bg-white rounded-xl shadow p-4 flex flex-col sticky top-4" style={{ height: "calc(100vh - 2rem)" }}>
            <h2 className="text-xl font-semibold mb-2" style={{ color: "var(--primary-color)" }}>Notes</h2>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="flex-1 border rounded p-2 resize-none"
              placeholder="Optional notes..."
            />
          </div>
        </div>

        <div className="md:hidden fixed right-0 top-1/2 -translate-y-1/2 z-50">
          <button
            onClick={() => setMobileNotesOpen((prev) => !prev)}
            className="px-2 py-4 rounded-l-xl text-white"
            style={{ backgroundColor: "var(--primary-color)" }}
          >
            {mobileNotesOpen ? ">" : "<"}
          </button>
        </div>
        {mobileNotesOpen && (
          <>
            <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setMobileNotesOpen(false)} />
            <div className="fixed right-0 top-0 h-full w-screen bg-white shadow-xl p-4 z-50">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xl font-semibold" style={{ color: "var(--primary-color)" }}>Notes</h2>
                <button onClick={() => setMobileNotesOpen(false)} className="px-3 py-1 rounded bg-gray-100">Close</button>
              </div>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                className="w-full h-[calc(100%-3rem)] border rounded p-3 text-base resize-none"
                placeholder="Drive reflection notes..."
              />
            </div>
          </>
        )}
        </div>
      </div>

      <MatchPickerModal
        open={showMatchPicker}
        onClose={() => setShowMatchPicker(false)}
        matches={modalMatchOptions}
        onSelect={(key) => {
          setSelectedMatchKey(key);
          let target = matchOptions.find((match) => match.key === key);
          if (!target) {
            const n = Number(String(key).replace(/\D/g, "")) || 1;
            if (String(key).toLowerCase().startsWith("q")) {
              target = { key: `q${n}`, label: `Q${n}`, scheduleTime: 0, teams: [] };
            } else if (String(key).toLowerCase().startsWith("p")) {
              target = { key: `p${n}`, label: `Practice ${n}`, scheduleTime: 0, teams: [] };
            } else if (String(key).toLowerCase().startsWith("f")) {
              target = { key: `f${n}`, label: `F${n}`, scheduleTime: 0, teams: [] };
            }
            if (target) {
              setMatchOptions((prev) => (prev.some((row) => row.key === target!.key) ? prev : [...prev, target!]));
            }
          }
          if (target) setRobotTeamDefaults(target, ourTeamNumber);
        }}
      />
    </div>
  );
}

export default function DriveReflectionFormPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["drive-team"]}>
      <DriveReflectionFormContent />
    </ProtectedRoute>
  );
}
