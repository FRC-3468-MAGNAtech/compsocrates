"use client";

import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, doc, getDoc } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import { getEventMatches, type TBAMatch } from "@/app/utils/tba-api";

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

function MatchPickerModal({
  open,
  onClose,
  matches,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  matches: MatchOption[];
  onSelect: (key: string) => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-4">
        <h2 className="text-lg font-semibold mb-3">Select Match</h2>
        <div className="max-h-80 overflow-y-auto space-y-2">
          {matches.length === 0 && (
            <div className="rounded border p-3 text-sm text-gray-600">No matches available.</div>
          )}
          {matches.map((match) => (
            <button
              type="button"
              key={match.key}
              onClick={() => {
                onSelect(match.key);
                onClose();
              }}
              className="w-full text-left rounded border p-3 hover:bg-gray-50"
            >
              <div className="font-semibold">{match.label}</div>
              <div className="text-xs text-gray-600">{match.teams.join(" vs ")}</div>
            </button>
          ))}
        </div>
        <button type="button" onClick={onClose} className="mt-3 w-full border rounded py-2">
          Close
        </button>
      </div>
    </div>
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

  useEffect(() => {
    async function loadMatches() {
      if (!userData?.teamId) return;
      try {
        const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
        const selectedEvents = (teamDoc.exists() ? teamDoc.data().selectedEvents : []) as string[] | undefined;
        const resolvedEvent =
          Array.isArray(selectedEvents) && selectedEvents.length > 0 ? String(selectedEvents[0]) : "app-testing";
        setEventKey(resolvedEvent);
        if (resolvedEvent === "app-testing") {
          setMatchOptions([]);
          return;
        }

        const ourTeam = parseTeamNumber(
          String(teamDoc.data()?.teamNumber || teamDoc.data()?.teamName || userData.teamId)
        );
        const ourTeamStr = ourTeam > 0 ? String(ourTeam) : "";
        setOurTeamNumber(ourTeamStr);

        const matches = await getEventMatches(resolvedEvent);
        let options: MatchOption[] = matches
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
        if (options.length === 0) {
          options = matches
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
            .sort((a, b) => a.scheduleTime - b.scheduleTime);
        }

        setMatchOptions(options);
        const now = Date.now() / 1000;
        const next = options.find((match) => match.scheduleTime >= now) || options[0];
        if (next) {
          setSelectedMatchKey(next.key);
          setRobotTeamDefaults(next, ourTeamStr);
        }
      } catch (error) {
        console.error("Failed to load drive reflection context:", error);
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

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!userData?.uid || !userData.teamId || !selectedMatch) return;
    setSaving(true);
    try {
      await addDoc(collection(db, "driveScouting"), {
        eventKey,
        matchKey: selectedMatch.key,
        matchLabel: selectedMatch.label,
        scoutId: userData.uid,
        scoutName: userData.displayName || "",
        teamId: userData.teamId,
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

  const robotBlock = (title: string, robot: RobotReflection, setRobot: (value: RobotReflection) => void) => (
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

      <label className="block text-sm font-medium text-gray-700">Role</label>
      <select className="w-full border rounded p-3" value={robot.role} onChange={(e) => setRobot({ ...robot, role: e.target.value })}>
        <option value="">Select Role</option>
        <option value="cycler">Cycler</option>
        <option value="passer">Passer</option>
        <option value="shooter">Shooter</option>
        <option value="stealer">Stealer</option>
      </select>

      <label className="flex items-center gap-2">
        <input type="checkbox" checked={robot.autoClimb} onChange={(e) => setRobot({ ...robot, autoClimb: e.target.checked })} />
        Auto Climb
      </label>

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
              <span className="text-sm text-gray-700">Match</span>
              <span className="font-semibold">{selectedMatch?.label || "No match selected"}</span>
              <button
                type="button"
                onClick={() => setShowMatchPicker(true)}
                className="px-2 py-0.5 text-xs rounded text-white"
                style={{ backgroundColor: "var(--primary-color)" }}
              >
                Fix
              </button>
            </div>
            <label className="block text-sm font-medium text-gray-700">Scout Name</label>
            <input className="w-full border rounded p-3 bg-gray-100 text-gray-600" value={userData?.displayName || ""} disabled />
          </div>

          {robotBlock("Robot 1", robot1, setRobot1)}
          {robotBlock("Robot 2", robot2, setRobot2)}
          {robotBlock("Robot 3", robot3, setRobot3)}

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
        matches={matchOptions}
        onSelect={(key) => {
          setSelectedMatchKey(key);
          const target = matchOptions.find((match) => match.key === key);
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
