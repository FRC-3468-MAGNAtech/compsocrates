"use client";

import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, doc, getDocs, getDoc, query, where } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import ReefscapeStyleModal from "@/app/components/ReefscapeStyleModal";
import { useAuth } from "@/app/AuthContext";
import { getEventMatches } from "@/app/utils/tba-api";
import { resolveDetectedTeamEvent } from "@/app/utils/eventDetection";

type TeamPickerProps = {
  open: boolean;
  onClose: () => void;
  teams: string[];
  scoutedTeams: Set<string>;
  onSelect: (team: string) => void;
};

function TeamPickerModal({ open, onClose, teams, scoutedTeams, onSelect }: TeamPickerProps) {
  return (
    <ReefscapeStyleModal open={open} onClose={onClose} step="qualification">
        <h2 className="text-xl font-semibold mb-4" style={{ color: "var(--primary-color)" }}>Select Team</h2>
        <div className="max-h-[60vh] overflow-y-auto border rounded p-2">
          {teams.length === 0 ? (
            <p className="p-3 text-sm text-gray-600">No teams available.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
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
                    className={`rounded-lg border p-3 text-sm text-left ${done ? "bg-gray-100 text-gray-400 cursor-not-allowed border-gray-300" : "hover:bg-gray-50 border-red-400"}`}
                  >
                    {done ? `${team} (Scouted)` : team}
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

function TeamStrategyFormContent() {
  const { userData } = useAuth();
  const [saving, setSaving] = useState(false);
  const [mobileNotesOpen, setMobileNotesOpen] = useState(false);
  const [eventKey, setEventKey] = useState("app-testing");
  const [eventName, setEventName] = useState("Practice Event");
  const [showTeamPicker, setShowTeamPicker] = useState(false);
  const [teamNumber, setTeamNumber] = useState("");
  const [startingPosition, setStartingPosition] = useState("");
  const [bestAt, setBestAt] = useState("");
  const [clearsBump, setClearsBump] = useState(false);
  const [clearsTrench, setClearsTrench] = useState(false);
  const [shootWhileIntaking, setShootWhileIntaking] = useState(false);
  const [moveAndShoot, setMoveAndShoot] = useState(false);
  const [notes, setNotes] = useState("");
  const [availableTeams, setAvailableTeams] = useState<string[]>([]);
  const [scoutedTeams, setScoutedTeams] = useState<Set<string>>(new Set());

  const eventLabel = useMemo(() => {
    if (!eventKey || eventKey === "app-testing") return "Practice Event";
    return eventName || "Practice Event";
  }, [eventKey, eventName]);

  useEffect(() => {
    if (!userData?.displayName) return;
  }, [userData?.displayName]);

  useEffect(() => {
    async function loadContext() {
      if (!userData?.teamId) return;
      try {
        const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
        const resolvedEvent = await resolveDetectedTeamEvent(userData.teamId);
        const resolvedKey = resolvedEvent?.key || "app-testing";
        setEventKey(resolvedKey);
        setEventName(resolvedEvent?.name || "Practice Event");

        if (resolvedKey !== "app-testing") {
          const ourTeam = String(teamDoc.data()?.teamNumber || "").replace(/[^\d]/g, "");
          const matches = await getEventMatches(resolvedKey);
          const teamAppears = ourTeam
            ? matches.some((match) =>
                [...match.alliances.red.team_keys, ...match.alliances.blue.team_keys]
                  .map((key) => key.replace("frc", "").trim())
                  .includes(ourTeam)
              )
            : false;
          const teamSet = new Set<string>();
          if (teamAppears) {
            matches.forEach((match) => {
              [...match.alliances.red.team_keys, ...match.alliances.blue.team_keys].forEach((key) => {
                const team = key.replace("frc", "").trim();
                if (team) teamSet.add(team);
              });
            });
          }
          setAvailableTeams(Array.from(teamSet).sort((a, b) => Number(a) - Number(b)));
        } else {
          setAvailableTeams([]);
        }

        const strategySnap = await getDocs(
          query(collection(db, "strategyScouting"), where("teamId", "==", userData.teamId), where("eventKey", "==", resolvedKey))
        );
        const done = new Set<string>();
        strategySnap.docs.forEach((snap) => {
          const value = String(snap.data().teamNumber || "").trim();
          if (value) done.add(value);
        });
        setScoutedTeams(done);
      } catch (error) {
        console.error("Failed loading strategy form context:", error);
      }
    }

    void loadContext();
  }, [userData?.teamId]);

  const canSubmit = useMemo(() => {
    return teamNumber.trim().length > 0 && startingPosition && bestAt;
  }, [teamNumber, startingPosition, bestAt]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!userData?.uid || !userData.teamId || !canSubmit) return;
    setSaving(true);
    try {
      await addDoc(collection(db, "strategyScouting"), {
        scoutName: userData.displayName || "",
        scoutId: userData.uid,
        teamId: userData.teamId,
        teamNumber: teamNumber.trim(),
        eventKey,
        game: "REBUILT",
        preferredStartingPosition: startingPosition,
        bestAt,
        clearsBump,
        clearsTrench,
        canShootWhileIntaking: shootWhileIntaking,
        canMoveAndShootSimultaneously: moveAndShoot,
        notes: notes.trim(),
        createdAt: Date.now(),
      });
      alert("Team Strategy Form submitted.");
      setTeamNumber("");
      setStartingPosition("");
      setBestAt("");
      setClearsBump(false);
      setClearsTrench(false);
      setShootWhileIntaking(false);
      setMoveAndShoot(false);
      setNotes("");
      setScoutedTeams((prev) => new Set(prev).add(teamNumber.trim()));
    } catch (error) {
      console.error("Error submitting team strategy form:", error);
      alert("Could not submit form.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="min-h-screen bg-gray-100 flex flex-col md:flex-row justify-center">
        <form onSubmit={handleSubmit} className="flex-1 p-4 space-y-4 max-w-3xl">
          <div className="bg-white rounded-xl shadow p-4">
            <h1 className="text-3xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>
              Team Strategy Form
            </h1>
          </div>

          <div className="bg-white rounded-xl shadow p-4 space-y-3">
            <h2 className="text-lg font-semibold" style={{ color: "var(--primary-color)" }}>Information</h2>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-lg font-semibold">Event:</span>
              <span className="text-lg font-semibold" style={{ color: "var(--primary-color)" }}>{eventLabel}</span>
            </div>
            <div className="text-sm text-gray-700">Use this layout to mirror match strategy planning format for cleaner review.</div>
            <label className="block text-sm font-medium text-gray-700">Scout Name</label>
            <input className="w-full border rounded p-3 bg-gray-100 text-gray-600" value={userData?.displayName || ""} disabled />

            <label className="block text-sm font-medium text-gray-700">Team Number</label>
            <div className="flex gap-2">
              <input
                className="flex-1 border rounded p-3"
                value={teamNumber}
                onChange={(e) => setTeamNumber(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="Team Number"
                required
              />
              <button type="button" onClick={() => setShowTeamPicker(true)} className="px-4 rounded border">Pick</button>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow p-4 space-y-3">
            <h2 className="text-lg font-semibold" style={{ color: "var(--primary-color)" }}>Strategy</h2>

            <label className="block text-sm font-medium text-gray-700">Preferred Starting Position</label>
            <select className="w-full border rounded p-3" value={startingPosition} onChange={(e) => setStartingPosition(e.target.value)} required>
              <option value="">Select Position</option>
              <option value="outpost-side">Outpost Side</option>
              <option value="middle">Middle</option>
              <option value="depot-side">Depot Side</option>
            </select>

            <label className="block text-sm font-medium text-gray-700">Best At</label>
            <select className="w-full border rounded p-3" value={bestAt} onChange={(e) => setBestAt(e.target.value)} required>
              <option value="">Select Best Role</option>
              <option value="cycling">Cycling</option>
              <option value="passing">Passing</option>
              <option value="shooting">Shooting</option>
              <option value="stealing">Stealing</option>
            </select>

            <label className="flex items-center gap-2"><input type="checkbox" checked={clearsBump} onChange={(e) => setClearsBump(e.target.checked)} />Clears Bump</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={clearsTrench} onChange={(e) => setClearsTrench(e.target.checked)} />Clears Trench</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={shootWhileIntaking} onChange={(e) => setShootWhileIntaking(e.target.checked)} />Can Shoot while Intaking</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={moveAndShoot} onChange={(e) => setMoveAndShoot(e.target.checked)} />Can Move and Shoot Simultaneously</label>
          </div>

          <div className="bg-white rounded-xl shadow p-4">
            <button
              type="submit"
              disabled={saving || !canSubmit}
              className="w-full py-3 rounded text-white font-semibold disabled:opacity-60"
              style={{ backgroundColor: "var(--primary-color)" }}
            >
              {saving ? "Submitting..." : "Submit Team Strategy Form"}
            </button>
          </div>
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
                placeholder="Team comments and observations..."
              />
            </div>
          </>
        )}
        </div>
      </div>

      <TeamPickerModal
        open={showTeamPicker}
        onClose={() => setShowTeamPicker(false)}
        teams={availableTeams}
        scoutedTeams={scoutedTeams}
        onSelect={setTeamNumber}
      />
    </div>
  );
}

export default function TeamStrategyFormPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["lead-strategist"]}>
      <TeamStrategyFormContent />
    </ProtectedRoute>
  );
}
