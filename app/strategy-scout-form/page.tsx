"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { addDoc, collection, doc, getDocs, getDoc, query, setDoc, where } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import SubmissionLockoutBanner from "@/app/components/SubmissionLockoutBanner";
import ReefscapeStyleModal from "@/app/components/ReefscapeStyleModal";
import { useAuth } from "@/app/AuthContext";
import { resolveDetectedTeamEvent } from "@/app/utils/eventDetection";
import { assertSubmissionsOpen } from "@/app/utils/submissionControls";

type TeamPickerProps = {
  open: boolean;
  onClose: () => void;
  teams: string[];
  assignedTeams: Set<string>;
  userTeams: Set<string>;
  scoutedTeams: Set<string>;
  onSelect: (team: string) => void;
};

function TeamPickerModal({ open, onClose, teams, assignedTeams, userTeams, scoutedTeams, onSelect }: TeamPickerProps) {
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
                const assigned = assignedTeams.has(team);
                const mine = userTeams.has(team);
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
                        : mine
                        ? "bg-indigo-50 border-indigo-400 text-indigo-900"
                        : "hover:bg-gray-50 border-red-400"
                    }`}
                  >
                    {done
                      ? `${team} (Scouted)`
                      : mine
                      ? `${team} (Assigned)`
                      : assigned
                      ? `${team} (Assigned)`
                      : team}
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

function getFirstEventCodeFromTbaKey(key: string): string {
  const normalized = String(key || "").toLowerCase();
  const specialMap: Record<string, string> = {
    "2026lake": "LAKE",
    "2025lake": "LAKE",
  };
  if (specialMap[normalized]) return specialMap[normalized];
  const suffix = normalized.slice(4).toUpperCase();
  return suffix || normalized.toUpperCase();
}

function parseManualTeamCsv(raw: string): string[] {
  if (!raw) return [];
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const numbers = new Set<number>();
  lines.forEach((line) => {
    const firstValue = line.split(",")[0]?.trim() ?? "";
    const parsed = parseInt(firstValue.replace(/[^\d]/g, ""), 10);
    if (Number.isFinite(parsed) && parsed > 0) numbers.add(parsed);
  });
  return Array.from(numbers)
    .sort((a, b) => a - b)
    .map((num) => String(num));
}

function parseManualTeamList(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input
      .map((value) => parseInt(String(value || "").replace(/[^\d]/g, ""), 10))
      .filter((value) => Number.isFinite(value) && value > 0)
      .map((value) => String(value))
      .sort((a, b) => Number(a) - Number(b));
  }
  if (typeof input === "string") {
    return parseManualTeamCsv(input);
  }
  return [];
}

function TeamStrategyFormContent() {
  const { userData } = useAuth();
  const searchParams = useSearchParams();
  const editId = searchParams.get("editId");
  const editCollectionParam = searchParams.get("editCollection");
  const editMode = Boolean(editId);
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
  const [assignedTeamNumbers, setAssignedTeamNumbers] = useState<string[]>([]);
  const [allAssignedTeamNumbers, setAllAssignedTeamNumbers] = useState<string[]>([]);
  const [scoutedTeams, setScoutedTeams] = useState<Set<string>>(new Set());
  const [teamLoadNote, setTeamLoadNote] = useState("");
  const [editEventKey, setEditEventKey] = useState<string | null>(null);

  const eventLabel = useMemo(() => {
    if (!eventKey || eventKey === "app-testing") return "Practice Event";
    return eventName || "Practice Event";
  }, [eventKey, eventName]);

  useEffect(() => {
    if (!userData?.displayName) return;
  }, [userData?.displayName]);

  useEffect(() => {
    if (!editId) return;
    let isActive = true;
    const editIdValue = editId;
    const collectionName: string = editCollectionParam || "strategyScouting";
    async function loadEditEntry() {
      try {
        const snap = await getDoc(doc(db, collectionName, editIdValue));
        if (!snap.exists()) return;
        const data = snap.data() as Record<string, unknown>;
        if (!isActive) return;
        const entryEventKey = String(data.eventKey || "").trim();
        setEditEventKey(entryEventKey || null);
        setTeamNumber(String(data.teamNumber || ""));
        setStartingPosition(String(data.preferredStartingPosition || data.startingPosition || ""));
        setBestAt(String(data.bestAt || ""));
        setClearsBump(Boolean(data.clearsBump));
        setClearsTrench(Boolean(data.clearsTrench));
        setShootWhileIntaking(Boolean(data.canShootWhileIntaking));
        setMoveAndShoot(Boolean(data.canMoveAndShootSimultaneously));
        setNotes(String(data.notes || ""));
      } catch (error) {
        console.error("Failed to load team strategy edit entry:", error);
      }
    }
    void loadEditEntry();
    return () => {
      isActive = false;
    };
  }, [editId, editCollectionParam]);

  useEffect(() => {
    async function loadContext() {
      if (!userData?.teamId) return;
      try {
        let teamData: Record<string, unknown> = {};
        try {
          const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
          teamData = teamDoc.exists() ? (teamDoc.data() as Record<string, unknown>) : {};
        } catch (error) {
          console.warn("Unable to load team document:", error);
        }

        let resolvedKey = "app-testing";
        let resolvedName = "Practice Event";
        try {
          if (editEventKey) {
            resolvedKey = editEventKey;
            resolvedName = editEventKey;
          } else {
            const resolvedEvent = await resolveDetectedTeamEvent(userData.teamId);
            if (resolvedEvent?.key) {
              resolvedKey = resolvedEvent.key;
              resolvedName = resolvedEvent.name || resolvedKey;
            }
          }
        } catch (error) {
          console.warn("Unable to resolve event for strategy form:", error);
        }

        let teamAssignments: Record<string, unknown>[] = [];
        try {
          const teamAssignmentsSnap = await getDocs(
            query(collection(db, "teamAssignments"), where("scoutId", "==", userData.uid))
          );
          teamAssignments = teamAssignmentsSnap.docs.map((row) => row.data() as Record<string, unknown>);
        } catch (error) {
          console.warn("Unable to load team assignments:", error);
        }
        let matchAssignments: Record<string, unknown>[] = [];
        try {
          const fallbackSnap = await getDocs(
            query(
              collection(db, "matchAssignments"),
              where("scoutId", "==", userData.uid),
              where("assignmentType", "==", "team")
            )
          );
          matchAssignments = fallbackSnap.docs.map((row) => row.data() as Record<string, unknown>);
        } catch (error) {
          console.warn("Unable to load fallback team assignments:", error);
        }
        const combinedAssignments = [...teamAssignments, ...matchAssignments];

        const assignmentForEvent =
          combinedAssignments.find((assignment) => String(assignment.eventKey || "").trim() === resolvedKey) ||
          (resolvedKey === "app-testing" ? combinedAssignments[0] : undefined);
        const effectiveEvent = String(assignmentForEvent?.eventKey || resolvedKey || "app-testing").trim() || "app-testing";
        setEventKey(effectiveEvent);
        setEventName(effectiveEvent === resolvedKey ? resolvedName : effectiveEvent);

        const assignedTeamsForEvent = combinedAssignments
          .filter((assignment) => String(assignment.eventKey || "").trim() === effectiveEvent)
          .map((assignment) => String(assignment.teamNumber || "").replace(/[^\d]/g, ""))
          .filter(Boolean);
        const sortedAssignedTeams = Array.from(new Set(assignedTeamsForEvent)).sort((a, b) => Number(a) - Number(b));
        setAssignedTeamNumbers(sortedAssignedTeams);

        let allAssignments: Record<string, unknown>[] = [];
        try {
          const allTeamSnap = await getDocs(
            query(collection(db, "teamAssignments"), where("eventKey", "==", effectiveEvent))
          );
          allAssignments = allTeamSnap.docs.map((row) => row.data() as Record<string, unknown>);
        } catch (error) {
          console.warn("Unable to load all team assignments:", error);
        }
        let matchAllAssignments: Record<string, unknown>[] = [];
        try {
          const fallbackSnap = await getDocs(
            query(
              collection(db, "matchAssignments"),
              where("eventKey", "==", effectiveEvent),
              where("assignmentType", "==", "team")
            )
          );
          matchAllAssignments = fallbackSnap.docs.map((row) => row.data() as Record<string, unknown>);
        } catch (error) {
          console.warn("Unable to load fallback team assignments:", error);
        }
        const allAssignedTeamsForEvent = [...allAssignments, ...matchAllAssignments]
          .filter((assignment) => String(assignment.eventKey || "").trim() === effectiveEvent)
          .map((assignment) => String(assignment.teamNumber || "").replace(/[^\d]/g, ""))
          .filter(Boolean);
        setAllAssignedTeamNumbers(
          Array.from(new Set(allAssignedTeamsForEvent)).sort((a, b) => Number(a) - Number(b))
        );

        const manualByEvent = (teamData.manualTeamListsByEvent || {}) as Record<string, unknown>;
        const storedManualTeams = parseManualTeamList(manualByEvent[effectiveEvent]);

        let firstTeams: string[] = [];
        let loadNote = "";
        if (effectiveEvent !== "app-testing") {
          const year = Number(effectiveEvent.slice(0, 4));
          if (Number.isFinite(year)) {
            try {
              const eventCode = getFirstEventCodeFromTbaKey(effectiveEvent);
              const response = await fetch("/api/first/teams", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ year, eventCode }),
              });
              if (response.ok) {
                const payload = await response.json();
                const rows = Array.isArray(payload.teams) ? (payload.teams as Array<Record<string, unknown>>) : [];
                firstTeams = Array.from(
                  new Set(
                    rows
                      .map((team) => Number(team.teamNumber || 0))
                      .filter((teamNumber) => Number.isFinite(teamNumber) && teamNumber > 0)
                      .map((teamNumber) => String(teamNumber))
                  )
                ).sort((a, b) => Number(a) - Number(b));
                if (firstTeams.length === 0) loadNote = "FIRST API returned no teams yet.";
              } else {
                const payload = await response.json().catch(() => ({}));
                const reason = String((payload as { code?: string }).code || "");
                loadNote = reason === "missing_credentials" ? "FIRST API credentials are missing." : `Unable to load teams (${response.status}).`;
              }
            } catch (error) {
              console.error("Failed to fetch FIRST teams:", error);
              loadNote = "Unable to load teams right now.";
            }
          } else {
            loadNote = "Event key missing year for FIRST API.";
          }
        }

        const baseTeams = firstTeams.length > 0 ? firstTeams : storedManualTeams;
        const mergedTeams = Array.from(new Set([...baseTeams, ...sortedAssignedTeams])).sort((a, b) => Number(a) - Number(b));
        setAvailableTeams(mergedTeams);
        if (firstTeams.length > 0) {
          setTeamLoadNote("");
        } else if (storedManualTeams.length > 0) {
          setTeamLoadNote("Using manual team list from assignments.");
        } else if (sortedAssignedTeams.length > 0) {
          setTeamLoadNote("Using assigned team list.");
        } else if (loadNote) {
          setTeamLoadNote(loadNote);
        } else {
          setTeamLoadNote("No teams available yet.");
        }

        try {
          const strategySnap = await getDocs(
            query(
              collection(db, "strategyScouting"),
              where("teamId", "==", userData.teamId),
              where("eventKey", "==", effectiveEvent),
              where("game", "==", "REBUILT")
            )
          );
          const done = new Set<string>();
          strategySnap.docs.forEach((snap) => {
            const value = String(snap.data().teamNumber || "").trim();
            if (value) done.add(value);
          });
          setScoutedTeams(done);
        } catch (error) {
          console.warn("Unable to load strategy scouting entries:", error);
          setScoutedTeams(new Set());
        }
      } catch (error) {
        console.error("Failed loading strategy form context:", error);
        setAvailableTeams([]);
        setTeamLoadNote("Unable to load teams right now.");
      }
    }

    void loadContext();
  }, [userData?.teamId, userData?.uid, editEventKey]);

  useEffect(() => {
    if (editMode) return;
    if (assignedTeamNumbers.length === 0) return;
    const nextTeam = assignedTeamNumbers.find((team) => !scoutedTeams.has(team));
    if (!nextTeam) return;
    setTeamNumber((prev) => {
      if (prev && !scoutedTeams.has(prev)) return prev;
      if (prev === nextTeam) return prev;
      return nextTeam;
    });
  }, [assignedTeamNumbers, scoutedTeams, editMode]);

  const canSubmit = useMemo(() => {
    return teamNumber.trim().length > 0 && startingPosition && bestAt;
  }, [teamNumber, startingPosition, bestAt]);

  const assignedTeamSet = useMemo(() => new Set(allAssignedTeamNumbers), [allAssignedTeamNumbers]);
  const userTeamSet = useMemo(() => new Set(assignedTeamNumbers), [assignedTeamNumbers]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!userData?.uid || !userData.teamId || !canSubmit) return;
    if (!editMode && !(await assertSubmissionsOpen(userData.teamId))) return;
    setSaving(true);
    try {
      const payload = {
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
        submittedAt: Date.now(),
      };
      if (editMode && editId && editCollectionParam) {
        await setDoc(doc(db, editCollectionParam, editId), payload, { merge: true });
        alert("Team Strategy Form updated.");
      } else {
        await addDoc(collection(db, "strategyScouting"), payload);
        alert("Team Strategy Form submitted.");
        if (typeof window !== "undefined") {
          window.location.reload();
        }
        setTeamNumber("");
        setStartingPosition("");
        setBestAt("");
        setClearsBump(false);
        setClearsTrench(false);
        setShootWhileIntaking(false);
        setMoveAndShoot(false);
        setNotes("");
        setScoutedTeams((prev) => new Set(prev).add(teamNumber.trim()));
      }
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
          <SubmissionLockoutBanner teamId={userData?.teamId} />
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
            {teamLoadNote && <p className="text-xs text-gray-500">{teamLoadNote}</p>}
          </div>

          <div className="bg-white rounded-xl shadow p-4 space-y-3">
            <h2 className="text-lg font-semibold" style={{ color: "var(--primary-color)" }}>Strategy</h2>

            <label className="block text-sm font-medium text-gray-700">Preferred Starting Position</label>
            <select className="w-full border rounded p-3" value={startingPosition} onChange={(e) => setStartingPosition(e.target.value)} required>
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
              {saving ? "Submitting..." : editMode ? "Update Team Strategy Form" : "Submit Team Strategy Form"}
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
        assignedTeams={assignedTeamSet}
        userTeams={userTeamSet}
        scoutedTeams={scoutedTeams}
        onSelect={setTeamNumber}
      />
    </div>
  );
}

export default function TeamStrategyFormPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["lead-strategist"]} formKey="strategy-scout-form">
      <TeamStrategyFormContent />
    </ProtectedRoute>
  );
}

