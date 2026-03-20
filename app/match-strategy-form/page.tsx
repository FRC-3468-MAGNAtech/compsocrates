"use client";

import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import ReefscapeMatchSelectModal, { type ReefscapeMatchOption } from "@/app/components/ReefscapeMatchSelectModal";
import { useAuth } from "@/app/AuthContext";
import { type TBAMatch } from "@/app/utils/tba-api";
import { resolveDetectedTeamEventKey } from "@/app/utils/eventDetection";
import { getEffectiveNowSec } from "@/app/utils/teamTime";
import {
  buildCompletedModalIdsFromTba,
  buildReefscapeModalOptions,
  fetchEventMatchesWithTeamAuth,
  mapTbaMatchToModalId,
} from "@/app/utils/reefscapeMatchSync";

type RobotPlan = {
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
  redTeams?: string[];
  blueTeams?: string[];
};

type ModalMatchOption = ReefscapeMatchOption & {
  sourceKey: string;
};

type PitCapabilityDoc = {
  teamNumber?: string;
  teamId?: string;
  game?: string;
  eventKey?: string;
  createdAt?: number;
  submittedAt?: number;
  timestamp?: number;
  climbLevel1?: boolean;
  climbLevel2?: boolean;
  climbLevel3?: boolean;
};

function buildFallbackMatchStrategyMatches(): MatchOption[] {
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
  return 0;
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

function canTeamPerformEndgame(level: string, pit?: PitCapabilityDoc): boolean {
  const status = String(level || "").trim().toLowerCase();
  if (!status) return true;
  if (!pit) return true;
  if (status === "level-1") return Boolean(pit.climbLevel1);
  if (status === "level-2") return Boolean(pit.climbLevel2);
  if (status === "level-3") return Boolean(pit.climbLevel3);
  return true;
}

function pitDocTime(doc: PitCapabilityDoc) {
  return Number(doc.createdAt || doc.submittedAt || doc.timestamp || 0);
}

function isUserAttendingEvent(
  attendeesByEvent: Record<string, string[]> | undefined,
  eventKey: string,
  user: { uid?: string | null; displayName?: string | null }
) {
  if (!attendeesByEvent) return false;
  const attendees = attendeesByEvent[eventKey] || [];
  const normalizedUid = String(user.uid || "").trim();
  const normalizedName = String(user.displayName || "").trim().toLowerCase();
  return attendees.some((value) => {
    const safe = String(value || "").trim();
    if (!safe) return false;
    return safe === normalizedUid || safe.toLowerCase() === normalizedName;
  });
}

function MatchPickerModal({
  open,
  onClose,
  matches,
  completed,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  matches: ModalMatchOption[];
  completed: Set<string>;
  onSelect: (key: string) => void;
}) {
  return (
    <ReefscapeMatchSelectModal
      open={open}
      onClose={onClose}
      options={matches}
      completed={completed}
      onPick={(match) => onSelect(match.sourceKey || match.id)}
    />
  );
}

function MatchStrategyFormContent() {
  const { userData, teamTimeOverride } = useAuth();
  const [saving, setSaving] = useState(false);
  const [mobileNotesOpen, setMobileNotesOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [eventKey, setEventKey] = useState("app-testing");
  const [ourTeamNumber, setOurTeamNumber] = useState("");
  const [showMatchPicker, setShowMatchPicker] = useState(false);
  const [matchOptions, setMatchOptions] = useState<MatchOption[]>([]);
  const [eventTbaMatches, setEventTbaMatches] = useState<TBAMatch[]>([]);
  const [modalCompleted, setModalCompleted] = useState<Set<string>>(new Set());
  const [selectedMatchKey, setSelectedMatchKey] = useState("");
  const [robot1, setRobot1] = useState<RobotPlan>({ teamNumber: "", startingPosition: "", role: "", autoClimb: false, endgameClimb: "" });
  const [robot2, setRobot2] = useState<RobotPlan>({ teamNumber: "", startingPosition: "", role: "", autoClimb: false, endgameClimb: "" });
  const [robot3, setRobot3] = useState<RobotPlan>({ teamNumber: "", startingPosition: "", role: "", autoClimb: false, endgameClimb: "" });
  const [pitByTeam, setPitByTeam] = useState<Record<string, PitCapabilityDoc>>({});

  useEffect(() => {
    async function loadMatches() {
      if (!userData?.teamId) {
        setEventKey("app-testing");
        const fallback = buildFallbackMatchStrategyMatches();
        setMatchOptions(fallback);
        setSelectedMatchKey(fallback[0]?.key || "");
        return;
      }
      try {
        const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
        const teamData = teamDoc.data() as Record<string, unknown> | undefined;
        const assignmentSnap = await getDocs(query(collection(db, "matchAssignments"), where("scoutId", "==", userData.uid)));
        const assignedEventCounts = new Map<string, number>();
        assignmentSnap.docs.forEach((row) => {
          const data = row.data() as Record<string, unknown>;
          const key = String(data.eventKey || "").trim().toLowerCase();
          if (!key) return;
          assignedEventCounts.set(key, (assignedEventCounts.get(key) || 0) + 1);
        });
        const resolvedEvent = await resolveDetectedTeamEventKey(userData.teamId);
        const normalizedResolved = String(resolvedEvent || "").trim().toLowerCase();
        const assignedEvent =
          assignedEventCounts.size === 0
            ? (normalizedResolved || "app-testing")
            : (normalizedResolved && assignedEventCounts.has(normalizedResolved))
              ? normalizedResolved
              : Array.from(assignedEventCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "app-testing";
        setEventKey(assignedEvent);
        if (assignedEvent === "app-testing") {
          const fallback = buildFallbackMatchStrategyMatches();
          setMatchOptions(fallback);
          setSelectedMatchKey(fallback[0]?.key || "");
          return;
        }

        const ourTeamNumber = parseTeamNumber(String(teamData?.teamNumber || teamData?.teamName || userData.teamId));
        setOurTeamNumber(ourTeamNumber > 0 ? String(ourTeamNumber) : "");
        const encryptedKey = String(teamData?.tbaApiKeyEncrypted || "").trim();
        const plainKey = String(teamData?.tbaApiKey || "").trim();
        const attendeesByEvent = (teamData?.eventAttendees || {}) as Record<string, string[]>;
        const matches = await fetchEventMatchesWithTeamAuth(assignedEvent, { encryptedKey, plainKey });
        setEventTbaMatches(matches);
        const completionNow = teamTimeOverride?.enabled ? getEffectiveNowSec(teamTimeOverride) : undefined;
        setModalCompleted(buildCompletedModalIdsFromTba(matches, completionNow));
        const options: MatchOption[] = matches
          .map((match) => {
            const redTeams = match.alliances.red.team_keys
              .map((key) => key.replace("frc", "").trim())
              .filter(Boolean);
            const blueTeams = match.alliances.blue.team_keys
              .map((key) => key.replace("frc", "").trim())
              .filter(Boolean);
            const teams = [...redTeams, ...blueTeams];
            return {
              key: match.key,
              label: labelForMatch(match),
              scheduleTime: match.actual_time || match.predicted_time || match.time || 0,
              teams,
              redTeams,
              blueTeams,
            };
          })
          .sort((a, b) => a.scheduleTime - b.scheduleTime);
        const resolvedOptions = options.length > 0 ? options : buildFallbackMatchStrategyMatches();
        setMatchOptions(resolvedOptions);

        const assignedMatchKeys = new Set(
          assignmentSnap.docs
            .map((row) => row.data() as Record<string, unknown>)
            .filter((row) => String(row.eventKey || "").trim().toLowerCase() === assignedEvent)
            .map((row) => String(row.matchKey || row.matchLabel || "").trim())
            .filter(Boolean)
        );
        const assignedMatches = resolvedOptions.filter(
          (match) => assignedMatchKeys.has(match.key) || assignedMatchKeys.has(match.label)
        );

        const now = getEffectiveNowSec(teamTimeOverride);
        const graceSeconds = 10 * 60;
        const pickNextBySchedule = (rows: MatchOption[]) => {
          const scheduled = rows
            .map((match) => ({ match, time: Number(match.scheduleTime || 0) }))
            .filter((row) => row.time > 0 && row.time >= now - graceSeconds)
            .sort((a, b) => a.time - b.time);
          if (scheduled.length > 0) return scheduled[0]?.match || null;
          return rows
            .slice()
            .sort((a, b) => extractMatchNumber(a) - extractMatchNumber(b))[0] || null;
        };

        const isAttending = assignedMatchKeys.size > 0 || isUserAttendingEvent(attendeesByEvent, assignedEvent, userData);
        let next: MatchOption | null = null;
        if (assignedMatches.length > 0) {
          next = pickNextBySchedule(assignedMatches);
        } else if (!isAttending) {
          next =
            resolvedOptions.find((match) => /_qm1$/i.test(match.key) || /^Q1$/i.test(match.label)) ||
            resolvedOptions.find((match) => /_qm\d+$/i.test(match.key) || /^Q\d+/i.test(match.label)) ||
            resolvedOptions[0] ||
            null;
        } else {
          const teamMatches = ourTeamNumber > 0 ? resolvedOptions.filter((match) => match.teams.includes(String(ourTeamNumber))) : [];
          const teamNext = teamMatches.length > 0 ? pickNextBySchedule(teamMatches) : null;
          next = teamNext || pickNextBySchedule(resolvedOptions) || resolvedOptions[0] || null;
        }
        if (next) {
          setSelectedMatchKey(next.key);
          setRobotTeamDefaults(next, ourTeamNumber > 0 ? String(ourTeamNumber) : "");
        } else {
          setSelectedMatchKey("");
          setRobot1((prev) => ({ ...prev, teamNumber: "" }));
          setRobot2((prev) => ({ ...prev, teamNumber: "" }));
          setRobot3((prev) => ({ ...prev, teamNumber: "" }));
        }
      } catch (error) {
        console.error("Failed to load match strategy context:", error);
        const fallback = buildFallbackMatchStrategyMatches();
        setMatchOptions(fallback);
        setEventTbaMatches([]);
        setModalCompleted(new Set());
        setSelectedMatchKey(fallback[0]?.key || "");
      }
    }

    void loadMatches();
  }, [userData?.teamId, teamTimeOverride?.enabled, teamTimeOverride?.offsetMs]);

  function setRobotTeamDefaults(match: MatchOption, ourTeamNumber: string) {
    if (!match) return;
    const redTeams = match.redTeams && match.redTeams.length > 0 ? match.redTeams : match.teams.slice(0, 3);
    const blueTeams = match.blueTeams && match.blueTeams.length > 0 ? match.blueTeams : match.teams.slice(3, 6);
    let allianceTeams = redTeams.length > 0 ? redTeams : match.teams.slice(0, 3);
    if (ourTeamNumber && blueTeams.includes(ourTeamNumber)) {
      allianceTeams = blueTeams;
    } else if (ourTeamNumber && redTeams.includes(ourTeamNumber)) {
      allianceTeams = redTeams;
    }
    const sorted = ourTeamNumber && allianceTeams.includes(ourTeamNumber)
      ? [ourTeamNumber, ...allianceTeams.filter((team) => team !== ourTeamNumber)]
      : allianceTeams;

    setRobot1((prev) => ({ ...prev, teamNumber: sorted[0] || prev.teamNumber }));
    setRobot2((prev) => ({ ...prev, teamNumber: sorted[1] || prev.teamNumber }));
    setRobot3((prev) => ({ ...prev, teamNumber: sorted[2] || prev.teamNumber }));
  }

  const selectedMatch = useMemo(() => matchOptions.find((match) => match.key === selectedMatchKey) || null, [matchOptions, selectedMatchKey]);
  const selectedTeamNumbers = useMemo(
    () =>
      [robot1.teamNumber, robot2.teamNumber, robot3.teamNumber]
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    [robot1.teamNumber, robot2.teamNumber, robot3.teamNumber]
  );

  useEffect(() => {
    async function loadPitSync() {
      if (!eventKey || selectedTeamNumbers.length === 0) {
        setPitByTeam({});
        return;
      }
      const pitSnap = await getDocs(collection(db, "pitScouting"));
      const relevant = pitSnap.docs
        .map((row) => row.data() as PitCapabilityDoc)
        .filter(
          (row) =>
            String(row.game || "REBUILT").toUpperCase() === "REBUILT" &&
            String(row.eventKey || "").trim() === String(eventKey || "").trim() &&
            selectedTeamNumbers.includes(String(row.teamNumber || "").trim())
        );
      const latestByTeam: Record<string, PitCapabilityDoc> = {};
      relevant.forEach((row) => {
        const team = String(row.teamNumber || "").trim();
        if (!team) return;
        const prev = latestByTeam[team];
        if (!prev || pitDocTime(row) >= pitDocTime(prev)) latestByTeam[team] = row;
      });
      setPitByTeam(latestByTeam);
    }
    void loadPitSync();
  }, [eventKey, selectedTeamNumbers]);

  const pitSyncWarnings = useMemo(() => {
    const warnings: string[] = [];
    [robot1, robot2, robot3].forEach((robot, index) => {
      const team = String(robot.teamNumber || "").trim();
      if (!team) return;
      const pit = pitByTeam[team];
      if (!pit) return;
      if (!canTeamPerformEndgame(robot.endgameClimb, pit)) {
        warnings.push(`Robot ${index + 1} (${team}) planned ${robot.endgameClimb || "climb"} but pit says unavailable.`);
      }
    });
    return warnings;
  }, [pitByTeam, robot1, robot2, robot3]);
  const pitSyncStatusByRobot = useMemo(
    () =>
      [robot1, robot2, robot3].map((robot) => {
        const team = String(robot.teamNumber || "").trim();
        const pit = team ? pitByTeam[team] : undefined;
        const climbConflict = Boolean(team && pit && !canTeamPerformEndgame(robot.endgameClimb, pit));
        return {
          team,
          hasPitSync: Boolean(pit),
          climbConflict,
        };
      }),
    [pitByTeam, robot1, robot2, robot3]
  );
  const modalMatchOptions = useMemo<ModalMatchOption[]>(() => {
    if (eventTbaMatches.length > 0) {
      const sourceById = new Map<string, string>();
      [...eventTbaMatches]
        .sort((a, b) => {
          const aTime = Number(a.actual_time || a.predicted_time || a.time || 0);
          const bTime = Number(b.actual_time || b.predicted_time || b.time || 0);
          if (aTime !== bTime) return aTime - bTime;
          return a.match_number - b.match_number;
        })
        .forEach((match) => {
          const id = mapTbaMatchToModalId(match);
          if (!id || sourceById.has(id)) return;
          sourceById.set(id, String(match.key || id));
        });
      return buildReefscapeModalOptions(eventTbaMatches).map((option) => ({
        ...option,
        sourceKey: sourceById.get(option.id) || option.id,
      }));
    }

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
  }, [eventTbaMatches, matchOptions]);

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

    if (pitSyncWarnings.length > 0) {
      const proceed = window.confirm(`Warning: plan conflicts with pit scouting:\n${pitSyncWarnings.join("\n")}\n\nSubmit anyway?`);
      if (!proceed) return;
    }

    setSaving(true);
    try {
      await addDoc(collection(db, "matchStrategyPlans"), {
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
      alert("Match Strategy Form submitted.");
      if (typeof window !== "undefined") {
        window.location.reload();
      }
    } catch (error) {
      console.error("Failed to submit match strategy form:", error);
      alert("Could not submit form.");
    } finally {
      setSaving(false);
    }
  }

  const robotBlock = (
    title: string,
    robot: RobotPlan,
    setRobot: (value: RobotPlan) => void,
    syncStatus: { team: string; hasPitSync: boolean; climbConflict: boolean }
  ) => (
    <div className="bg-white rounded-xl shadow p-4 space-y-3">
      <h2 className="text-lg font-semibold" style={{ color: "var(--primary-color)" }}>{title}</h2>
      <label className="block text-sm font-medium text-gray-700">Team Number</label>
      <input className="w-full border rounded p-3" value={robot.teamNumber} onChange={(e) => setRobot({ ...robot, teamNumber: e.target.value.replace(/[^\d]/g, "") })} />
      {syncStatus.team && !syncStatus.hasPitSync && (
        <p className="text-xs text-amber-700">No pit form synced for team {syncStatus.team} at this event yet.</p>
      )}

      <label className="block text-sm font-medium text-gray-700">Starting Position</label>
      <select className="w-full border rounded p-3" value={robot.startingPosition} onChange={(e) => setRobot({ ...robot, startingPosition: e.target.value })}>
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

      <label className="flex items-center gap-2"><input type="checkbox" checked={robot.autoClimb} onChange={(e) => setRobot({ ...robot, autoClimb: e.target.checked })} />Auto Climb</label>

      <label className="block text-sm font-medium text-gray-700">Endgame Climb</label>
      <select className="w-full border rounded p-3" value={robot.endgameClimb} onChange={(e) => setRobot({ ...robot, endgameClimb: e.target.value })}>
        <option value="">None</option>
        <option value="level-1">Level 1</option>
        <option value="level-2">Level 2</option>
        <option value="level-3">Level 3</option>
      </select>
      {syncStatus.climbConflict && (
        <p className="text-xs text-red-700">Does not match pit capability for this team: selected climb is unavailable.</p>
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
            <h1 className="text-3xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>Match Strategy Form</h1>
          </div>

          <div className="bg-white rounded-xl shadow p-4 space-y-3">
            <h2 className="text-lg font-semibold" style={{ color: "var(--primary-color)" }}>Information</h2>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-lg font-semibold">Match:</span>
              <span className="text-lg font-semibold" style={{ color: "var(--primary-color)" }}>{displayMatchLabel(selectedMatch)}</span>
              <button type="button" onClick={() => setShowMatchPicker(true)} className="px-2 py-0.5 text-xs rounded text-white" style={{ backgroundColor: "var(--primary-color)" }}>Fix</button>
            </div>
            <div className="text-sm space-y-1">
              {matchOptions.length === 0 && (
                <div className="text-amber-700">No matches with Team {ourTeamNumber || "your team"} were found at this event. Use manual values if needed.</div>
              )}
              <div className="text-green-700">Detected pit form sync is active for this match.</div>
              <div className="text-gray-700">Alerts show up below each robot field.</div>
            </div>
            <label className="block text-sm font-medium text-gray-700">Scout Name</label>
            <input className="w-full border rounded p-3 bg-gray-100 text-gray-600" value={userData?.displayName || ""} disabled />
          </div>

          {robotBlock("Robot 1", robot1, setRobot1, pitSyncStatusByRobot[0])}
          {robotBlock("Robot 2", robot2, setRobot2, pitSyncStatusByRobot[1])}
          {robotBlock("Robot 3", robot3, setRobot3, pitSyncStatusByRobot[2])}

          <button type="submit" disabled={saving || !selectedMatch} className="w-full py-3 rounded text-white font-semibold disabled:opacity-60" style={{ backgroundColor: "var(--primary-color)" }}>
            {saving ? "Submitting..." : "Submit Match Strategy Form"}
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
                placeholder="Strategy notes..."
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
        completed={modalCompleted}
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

export default function MatchStrategyFormPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["lead-strategist"]} formKey="match-strategy-form">
      <MatchStrategyFormContent />
    </ProtectedRoute>
  );
}
