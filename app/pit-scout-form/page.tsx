"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { addDoc, collection, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";
import { Image as ImageIcon, Link as LinkIcon, Trash2 } from "lucide-react";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import SubmissionLockoutBanner from "@/app/components/SubmissionLockoutBanner";
import ReefscapeStyleModal from "@/app/components/ReefscapeStyleModal";
import { useAuth } from "@/app/AuthContext";
import { resolveDetectedTeamEventKey } from "@/app/utils/eventDetection";
import { assertSubmissionsOpen } from "@/app/utils/submissionControls";

type PitFormState = {
  scoutName: string;
  teamNumber: string;
  robotWeight: string;
  rookieTeam: boolean;
  robotPictureUrl: string;
  pitDisposition: boolean;
  driveDisposition: boolean;
  fuelPreloadCapacity: string;
  fuelBallsPerSecond: string;
  fuelCarryingCapacity: string;
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
  assignedTeams,
  userTeams,
  scoutedTeams,
  onClose,
  onSelect,
}: {
  open: boolean;
  teams: string[];
  assignedTeams: Set<string>;
  userTeams: Set<string>;
  scoutedTeams: Set<string>;
  onClose: () => void;
  onSelect: (team: string) => void;
}) {
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

function PitScoutFormContent() {
  const router = useRouter();
  const { userData } = useAuth();
  const searchParams = useSearchParams();
  const editId = searchParams.get("editId");
  const editCollectionParam = searchParams.get("editCollection");
  const editMode = Boolean(editId);
  const [saving, setSaving] = useState(false);
  const [mobileNotesOpen, setMobileNotesOpen] = useState(false);
  const [showTeamPicker, setShowTeamPicker] = useState(false);
  const [robotPictureUrlInput, setRobotPictureUrlInput] = useState("");
  const [eventKey, setEventKey] = useState("app-testing");
  const [editEventKey, setEditEventKey] = useState<string | null>(null);
  const [apiTeams, setApiTeams] = useState<string[]>([]);
  const [availableTeams, setAvailableTeams] = useState<string[]>([]);
  const [scoutedTeams, setScoutedTeams] = useState<Set<string>>(new Set());
  const [assignedPitTeams, setAssignedPitTeams] = useState<string[]>([]);
  const [allAssignedPitTeams, setAllAssignedPitTeams] = useState<string[]>([]);
  const [teamLoadNote, setTeamLoadNote] = useState("");
  const [form, setForm] = useState<PitFormState>({
    scoutName: userData?.displayName || "",
    teamNumber: "",
    robotWeight: "",
    rookieTeam: false,
    robotPictureUrl: "",
    pitDisposition: false,
    driveDisposition: false,
    fuelPreloadCapacity: "",
    fuelBallsPerSecond: "",
    fuelCarryingCapacity: "",
    climbLevel1: false,
    climbLevel2: false,
    climbLevel3: false,
    typicalFuelCycleTime: "",
    typicalClimbTime: "",
    autoCycleDescription: "",
    notes: "",
  });
  function normalizeScaleInput(raw: string): string {
    const value = raw.trim().toLowerCase();
    if (!value) return "";
    if (value === "x") return "x";
    return value.replace(/[^\d]/g, "");
  }
  function isValidImageUrl(value: string): boolean {
    try {
      const parsed = new URL(value);
      return parsed.protocol === "https:" || parsed.protocol === "http:";
    } catch {
      return false;
    }
  }

  function applyRobotPictureUrl() {
    const normalized = robotPictureUrlInput.trim();
    if (!normalized) {
      setForm((prev) => ({ ...prev, robotPictureUrl: "" }));
      return;
    }
    if (!isValidImageUrl(normalized)) {
      alert("Please enter a valid http(s) image URL.");
      return;
    }
    setForm((prev) => ({ ...prev, robotPictureUrl: normalized }));
  }

  function clearRobotPictureUrl() {
    setRobotPictureUrlInput("");
    setForm((prev) => ({ ...prev, robotPictureUrl: "" }));
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

  useEffect(() => {
    if (!userData?.displayName) return;
    setForm((prev) => ({ ...prev, scoutName: userData.displayName }));
  }, [userData?.displayName]);

  useEffect(() => {
    if (!editId) return;
    let isActive = true;
    const editIdValue = editId;
    const collectionName: string = editCollectionParam || "pitScouting";
    async function loadEditEntry() {
      try {
        const snap = await getDoc(doc(db, collectionName, editIdValue));
        if (!snap.exists()) return;
        const data = snap.data() as Record<string, unknown>;
        if (!isActive) return;
        const entryEventKey = String(data.eventKey || "").trim();
        setEditEventKey(entryEventKey || null);
        setForm((prev) => ({
          ...prev,
          scoutName: String(data.scoutName || prev.scoutName || ""),
          teamNumber: String(data.teamNumber || ""),
          robotWeight: String(data.robotWeight || ""),
          robotPictureUrl: String(data.robotPictureUrl || ""),
          pitDisposition: Boolean(data.pitDisposition),
          driveDisposition: Boolean(data.driveDisposition),
          fuelPreloadCapacity: String(data.fuelPreloadCapacity || ""),
          fuelBallsPerSecond: String(data.fuelBallsPerSecond || ""),
          fuelCarryingCapacity: String(data.fuelCarryingCapacity || ""),
          climbLevel1: Boolean(data.climbLevel1),
          climbLevel2: Boolean(data.climbLevel2),
          climbLevel3: Boolean(data.climbLevel3),
          typicalFuelCycleTime: String(data.typicalFuelCycleTime || ""),
          typicalClimbTime: String(data.typicalClimbTime || ""),
          autoCycleDescription: String(data.autoCycleDescription || ""),
          notes: String(data.notes || ""),
        }));
        setRobotPictureUrlInput(String(data.robotPictureUrl || ""));
      } catch (error) {
        console.error("Failed to load pit scout edit entry:", error);
      }
    }
    void loadEditEntry();
    return () => {
      isActive = false;
    };
  }, [editId, editCollectionParam]);

  useEffect(() => {
    async function loadEventTeams() {
      if (!userData?.teamId) return;
      try {
        const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
        const teamData = teamDoc.exists() ? (teamDoc.data() as Record<string, unknown>) : {};
        const resolvedEvent = editEventKey || (await resolveDetectedTeamEventKey(userData.teamId));
        let pitAssignments: Record<string, unknown>[] = [];
        try {
          const pitAssignmentsSnap = await getDocs(
            query(collection(db, "pitAssignments"), where("scoutId", "==", userData.uid))
          );
          pitAssignments = pitAssignmentsSnap.docs.map((row) => row.data() as Record<string, unknown>);
        } catch (error) {
          console.warn("Unable to load pit assignments:", error);
        }
        const assignmentForEvent =
          pitAssignments.find((assignment) => String(assignment.eventKey || "").trim() === resolvedEvent) ||
          (resolvedEvent === "app-testing" ? pitAssignments[0] : undefined);
        const effectiveEvent = String(assignmentForEvent?.eventKey || resolvedEvent || "app-testing").trim() || "app-testing";
        setEventKey(effectiveEvent);

        const assignedTeamsForEvent = pitAssignments
          .filter((assignment) => String(assignment.eventKey || "").trim() === effectiveEvent)
          .map((assignment) => String(assignment.teamNumber || "").replace(/[^\d]/g, ""))
          .filter(Boolean);
        const sortedAssignedTeams = Array.from(new Set(assignedTeamsForEvent)).sort((a, b) => Number(a) - Number(b));
        setAssignedPitTeams(sortedAssignedTeams);

        let allPitAssignments: Record<string, unknown>[] = [];
        try {
          const allPitSnap = await getDocs(
            query(collection(db, "pitAssignments"), where("eventKey", "==", effectiveEvent))
          );
          allPitAssignments = allPitSnap.docs.map((row) => row.data() as Record<string, unknown>);
        } catch (error) {
          console.warn("Unable to load all pit assignments:", error);
        }
        const allAssignedTeamsForEvent = allPitAssignments
          .filter((assignment) => String(assignment.eventKey || "").trim() === effectiveEvent)
          .map((assignment) => String(assignment.teamNumber || "").replace(/[^\d]/g, ""))
          .filter(Boolean);
        setAllAssignedPitTeams(
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

        setApiTeams(firstTeams);
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
          const scoutedSnap = await getDocs(
            query(
              collection(db, "pitScouting"),
              where("teamId", "==", userData.teamId),
              where("eventKey", "==", effectiveEvent),
              where("game", "==", "REBUILT")
            )
          );
          const done = new Set<string>();
          scoutedSnap.docs.forEach((row) => {
            const team = String(row.data().teamNumber || "").trim();
            if (team) done.add(team);
          });
          setScoutedTeams(done);
        } catch (error) {
          console.warn("Unable to load pit scouting entries:", error);
          setScoutedTeams(new Set());
        }
      } catch (error) {
        console.error("Failed loading pit team list:", error);
        setAvailableTeams([]);
        setTeamLoadNote("Unable to load teams right now.");
      }
    }
    void loadEventTeams();
  }, [userData?.teamId, userData?.uid, editEventKey]);

  useEffect(() => {
    if (editMode) return;
    if (assignedPitTeams.length === 0) return;
    const nextTeam = assignedPitTeams.find((team) => !scoutedTeams.has(team));
    if (!nextTeam) return;
    setForm((prev) => {
      if (prev.teamNumber && !scoutedTeams.has(prev.teamNumber)) return prev;
      if (prev.teamNumber === nextTeam) return prev;
      return { ...prev, teamNumber: nextTeam };
    });
  }, [assignedPitTeams, form.teamNumber, scoutedTeams, editMode]);

  const canSubmit = useMemo(() => {
    return form.teamNumber.trim().length > 0;
  }, [form.teamNumber]);

  const assignedTeamSet = useMemo(() => new Set(allAssignedPitTeams), [allAssignedPitTeams]);
  const userTeamSet = useMemo(() => new Set(assignedPitTeams), [assignedPitTeams]);

  async function submitForm(event: React.FormEvent) {
    event.preventDefault();
    if (!userData?.uid || !userData.teamId) return;
    if (!editMode && !(await assertSubmissionsOpen(userData.teamId))) return;

    setSaving(true);
    try {
      const existingCreatedAt =
        typeof (form as unknown as { createdAt?: number }).createdAt === "number"
          ? (form as unknown as { createdAt?: number }).createdAt
          : undefined;
      const payload = {
        ...form,
        scoutName: userData.displayName || "",
        teamNumber: form.teamNumber.trim(),
        game: "REBUILT",
        eventKey,
        teamId: userData.teamId,
        submittedBy: userData.uid,
        createdAt: editMode && existingCreatedAt ? existingCreatedAt : Date.now(),
        submittedAt: Date.now(),
      };
      if (editMode && editId && editCollectionParam) {
        await setDoc(doc(db, editCollectionParam, editId), payload, { merge: true });
        alert("Pit Scout Form updated.");
      } else {
        await addDoc(collection(db, "pitScouting"), payload);
        alert("Pit Scout Form submitted.");
        if (typeof window !== "undefined") {
          window.location.reload();
        }
        setScoutedTeams((prev) => new Set(prev).add(form.teamNumber.trim()));
        setForm((prev) => ({
          ...prev,
          teamNumber: "",
          robotWeight: "",
          rookieTeam: false,
          robotPictureUrl: "",
          notes: "",
          typicalFuelCycleTime: "",
          typicalClimbTime: "",
          autoCycleDescription: "",
        }));
        setRobotPictureUrlInput("");
      }
    } catch (error) {
      console.error("Error submitting pit form:", error);
      alert("Could not submit pit form.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="min-h-screen bg-gray-100 flex flex-col md:flex-row justify-center">
          <form onSubmit={submitForm} className="flex-1 p-4 space-y-6 max-w-3xl">
            <SubmissionLockoutBanner teamId={userData?.teamId} />
            <div className="bg-white rounded-xl shadow p-4">
              <h1 className="text-3xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>Pit Scout Form</h1>
              <div className="mt-3 max-w-sm">
                <label className="block text-sm font-medium text-gray-700 mb-1">Form Select</label>
                <select
                  className="w-full border rounded p-2"
                  value="REBUILT"
                  onChange={(event) => {
                    if (event.target.value === "REEFSCAPE") {
                      router.push("/pit-scout-form-reefscape");
                    }
                  }}
                >
                  <option value="REEFSCAPE">REEFSCAPE Form</option>
                  <option value="REBUILT">REBUILT Form</option>
                </select>
              </div>
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
              {teamLoadNote && <p className="text-xs text-gray-500">{teamLoadNote}</p>}

              <label className="block text-sm font-medium text-gray-700">Robot Weight</label>
              <input
                className="w-full border rounded p-3"
                value={form.robotWeight}
                onChange={(event) => setForm({ ...form, robotWeight: event.target.value })}
                placeholder="Robot Weight"
              />
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <input
                  type="checkbox"
                  checked={form.rookieTeam}
                  onChange={(event) => setForm({ ...form, rookieTeam: event.target.checked })}
                  className="w-4 h-4"
                />
                Rookie Team
              </label>

              <label className="block text-sm font-medium text-gray-700">Picture of Robot</label>
              <div className="rounded-lg border p-3 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-16 h-16 rounded-lg border flex items-center justify-center overflow-hidden bg-gray-100">
                    {form.robotPictureUrl ? (
                      <img src={form.robotPictureUrl} alt="Robot preview" className="w-full h-full object-cover" />
                    ) : (
                      <ImageIcon size={20} className="text-gray-500" />
                    )}
                  </div>
                  <div className="flex-1 space-y-2">
                    <input
                      type="url"
                      value={robotPictureUrlInput}
                      onChange={(event) => setRobotPictureUrlInput(event.target.value)}
                      placeholder="https://example.com/robot.jpg"
                      className="w-full border rounded p-2"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={applyRobotPictureUrl}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded text-white"
                        style={{ backgroundColor: "var(--primary-color)" }}
                      >
                        <LinkIcon size={14} />
                        Apply URL
                      </button>
                      <button type="button" onClick={clearRobotPictureUrl} className="inline-flex items-center gap-2 px-3 py-2 rounded border">
                        <Trash2 size={14} />
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow p-4 space-y-3">
              <h2 className="text-lg font-semibold" style={{ color: "var(--primary-color)" }}>Disposition</h2>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.pitDisposition} onChange={(event) => setForm({ ...form, pitDisposition: event.target.checked })} />Friendly and easy to work with (Pit)</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.driveDisposition} onChange={(event) => setForm({ ...form, driveDisposition: event.target.checked })} />Friendly and easy to work with (Drive)</label>
            </div>

            <div className="bg-white rounded-xl shadow p-4 space-y-4">
              <h2 className="text-lg font-semibold" style={{ color: "var(--primary-color)" }}>Routine</h2>

              <h3 className="font-semibold text-gray-800">Fuel</h3>
              <label className="block text-sm font-medium text-gray-700">Preload Capacity</label>
              <input
                type="text"
                value={form.fuelPreloadCapacity}
                onChange={(event) => setForm({ ...form, fuelPreloadCapacity: normalizeScaleInput(event.target.value) })}
                className="w-full border rounded p-3"
                placeholder="Number or x"
              />

              <label className="block text-sm font-medium text-gray-700">Balls Per Second</label>
              <input
                type="text"
                value={form.fuelBallsPerSecond}
                onChange={(event) => setForm({ ...form, fuelBallsPerSecond: normalizeScaleInput(event.target.value) })}
                className="w-full border rounded p-3"
                placeholder="Number or x"
              />

              <label className="block text-sm font-medium text-gray-700">Carrying Capacity</label>
              <input
                type="text"
                value={form.fuelCarryingCapacity}
                onChange={(event) => setForm({ ...form, fuelCarryingCapacity: normalizeScaleInput(event.target.value) })}
                className="w-full border rounded p-3"
                placeholder="Number or x"
              />

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
                {saving ? "Submitting..." : editMode ? "Update Pit Scout Form" : "Submit Pit Scout Form"}
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
        assignedTeams={assignedTeamSet}
        userTeams={userTeamSet}
        scoutedTeams={scoutedTeams}
        onClose={() => setShowTeamPicker(false)}
        onSelect={(team) => setForm((prev) => ({ ...prev, teamNumber: team }))}
      />
    </div>
  );
}

export default function PitScoutFormPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["pit-scout"]} formKey="pit-scout-form">
      <PitScoutFormContent />
    </ProtectedRoute>
  );
}

