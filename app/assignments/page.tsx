"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import { Trash2, Plus } from "lucide-react";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import DataSourceCredits from "@/app/components/DataSourceCredits";
import { getEventMatches, type TBAMatch } from "@/app/utils/tba-api";
import { getRoleLabel, getUserRoles, normalizeLegacyRole } from "@/app/utils/roles";
import { APP_EVENTS, dedupeEventKeys } from "@/app/utils/events";

interface Assignment {
  id: string;
  eventKey: string;
  matchKey: string;
  matchLabel: string;
  scoutId: string;
  scoutName: string;
  teamNumber: number;
  assignedBy: string;
  assignedAt: number;
}

interface PitAssignment {
  id: string;
  eventKey: string;
  teamNumber: number;
  scoutId: string;
  scoutName: string;
  assignedBy: string;
  assignedAt: number;
}

interface PracticeAssignment {
  id: string;
  eventKey: string;
  practiceMatchId: string;
  matchKey: string;
  matchLabel: string;
  scoutId: string;
  scoutName: string;
  teamNumber: number;
  assignedBy: string;
  assignedAt: number;
}

interface TeamMember {
  uid: string;
  displayName: string;
  role: string;
}

type ScoutWeight = {
  member: TeamMember;
  weightedAccuracy: number;
};

type MatchOption = {
  key: string;
  label: string;
  teams: number[];
  compLevel: TBAMatch["comp_level"];
  matchNumber: number;
  setNumber: number;
  scheduleTime: number;
};

type EventOption = {
  key: string;
  name: string;
  startDate: string;
  endDate: string;
};

type PracticeMatchOption = {
  id: string;
  eventKey: string;
  matchKey: string;
  label: string;
  teams: number[];
  stage: "practice" | "qualification" | "playoff";
  matchNumber: number;
  scheduleTime: number;
  isManual: boolean;
};

type AssignmentMatchChoice = {
  key: string;
  label: string;
  teams: number[];
};

type RandomizeTarget = "match" | "practice";
type RandomizePattern = "rotate-each-match" | "block-5" | "constant";

type RandomizeConfig = {
  target: RandomizeTarget;
  matchCount: number;
  pattern: RandomizePattern;
  scoutIds: string[];
};

function dedupeEventOptionsByName(options: EventOption[]): EventOption[] {
  const byName = new Map<string, EventOption>();
  options.forEach((option) => {
    const nameKey = option.name.trim().toLowerCase();
    if (!nameKey) return;
    const existing = byName.get(nameKey);
    if (!existing) {
      byName.set(nameKey, option);
      return;
    }
    const existingTime = new Date(`${existing.startDate}T12:00:00`).getTime();
    const incomingTime = new Date(`${option.startDate}T12:00:00`).getTime();
    if (incomingTime < existingTime) {
      byName.set(nameKey, option);
    }
  });
  return Array.from(byName.values());
}

function isPastEventOption(event: EventOption) {
  const now = Date.now();
  const end = new Date(`${event.endDate}T23:59:59`).getTime();
  return Number.isFinite(end) && now > end;
}

function sortEventOptions(events: EventOption[]) {
  return [...events].sort((a, b) => {
    const aPast = isPastEventOption(a);
    const bPast = isPastEventOption(b);
    if (aPast !== bPast) return aPast ? 1 : -1;
    const aTime = new Date(`${a.startDate}T12:00:00`).getTime();
    const bTime = new Date(`${b.startDate}T12:00:00`).getTime();
    return aTime - bTime;
  });
}

function compLevelPriority(compLevel: string) {
  if (compLevel === "qm") return 0;
  if (compLevel === "ef") return 1;
  if (compLevel === "qf") return 2;
  if (compLevel === "sf") return 3;
  if (compLevel === "f") return 4;
  return 999;
}

function matchLabel(match: TBAMatch) {
  if (match.comp_level === "qm") return `Qualification ${match.match_number}`;
  if (match.comp_level === "f") return `Finals ${match.match_number}`;
  if (match.comp_level === "sf") return `Semifinal ${match.set_number}-${match.match_number}`;
  if (match.comp_level === "qf") return `Quarterfinal ${match.set_number}-${match.match_number}`;
  if (match.comp_level === "ef") return `Octofinal ${match.set_number}-${match.match_number}`;
  return match.key;
}

function parseTeamNumbers(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "number") return item;
        if (typeof item === "string") return parseInt(item.replace(/[^\d]/g, ""), 10);
        return NaN;
      })
      .filter((item) => Number.isFinite(item) && item > 0);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => parseInt(item.replace(/[^\d]/g, ""), 10))
      .filter((item) => Number.isFinite(item) && item > 0);
  }
  return [];
}

function normalizePracticeStage(rawType: unknown, rawMatchKey: unknown, rawCompLevel: unknown): "practice" | "qualification" | "playoff" {
  const compLevel = String(rawCompLevel || "").toLowerCase().trim();
  if (compLevel === "qm") return "qualification";
  if (compLevel === "qf" || compLevel === "sf" || compLevel === "f") return "playoff";

  const matchKey = String(rawMatchKey || "").toLowerCase().trim();
  if (/_qm\d+/.test(matchKey)) return "qualification";
  if (/_qf\d+m\d+/.test(matchKey) || /_sf\d+m\d+/.test(matchKey) || /_f\d+m\d+/.test(matchKey)) return "playoff";

  const type = String(rawType || "").toLowerCase().trim();
  if (type === "qualification") return "qualification";
  if (type === "playoff" || type === "finals") return "playoff";
  return "practice";
}

function practiceMatchLabel(stage: "practice" | "qualification" | "playoff", matchNumber: number, alliance: string) {
  const prefix = stage === "practice" ? "Practice" : stage === "qualification" ? "Qualification" : "Playoff";
  const allianceLabel = alliance === "red" || alliance === "blue"
    ? `${alliance.charAt(0).toUpperCase()}${alliance.slice(1)} Alliance`
    : "Alliance";
  return `${prefix} ${matchNumber} • ${allianceLabel}`;
}

function isEventPracticeAssignment(row: { matchKey?: string; matchLabel?: string }) {
  const key = String(row.matchKey || "").toLowerCase();
  const label = String(row.matchLabel || "").toLowerCase();
  return key.includes("_pm") || /^p\d+$/.test(key) || label.includes("practice ");
}

function scoreScoutingRecord(record: Record<string, unknown>): number {
  let score = 0;
  if (Boolean(record.leftStartingZone)) score += 3;
  score += Number(record.autoCoralL1 || 0) * 3;
  score += Number(record.autoCoralL2 || 0) * 4;
  score += Number(record.autoCoralL3 || 0) * 6;
  score += Number(record.autoCoralL4 || 0) * 7;
  score += Number(record.autoAlgaeProcessorScored || 0) * 6;
  score += Number(record.autoAlgaeNetScored || 0) * 4;
  score += Number(record.teleopCoralL1 || 0) * 2;
  score += Number(record.teleopCoralL2 || 0) * 3;
  score += Number(record.teleopCoralL3 || 0) * 4;
  score += Number(record.teleopCoralL4 || 0) * 5;
  score += Number(record.teleopProcessorScored || 0) * 6;
  score += Number(record.teleopNetRobotScored || 0) * 4;
  score += Number(record.teleopNetHumanScored || 0) * 4;
  score += Number(record.penaltyPoints || 0);

  const end = String(record.stageStatus || "").toLowerCase();
  if (end.includes("deep")) score += 12;
  else if (end.includes("shallow")) score += 6;
  else if (end.includes("park") || end.includes("barge")) score += 2;
  return score;
}

async function fetchStatboticsEpa(teamNumber: number, year: number): Promise<number> {
  try {
    const response = await fetch(`https://api.statbotics.io/v3/team_year/${teamNumber}/${year}`, { cache: "no-store" });
    if (!response.ok) return 0;
    const payload = (await response.json()) as Record<string, unknown>;
    const norm = payload.norm_epa as Record<string, unknown> | undefined;
    const current = typeof norm?.current === "number" ? norm.current : 0;
    return Number.isFinite(current) ? current : 0;
  } catch (error) {
    console.error(`Unable to load Statbotics EPA for team ${teamNumber}:`, error);
    return 0;
  }
}

async function fetchEventMatchesForAssignments(
  eventKey: string,
  encryptedKey: string,
  plainKey: string
): Promise<TBAMatch[]> {
  const safeEvent = String(eventKey || "").trim();
  if (!safeEvent) return [];

  if (encryptedKey || plainKey) {
    const response = await fetch("/api/tba/matches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventKey: safeEvent, encryptedKey, plainKey }),
    });
    if (response.ok) {
      const payload = (await response.json()) as { matches?: TBAMatch[] };
      if (Array.isArray(payload.matches)) return payload.matches;
    }
  }

  return getEventMatches(safeEvent);
}

function AssignmentsContent() {
  const { userData } = useAuth();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [pitAssignments, setPitAssignments] = useState<PitAssignment[]>([]);
  const [practiceAssignments, setPracticeAssignments] = useState<PracticeAssignment[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [selectedEvent, setSelectedEvent] = useState("");
  const [events, setEvents] = useState<EventOption[]>([]);
  const [practiceEventOptions, setPracticeEventOptions] = useState<EventOption[]>([]);
  const [showPracticeEventPicker, setShowPracticeEventPicker] = useState(false);
  const [practiceEventSearch, setPracticeEventSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [matchOptions, setMatchOptions] = useState<MatchOption[]>([]);
  const [practiceMatchOptions, setPracticeMatchOptions] = useState<PracticeMatchOption[]>([]);
  const [eventAttendees, setEventAttendees] = useState<Record<string, string[]>>({});
  const [manualPriorityTeamsByEvent, setManualPriorityTeamsByEvent] = useState<Record<string, number[]>>({});
  const [manualPriorityTeamsGlobal, setManualPriorityTeamsGlobal] = useState<number[]>([]);

  const [selectedMatchKey, setSelectedMatchKey] = useState("");
  const [selectedScoutId, setSelectedScoutId] = useState("");
  const [selectedTeamNumber, setSelectedTeamNumber] = useState("");
  const [selectedPitScoutId, setSelectedPitScoutId] = useState("");
  const [selectedPitTeamNumber, setSelectedPitTeamNumber] = useState("");
  const [selectedMatchType, setSelectedMatchType] = useState<"practice" | "qualification" | "finals">("qualification");
  const [assignmentModalMode, setAssignmentModalMode] = useState<"match" | "pit" | "practice">("match");
  const [selectedPracticeEventKey, setSelectedPracticeEventKey] = useState("");
  const [selectedPracticeMatchNumber, setSelectedPracticeMatchNumber] = useState("");
  const [selectedPracticeScoutId, setSelectedPracticeScoutId] = useState("");
  const [selectedPracticeTeamNumber, setSelectedPracticeTeamNumber] = useState("");
  const [scheduleView, setScheduleView] = useState<"practice" | "match">("match");
  const [assignmentView, setAssignmentView] = useState<"practice" | "match" | "pit">("match");
  const [showRandomizeModal, setShowRandomizeModal] = useState(false);
  const [randomizeTarget, setRandomizeTarget] = useState<RandomizeTarget>("match");
  const [randomizeMatchCount, setRandomizeMatchCount] = useState("");
  const [randomizePattern, setRandomizePattern] = useState<RandomizePattern>("rotate-each-match");
  const [randomizeScoutIds, setRandomizeScoutIds] = useState<string[]>([]);

  useEffect(() => {
    void loadData();
  }, [selectedEvent, userData?.teamId]);

  async function resolveEventOptions(teamData: Record<string, unknown>): Promise<EventOption[]> {
    const selected = Array.isArray(teamData.selectedEvents)
      ? dedupeEventKeys(teamData.selectedEvents.map((value) => String(value || "").trim()).filter(Boolean))
      : [];
    const fallbackFromApp = APP_EVENTS.map((event) => ({
      key: event.key,
      name: event.name,
      startDate: event.startDate,
      endDate: event.endDate,
    }));
    if (selected.length === 0) return sortEventOptions(fallbackFromApp);

    const encryptedKey = typeof teamData.tbaApiKeyEncrypted === "string" ? teamData.tbaApiKeyEncrypted.trim() : "";
    const plainKey = typeof teamData.tbaApiKey === "string" ? teamData.tbaApiKey.trim() : "";
    const fromTba = new Map<string, EventOption>();
    if (encryptedKey || plainKey) {
      const years = new Set<number>();
      selected.forEach((eventKey) => {
        const year = Number(eventKey.slice(0, 4));
        if (Number.isFinite(year)) years.add(year);
      });
      if (years.size === 0) years.add(new Date().getFullYear());

      const responses = await Promise.all(
        Array.from(years).map(async (year) => {
          const response = await fetch("/api/tba/events", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ year, encryptedKey, plainKey }),
          });
          if (!response.ok) return [] as Array<Record<string, unknown>>;
          const payload = await response.json();
          return Array.isArray(payload.events) ? (payload.events as Array<Record<string, unknown>>) : [];
        })
      );

      responses.flat().forEach((event) => {
        const key = String(event.key || "").trim();
        if (!key || !selected.includes(key)) return;
        fromTba.set(key, {
          key,
          name: String(event.name || key),
          startDate: String(event.start_date || `${new Date().getFullYear()}-01-01`),
          endDate: String(event.end_date || event.start_date || `${new Date().getFullYear()}-01-01`),
        });
      });
    }

    const staticByKey = new Map(fallbackFromApp.map((event) => [event.key, event]));
    const resolved = selected
      .map((key) => fromTba.get(key) || staticByKey.get(key) || {
        key,
        name: key,
        startDate: `${new Date().getFullYear()}-01-01`,
        endDate: `${new Date().getFullYear()}-01-01`,
      });
    return sortEventOptions(dedupeEventOptionsByName(resolved));
  }

  async function loadData() {
    if (!userData?.teamId) return;
    setLoading(true);
    try {
      const [membersSnap, teamDoc] = await Promise.all([
        getDocs(query(collection(db, "users"), where("teamId", "==", userData.teamId))),
        getDoc(doc(db, "teams", userData.teamId)),
      ]);
      setMembers(membersSnap.docs.map((memberDoc) => ({ uid: memberDoc.id, ...memberDoc.data() } as TeamMember)));
      const teamData = teamDoc.exists() ? teamDoc.data() : {};
      setEventAttendees(teamData.eventAttendees || {});
      const encryptedKey = typeof teamData.tbaApiKeyEncrypted === "string" ? teamData.tbaApiKeyEncrypted.trim() : "";
      const plainKey = typeof teamData.tbaApiKey === "string" ? teamData.tbaApiKey.trim() : "";
      const signedEventKeys = Array.isArray(teamData.selectedEvents)
        ? dedupeEventKeys(teamData.selectedEvents.map((value) => String(value || "").trim()).filter(Boolean))
        : [];
      const resolvedEvents = await resolveEventOptions(teamData);
      setEvents(resolvedEvents);
      const fallbackFromApp = APP_EVENTS.map((event) => ({
        key: event.key,
        name: event.name,
        startDate: event.startDate,
        endDate: event.endDate,
      }));
      let practiceUniverse = [...fallbackFromApp];
      if (encryptedKey || plainKey) {
        const years = new Set<number>();
        years.add(new Date().getFullYear());
        signedEventKeys.forEach((eventKey) => {
          const year = Number(String(eventKey || "").slice(0, 4));
          if (Number.isFinite(year)) years.add(year);
        });
        const tbaResponses = await Promise.all(
          Array.from(years).map(async (year) => {
            const response = await fetch("/api/tba/events", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ year, encryptedKey, plainKey }),
            });
            if (!response.ok) return [] as Array<Record<string, unknown>>;
            const payload = (await response.json()) as { events?: Array<Record<string, unknown>> };
            return Array.isArray(payload.events) ? payload.events : [];
          })
        );
        const tbaOptions = tbaResponses.flat().map((event) => ({
          key: String(event.key || "").trim(),
          name: String(event.name || event.key || "").trim(),
          startDate: String(event.start_date || `${new Date().getFullYear()}-01-01`),
          endDate: String(event.end_date || event.start_date || `${new Date().getFullYear()}-01-01`),
        })).filter((event) => Boolean(event.key));
        if (tbaOptions.length > 0) {
          practiceUniverse = dedupeEventOptionsByName([...practiceUniverse, ...tbaOptions]);
        }
      }
      const availablePracticeEvents = sortEventOptions(
        dedupeEventOptionsByName(practiceUniverse.filter((event) => !signedEventKeys.includes(event.key)))
      );
      setPracticeEventOptions(availablePracticeEvents);
      const effectiveEvent = resolvedEvents.some((event) => event.key === selectedEvent)
        ? selectedEvent
        : (resolvedEvents[0]?.key || "");
      if (!selectedEvent || effectiveEvent !== selectedEvent) {
        setSelectedEvent(effectiveEvent);
      }
      if (!selectedPracticeEventKey || !availablePracticeEvents.some((event) => event.key === selectedPracticeEventKey)) {
        setSelectedPracticeEventKey(availablePracticeEvents[0]?.key || "");
      }
      if (!effectiveEvent) {
        setAssignments([]);
        setPitAssignments([]);
        setPracticeAssignments([]);
        setMatchOptions([]);
        setPracticeMatchOptions([]);
        return;
      }

      const [assignmentsSnap, pitAssignmentsSnap, practiceMatchesSnap] = await Promise.all([
        getDocs(query(collection(db, "matchAssignments"), where("eventKey", "==", effectiveEvent))),
        getDocs(query(collection(db, "pitAssignments"), where("eventKey", "==", effectiveEvent))),
        getDocs(query(collection(db, "practiceMatches"), where("eventKey", "==", effectiveEvent))),
      ]);
      let practiceAssignmentsDocs = [] as Array<{ id: string; data: Record<string, unknown> }>;
      try {
        const byTeamSnap = await getDocs(query(collection(db, "practiceAssignments"), where("teamId", "==", userData.teamId)));
        practiceAssignmentsDocs = byTeamSnap.docs.map((assignmentDoc) => ({
          id: assignmentDoc.id,
          data: assignmentDoc.data() as Record<string, unknown>,
        }));
      } catch {
        const byEventSnap = await getDocs(query(collection(db, "practiceAssignments"), where("eventKey", "==", effectiveEvent)));
        practiceAssignmentsDocs = byEventSnap.docs.map((assignmentDoc) => ({
          id: assignmentDoc.id,
          data: assignmentDoc.data() as Record<string, unknown>,
        }));
      }
      setAssignments(
        assignmentsSnap.docs.map((assignmentDoc) => ({
          id: assignmentDoc.id,
          ...assignmentDoc.data(),
        })) as Assignment[]
      );
      setPitAssignments(
        pitAssignmentsSnap.docs.map((assignmentDoc) => ({
          id: assignmentDoc.id,
          ...assignmentDoc.data(),
        })) as PitAssignment[]
      );
      setPracticeAssignments(
        practiceAssignmentsDocs.map((row) => ({
          id: row.id,
          ...row.data,
        })) as PracticeAssignment[]
      );

      const practiceOptions = practiceMatchesSnap.docs
        .map((practiceDoc) => {
          const data = practiceDoc.data() as Record<string, unknown>;
          const stage = normalizePracticeStage(data.matchType, data.matchKey, data.compLevel);
          const matchNumber = Number(data.matchNumber || 0);
          const scheduleTime = Number(data.scheduleTime || data.time || 0);
          const alliance = String(data.alliance || "").trim().toLowerCase();
          const teams = parseTeamNumbers(
            data.allianceTeams || data.teams || data.teamNumbers || data.redAllianceTeams || data.blueAllianceTeams
          ).slice(0, 3);
          return {
            id: practiceDoc.id,
            eventKey: effectiveEvent,
            matchKey: String(data.matchKey || practiceDoc.id),
            label: practiceMatchLabel(stage, matchNumber, alliance),
            teams,
            stage,
            matchNumber,
            scheduleTime: Number.isFinite(scheduleTime) ? scheduleTime : 0,
            isManual: Boolean(data.manualGenerated),
          } as PracticeMatchOption;
        })
        .filter((row) => row.teams.length >= 3 && row.matchNumber > 0)
        .sort((a, b) => {
          const stageOrder = a.stage === "practice" ? 0 : a.stage === "qualification" ? 1 : 2;
          const otherStageOrder = b.stage === "practice" ? 0 : b.stage === "qualification" ? 1 : 2;
          if (stageOrder !== otherStageOrder) return stageOrder - otherStageOrder;
          if (a.matchNumber !== b.matchNumber) return a.matchNumber - b.matchNumber;
          return a.id.localeCompare(b.id);
        });
      setPracticeMatchOptions(practiceOptions);
      const priorityByEventRaw = (
        teamData.priorityTeamsByEvent ||
        teamData.assignmentPriorityTeamsByEvent ||
        teamData.eventPriorityTeams ||
        {}
      ) as Record<string, unknown>;
      const normalizedByEvent: Record<string, number[]> = {};
      Object.entries(priorityByEventRaw).forEach(([eventKey, teamList]) => {
        normalizedByEvent[eventKey] = parseTeamNumbers(teamList);
      });
      setManualPriorityTeamsByEvent(normalizedByEvent);
      setManualPriorityTeamsGlobal(
        parseTeamNumbers(teamData.priorityTeams || teamData.assignmentPriorityTeams || teamData.priorityTeamNumbers || [])
      );

      try {
        const matches = await fetchEventMatchesForAssignments(effectiveEvent, encryptedKey, plainKey);
        const sorted = [...matches].sort((a, b) => {
          const priorityDiff = compLevelPriority(a.comp_level) - compLevelPriority(b.comp_level);
          if (priorityDiff !== 0) return priorityDiff;
          if (a.set_number !== b.set_number) return a.set_number - b.set_number;
          return a.match_number - b.match_number;
        });

        const options = sorted.map((match) => ({
          key: match.key,
          label: matchLabel(match),
          teams: [...match.alliances.red.team_keys, ...match.alliances.blue.team_keys]
            .map((teamKey) => parseInt(teamKey.replace("frc", ""), 10))
            .filter((teamNumber) => !Number.isNaN(teamNumber)),
          compLevel: match.comp_level,
          matchNumber: match.match_number,
          setNumber: match.set_number,
          scheduleTime: match.actual_time || match.predicted_time || match.time || 0,
        }));
        setMatchOptions(options);
      } catch (error) {
        console.error("Unable to fetch TBA matches for assignments:", error);
        setMatchOptions([]);
      }
    } catch (error) {
      console.error("Error loading data:", error);
    } finally {
      setLoading(false);
    }
  }

  const eventTeamOptions = useMemo(
    () => Array.from(new Set(matchOptions.flatMap((match) => match.teams))).sort((a, b) => a - b),
    [matchOptions]
  );
  const eventPracticeMatches = useMemo(
    () => practiceMatchOptions.filter((match) => match.stage === "practice"),
    [practiceMatchOptions]
  );
  const typeFilteredMatches = useMemo<AssignmentMatchChoice[]>(() => {
    if (selectedMatchType === "practice") {
      return eventPracticeMatches
        .slice()
        .sort((a, b) => a.matchNumber - b.matchNumber)
        .map((match) => ({
          key: `p${match.matchNumber}`,
          label: `Practice ${match.matchNumber}`,
          teams: match.teams.length > 0 ? match.teams : eventTeamOptions,
        }));
    }
    if (selectedMatchType === "qualification") {
      return matchOptions
        .filter((match) => match.compLevel === "qm")
        .map((match) => ({ key: match.key, label: match.label, teams: match.teams }));
    }
    return matchOptions
      .filter((match) => match.compLevel !== "qm")
      .map((match) => ({ key: match.key, label: match.label, teams: match.teams }));
  }, [eventPracticeMatches, eventTeamOptions, matchOptions, selectedMatchType]);
  const selectedMatch = useMemo(
    () => typeFilteredMatches.find((match) => match.key === selectedMatchKey) || null,
    [typeFilteredMatches, selectedMatchKey]
  );
  const activeOrNextMatchKey = useMemo(() => {
    const now = Date.now() / 1000;
    const timedMatches = [...matchOptions]
      .filter((match) => match.scheduleTime > 0)
      .sort((a, b) => a.scheduleTime - b.scheduleTime);
    if (timedMatches.length === 0) return "";
    const active = timedMatches.find((match) => now >= match.scheduleTime && now <= match.scheduleTime + 8 * 60);
    if (active) return active.key;
    const next = timedMatches.find((match) => match.scheduleTime >= now);
    return next?.key || timedMatches[timedMatches.length - 1].key;
  }, [matchOptions]);
  const pitTeamOptions = useMemo(() => {
    const teams = [...eventTeamOptions];
    const assigned = new Set(pitAssignments.map((assignment) => assignment.teamNumber));
    return teams.filter((teamNumber) => !assigned.has(teamNumber));
  }, [eventTeamOptions, pitAssignments]);

  const randomizeEligibleMembers = useMemo(() => {
    const attendeeKeys = eventAttendees[selectedEvent] || [];
    const attendeeMembers = members.filter(
      (member) => attendeeKeys.includes(member.uid) || attendeeKeys.includes(member.displayName)
    );
    const sourceMembers = attendeeMembers.length > 0 ? attendeeMembers : members;
    return sourceMembers.filter((member) => {
      if (!member.displayName.trim()) return false;
      const roles = getUserRoles({ role: member.role });
      return roles.includes("match-scout") || roles.includes("media") || roles.includes("lead-scout");
    });
  }, [eventAttendees, members, selectedEvent]);

  function openRandomizeConfig(target: RandomizeTarget) {
    setRandomizeTarget(target);
    setRandomizeMatchCount("");
    setRandomizePattern("rotate-each-match");
    setRandomizeScoutIds(randomizeEligibleMembers.map((member) => member.uid));
    setShowRandomizeModal(true);
  }

  function toggleRandomizeScout(uid: string) {
    setRandomizeScoutIds((prev) => (prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]));
  }

  function presetRandomizeScoutsByRoles(roleKeys: Array<"match-scout" | "media" | "lead-scout">) {
    const next = randomizeEligibleMembers
      .filter((member) => {
        const roles = getUserRoles({ role: member.role });
        return roleKeys.some((role) => roles.includes(role));
      })
      .map((member) => member.uid);
    setRandomizeScoutIds(next);
  }

  function computeTeamPriorityOrder(
    teams: number[],
    manualPriorityTeams: number[],
    historyMap: Map<number, { total: number; count: number }>,
    statboticsMap: Map<number, number>
  ): number[] {
    const manualTeams = teams.filter((teamNumber) => manualPriorityTeams.includes(teamNumber));
    const remainingAfterManual = teams.filter((teamNumber) => !manualTeams.includes(teamNumber));
    const withHistory = [...remainingAfterManual].filter((teamNumber) => historyMap.has(teamNumber));
    withHistory.sort((a, b) => {
      const aRow = historyMap.get(a)!;
      const bRow = historyMap.get(b)!;
      return bRow.total / Math.max(1, bRow.count) - aRow.total / Math.max(1, aRow.count);
    });
    const remainingAfterHistory = remainingAfterManual.filter((teamNumber) => !withHistory.includes(teamNumber));
    const withStatbotics = [...remainingAfterHistory].filter((teamNumber) => statboticsMap.has(teamNumber));
    withStatbotics.sort((a, b) => (statboticsMap.get(b) || 0) - (statboticsMap.get(a) || 0));
    const finalRemaining = remainingAfterHistory.filter((teamNumber) => !withStatbotics.includes(teamNumber));
    return [...manualTeams, ...withHistory, ...withStatbotics, ...finalRemaining];
  }

  async function buildPerformanceMapsForTeams(allTeams: number[], year: number, eventKey: string) {
    const historyMap = new Map<number, { total: number; count: number }>();
    const statboticsMap = new Map<number, number>();
    if (allTeams.length === 0) return { historyMap, statboticsMap };

    const scoutingSnap = await getDocs(query(collection(db, "scouting"), where("eventKey", "==", eventKey)));
    scoutingSnap.forEach((entryDoc) => {
      const row = entryDoc.data() as Record<string, unknown>;
      const parsedTeamNumber = parseInt(String(row.teamNumber || "").replace(/[^\d]/g, ""), 10);
      if (!Number.isFinite(parsedTeamNumber) || !allTeams.includes(parsedTeamNumber)) return;
      const matchType = String(row.matchType || "").toLowerCase();
      const practiceMode = String(row.practiceMode || "").toLowerCase();
      if (matchType === "practice" || Boolean(row.isPracticeScouting) || practiceMode === "trial" || practiceMode === "competitive") {
        return;
      }
      const score = scoreScoutingRecord(row);
      if (!historyMap.has(parsedTeamNumber)) {
        historyMap.set(parsedTeamNumber, { total: 0, count: 0 });
      }
      const existing = historyMap.get(parsedTeamNumber)!;
      existing.total += score;
      existing.count += 1;
    });

    const missingHistoryTeams = allTeams.filter((team) => !historyMap.has(team));
    const statboticsEntries = await Promise.all(
      missingHistoryTeams.map(async (teamNumber) => [teamNumber, await fetchStatboticsEpa(teamNumber, year)] as const)
    );
    statboticsEntries.forEach(([teamNumber, epa]) => {
      statboticsMap.set(teamNumber, epa);
    });
    return { historyMap, statboticsMap };
  }

  function pickScoutForSlot(
    scouts: TeamMember[],
    matchIndex: number,
    teamIndex: number,
    pattern: RandomizePattern
  ): TeamMember | null {
    if (scouts.length === 0) return null;
    const offset =
      pattern === "constant" ? 0 : pattern === "block-5" ? Math.floor(matchIndex / 5) : matchIndex;
    return scouts[(offset + teamIndex) % scouts.length] || null;
  }

  async function generateManualPracticeMatches() {
    if (!userData || !selectedEvent) return;
    const response = window.prompt(
      "No event practice matches were detected. How many event practice matches should be created?",
      "20"
    );
    if (response === null) return;
    const count = Math.max(1, Math.min(150, parseInt(response.replace(/[^\d]/g, ""), 10) || 0));
    if (!count) {
      alert("Enter a valid number of practice matches.");
      return;
    }

    try {
      const now = Date.now();
      await Promise.all(
        Array.from({ length: count }, (_, index) => {
          const matchNumber = index + 1;
          const docId = `manual_${selectedEvent}_practice_${matchNumber}`;
          return setDoc(
            doc(db, "practiceMatches", docId),
            {
              eventKey: selectedEvent,
              matchNumber,
              matchType: "practice",
              matchKey: `${selectedEvent}_pm${matchNumber}`,
              alliance: "",
              allianceTeams: [],
              teams: [],
              scheduleTime: 0,
              manualGenerated: true,
              generatedBy: userData.uid,
              generatedAt: now,
            },
            { merge: true }
          );
        })
      );
      await loadData();
      setSelectedMatchType("practice");
      setSelectedMatchKey("");
      setSelectedTeamNumber("");
    } catch (error) {
      console.error("Error generating manual event practice matches:", error);
      alert("Could not generate manual practice matches.");
    }
  }

  async function selectMatchType(type: "practice" | "qualification" | "finals") {
    if (type === "practice" && eventPracticeMatches.length === 0) {
      await generateManualPracticeMatches();
      return;
    }
    setSelectedMatchType(type);
    setSelectedMatchKey("");
    setSelectedTeamNumber("");
  }

  async function createAssignment() {
    if (!userData || !selectedMatch || !selectedScoutId || !selectedTeamNumber) return;
    const scout = members.find((member) => member.uid === selectedScoutId);
    if (!scout) return;

    try {
      await addDoc(collection(db, "matchAssignments"), {
        eventKey: selectedEvent,
        matchKey: selectedMatch.key,
        matchLabel: selectedMatch.label,
        scoutId: selectedScoutId,
        scoutName: scout.displayName,
        teamNumber: parseInt(selectedTeamNumber, 10),
        assignedBy: userData.uid,
        assignedAt: Date.now(),
      });
      setSelectedMatchKey("");
      setSelectedScoutId("");
      setSelectedTeamNumber("");
      setSelectedMatchType("qualification");
      setShowAssignModal(false);
      await loadData();
    } catch (error) {
      console.error("Error creating assignment:", error);
      alert("Error creating assignment");
    }
  }

  async function createPitAssignment() {
    if (!userData || !selectedPitScoutId || !selectedPitTeamNumber) return;
    const scout = members.find((member) => member.uid === selectedPitScoutId);
    if (!scout) return;
    const teamNumber = parseInt(selectedPitTeamNumber, 10);
    if (!Number.isFinite(teamNumber)) return;
    if (pitAssignments.some((assignment) => assignment.teamNumber === teamNumber)) {
      alert("That team already has a pit scout assignment.");
      return;
    }

    try {
      await addDoc(collection(db, "pitAssignments"), {
        eventKey: selectedEvent,
        teamNumber,
        scoutId: selectedPitScoutId,
        scoutName: scout.displayName,
        assignedBy: userData.uid,
        assignedAt: Date.now(),
      });
      setSelectedPitScoutId("");
      setSelectedPitTeamNumber("");
      setShowAssignModal(false);
      await loadData();
    } catch (error) {
      console.error("Error creating pit assignment:", error);
      alert("Error creating pit assignment");
    }
  }

  async function deleteAssignment(id: string) {
    if (!confirm("Are you sure you want to delete this assignment?")) return;
    try {
      await deleteDoc(doc(db, "matchAssignments", id));
      await loadData();
    } catch (error) {
      console.error("Error deleting assignment:", error);
      alert("Error deleting assignment");
    }
  }

  async function deletePitAssignment(id: string) {
    if (!confirm("Delete this pit assignment?")) return;
    try {
      await deleteDoc(doc(db, "pitAssignments", id));
      await loadData();
    } catch (error) {
      console.error("Error deleting pit assignment:", error);
      alert("Error deleting pit assignment");
    }
  }

  async function deletePracticeAssignment(id: string) {
    if (!confirm("Delete this practice assignment?")) return;
    try {
      await deleteDoc(doc(db, "practiceAssignments", id));
      await loadData();
    } catch (error) {
      console.error("Error deleting practice assignment:", error);
      alert("Error deleting practice assignment");
    }
  }

  async function randomizeAllAssignments(config?: RandomizeConfig) {
    if (!userData || !selectedEvent) return;
    const nowSec = Math.floor(Date.now() / 1000);
    const allQualificationMatches = matchOptions.filter((match) => match.compLevel === "qm");
    const upcomingQualificationMatches = allQualificationMatches.filter(
      (match) => match.scheduleTime <= 0 || match.scheduleTime + 8 * 60 >= nowSec
    );
    const qualificationMatchesBase = upcomingQualificationMatches.length > 0 ? upcomingQualificationMatches : allQualificationMatches;
    const requestedMatchCount = Math.max(0, Number(config?.matchCount || 0));
    const qualificationMatches =
      requestedMatchCount > 0 ? qualificationMatchesBase.slice(0, requestedMatchCount) : qualificationMatchesBase;
    if (qualificationMatches.length === 0) {
      alert("No qualification matches available to randomize.");
      return;
    }

    const selectedScoutIds = new Set(config?.scoutIds || []);
    const eligibleMembers = randomizeEligibleMembers.filter(
      (member) => selectedScoutIds.size === 0 || selectedScoutIds.has(member.uid)
    );
    if (eligibleMembers.length === 0) {
      alert("No eligible scout-role members available to assign.");
      return;
    }

    if (!confirm("Randomize selected qualification assignments for this event? Existing assignments will be replaced.")) return;

    try {
      const existing = assignments.filter((assignment) => assignment.eventKey === selectedEvent);
      await Promise.all(existing.map((assignment) => deleteDoc(doc(db, "matchAssignments", assignment.id))));

      const newAssignments: Array<Omit<Assignment, "id">> = [];
      const lowScoutMode = eligibleMembers.length < 6;
      const scoutWeights: ScoutWeight[] = await Promise.all(
        eligibleMembers.map(async (member) => {
          const [competitionEntries, trialSessions] = await Promise.all([
            getDocs(query(collection(db, "scouting"), where("scoutName", "==", member.displayName))),
            getDocs(
              query(
                collection(db, "practiceSessions"),
                where("scoutName", "==", member.displayName),
                where("mode", "==", "trial")
              )
            ),
          ]);

          const competitionAccuracies = competitionEntries.docs
            .map((entryDoc) => entryDoc.data() as Record<string, unknown>)
            .filter((row) => {
              const matchType = String(row.matchType || "").toLowerCase();
              const practiceMode = String(row.practiceMode || "").toLowerCase();
              return (
                typeof row.accuracy === "number" &&
                matchType !== "practice" &&
                !Boolean(row.isPracticeScouting) &&
                practiceMode !== "trial" &&
                practiceMode !== "competitive"
              );
            })
            .map((row) => Number(row.accuracy || 0))
            .filter((value) => Number.isFinite(value) && value > 0);
          const trialAccuracies = trialSessions.docs
            .map((sessionDoc) => Number((sessionDoc.data() as Record<string, unknown>).accuracy || 0))
            .filter((value) => Number.isFinite(value) && value > 0);

          const compAvg =
            competitionAccuracies.length > 0
              ? competitionAccuracies.reduce((sum, value) => sum + value, 0) / competitionAccuracies.length
              : null;
          const trialAvg =
            trialAccuracies.length > 0 ? trialAccuracies.reduce((sum, value) => sum + value, 0) / trialAccuracies.length : null;

          let weightedAccuracy = 50;
          if (compAvg !== null && trialAvg !== null) weightedAccuracy = compAvg * 0.8 + trialAvg * 0.2;
          else if (compAvg !== null) weightedAccuracy = compAvg;
          else if (trialAvg !== null) weightedAccuracy = trialAvg;

          return { member, weightedAccuracy };
        })
      );

      const scoutsByAccuracy = [...scoutWeights]
        .sort((a, b) => b.weightedAccuracy - a.weightedAccuracy)
        .map((row) => row.member);
      const scoutOrder = lowScoutMode ? scoutsByAccuracy : [...eligibleMembers];
      const allQualificationTeams = Array.from(
        new Set(qualificationMatches.flatMap((match) => match.teams).filter((team) => Number.isFinite(team)))
      );
      const yearFromEvent = parseInt(selectedEvent.slice(0, 4), 10) || new Date().getFullYear();
      const manualPriorityTeams = Array.from(
        new Set([...(manualPriorityTeamsByEvent[selectedEvent] || []), ...manualPriorityTeamsGlobal])
      );
      const { historyMap, statboticsMap } = lowScoutMode
        ? await buildPerformanceMapsForTeams(allQualificationTeams, yearFromEvent, selectedEvent)
        : { historyMap: new Map<number, { total: number; count: number }>(), statboticsMap: new Map<number, number>() };

      qualificationMatches.forEach((match, matchIndex) => {
        const rankedTeams = lowScoutMode
          ? computeTeamPriorityOrder(match.teams, manualPriorityTeams, historyMap, statboticsMap)
          : [...match.teams];
        const teamsToAssign = lowScoutMode ? rankedTeams.slice(0, scoutOrder.length) : rankedTeams;
        teamsToAssign.forEach((teamNumber, teamIndex) => {
          const scout = pickScoutForSlot(scoutOrder, matchIndex, teamIndex, config?.pattern || "rotate-each-match");
          if (!scout) return;
          newAssignments.push({
            eventKey: selectedEvent,
            matchKey: match.key,
            matchLabel: match.label,
            scoutId: scout.uid,
            scoutName: scout.displayName,
            teamNumber,
            assignedBy: userData.uid,
            assignedAt: Date.now(),
          });
        });
      });

      await Promise.all(newAssignments.map((assignment) => addDoc(collection(db, "matchAssignments"), assignment)));
      await loadData();
      alert(`Randomized ${newAssignments.length} assignments across ${qualificationMatches.length} matches.`);
    } catch (error) {
      console.error("Error randomizing assignments:", error);
      alert("Error randomizing assignments.");
    }
  }

  async function randomizePracticeAssignments(config?: RandomizeConfig) {
    if (!userData || !selectedEvent) return;
    const allPracticeMatches = practiceMatchOptions.filter((match) => match.stage === "practice");
    const requestedMatchCount = Math.max(0, Number(config?.matchCount || 0));
    const targetMatches = requestedMatchCount > 0 ? allPracticeMatches.slice(0, requestedMatchCount) : allPracticeMatches;
    if (targetMatches.length === 0) {
      alert("No practice matches available to randomize.");
      return;
    }

    const selectedScoutIds = new Set(config?.scoutIds || []);
    const eligibleMembers = randomizeEligibleMembers.filter(
      (member) => selectedScoutIds.size === 0 || selectedScoutIds.has(member.uid)
    );
    if (eligibleMembers.length === 0) {
      alert("No eligible scout-role members available to assign.");
      return;
    }

    if (!confirm("Randomize event practice match assignments for this event? Existing event-practice match assignments will be replaced.")) return;

    try {
      const existing = assignments.filter(
        (assignment) => assignment.eventKey === selectedEvent && isEventPracticeAssignment(assignment)
      );
      await Promise.all(existing.map((assignment) => deleteDoc(doc(db, "matchAssignments", assignment.id))));

      const manualPriorityTeams = Array.from(
        new Set([...(manualPriorityTeamsByEvent[selectedEvent] || []), ...manualPriorityTeamsGlobal])
      );

      const lowScoutMode = eligibleMembers.length < 6;
      const yearFromEvent = parseInt(selectedEvent.slice(0, 4), 10) || new Date().getFullYear();
      const allPracticeTeams = Array.from(new Set(targetMatches.flatMap((match) => match.teams))).filter((team) => Number.isFinite(team));
      const { historyMap, statboticsMap } = lowScoutMode
        ? await buildPerformanceMapsForTeams(allPracticeTeams, yearFromEvent, selectedEvent)
        : { historyMap: new Map<number, { total: number; count: number }>(), statboticsMap: new Map<number, number>() };
      const scoutOrder = [...eligibleMembers];
      const now = Date.now();
      const newAssignments: Array<Omit<Assignment, "id">> = [];

      targetMatches.forEach((match, matchIndex) => {
        const sourceTeams = match.teams.length > 0 ? match.teams : eventTeamOptions;
        const teamOrder = computeTeamPriorityOrder(sourceTeams, manualPriorityTeams, historyMap, statboticsMap);
        const teamsToAssign = lowScoutMode ? teamOrder.slice(0, scoutOrder.length) : teamOrder;

        teamsToAssign.forEach((teamNumber, teamIndex) => {
          const scout = pickScoutForSlot(scoutOrder, matchIndex, teamIndex, config?.pattern || "rotate-each-match");
          if (!scout) return;
          newAssignments.push({
            eventKey: selectedEvent,
            matchKey: `p${match.matchNumber}`,
            matchLabel: `Practice ${match.matchNumber}`,
            scoutId: scout.uid,
            scoutName: scout.displayName,
            teamNumber,
            assignedBy: userData.uid,
            assignedAt: now + matchIndex,
          });
        });
      });

      await Promise.all(newAssignments.map((assignment) => addDoc(collection(db, "matchAssignments"), assignment)));
      await loadData();
      alert(`Randomized ${newAssignments.length} event-practice match assignments across ${targetMatches.length} practice matches.`);
    } catch (error) {
      console.error("Error randomizing practice assignments:", error);
      alert("Error randomizing practice assignments.");
    }
  }

  function toggleAttendee(member: TeamMember) {
    const current = eventAttendees[selectedEvent] || [];
    const hasMember = current.includes(member.uid) || current.includes(member.displayName);
    const cleaned = current.filter((value) => value !== member.displayName);
    const updated = hasMember ? cleaned.filter((value) => value !== member.uid) : [...cleaned, member.uid];
    setEventAttendees((prev) => ({ ...prev, [selectedEvent]: updated }));
  }

  async function saveAttendees() {
    if (!userData?.teamId) return;
    try {
      await setDoc(doc(db, "teams", userData.teamId), { eventAttendees }, { merge: true });
      alert("Event attendees saved.");
    } catch (error) {
      console.error("Error saving attendees:", error);
      alert("Could not save attendees.");
    }
  }

  async function runRandomizeFromConfig() {
    const selectedCount = randomizeScoutIds.length;
    if (selectedCount === 0) {
      alert("Select at least one scout.");
      return;
    }
    const matchCount = Math.max(0, parseInt(randomizeMatchCount.replace(/[^\d]/g, ""), 10) || 0);
    const config: RandomizeConfig = {
      target: randomizeTarget,
      matchCount,
      pattern: randomizePattern,
      scoutIds: randomizeScoutIds,
    };
    setShowRandomizeModal(false);
    if (config.target === "practice") {
      await randomizePracticeAssignments(config);
      return;
    }
    await randomizeAllAssignments(config);
  }

  async function createPracticeScoutAssignment() {
    if (!userData || !selectedPracticeScoutId || !selectedPracticeEventKey || !selectedPracticeMatchNumber || !selectedPracticeTeamNumber) return;
    const scout = members.find((member) => member.uid === selectedPracticeScoutId);
    if (!scout) return;
    const matchNumber = parseInt(selectedPracticeMatchNumber, 10);
    const teamNumber = parseInt(selectedPracticeTeamNumber, 10);
    if (!Number.isFinite(matchNumber) || matchNumber <= 0) return;
    if (!Number.isFinite(teamNumber) || teamNumber <= 0) return;

    try {
      await addDoc(collection(db, "practiceAssignments"), {
        teamId: userData.teamId || "",
        eventKey: selectedPracticeEventKey,
        practiceMatchId: `practice_${selectedPracticeEventKey}_${matchNumber}`,
        matchKey: `p${matchNumber}`,
        matchLabel: `Practice ${matchNumber}`,
        scoutId: selectedPracticeScoutId,
        scoutName: scout.displayName,
        teamNumber,
        assignedBy: userData.uid,
        assignedAt: Date.now(),
      });
      setSelectedPracticeMatchNumber("");
      setSelectedPracticeTeamNumber("");
      setSelectedPracticeScoutId("");
      setShowAssignModal(false);
      await loadData();
    } catch (error) {
      console.error("Error creating practice assignment:", error);
      alert("Error creating practice assignment");
    }
  }

  const matchAssignmentsSorted = useMemo(
    () =>
      assignments
        .filter((assignment) => !isEventPracticeAssignment(assignment))
        .slice()
        .sort((a, b) => {
          const labelDiff = String(a.matchLabel || a.matchKey || "").localeCompare(String(b.matchLabel || b.matchKey || ""));
          if (labelDiff !== 0) return labelDiff;
          return a.teamNumber - b.teamNumber;
        }),
    [assignments]
  );
  const eventPracticeMatchAssignments = useMemo(
    () => assignments.filter((assignment) => isEventPracticeAssignment(assignment)),
    [assignments]
  );
  const practiceAssignmentsSorted = useMemo(
    () =>
      practiceAssignments
        .slice()
        .sort((a, b) => {
          const eventDiff = String(a.eventKey || "").localeCompare(String(b.eventKey || ""));
          if (eventDiff !== 0) return eventDiff;
          const labelDiff = String(a.matchLabel || a.matchKey || "").localeCompare(String(b.matchLabel || b.matchKey || ""));
          if (labelDiff !== 0) return labelDiff;
          return a.teamNumber - b.teamNumber;
        }),
    [practiceAssignments]
  );
  const pitAssignmentsSorted = useMemo(
    () => pitAssignments.slice().sort((a, b) => a.teamNumber - b.teamNumber),
    [pitAssignments]
  );
  const filteredPracticeEventOptions = useMemo(() => {
    const needle = practiceEventSearch.trim().toLowerCase();
    if (!needle) return practiceEventOptions;
    return practiceEventOptions.filter((event) => {
      const haystack = `${event.name} ${event.key}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [practiceEventOptions, practiceEventSearch]);
  const selectedPracticeEventOption = useMemo(
    () => practiceEventOptions.find((event) => event.key === selectedPracticeEventKey) || null,
    [practiceEventOptions, selectedPracticeEventKey]
  );

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-bold mb-2 theme-text">Match Assignments</h1>
              <p className="text-gray-600">Assign team members and set who is attending each event.</p>
            </div>
            <button
              onClick={() => setShowAssignModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded text-white font-semibold hover:opacity-90"
              style={{ backgroundColor: "var(--primary-color)" }}
            >
              <Plus size={20} />
              New Assignment
            </button>
          </div>

          <div className="bg-white rounded-xl shadow-md p-6 mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">Select Event</label>
            <select
              value={selectedEvent}
              onChange={(e) => setSelectedEvent(e.target.value)}
              className="w-full max-w-md border rounded p-2"
            >
              {events.map((event) => (
                <option key={event.key} value={event.key}>
                  {event.name}
                </option>
              ))}
              {events.length === 0 && <option value="">No events selected</option>}
            </select>
          </div>

          <DataSourceCredits className="mb-6" />

          <div className="bg-white rounded-xl shadow-md p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Event Attendance</h2>
              <button
                onClick={saveAttendees}
                className="px-4 py-2 rounded text-white text-sm font-medium"
                style={{ backgroundColor: "var(--primary-color)" }}
              >
                Save Attendees
              </button>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              {members.map((member) => (
                <label key={member.uid} className="flex items-center gap-2 p-3 border rounded-lg">
                  <input
                    type="checkbox"
                    checked={
                      (eventAttendees[selectedEvent] || []).includes(member.uid) ||
                      (eventAttendees[selectedEvent] || []).includes(member.displayName)
                    }
                    onChange={() => toggleAttendee(member)}
                  />
                  <span className="font-medium">{member.displayName}</span>
                  <span className="text-xs text-gray-500">{getRoleLabel(normalizeLegacyRole(member.role))}</span>
                </label>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="bg-white rounded-xl shadow-md p-12 text-center">
              <LoadingSpinner />
              <p className="text-gray-600">Loading assignments...</p>
            </div>
          ) : (
            <>
              <div className="bg-white rounded-xl shadow-md overflow-hidden">
                <div className="p-6 border-b border-gray-200 flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-semibold">Assignments</h2>
                    <p className="text-sm text-gray-600">
                      Sort by assignment type. Practice here means practice-scouted assignments; event practice matches stay under match schedule.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setAssignmentView("match")}
                      className={`px-3 py-2 rounded text-sm font-medium ${assignmentView === "match" ? "text-white" : "bg-gray-100 text-gray-700"}`}
                      style={assignmentView === "match" ? { backgroundColor: "var(--primary-color)" } : undefined}
                    >
                      Match
                    </button>
                    <button
                      type="button"
                      onClick={() => setAssignmentView("pit")}
                      className={`px-3 py-2 rounded text-sm font-medium ${assignmentView === "pit" ? "text-white" : "bg-gray-100 text-gray-700"}`}
                      style={assignmentView === "pit" ? { backgroundColor: "var(--primary-color)" } : undefined}
                    >
                      Pit
                    </button>
                    <button
                      type="button"
                      onClick={() => setAssignmentView("practice")}
                      className={`px-3 py-2 rounded text-sm font-medium ${assignmentView === "practice" ? "text-white" : "bg-gray-100 text-gray-700"}`}
                      style={assignmentView === "practice" ? { backgroundColor: "var(--primary-color)" } : undefined}
                    >
                      Practice
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      {assignmentView === "pit" ? (
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Team</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Member</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                        </tr>
                      ) : (
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Match</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Event</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Member</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Team</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                        </tr>
                      )}
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {assignmentView === "pit" &&
                        pitAssignmentsSorted.map((assignment) => (
                          <tr key={assignment.id}>
                            <td className="px-6 py-4 whitespace-nowrap font-medium">Team {assignment.teamNumber}</td>
                            <td className="px-6 py-4 whitespace-nowrap">{assignment.scoutName}</td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <button onClick={() => void deletePitAssignment(assignment.id)} className="text-red-600 hover:text-red-800">
                                <Trash2 size={18} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      {assignmentView === "match" &&
                        matchAssignmentsSorted.map((assignment) => (
                          <tr key={assignment.id}>
                            <td className="px-6 py-4 whitespace-nowrap font-medium">{assignment.matchLabel || assignment.matchKey}</td>
                            <td className="px-6 py-4 whitespace-nowrap">{assignment.eventKey}</td>
                            <td className="px-6 py-4 whitespace-nowrap">{assignment.scoutName}</td>
                            <td className="px-6 py-4 whitespace-nowrap">Team {assignment.teamNumber}</td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <button onClick={() => void deleteAssignment(assignment.id)} className="text-red-600 hover:text-red-800">
                                <Trash2 size={18} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      {assignmentView === "practice" &&
                        practiceAssignmentsSorted.map((assignment) => (
                          <tr key={assignment.id}>
                            <td className="px-6 py-4 whitespace-nowrap font-medium">{assignment.matchLabel || assignment.matchKey}</td>
                            <td className="px-6 py-4 whitespace-nowrap">{assignment.eventKey}</td>
                            <td className="px-6 py-4 whitespace-nowrap">{assignment.scoutName}</td>
                            <td className="px-6 py-4 whitespace-nowrap">Team {assignment.teamNumber}</td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <button onClick={() => void deletePracticeAssignment(assignment.id)} className="text-red-600 hover:text-red-800">
                                <Trash2 size={18} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      {assignmentView === "pit" && pitAssignmentsSorted.length === 0 && (
                        <tr>
                          <td colSpan={3} className="px-6 py-8 text-center text-sm text-gray-500">No pit assignments yet.</td>
                        </tr>
                      )}
                      {assignmentView === "match" && matchAssignmentsSorted.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-6 py-8 text-center text-sm text-gray-500">No match assignments yet.</td>
                        </tr>
                      )}
                      {assignmentView === "practice" && practiceAssignmentsSorted.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-6 py-8 text-center text-sm text-gray-500">No practice assignments yet.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-md overflow-hidden mt-6">
                <div className="p-6 border-b border-gray-200 flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-semibold">Match Schedule</h2>
                    <p className="text-sm text-gray-600">
                      Sort between event practice matches and regular match schedule.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setScheduleView("match")}
                      className={`px-3 py-2 rounded text-sm font-medium ${scheduleView === "match" ? "text-white" : "bg-gray-100 text-gray-700"}`}
                      style={scheduleView === "match" ? { backgroundColor: "var(--primary-color)" } : undefined}
                    >
                      Match
                    </button>
                    <button
                      type="button"
                      onClick={() => setScheduleView("practice")}
                      className={`px-3 py-2 rounded text-sm font-medium ${scheduleView === "practice" ? "text-white" : "bg-gray-100 text-gray-700"}`}
                      style={scheduleView === "practice" ? { backgroundColor: "var(--primary-color)" } : undefined}
                    >
                      Practice
                    </button>
                    <button
                      onClick={() => openRandomizeConfig(scheduleView === "practice" ? "practice" : "match")}
                      className="px-4 py-2 rounded text-white text-sm font-semibold"
                      style={{ backgroundColor: "var(--primary-color)" }}
                    >
                      {scheduleView === "practice" ? "Randomize Practice" : "Randomize Match"}
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Match</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Assignments</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {scheduleView === "practice" &&
                        eventPracticeMatches
                          .slice()
                          .sort((a, b) => a.matchNumber - b.matchNumber)
                          .map((match) => {
                            const perMatch = eventPracticeMatchAssignments.filter(
                              (assignment) => assignment.matchKey === `p${match.matchNumber}`
                            );
                            return (
                              <tr key={match.id}>
                                <td className="px-6 py-4 whitespace-nowrap font-medium">{`Practice ${match.matchNumber}`}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                                  {match.scheduleTime > 0
                                    ? new Date(match.scheduleTime * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                                    : (match.isManual ? "Manual" : "TBD")}
                                </td>
                                <td className="px-6 py-4 text-sm">
                                  {perMatch.length === 0
                                    ? "Unassigned"
                                    : perMatch.map((assignment) => `T${assignment.teamNumber}: ${assignment.scoutName}`).join(" | ")}
                                </td>
                              </tr>
                            );
                          })}
                      {scheduleView === "match" &&
                        matchOptions.map((match) => {
                          const perMatch = matchAssignmentsSorted.filter((assignment) => assignment.matchKey === match.key);
                          const isActive = activeOrNextMatchKey === match.key;
                          return (
                            <tr key={match.key} className={isActive ? "bg-yellow-50" : ""}>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <span className="font-medium">{match.label}</span>
                                {isActive && <span className="ml-2 text-xs font-semibold text-yellow-700">ACTIVE/NEXT</span>}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                                {match.scheduleTime > 0
                                  ? new Date(match.scheduleTime * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                                  : "TBD"}
                              </td>
                              <td className="px-6 py-4 text-sm">
                                {perMatch.length === 0
                                  ? "Unassigned"
                                  : perMatch.map((assignment) => `T${assignment.teamNumber}: ${assignment.scoutName}`).join(" | ")}
                              </td>
                            </tr>
                          );
                        })}
                      {scheduleView === "practice" && eventPracticeMatches.length === 0 && (
                        <tr>
                          <td colSpan={3} className="px-6 py-8 text-center text-sm text-gray-500">
                            No event practice matches found. Open New Assignment and click Practice to generate manual practice matches.
                          </td>
                        </tr>
                      )}
                      {scheduleView === "match" && matchOptions.length === 0 && (
                        <tr>
                          <td colSpan={3} className="px-6 py-8 text-center text-sm text-gray-500">
                            No match schedule found for this event.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {showAssignModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
                <h2 className="text-2xl font-bold mb-4 theme-text">New Assignment</h2>
                <div className="grid grid-cols-3 gap-2 mb-4">
                  <button
                    onClick={() => setAssignmentModalMode("match")}
                    className={`py-2 rounded text-sm font-medium ${assignmentModalMode === "match" ? "bg-red-600 text-white" : "bg-gray-100"}`}
                  >
                    Match Scout
                  </button>
                  <button
                    onClick={() => setAssignmentModalMode("pit")}
                    className={`py-2 rounded text-sm font-medium ${assignmentModalMode === "pit" ? "bg-red-600 text-white" : "bg-gray-100"}`}
                  >
                    Pit Scout
                  </button>
                  <button
                    onClick={() => setAssignmentModalMode("practice")}
                    className={`py-2 rounded text-sm font-medium ${assignmentModalMode === "practice" ? "bg-red-600 text-white" : "bg-gray-100"}`}
                  >
                    Practice Scout
                  </button>
                </div>
                <div className="space-y-4">
                  {assignmentModalMode === "match" ? (
                    <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Match</label>
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      <button
                        onClick={() => {
                          void selectMatchType("practice");
                        }}
                        className={`py-2 rounded text-sm font-medium ${selectedMatchType === "practice" ? "bg-red-600 text-white" : "bg-gray-100"}`}
                      >
                        Practice
                      </button>
                      <button
                        onClick={() => {
                          void selectMatchType("qualification");
                        }}
                        className={`py-2 rounded text-sm font-medium ${selectedMatchType === "qualification" ? "bg-red-600 text-white" : "bg-gray-100"}`}
                      >
                        Qual
                      </button>
                      <button
                        onClick={() => {
                          void selectMatchType("finals");
                        }}
                        className={`py-2 rounded text-sm font-medium ${selectedMatchType === "finals" ? "bg-red-600 text-white" : "bg-gray-100"}`}
                      >
                        Finals
                      </button>
                    </div>
                    <div className="max-h-48 overflow-y-auto border rounded p-2 space-y-2">
                      {typeFilteredMatches.map((match) => (
                        <button
                          key={match.key}
                          onClick={() => {
                            setSelectedMatchKey(match.key);
                            setSelectedTeamNumber("");
                          }}
                          className={`w-full text-left px-3 py-2 rounded border ${
                            selectedMatchKey === match.key ? "border-red-500 bg-red-50" : "border-gray-200 hover:bg-gray-50"
                          }`}
                        >
                          <span className="font-medium">{match.label}</span>
                        </button>
                      ))}
                      {typeFilteredMatches.length === 0 && (
                        <p className="text-sm text-gray-500 text-center py-4">
                          {selectedMatchType === "practice"
                            ? "No event practice matches found. Click Practice again to generate manual practice matches."
                            : "No matches found for this type."}
                        </p>
                      )}
                    </div>
                    </div>
                  ) : assignmentModalMode === "practice" ? (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Practice Event</label>
                        <button
                          type="button"
                          onClick={() => {
                            setPracticeEventSearch("");
                            setShowPracticeEventPicker(true);
                          }}
                          className="w-full border rounded p-2 text-left hover:bg-gray-50"
                        >
                          {selectedPracticeEventOption ? selectedPracticeEventOption.name : "Select Event"}
                        </button>
                        <p className="text-xs text-gray-500 mt-1">
                          Practice Scout excludes your team&apos;s signed-up events.
                        </p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Practice Match Number</label>
                        <input
                          type="number"
                          min={1}
                          className="w-full border rounded p-2"
                          value={selectedPracticeMatchNumber}
                          onChange={(e) => setSelectedPracticeMatchNumber(e.target.value.replace(/[^\d]/g, ""))}
                          placeholder="e.g. 7"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Team</label>
                        <input
                          type="number"
                          min={1}
                          className="w-full border rounded p-2"
                          value={selectedPracticeTeamNumber}
                          onChange={(e) => setSelectedPracticeTeamNumber(e.target.value.replace(/[^\d]/g, ""))}
                          placeholder="e.g. 148"
                        />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Team</label>
                      <select
                        className="w-full border rounded p-2"
                        value={selectedPitTeamNumber}
                        onChange={(e) => setSelectedPitTeamNumber(e.target.value)}
                      >
                        <option value="">Select Team</option>
                        {pitTeamOptions.map((teamNumber) => (
                          <option key={teamNumber} value={teamNumber}>
                            Team {teamNumber}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Member</label>
                    <select
                      className="w-full border rounded p-2"
                      value={
                        assignmentModalMode === "match"
                          ? selectedScoutId
                          : assignmentModalMode === "practice"
                          ? selectedPracticeScoutId
                          : selectedPitScoutId
                      }
                      onChange={(e) => {
                        if (assignmentModalMode === "match") setSelectedScoutId(e.target.value);
                        else if (assignmentModalMode === "practice") setSelectedPracticeScoutId(e.target.value);
                        else setSelectedPitScoutId(e.target.value);
                      }}
                    >
                      <option value="">Select Member</option>
                      {members.map((member) => (
                        <option key={member.uid} value={member.uid}>
                          {member.displayName}
                        </option>
                      ))}
                    </select>
                  </div>
                  {assignmentModalMode === "match" && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Team</label>
                    <select
                      className="w-full border rounded p-2 disabled:bg-gray-100 disabled:text-gray-500"
                      value={selectedTeamNumber}
                      onChange={(e) => setSelectedTeamNumber(e.target.value)}
                      disabled={!selectedMatch}
                    >
                      <option value="">{selectedMatch ? "Select Team" : "Select Match First"}</option>
                      {selectedMatch?.teams.map((team) => (
                        <option key={team} value={team}>
                          Team {team}
                        </option>
                      ))}
                    </select>
                  </div>
                  )}
                </div>
                <div className="flex gap-3 mt-6">
                  <button
                    onClick={() => {
                      if (assignmentModalMode === "match") {
                        void createAssignment();
                        return;
                      }
                      if (assignmentModalMode === "practice") {
                        void createPracticeScoutAssignment();
                        return;
                      }
                      void createPitAssignment();
                    }}
                    className="flex-1 py-2 rounded text-white font-semibold disabled:opacity-50"
                    style={{ backgroundColor: "var(--primary-color)" }}
                    disabled={
                      assignmentModalMode === "match"
                        ? (!selectedMatchKey || !selectedScoutId || !selectedTeamNumber)
                        : assignmentModalMode === "practice"
                        ? (!selectedPracticeEventKey || !selectedPracticeMatchNumber || !selectedPracticeScoutId || !selectedPracticeTeamNumber)
                        : (!selectedPitScoutId || !selectedPitTeamNumber)
                    }
                  >
                    Create
                  </button>
                  <button
                    onClick={() => setShowAssignModal(false)}
                    className="flex-1 py-2 rounded border-2 border-gray-300 text-gray-700 font-medium"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
          {showRandomizeModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[58] p-4">
              <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-semibold theme-text">
                    Randomize {randomizeTarget === "practice" ? "Practice" : "Match"} Assignments
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowRandomizeModal(false)}
                    className="px-3 py-1 rounded border border-gray-300 text-sm"
                  >
                    Close
                  </button>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Matches To Randomize</label>
                    <input
                      type="number"
                      min={1}
                      value={randomizeMatchCount}
                      onChange={(e) => setRandomizeMatchCount(e.target.value.replace(/[^\d]/g, ""))}
                      className="w-full border rounded p-2"
                      placeholder="Leave blank for all upcoming matches"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Match Pattern</label>
                    <select
                      value={randomizePattern}
                      onChange={(e) => setRandomizePattern(e.target.value as RandomizePattern)}
                      className="w-full border rounded p-2"
                    >
                      <option value="rotate-each-match">Rotate each match</option>
                      <option value="block-5">Intervals of 5 then swap</option>
                      <option value="constant">Constant same order</option>
                    </select>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-medium text-gray-700">Scouts To Factor In</label>
                      <span className="text-xs text-gray-500">{randomizeScoutIds.length} selected</span>
                    </div>
                    <div className="flex flex-wrap gap-2 mb-2">
                      <button type="button" onClick={() => setRandomizeScoutIds(randomizeEligibleMembers.map((member) => member.uid))} className="px-2 py-1 rounded border text-xs">
                        Select All
                      </button>
                      <button type="button" onClick={() => setRandomizeScoutIds([])} className="px-2 py-1 rounded border text-xs">
                        Clear
                      </button>
                      <button type="button" onClick={() => presetRandomizeScoutsByRoles(["match-scout"])} className="px-2 py-1 rounded border text-xs">
                        Match Scout
                      </button>
                      <button type="button" onClick={() => presetRandomizeScoutsByRoles(["lead-scout"])} className="px-2 py-1 rounded border text-xs">
                        Lead Scout
                      </button>
                      <button type="button" onClick={() => presetRandomizeScoutsByRoles(["media"])} className="px-2 py-1 rounded border text-xs">
                        Media
                      </button>
                    </div>
                    <div className="max-h-52 overflow-y-auto border rounded p-2 space-y-1">
                      {randomizeEligibleMembers.length === 0 ? (
                        <p className="text-sm text-gray-500">No eligible scout-role members found.</p>
                      ) : (
                        randomizeEligibleMembers.map((member) => (
                          <label key={`randomize-scout-${member.uid}`} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={randomizeScoutIds.includes(member.uid)}
                              onChange={() => toggleRandomizeScout(member.uid)}
                            />
                            <span>{member.displayName}</span>
                            <span className="text-xs text-gray-500">{getRoleLabel(normalizeLegacyRole(member.role))}</span>
                          </label>
                        ))
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      If fewer than 6 scouts are selected, randomize prioritizes manual priority teams, then highest-performing teams.
                    </p>
                  </div>
                </div>

                <div className="flex gap-3 mt-6">
                  <button
                    type="button"
                    onClick={() => void runRandomizeFromConfig()}
                    className="flex-1 py-2 rounded text-white font-semibold"
                    style={{ backgroundColor: "var(--primary-color)" }}
                    disabled={randomizeScoutIds.length === 0}
                  >
                    Run Randomize
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowRandomizeModal(false)}
                    className="flex-1 py-2 rounded border-2 border-gray-300 text-gray-700 font-medium"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
          {showPracticeEventPicker && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
              <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-semibold theme-text">Select Practice Event</h3>
                  <button
                    type="button"
                    onClick={() => setShowPracticeEventPicker(false)}
                    className="px-3 py-1 rounded border border-gray-300 text-sm"
                  >
                    Close
                  </button>
                </div>
                <input
                  type="text"
                  value={practiceEventSearch}
                  onChange={(e) => setPracticeEventSearch(e.target.value)}
                  className="w-full border rounded p-2 mb-3"
                  placeholder="Search by event name or key..."
                  autoFocus
                />
                <div className="max-h-80 overflow-y-auto border rounded">
                  {filteredPracticeEventOptions.length === 0 ? (
                    <p className="px-3 py-6 text-sm text-gray-500 text-center">No matching events found.</p>
                  ) : (
                    <div className="divide-y divide-gray-200">
                      {filteredPracticeEventOptions.map((event) => (
                        <button
                          key={event.key}
                          type="button"
                          onClick={() => {
                            setSelectedPracticeEventKey(event.key);
                            setShowPracticeEventPicker(false);
                          }}
                          className={`w-full text-left px-3 py-2 hover:bg-gray-50 ${
                            selectedPracticeEventKey === event.key ? "bg-indigo-50" : ""
                          }`}
                        >
                          <p className="font-medium">{event.name}</p>
                          <p className="text-xs text-gray-500">{event.key}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AssignmentsPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["lead-scout", "lead-strategist", "team-coach"]}>
      <AssignmentsContent />
    </ProtectedRoute>
  );
}
