"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { addDoc, collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import { getEventMatches } from "@/app/utils/tba-api";

type PitFormState = {
  scoutName: string;
  teamNumber: string;
  robotPictureUrl: string;
  pitDisposition: boolean;
  driveDisposition: boolean;
  fuelPreloadCapacity: number;
  fuelBallsPerSecond: number;
  fuelCarryingCapacity: number;
  climbLevel1: boolean;
  climbLevel2: boolean;
  climbLevel3: boolean;
  typicalFuelCycleTime: string;
  typicalClimbTime: string;
  autoCycleDescription: string;
  notes: string;
};

function TeamPickerModal({
  open,
  teams,
  scoutedTeams,
  onClose,
  onSelect,
}: {
  open: boolean;
  teams: string[];
  scoutedTeams: Set<string>;
  onClose: () => void;
  onSelect: (team: string) => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg p-4">
        <h2 className="text-lg font-semibold mb-3">Select Team Number</h2>
        <div className="max-h-80 overflow-y-auto border rounded p-2 grid grid-cols-3 gap-1">
          {teams.map((team) => {
            const done = scoutedTeams.has(team);
            return (
              <button
                key={team}
                type="button"
                disabled={done}
                onClick={() => {
                  onSelect(team);
                  onClose();
                }}
                className={`rounded border p-2 text-sm ${done ? "bg-gray-100 text-gray-400 cursor-not-allowed" : "hover:bg-gray-50"}`}
              >
                {done ? `${team} (Scouted)` : team}
              </button>
            );
          })}
        </div>
        <button type="button" onClick={onClose} className="mt-3 w-full py-2 rounded border">Close</button>
      </div>
    </div>
  );
}

function PitScoutFormContent() {
  const router = useRouter();
  const { userData } = useAuth();
  const [saving, setSaving] = useState(false);
  const [mobileNotesOpen, setMobileNotesOpen] = useState(false);
  const [showTeamPicker, setShowTeamPicker] = useState(false);
  const [eventKey, setEventKey] = useState("app-testing");
  const [availableTeams, setAvailableTeams] = useState<string[]>([]);
  const [scoutedTeams, setScoutedTeams] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<PitFormState>({
    scoutName: userData?.displayName || "",
    teamNumber: "",
    robotPictureUrl: "",
    pitDisposition: false,
    driveDisposition: false,
    fuelPreloadCapacity: 1,
    fuelBallsPerSecond: 1,
    fuelCarryingCapacity: 1,
    climbLevel1: false,
    climbLevel2: false,
    climbLevel3: false,
    typicalFuelCycleTime: "",
    typicalClimbTime: "",
    autoCycleDescription: "",
    notes: "",
  });

  useEffect(() => {
    if (!userData?.displayName) return;
    setForm((prev) => ({ ...prev, scoutName: userData.displayName }));
  }, [userData?.displayName]);

  useEffect(() => {
    async function loadEventTeams() {
      if (!userData?.teamId) return;
      try {
        const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
        const selectedEvents = (teamDoc.exists() ? teamDoc.data().selectedEvents : []) as string[] | undefined;
        const resolvedEvent = Array.isArray(selectedEvents) && selectedEvents.length > 0 ? String(selectedEvents[0]) : "app-testing";
        setEventKey(resolvedEvent);

        if (resolvedEvent !== "app-testing") {
          const matches = await getEventMatches(resolvedEvent);
          const teamSet = new Set<string>();
          matches.forEach((match) => {
            [...match.alliances.red.team_keys, ...match.alliances.blue.team_keys].forEach((teamKey) => {
              const team = teamKey.replace("frc", "").trim();
              if (team) teamSet.add(team);
            });
          });
          setAvailableTeams(Array.from(teamSet).sort((a, b) => Number(a) - Number(b)));
        } else {
          setAvailableTeams([]);
        }

        const scoutedSnap = await getDocs(
          query(collection(db, "pitScouting"), where("teamId", "==", userData.teamId), where("eventKey", "==", resolvedEvent), where("game", "==", "REBUILT"))
        );
        const done = new Set<string>();
        scoutedSnap.docs.forEach((row) => {
          const team = String(row.data().teamNumber || "").trim();
          if (team) done.add(team);
        });
        setScoutedTeams(done);
      } catch (error) {
        console.error("Failed loading pit team list:", error);
      }
    }
    void loadEventTeams();
  }, [userData?.teamId]);

  const canSubmit = useMemo(() => {
    return false;
  }, []);

  async function submitForm(event: React.FormEvent) {
    event.preventDefault();
    alert("REEFSCAPE pit form submissions are disabled.");
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="min-h-screen bg-gray-100 flex flex-col md:flex-row justify-center">
          <form onSubmit={submitForm} className="flex-1 p-4 space-y-6 max-w-3xl">
            <div className="bg-white rounded-xl shadow p-4">
              <h1 className="text-3xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>Pit Scout Form</h1>
              <div className="mt-3 max-w-sm">
                <label className="block text-sm font-medium text-gray-700 mb-1">Form Select</label>
                <select
                  className="w-full border rounded p-2"
                  value="REEFSCAPE"
                  onChange={(event) => {
                    if (event.target.value === "REBUILT") {
                      router.push("/pit-scout-form");
                    }
                  }}
                >
                  <option value="REEFSCAPE">REEFSCAPE Form</option>
                  <option value="REBUILT">REBUILT Form</option>
                </select>
              </div>
              <p className="text-sm text-red-600 mt-2">REEFSCAPE submissions are disabled.</p>
            </div>

            <div className="bg-white rounded-xl shadow p-4 space-y-3">
              <h2 className="text-lg font-semibold" style={{ color: "var(--primary-color)" }}>Information</h2>
              <label className="block text-sm font-medium text-gray-700">Scout Name</label>
              <input className="w-full border rounded p-3 bg-gray-100 text-gray-600" value={form.scoutName} disabled />

              <label className="block text-sm font-medium text-gray-700">Team Number</label>
              <div className="flex gap-2">
                <input
                  className="flex-1 border rounded p-3"
                  value={form.teamNumber}
                  onChange={(event) => setForm({ ...form, teamNumber: event.target.value.replace(/[^\d]/g, "") })}
                  placeholder="Team Number"
                  required
                />
                <button type="button" className="px-4 rounded border" onClick={() => setShowTeamPicker(true)}>Pick</button>
              </div>

              <label className="block text-sm font-medium text-gray-700">Picture of Robot</label>
              <input
                type="url"
                value={form.robotPictureUrl}
                onChange={(event) => setForm({ ...form, robotPictureUrl: event.target.value.trim() })}
                placeholder="https://..."
                className="w-full border rounded p-3"
              />
            </div>

            <div className="bg-white rounded-xl shadow p-4 space-y-3">
              <h2 className="text-lg font-semibold" style={{ color: "var(--primary-color)" }}>Disposition</h2>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.pitDisposition} onChange={(event) => setForm({ ...form, pitDisposition: event.target.checked })} />Friendly and easy to work with (Pit)</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.driveDisposition} onChange={(event) => setForm({ ...form, driveDisposition: event.target.checked })} />Friendly and easy to work with (Drive)</label>
            </div>

            <div className="bg-white rounded-xl shadow p-4 space-y-4">
              <h2 className="text-lg font-semibold" style={{ color: "var(--primary-color)" }}>Teleoperated</h2>

              <h3 className="font-semibold text-gray-800">Fuel</h3>
              <label className="block text-sm font-medium text-gray-700">Preload Capacity (Scale 1-8)</label>
              <input type="number" min={1} max={8} value={form.fuelPreloadCapacity} onChange={(event) => setForm({ ...form, fuelPreloadCapacity: Math.min(8, Math.max(1, Number(event.target.value) || 1)) })} className="w-full border rounded p-3" />

              <label className="block text-sm font-medium text-gray-700">Balls Per Second (Scale 1-10)</label>
              <input type="number" min={1} max={10} value={form.fuelBallsPerSecond} onChange={(event) => setForm({ ...form, fuelBallsPerSecond: Math.min(10, Math.max(1, Number(event.target.value) || 1)) })} className="w-full border rounded p-3" />

              <label className="block text-sm font-medium text-gray-700">Carrying Capacity (Scale 1-50)</label>
              <input type="number" min={1} max={50} value={form.fuelCarryingCapacity} onChange={(event) => setForm({ ...form, fuelCarryingCapacity: Math.min(50, Math.max(1, Number(event.target.value) || 1)) })} className="w-full border rounded p-3" />

              <h3 className="font-semibold text-gray-800">Tower</h3>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.climbLevel1} onChange={(event) => setForm({ ...form, climbLevel1: event.target.checked })} />Level 1 Climb</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.climbLevel2} onChange={(event) => setForm({ ...form, climbLevel2: event.target.checked })} />Level 2 Climb</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.climbLevel3} onChange={(event) => setForm({ ...form, climbLevel3: event.target.checked })} />Level 3 Climb</label>

              <h3 className="font-semibold text-gray-800">Cycles</h3>
              <label className="block text-sm font-medium text-gray-700">Typical Fuel Cycle Time</label>
              <input
                type="text"
                value={form.typicalFuelCycleTime}
                onChange={(event) => setForm({ ...form, typicalFuelCycleTime: event.target.value.replace(/[^\d.]/g, "") })}
                className="w-full border rounded p-3"
                placeholder="Seconds"
              />
              <label className="block text-sm font-medium text-gray-700">Typical Climb Time</label>
              <input
                type="text"
                value={form.typicalClimbTime}
                onChange={(event) => setForm({ ...form, typicalClimbTime: event.target.value.replace(/[^\d.]/g, "") })}
                className="w-full border rounded p-3"
                placeholder="Seconds"
              />
            </div>

            <div className="bg-white rounded-xl shadow p-4 space-y-3">
              <h2 className="text-lg font-semibold" style={{ color: "var(--primary-color)" }}>Autonomous</h2>
              <label className="block text-sm font-medium text-gray-700">Description of Auto Cycle</label>
              <textarea
                value={form.autoCycleDescription}
                onChange={(event) => setForm({ ...form, autoCycleDescription: event.target.value })}
                className="w-full border rounded p-3 h-28"
              />
            </div>

            <div className="sticky bottom-0 bg-gray-100 pt-4 pb-2">
              <button
                type="submit"
                disabled={saving || !canSubmit}
                className="w-full py-3 rounded text-white font-semibold disabled:opacity-50"
                style={{ backgroundColor: "var(--primary-color)" }}
              >
                Submission Disabled for REEFSCAPE
              </button>
            </div>
          </form>

          <div className="hidden md:block w-80 p-4">
            <div className="bg-white rounded-xl shadow p-4 flex flex-col sticky top-4" style={{ height: "calc(100vh - 2rem)" }}>
              <h2 className="text-xl font-semibold mb-2" style={{ color: "var(--primary-color)" }}>Notes</h2>
              <textarea
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
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
                  value={form.notes}
                  onChange={(event) => setForm({ ...form, notes: event.target.value })}
                  className="w-full h-[calc(100%-3rem)] border rounded p-3 text-base resize-none"
                  placeholder="Team comments and observations..."
                />
              </div>
            </>
          )}
        </div>
      </div>

      <TeamPickerModal
        open={showTeamPicker}
        teams={availableTeams}
        scoutedTeams={scoutedTeams}
        onClose={() => setShowTeamPicker(false)}
        onSelect={(team) => setForm((prev) => ({ ...prev, teamNumber: team }))}
      />
    </div>
  );
}

export default function PitScoutFormPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["pit-scout"]}>
      <PitScoutFormContent />
    </ProtectedRoute>
  );
}
