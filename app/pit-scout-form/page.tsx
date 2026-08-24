"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { addDoc, collection, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";
import { Image as ImageIcon, Link as LinkIcon, Trash2, Search, X, Gauge, Boxes, ClipboardList, NotebookPen } from "lucide-react";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import { useAuth } from "@/app/AuthContext";
import { resolveDetectedTeamEventKey } from "@/app/utils/eventDetection";
import { HudCanvas, HudViewport, CommandBar, Surface, Deck, PageIntro, Chip, Action } from "@/app/components/Hud";

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

/** Floating glass command palette — replaces the old boxed modal chrome entirely. */
function TeamPickerDeck({
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
  const [filter, setFilter] = useState("");
  useEffect(() => {
    if (open) setFilter("");
  }, [open]);
  if (!open) return null;
  const visible = teams.filter((team) => team.includes(filter.trim()));
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/25 backdrop-blur-md" onClick={onClose} />
      <Surface raised className="relative w-full max-w-2xl overflow-hidden">
        <div className="flex items-center justify-between gap-4 border-b border-white/50 p-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-red-800/70">Assignment Roster</p>
            <h2 className="font-display text-2xl text-slate-950">Select Team</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/70 bg-white/50 p-2 text-slate-700 transition hover:bg-white/80"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5">
          <div className="relative mb-4">
            <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value.replace(/[^\d]/g, ""))}
              placeholder="Filter by team number"
              className="w-full !pl-10"
            />
          </div>
          <div className="max-h-[52vh] overflow-y-auto rounded-[1.25rem] border border-white/50 bg-white/30 p-3">
            {visible.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">No teams available.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {visible.map((team) => {
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
                      className={`rounded-2xl border px-3 py-3 text-left font-data text-sm font-semibold transition ${
                        done
                          ? "cursor-not-allowed border-slate-200/70 bg-slate-100/60 text-slate-400"
                          : mine
                          ? "border-amber-300/70 bg-amber-50/70 text-amber-950 hover:-translate-y-0.5"
                          : assigned
                          ? "border-red-300/60 bg-red-50/60 text-red-950 hover:-translate-y-0.5"
                          : "border-white/70 bg-white/50 text-slate-800 hover:-translate-y-0.5 hover:bg-white/75"
                      }`}
                    >
                      <span className="block text-base">{team}</span>
                      <span className="block text-[10px] font-bold uppercase tracking-[0.14em] opacity-70">
                        {done ? "Scouted" : mine ? "Assigned to you" : assigned ? "Assigned" : "Open"}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </Surface>
    </div>
  );
}

function PitScoutFormContent() {
  const router = useRouter();
  const { userData } = useAuth();
  const searchParams = useSearchParams();
  const editId = searchParams.get("editId");
  const editCollectionParam = searchParams.get("editCollection");
  const editMode = Boolean(editId);
  const [saving, setSaving] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
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
    <HudCanvas>
      <CommandBar>
        <Chip label="Game" value="REBUILT" tone="crimson" icon={Boxes} />
        <select
          className="!min-h-0 !rounded-full !border-amber-300/60 !bg-white/60 !py-1.5 !pl-4 !pr-8 text-xs font-bold uppercase tracking-wider text-slate-800"
          value="REBUILT"
          onChange={(event) => {
            if (event.target.value === "REEFSCAPE") router.push("/pit-scout-form-reefscape");
          }}
        >
          <option value="REEFSCAPE">REEFSCAPE Form</option>
          <option value="REBUILT">REBUILT Form</option>
        </select>
        <Action variant="secondary" type="button" onClick={() => setShowTeamPicker(true)}>
          <Search size={14} /> Pick Team
        </Action>
        <Action variant="ghost" type="button" onClick={() => setNotesOpen((prev) => !prev)}>
          <NotebookPen size={14} /> Notes
        </Action>
      </CommandBar>

      <HudViewport className="pb-40">
        <PageIntro
          eyebrow={editMode ? "Editing Existing Entry" : "Pit Intelligence Intake"}
          title={<>Pit Scout <span className="gradient-text">Form</span></>}
          subtitle="Log chassis, routine, and disposition data for a team's pit before qualification play begins."
          actions={
            <>
              <Chip label="Event" value={eventKey} tone="gold" icon={Gauge} />
              <Chip label="Scouted" value={scoutedTeams.size} tone="slate" icon={ClipboardList} />
            </>
          }
        />

        <form onSubmit={submitForm}>
          <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Identity block — wide, high priority */}
            <Deck priority="high" className="lg:col-span-7">
              <h2 className="font-display text-2xl text-slate-950">Identity</h2>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">Scout Name</label>
                  <input value={form.scoutName} disabled className="w-full" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">Team Number</label>
                  <div className="flex gap-2">
                    <input
                      value={form.teamNumber}
                      onChange={(event) => setForm({ ...form, teamNumber: event.target.value.replace(/[^\d]/g, "") })}
                      placeholder="e.g. 4931"
                      required
                      className="flex-1 font-data"
                    />
                    <button
                      type="button"
                      onClick={() => setShowTeamPicker(true)}
                      className="theme-stepper-btn !w-auto !px-4 text-xs font-bold uppercase"
                    >
                      Pick
                    </button>
                  </div>
                  {teamLoadNote && <p className="mt-1 text-[11px] text-slate-500">{teamLoadNote}</p>}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">Robot Weight</label>
                  <input
                    value={form.robotWeight}
                    onChange={(event) => setForm({ ...form, robotWeight: event.target.value })}
                    placeholder="lbs"
                    className="w-full"
                  />
                </div>
                <label className="mt-6 flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.rookieTeam}
                    onChange={(event) => setForm({ ...form, rookieTeam: event.target.checked })}
                    className="!h-4 !w-4 !min-h-0 !rounded"
                  />
                  Rookie Team
                </label>
              </div>

              <div className="mt-5 rounded-2xl border border-white/60 bg-white/35 p-4">
                <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">Picture of Robot</p>
                <div className="flex items-center gap-4">
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/70 bg-white/50">
                    {form.robotPictureUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={form.robotPictureUrl} alt="Robot preview" className="h-full w-full object-cover" />
                    ) : (
                      <ImageIcon size={22} className="text-slate-400" />
                    )}
                  </div>
                  <div className="flex-1 space-y-2">
                    <input
                      type="url"
                      value={robotPictureUrlInput}
                      onChange={(event) => setRobotPictureUrlInput(event.target.value)}
                      placeholder="https://example.com/robot.jpg"
                      className="w-full font-data text-sm"
                    />
                    <div className="flex flex-wrap gap-2">
                      <Action variant="primary" type="button" onClick={applyRobotPictureUrl} className="!px-4 !py-2 !text-xs">
                        <LinkIcon size={13} /> Apply URL
                      </Action>
                      <Action variant="ghost" type="button" onClick={clearRobotPictureUrl} className="!px-4 !py-2 !text-xs">
                        <Trash2 size={13} /> Remove
                      </Action>
                    </div>
                  </div>
                </div>
              </div>
            </Deck>

            {/* Disposition — narrow, offset upward slightly */}
            <Deck className="lg:col-span-5 lg:mt-6">
              <h2 className="font-display text-2xl text-slate-950">Disposition</h2>
              <div className="mt-4 space-y-3">
                <label className="flex items-center gap-3 rounded-2xl border border-white/60 bg-white/35 p-3 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.pitDisposition}
                    onChange={(event) => setForm({ ...form, pitDisposition: event.target.checked })}
                    className="!h-4 !w-4 !min-h-0 !rounded"
                  />
                  Friendly and easy to work with (Pit)
                </label>
                <label className="flex items-center gap-3 rounded-2xl border border-white/60 bg-white/35 p-3 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.driveDisposition}
                    onChange={(event) => setForm({ ...form, driveDisposition: event.target.checked })}
                    className="!h-4 !w-4 !min-h-0 !rounded"
                  />
                  Friendly and easy to work with (Drive)
                </label>
              </div>
            </Deck>

            {/* Routine — fuel + tower + cycles, asymmetric internal columns */}
            <Deck priority="critical" className="lg:col-span-8">
              <h2 className="font-display text-2xl text-slate-950">Routine</h2>
              <div className="mt-5 grid grid-cols-1 gap-6 sm:grid-cols-3">
                <div>
                  <p className="mb-2 text-xs font-bold uppercase tracking-wider text-red-800/70">Fuel</p>
                  <div className="space-y-3">
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-slate-500">Preload Capacity</label>
                      <input
                        value={form.fuelPreloadCapacity}
                        onChange={(event) => setForm({ ...form, fuelPreloadCapacity: normalizeScaleInput(event.target.value) })}
                        placeholder="Number or x"
                        className="w-full font-data"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-slate-500">Balls Per Second</label>
                      <input
                        value={form.fuelBallsPerSecond}
                        onChange={(event) => setForm({ ...form, fuelBallsPerSecond: normalizeScaleInput(event.target.value) })}
                        placeholder="Number or x"
                        className="w-full font-data"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-slate-500">Carrying Capacity</label>
                      <input
                        value={form.fuelCarryingCapacity}
                        onChange={(event) => setForm({ ...form, fuelCarryingCapacity: normalizeScaleInput(event.target.value) })}
                        placeholder="Number or x"
                        className="w-full font-data"
                      />
                    </div>
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs font-bold uppercase tracking-wider text-red-800/70">Tower</p>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                      <input type="checkbox" checked={form.climbLevel1} onChange={(event) => setForm({ ...form, climbLevel1: event.target.checked })} className="!h-4 !w-4 !min-h-0 !rounded" />
                      Level 1 Climb
                    </label>
                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                      <input type="checkbox" checked={form.climbLevel2} onChange={(event) => setForm({ ...form, climbLevel2: event.target.checked })} className="!h-4 !w-4 !min-h-0 !rounded" />
                      Level 2 Climb
                    </label>
                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                      <input type="checkbox" checked={form.climbLevel3} onChange={(event) => setForm({ ...form, climbLevel3: event.target.checked })} className="!h-4 !w-4 !min-h-0 !rounded" />
                      Level 3 Climb
                    </label>
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs font-bold uppercase tracking-wider text-red-800/70">Cycles</p>
                  <div className="space-y-3">
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-slate-500">Typical Fuel Cycle (s)</label>
                      <input
                        value={form.typicalFuelCycleTime}
                        onChange={(event) => setForm({ ...form, typicalFuelCycleTime: event.target.value.replace(/[^\d.]/g, "") })}
                        placeholder="Seconds"
                        className="w-full font-data"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-slate-500">Typical Climb Time (s)</label>
                      <input
                        value={form.typicalClimbTime}
                        onChange={(event) => setForm({ ...form, typicalClimbTime: event.target.value.replace(/[^\d.]/g, "") })}
                        placeholder="Seconds"
                        className="w-full font-data"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </Deck>

            {/* Autonomous — narrow companion, offset down */}
            <Deck className="lg:col-span-4 lg:mt-10">
              <h2 className="font-display text-2xl text-slate-950">Autonomous</h2>
              <label className="mb-1 mt-4 block text-xs font-bold uppercase tracking-wider text-slate-500">Description of Auto Cycle</label>
              <textarea
                value={form.autoCycleDescription}
                onChange={(event) => setForm({ ...form, autoCycleDescription: event.target.value })}
                className="h-40 w-full resize-none"
              />
            </Deck>
          </div>

          <div className="fixed inset-x-0 bottom-6 z-30 flex justify-center px-4">
            <Surface raised className="flex w-full max-w-xl items-center gap-4 !rounded-full px-6 py-3">
              <p className="hidden font-data text-xs text-slate-500 sm:block">
                {canSubmit ? `Team ${form.teamNumber} ready to submit` : "Enter a team number to continue"}
              </p>
              <Action type="submit" disabled={saving || !canSubmit} className="ml-auto !px-8">
                {saving ? "Submitting..." : editMode ? "Update Pit Scout Form" : "Submit Pit Scout Form"}
              </Action>
            </Surface>
          </div>
        </form>
      </HudViewport>

      {notesOpen && (
        <div className="fixed inset-0 z-[65] flex items-start justify-end p-4 sm:p-6">
          <div className="absolute inset-0 bg-slate-950/20 backdrop-blur-md" onClick={() => setNotesOpen(false)} />
          <Surface raised className="relative flex h-full w-full max-w-md flex-col p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-2xl text-slate-950">Notes</h2>
              <button
                onClick={() => setNotesOpen(false)}
                className="rounded-full border border-white/70 bg-white/50 p-2 text-slate-700 transition hover:bg-white/80"
                aria-label="Close notes"
              >
                <X size={18} />
              </button>
            </div>
            <textarea
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              className="flex-1 w-full resize-none"
              placeholder="Team comments and observations..."
            />
          </Surface>
        </div>
      )}

      <TeamPickerDeck
        open={showTeamPicker}
        teams={availableTeams}
        assignedTeams={assignedTeamSet}
        userTeams={userTeamSet}
        scoutedTeams={scoutedTeams}
        onClose={() => setShowTeamPicker(false)}
        onSelect={(team) => setForm((prev) => ({ ...prev, teamNumber: team }))}
      />
    </HudCanvas>
  );
}

export default function PitScoutFormPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["pit-scout"]} formKey="pit-scout-form">
      <PitScoutFormContent />
    </ProtectedRoute>
  );
}
