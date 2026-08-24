"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { addDoc, collection, doc, getDocs, getDoc, query, setDoc, where } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import { useAuth } from "@/app/AuthContext";
import { resolveDetectedTeamEvent } from "@/app/utils/eventDetection";
import {
  Action,
  Chip,
  CommandBar,
  Deck,
  HudCanvas,
  HudViewport,
  Surface,
} from "@/app/components/Hud";
import {
  ArrowLeft,
  Check,
  Compass,
  Gauge,
  Lock,
  NotebookPen,
  Search,
  Target,
  X as XIcon,
} from "lucide-react";

const STARTING_POSITIONS = [
  { value: "not-there", label: "Not There" },
  { value: "outpost-trench", label: "Outpost Trench" },
  { value: "outpost-side", label: "Outpost Side" },
  { value: "outpost-bump", label: "Outpost Bump" },
  { value: "middle", label: "Middle" },
  { value: "depot-bump", label: "Depot Bump" },
  { value: "depot-side", label: "Depot Side" },
  { value: "depot-trench", label: "Depot Trench" },
];

const BEST_AT_OPTIONS = [
  { value: "cycling", label: "Cycling" },
  { value: "passing", label: "Passing" },
  { value: "shooting", label: "Shooting" },
  { value: "stealing", label: "Stealing" },
];

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

/** Floating glass overlay for the team picker — an asymmetric grid of team tiles, not a linear list. */
function TeamPickerOverlay({
  open,
  onClose,
  teams,
  assignedTeams,
  userTeams,
  scoutedTeams,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  teams: string[];
  assignedTeams: Set<string>;
  userTeams: Set<string>;
  scoutedTeams: Set<string>;
  onSelect: (team: string) => void;
}) {
  const [filter, setFilter] = useState("");
  useEffect(() => {
    if (!open) setFilter("");
  }, [open]);
  if (!open) return null;

  const filtered = teams.filter((team) => team.includes(filter.trim()));

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto p-4 pt-16 sm:pt-24">
      <div className="fixed inset-0 bg-slate-950/25 backdrop-blur-sm" onClick={onClose} />
      <Surface raised className="relative z-10 w-full max-w-3xl p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.28em] text-red-900/60">Assignment Deck</p>
            <h2 className="mt-1 font-display text-2xl text-slate-950">Select a Team</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-full border border-white/70 bg-white/50 text-slate-700 hover:bg-white/80"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 flex items-center gap-2 rounded-full border border-amber-300/50 bg-white/50 px-4 py-2">
          <Search className="h-4 w-4 text-slate-500" />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value.replace(/[^\d]/g, ""))}
            placeholder="Filter by team number..."
            className="!min-h-0 flex-1 border-0 bg-transparent p-0 shadow-none focus:outline-none"
          />
        </div>

        <div className="mt-4 max-h-[55vh] overflow-y-auto pr-1">
          {filtered.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-500">No teams available.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
              {filtered.map((team) => {
                const done = scoutedTeams.has(team);
                const mine = userTeams.has(team);
                const assigned = assignedTeams.has(team);
                return (
                  <button
                    key={team}
                    type="button"
                    disabled={done}
                    onClick={() => {
                      onSelect(team);
                      onClose();
                    }}
                    className={`rounded-2xl border px-3 py-3 text-left transition ${
                      done
                        ? "cursor-not-allowed border-slate-300/60 bg-slate-100/60 text-slate-400"
                        : mine
                          ? "border-amber-300/70 bg-amber-50/60 text-amber-950 hover:-translate-y-0.5 hover:bg-amber-50/90"
                          : "border-white/70 bg-white/50 text-slate-900 hover:-translate-y-0.5 hover:bg-white/80"
                    }`}
                  >
                    <span className="font-data text-base font-bold">{team}</span>
                    <span className="mt-0.5 block text-[10px] font-bold uppercase tracking-[0.14em] opacity-60">
                      {done ? "Scouted" : mine ? "Assigned to you" : assigned ? "Assigned" : "Open"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </Surface>
    </div>
  );
}

function TeamStrategyFormContent() {
  const router = useRouter();
  const { userData } = useAuth();
  const searchParams = useSearchParams();
  const editId = searchParams.get("editId");
  const editCollectionParam = searchParams.get("editCollection");
  const editMode = Boolean(editId);
  const [saving, setSaving] = useState(false);
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
    return teamNumber.trim().length > 0 && startingPosition !== "" && bestAt !== "";
  }, [teamNumber, startingPosition, bestAt]);

  const assignedTeamSet = useMemo(() => new Set(allAssignedTeamNumbers), [allAssignedTeamNumbers]);
  const userTeamSet = useMemo(() => new Set(assignedTeamNumbers), [assignedTeamNumbers]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!userData?.uid || !userData.teamId || !canSubmit) return;
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

  const capabilityToggles = [
    { key: "clearsBump", label: "Clears Bump", value: clearsBump, set: setClearsBump },
    { key: "clearsTrench", label: "Clears Trench", value: clearsTrench, set: setClearsTrench },
    { key: "shootWhileIntaking", label: "Shoots While Intaking", value: shootWhileIntaking, set: setShootWhileIntaking },
    { key: "moveAndShoot", label: "Moves and Shoots Simultaneously", value: moveAndShoot, set: setMoveAndShoot },
  ] as const;

  return (
    <HudCanvas>
      <CommandBar>
        <button
          type="button"
          onClick={() => router.back()}
          className="flex items-center gap-2 rounded-full py-1.5 pl-3 pr-4 text-sm font-bold text-slate-800 hover:text-red-800"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <Link href="/" className="hidden items-center gap-2 rounded-full py-1.5 pl-2 pr-4 sm:flex">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-red-800 via-red-600 to-amber-300 text-[10px] font-black text-white">
            CS
          </span>
          <span className="font-display text-base text-slate-950">CompSocrates</span>
        </Link>
        <Action variant="secondary" onClick={() => setShowTeamPicker(true)}>
          <Search className="h-4 w-4" />
          Pick Team
        </Action>
      </CommandBar>

      <HudViewport>
        {/* Asymmetric two-column strategy deck: dominant profile column, staggered satellite for notes */}
        <form onSubmit={handleSubmit} className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
          <div className="flex flex-col gap-6">
            <Deck priority="critical">
              <p className="text-xs font-black uppercase tracking-[0.3em] text-red-900/60">Pre-Event Scouting</p>
              <h1 className="mt-3 font-display text-4xl text-slate-950 sm:text-5xl">Team Strategy Profile</h1>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Chip icon={Compass} label="Event" value={eventLabel} tone="crimson" />
                <Chip icon={Lock} label="Scout" value={userData?.displayName || "Unassigned"} tone="slate" />
                {editMode && <Chip icon={NotebookPen} label="Mode" value="Editing Entry" tone="gold" />}
              </div>
            </Deck>

            <Deck priority="high" offset="lg:translate-x-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.28em] text-amber-900/70">Target</p>
                  <h2 className="mt-2 font-display text-2xl text-slate-950">Team Number</h2>
                </div>
                {teamNumber && (
                  <span className="font-data rounded-full border border-amber-300/60 bg-amber-50/60 px-4 py-1.5 text-2xl font-black text-red-800">
                    {teamNumber}
                  </span>
                )}
              </div>
              <div className="mt-4 flex gap-3">
                <input
                  className="flex-1"
                  value={teamNumber}
                  onChange={(event) => setTeamNumber(event.target.value.replace(/[^\d]/g, ""))}
                  placeholder="Enter team number"
                  required
                />
                <Action type="button" variant="secondary" onClick={() => setShowTeamPicker(true)}>
                  Browse
                </Action>
              </div>
              {teamLoadNote && <p className="mt-2 text-xs font-semibold text-amber-800/80">{teamLoadNote}</p>}
            </Deck>

            <Deck priority="normal" offset="lg:-translate-x-3">
              <div className="flex items-center gap-2.5">
                <Target className="h-5 w-5 text-red-800" />
                <h2 className="font-display text-2xl text-slate-950">Field Positioning</h2>
              </div>
              <label className="mt-4 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                Preferred Starting Position
              </label>
              <select
                className="mt-2 w-full"
                value={startingPosition}
                onChange={(event) => setStartingPosition(event.target.value)}
                required
              >
                <option value="">Select Position</option>
                {STARTING_POSITIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              <label className="mt-5 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                Best At
              </label>
              <div className="mt-2 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {BEST_AT_OPTIONS.map((option) => {
                  const active = bestAt === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setBestAt(option.value)}
                      className={`rounded-2xl border px-3 py-2.5 text-sm font-bold transition ${
                        active
                          ? "border-red-800/60 bg-gradient-to-br from-red-700 to-red-900 text-white shadow-[0_10px_30px_rgba(139,0,0,0.28)]"
                          : "border-white/70 bg-white/45 text-slate-800 hover:bg-white/70"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </Deck>

            <Deck priority="normal" offset="lg:translate-x-2">
              <div className="flex items-center gap-2.5">
                <Gauge className="h-5 w-5 text-amber-700" />
                <h2 className="font-display text-2xl text-slate-950">Robot Capabilities</h2>
              </div>
              <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
                {capabilityToggles.map((toggle) => (
                  <button
                    key={toggle.key}
                    type="button"
                    onClick={() => toggle.set(!toggle.value)}
                    className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition ${
                      toggle.value
                        ? "border-amber-300/70 bg-amber-50/60 text-amber-950"
                        : "border-white/70 bg-white/40 text-slate-700 hover:bg-white/60"
                    }`}
                  >
                    {toggle.label}
                    <span
                      className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border ${
                        toggle.value ? "border-amber-400 bg-amber-400 text-white" : "border-slate-300 bg-white/60 text-transparent"
                      }`}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  </button>
                ))}
              </div>
            </Deck>

            <Surface className="p-5">
              <button
                type="submit"
                disabled={saving || !canSubmit}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-red-800/50 bg-gradient-to-br from-red-700 to-red-900 px-6 py-3.5 text-base font-bold text-white shadow-[0_16px_50px_rgba(139,0,0,0.32)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? "Submitting..." : editMode ? "Update Team Strategy Form" : "Submit Team Strategy Form"}
              </button>
            </Surface>
          </div>

          <Deck priority="high" className="xl:sticky xl:top-28 xl:self-start" offset="lg:-translate-x-2">
            <div className="flex items-center gap-2.5">
              <NotebookPen className="h-5 w-5 text-red-800" />
              <h2 className="font-display text-2xl text-slate-950">Scout Notes</h2>
            </div>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="mt-4 h-64 w-full resize-none xl:h-[calc(100vh-22rem)]"
              placeholder="Observations, tendencies, anything strategy should know..."
            />
          </Deck>
        </form>
      </HudViewport>

      <TeamPickerOverlay
        open={showTeamPicker}
        onClose={() => setShowTeamPicker(false)}
        teams={availableTeams}
        assignedTeams={assignedTeamSet}
        userTeams={userTeamSet}
        scoutedTeams={scoutedTeams}
        onSelect={setTeamNumber}
      />
    </HudCanvas>
  );
}

export default function TeamStrategyFormPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["lead-strategist"]} formKey="strategy-scout-form">
      <TeamStrategyFormContent />
    </ProtectedRoute>
  );
}
