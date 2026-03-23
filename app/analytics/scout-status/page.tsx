"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import AnalyticsShell from "@/app/components/AnalyticsShell";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import DataSourceCredits from "@/app/components/DataSourceCredits";
import { useAuth } from "@/app/AuthContext";
import {
  entryMatchesAnalyticsFilters,
  getEventOptionsForEntries,
  getEventsForGame,
  isPracticeScoutedEntry,
  normalizeMatchLabel,
  type AnalyticsGame,
} from "@/app/utils/analyticsEvents";
import { fetchFirstSchedule, getFirstEventCodeFromTbaKey, splitFirstAllianceTeams } from "@/app/utils/firstSchedule";
import { getEventMatches, type TBAMatch } from "@/app/utils/tba-api";

type ScoutStatusEntry = {
  id?: string;
  eventKey?: string;
  eventName?: string;
  matchId?: string;
  matchKey?: string;
  matchLabel?: string;
  matchNumber?: string;
  matchType?: string;
  submittedAt?: number;
  timestamp?: number;
  createdAt?: number;
  game?: string;
  teamNumber?: string;
  scoutName?: string;
  scoutId?: string;
  helperName?: string;
  assistedTeamNumber?: string;
  robots?: Array<{ teamNumber?: string }>;
  alliance?: string;
  entryType?: string;
  isLeadScouting?: boolean;
  isPracticeScouting?: boolean;
  practiceMode?: string;
  practiceSessionId?: string;
  excludeFromStats?: boolean;
};

type ScoutStatusFormType =
  | "match-scout"
  | "lead-scout"
  | "pit-scout"
  | "team-strategy"
  | "match-strategy"
  | "drive-reflection"
  | "helper";

type MatchRow = {
  key: string;
  label: string;
  time: number;
  red: number[];
  blue: number[];
  level: "practice" | "qualification" | "playoff" | "finals";
  setNumber: number;
  matchNumber: number;
};

type AllianceMatchRow = MatchRow & {
  alliance: "red" | "blue";
  allianceTeams: number[];
};

type MatchCategory = "practice" | "qualification" | "semifinals" | "finals";

const CATEGORY_OPTIONS: Array<{ id: MatchCategory; label: string; short: string }> = [
  { id: "practice", label: "Practice", short: "P" },
  { id: "qualification", label: "Qualifications", short: "Q" },
  { id: "semifinals", label: "Semi-Finals", short: "SF" },
  { id: "finals", label: "Finals", short: "F" },
];

const FORM_OPTIONS: Array<{ id: ScoutStatusFormType; label: string }> = [
  { id: "match-scout", label: "Match Scout" },
  { id: "lead-scout", label: "Lead Scout" },
  { id: "pit-scout", label: "Pit Scout" },
  { id: "team-strategy", label: "Team Strategy" },
  { id: "match-strategy", label: "Match Strategy" },
  { id: "drive-reflection", label: "Drive Reflection" },
  { id: "helper", label: "Helper" },
];

function entryTime(entry: ScoutStatusEntry): number {
  const raw = Number(entry.submittedAt ?? entry.timestamp ?? entry.createdAt ?? 0);
  return Number.isFinite(raw) ? raw : 0;
}

function entryMatchKey(entry: ScoutStatusEntry): string {
  const rawMatchId = String(entry.matchId || entry.matchKey || "").trim().toLowerCase();
  if (rawMatchId) return rawMatchId;
  const label = String(entry.matchLabel || "").trim();
  if (label) {
    const parsed = normalizeMatchLabel(label);
    return parsed.matchId || `${parsed.matchType}-${parsed.matchNumber}`;
  }
  const matchType = String(entry.matchType || "").trim().toLowerCase();
  const matchNumber = String(entry.matchNumber || "").replace(/[^\d]/g, "");
  if (matchType && matchNumber) {
    const prefix = matchType.startsWith("p") ? "p" : matchType.startsWith("f") ? "f" : "q";
    return `${prefix}${matchNumber}`;
  }
  if (matchNumber) return `q${matchNumber}`;
  return "";
}

function matchLabel(match: TBAMatch) {
  if (match.comp_level === "qm") return `Qualification ${match.match_number}`;
  if (match.comp_level === "f") return `Finals ${match.match_number}`;
  if (match.comp_level === "sf") return `Semifinal ${match.set_number}-${match.match_number}`;
  if (match.comp_level === "qf") return `Quarterfinal ${match.set_number}-${match.match_number}`;
  if (match.comp_level === "ef") return `Octofinal ${match.set_number}-${match.match_number}`;
  return match.key;
}

function compLevelPriority(compLevel: string) {
  if (compLevel === "pr") return -1;
  if (compLevel === "qm") return 0;
  if (compLevel === "ef") return 1;
  if (compLevel === "qf") return 2;
  if (compLevel === "sf") return 3;
  if (compLevel === "f") return 4;
  return 99;
}

function getMatchCategoryFromRow(match: MatchRow): MatchCategory {
  if (match.level === "practice") return "practice";
  if (match.level === "finals") return "finals";
  if (match.level === "qualification") return "qualification";
  return "semifinals";
}

function getEntryCategory(entry: ScoutStatusEntry): MatchCategory {
  const matchType = String(entry.matchType || "").toLowerCase();
  const label = String(entry.matchLabel || entry.matchId || "").toLowerCase();
  if (matchType.startsWith("p") || label.includes("practice")) return "practice";
  if (matchType.startsWith("f") || label.includes("final")) return "finals";
  if (matchType.startsWith("q") || label.includes("qual")) return "qualification";
  if (
    matchType.includes("playoff") ||
    matchType.includes("semi") ||
    label.includes("semi") ||
    label.includes("quarter") ||
    label.includes("octo") ||
    label.includes("playoff")
  ) {
    return "semifinals";
  }
  const parsed = normalizeMatchLabel(label);
  if (parsed.matchType === "practice") return "practice";
  if (parsed.matchType === "finals") return "finals";
  return "qualification";
}

function getEntryMatchNumber(entry: ScoutStatusEntry): number | null {
  const raw = String(entry.matchNumber || "").replace(/[^\d]/g, "");
  if (raw) {
    const num = Number(raw);
    return Number.isFinite(num) ? num : null;
  }
  const parsed = normalizeMatchLabel(String(entry.matchLabel || entry.matchId || ""));
  const num = Number(parsed.matchNumber || 0);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function parseRangeInput(value: string): { start: number; end: number } | null {
  const nums = String(value || "").match(/\d+/g);
  if (!nums || nums.length === 0) return null;
  const start = Number(nums[0]);
  const end = Number(nums[1] ?? nums[0]);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

function getScoutIdentity(entry: ScoutStatusEntry): { id: string; name: string } {
  const name = String(entry.scoutName || entry.helperName || "Unknown Scout").trim() || "Unknown Scout";
  const id = String(entry.scoutId || entry.scoutName || entry.helperName || "unknown").trim() || "unknown";
  return { id, name };
}

function isMatchBasedForm(formType: ScoutStatusFormType): boolean {
  return ["match-scout", "lead-scout", "match-strategy", "drive-reflection"].includes(formType);
}

function isTeamCoverageForm(formType: ScoutStatusFormType): boolean {
  return formType === "pit-scout" || formType === "team-strategy";
}

function isAllianceCoverageForm(formType: ScoutStatusFormType): boolean {
  return formType === "match-strategy" || formType === "drive-reflection";
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

async function fetchMatchesForEvent(eventKey: string, encryptedKey: string, plainKey: string): Promise<TBAMatch[]> {
  try {
    const response = await fetch("/api/tba/matches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventKey, encryptedKey, plainKey }),
    });
    if (response.ok) {
      const payload = (await response.json()) as { matches?: TBAMatch[] };
      if (Array.isArray(payload.matches)) return payload.matches;
    }
  } catch (error) {
    console.warn("Scout status TBA proxy failed:", error);
  }

  try {
    return await getEventMatches(eventKey, plainKey || undefined);
  } catch (error) {
    console.warn("Scout status direct TBA fetch failed:", error);
    return [];
  }
}

function ScoutStatusContent() {
  const { userData } = useAuth();
  const [entries, setEntries] = useState<ScoutStatusEntry[]>([]);
  const [selectedFormType, setSelectedFormType] = useState<ScoutStatusFormType>("match-scout");
  const [selectedGame, setSelectedGame] = useState<AnalyticsGame>("REBUILT");
  const [selectedEvent, setSelectedEvent] = useState("all");
  const [practiceMatchesOnly, setPracticeMatchesOnly] = useState(false);
  const [activeCategories, setActiveCategories] = useState<MatchCategory[]>(
    CATEGORY_OPTIONS.map((option) => option.id)
  );
  const [categoryRanges, setCategoryRanges] = useState<Record<MatchCategory, string>>({
    practice: "",
    qualification: "",
    semifinals: "",
    finals: "",
  });
  const [loadingEntries, setLoadingEntries] = useState(true);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [eventTeams, setEventTeams] = useState<string[]>([]);
  const [teamLoadNote, setTeamLoadNote] = useState("");
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [tbaKeys, setTbaKeys] = useState({ encrypted: "", plain: "" });

  useEffect(() => {
    const savedGame = localStorage.getItem("analytics-selected-game");
    const savedEvent = localStorage.getItem("analytics-selected-event");
    const savedPractice = localStorage.getItem("analytics-practice-matches-only");
    const savedForm = localStorage.getItem("analytics-scout-status-form");
    if (savedGame === "REEFSCAPE" || savedGame === "REBUILT") setSelectedGame(savedGame);
    if (savedEvent) setSelectedEvent(savedEvent);
    if (savedPractice !== null) setPracticeMatchesOnly(savedPractice === "true");
    if (savedForm && FORM_OPTIONS.some((option) => option.id === savedForm)) {
      setSelectedFormType(savedForm as ScoutStatusFormType);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("analytics-selected-game", selectedGame);
    localStorage.setItem("analytics-selected-event", selectedEvent);
    localStorage.setItem("analytics-practice-matches-only", String(practiceMatchesOnly));
    localStorage.setItem("analytics-scout-status-form", selectedFormType);
  }, [selectedGame, selectedEvent, practiceMatchesOnly, selectedFormType]);

  useEffect(() => {
    async function loadEntries() {
      setLoadingEntries(true);
      try {
        if (selectedFormType === "lead-scout") {
          const results = await Promise.allSettled([
            getDocs(collection(db, "leadScouting")),
            getDocs(query(collection(db, "scouting"), where("entryType", "==", "lead"))),
          ]);
          const leadEntries =
            results[0].status === "fulfilled"
              ? results[0].value.docs.map((docSnap) => ({
                  id: docSnap.id,
                  ...docSnap.data(),
                  entryType: "lead",
                  isLeadScouting: true,
                }))
              : [];
          const scoutingEntries =
            results[1].status === "fulfilled"
              ? results[1].value.docs.map((docSnap) => ({
                  id: docSnap.id,
                  ...docSnap.data(),
                  entryType: "lead",
                  isLeadScouting: true,
                }))
              : [];
          setEntries([...leadEntries, ...scoutingEntries] as ScoutStatusEntry[]);
          return;
        }

        if (selectedFormType === "pit-scout") {
          const snap = await getDocs(collection(db, "pitScouting"));
          setEntries(snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })) as ScoutStatusEntry[]);
          return;
        }

        if (selectedFormType === "team-strategy") {
          const snap = await getDocs(collection(db, "strategyScouting"));
          setEntries(snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })) as ScoutStatusEntry[]);
          return;
        }

        if (selectedFormType === "match-strategy") {
          const snap = await getDocs(collection(db, "matchStrategyPlans"));
          setEntries(snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })) as ScoutStatusEntry[]);
          return;
        }

        if (selectedFormType === "drive-reflection") {
          const snap = await getDocs(collection(db, "driveScouting"));
          setEntries(snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })) as ScoutStatusEntry[]);
          return;
        }

        if (selectedFormType === "helper") {
          const snap = await getDocs(collection(db, "helperReports"));
          setEntries(snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })) as ScoutStatusEntry[]);
          return;
        }

        const snap = await getDocs(collection(db, "scouting"));
        setEntries(snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })) as ScoutStatusEntry[]);
      } finally {
        setLoadingEntries(false);
      }
    }
    void loadEntries();
  }, [selectedFormType]);

  useEffect(() => {
    async function loadKeys() {
      if (!userData?.teamId) return;
      try {
        const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
        setTbaKeys({
          encrypted: String(teamDoc.data()?.tbaApiKeyEncrypted || "").trim(),
          plain: String(teamDoc.data()?.tbaApiKey || "").trim(),
        });
      } catch (error) {
        console.warn("Scout status failed to load TBA keys:", error);
      }
    }
    void loadKeys();
  }, [userData?.teamId]);

  const eventOptions = useMemo(() => {
    return [{ id: "all", name: "All Events" }, ...getEventOptionsForEntries(entries, selectedGame)];
  }, [entries, selectedGame]);

  const filteredEntries = useMemo(() => {
    const eventFilterOptions = getEventsForGame(selectedGame);
    const includeLead = selectedFormType === "lead-scout";
    return entries
      .filter((entry) => entryMatchesAnalyticsFilters(entry, selectedGame, selectedEvent, eventFilterOptions, { includeLead }))
      .filter((entry) => (practiceMatchesOnly ? isPracticeScoutedEntry(entry) : !isPracticeScoutedEntry(entry)))
      .filter((entry) => !entry.excludeFromStats);
  }, [entries, selectedEvent, selectedGame, practiceMatchesOnly, selectedFormType]);

  const categoryRangesParsed = useMemo(
    () => ({
      practice: parseRangeInput(categoryRanges.practice),
      qualification: parseRangeInput(categoryRanges.qualification),
      semifinals: parseRangeInput(categoryRanges.semifinals),
      finals: parseRangeInput(categoryRanges.finals),
    }),
    [categoryRanges]
  );

  const categoryFilteredEntries = useMemo(() => {
    if (!isMatchBasedForm(selectedFormType)) return filteredEntries;
    if (activeCategories.length === 0) return filteredEntries;
    const activeSet = new Set(activeCategories);
    return filteredEntries.filter((entry) => {
      const category = getEntryCategory(entry);
      if (!activeSet.has(category)) return false;
      const range = categoryRangesParsed[category];
      if (!range) return true;
      const number = getEntryMatchNumber(entry);
      if (!number) return false;
      return number >= range.start && number <= range.end;
    });
  }, [filteredEntries, activeCategories, categoryRangesParsed, selectedFormType]);

  const displayEntries = useMemo(
    () => (isMatchBasedForm(selectedFormType) ? categoryFilteredEntries : filteredEntries),
    [categoryFilteredEntries, filteredEntries, selectedFormType]
  );

  const scoutStats = useMemo(() => {
    const byScout = new Map<string, { id: string; name: string; entries: number; matches: Set<string>; last: number }>();
    displayEntries.forEach((entry) => {
      const { id: scoutId, name: scoutName } = getScoutIdentity(entry);
      const key = isTeamCoverageForm(selectedFormType)
        ? String(entry.teamNumber || "").trim()
        : selectedFormType === "helper"
        ? String(entry.id || "")
        : entryMatchKey(entry);
      if (!scoutId) return;
      const current = byScout.get(scoutId) || { id: scoutId, name: scoutName, entries: 0, matches: new Set<string>(), last: 0 };
      current.entries += 1;
      if (key) current.matches.add(key);
      const time = entryTime(entry);
      if (time > current.last) current.last = time;
      byScout.set(scoutId, current);
    });
    return Array.from(byScout.values()).sort((a, b) => b.entries - a.entries);
  }, [displayEntries, selectedFormType]);

  const coverage = useMemo(() => {
    const counts = new Map<string, number>();
    displayEntries.forEach((entry) => {
      if (selectedFormType === "match-scout") {
        const team = String(entry.teamNumber || "").trim();
        const matchKey = entryMatchKey(entry);
        if (!team || !matchKey) return;
        const key = `${matchKey}::${team}`;
        counts.set(key, (counts.get(key) || 0) + 1);
        return;
      }

      if (selectedFormType === "lead-scout") {
        const matchKey = entryMatchKey(entry);
        if (!matchKey) return;
        (entry.robots || []).forEach((robot) => {
          const team = String(robot?.teamNumber || "").trim();
          if (!team) return;
          const key = `${matchKey}::${team}`;
          counts.set(key, (counts.get(key) || 0) + 1);
        });
        return;
      }

      if (selectedFormType === "match-strategy" || selectedFormType === "drive-reflection") {
        const matchKey = entryMatchKey(entry);
        if (!matchKey) return;
        counts.set(matchKey, (counts.get(matchKey) || 0) + 1);
        return;
      }

      if (selectedFormType === "pit-scout" || selectedFormType === "team-strategy") {
        const team = String(entry.teamNumber || "").trim();
        if (!team) return;
        counts.set(team, (counts.get(team) || 0) + 1);
      }
    });
    return counts;
  }, [displayEntries, selectedFormType]);

  const renderCheckMarks = (count: number) => {
    return Array.from({ length: count }).map((_, index) => (
      <svg
        key={`check-${index}`}
        viewBox="0 0 20 20"
        aria-hidden="true"
        className="h-4 w-4 text-green-700"
      >
        <path
          fill="currentColor"
          d="M7.7 13.3 4.9 10.5 3.5 11.9 7.7 16.1 17 6.8 15.6 5.4z"
        />
      </svg>
    ));
  };

  useEffect(() => {
    async function loadMatches() {
      if (!selectedEvent || selectedEvent === "all") {
        setMatches([]);
        return;
      }
      setScheduleLoading(true);
      try {
        const rows = await fetchMatchesForEvent(selectedEvent, tbaKeys.encrypted, tbaKeys.plain);
        const normalized = rows
          .sort((a, b) => {
            const levelDiff = compLevelPriority(a.comp_level) - compLevelPriority(b.comp_level);
            if (levelDiff !== 0) return levelDiff;
            if (a.set_number !== b.set_number) return a.set_number - b.set_number;
            return a.match_number - b.match_number;
          })
          .map((match) => {
            const level =
              match.comp_level === "pr"
                ? "practice"
                : match.comp_level === "qm"
                ? "qualification"
                : match.comp_level === "f"
                ? "finals"
                : "playoff";
            return {
              key: match.key,
              label: matchLabel(match),
              time: match.actual_time || match.predicted_time || match.time || 0,
              red: match.alliances.red.team_keys.map((k) => parseInt(k.replace("frc", ""), 10)).filter(Number.isFinite),
              blue: match.alliances.blue.team_keys.map((k) => parseInt(k.replace("frc", ""), 10)).filter(Number.isFinite),
              level,
              setNumber: match.set_number,
              matchNumber: match.match_number,
            } as MatchRow;
          });
        const firstSchedule = await fetchFirstSchedule(selectedEvent, "Practice");
        const existingPracticeNumbers = new Set(normalized.filter((row) => row.level === "practice").map((row) => row.matchNumber));
        const firstPracticeRows = firstSchedule
          .map((match) => {
            const { red, blue } = splitFirstAllianceTeams(match);
            return {
              key: `first_${selectedEvent}_practice_${match.matchNumber}`,
              label: `Practice ${match.matchNumber}`,
              time: match.startTime || 0,
              red,
              blue,
              level: "practice" as const,
              setNumber: 1,
              matchNumber: match.matchNumber,
            };
          })
          .filter((row) => row.red.length >= 3 && row.blue.length >= 3)
          .filter((row) => !existingPracticeNumbers.has(row.matchNumber));
        const merged = [...firstPracticeRows, ...normalized].sort((a, b) => {
          const levelOrder = a.level === "practice" ? -1 : a.level === "qualification" ? 0 : a.level === "playoff" ? 1 : 2;
          const otherLevelOrder = b.level === "practice" ? -1 : b.level === "qualification" ? 0 : b.level === "playoff" ? 1 : 2;
          if (levelOrder !== otherLevelOrder) return levelOrder - otherLevelOrder;
          if (a.setNumber !== b.setNumber) return a.setNumber - b.setNumber;
          if (a.matchNumber !== b.matchNumber) return a.matchNumber - b.matchNumber;
          return a.time - b.time;
        });
        setMatches(merged);
      } catch (error) {
        console.warn("Scout status failed to load match schedule:", error);
        setMatches([]);
      } finally {
        setScheduleLoading(false);
      }
    }
    void loadMatches();
  }, [selectedEvent, tbaKeys.encrypted, tbaKeys.plain]);

  const scheduleTeams = useMemo(() => {
    const set = new Set<number>();
    matches.forEach((match) => {
      match.red.forEach((team) => set.add(team));
      match.blue.forEach((team) => set.add(team));
    });
    return Array.from(set)
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b)
      .map((num) => String(num));
  }, [matches]);

  useEffect(() => {
    async function loadTeams() {
      if (!isTeamCoverageForm(selectedFormType)) {
        setEventTeams([]);
        setTeamLoadNote("");
        return;
      }
      if (!selectedEvent || selectedEvent === "all") {
        setEventTeams([]);
        setTeamLoadNote("");
        return;
      }
      if (!userData?.teamId) {
        setEventTeams([]);
        setTeamLoadNote("Team is required to load teams.");
        return;
      }
      setTeamsLoading(true);
      try {
        const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
        const teamData = teamDoc.exists() ? (teamDoc.data() as Record<string, unknown>) : {};
        const manualByEvent = (teamData.manualTeamListsByEvent || {}) as Record<string, unknown>;
        const storedManualTeams = parseManualTeamList(manualByEvent[selectedEvent]);

        let firstTeams: string[] = [];
        let loadNote = "";
        if (selectedEvent !== "app-testing") {
          const year = Number(selectedEvent.slice(0, 4));
          if (Number.isFinite(year)) {
            try {
              const eventCode = getFirstEventCodeFromTbaKey(selectedEvent);
              const response = await fetch("/api/first/teams", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ year, eventCode }),
              });
              if (response.ok) {
                const payload = (await response.json()) as { teams?: Array<Record<string, unknown>> };
                const rows = Array.isArray(payload.teams) ? payload.teams : [];
                firstTeams = Array.from(
                  new Set(
                    rows
                      .map((team) => Number(team.teamNumber || 0))
                      .filter((teamNumber) => Number.isFinite(teamNumber) && teamNumber > 0)
                      .map((teamNumber) => String(teamNumber))
                  )
                ).sort((a, b) => Number(a) - Number(b));
              } else {
                loadNote = response.status === 403 ? "FIRST API access denied." : `Unable to load teams (${response.status}).`;
              }
            } catch (error) {
              console.warn("Scout status failed to fetch FIRST teams:", error);
              loadNote = "Unable to load teams right now.";
            }
          }
        }

        const baseTeams = firstTeams.length > 0 ? firstTeams : storedManualTeams;
        const mergedTeams = Array.from(new Set([...baseTeams, ...scheduleTeams])).sort((a, b) => Number(a) - Number(b));
        setEventTeams(mergedTeams);
        if (firstTeams.length > 0) {
          setTeamLoadNote("");
        } else if (storedManualTeams.length > 0) {
          setTeamLoadNote("Using manual team list from assignments.");
        } else if (scheduleTeams.length > 0) {
          setTeamLoadNote("Using teams from the match schedule.");
        } else if (loadNote) {
          setTeamLoadNote(loadNote);
        } else {
          setTeamLoadNote("No teams available yet.");
        }
      } catch (error) {
        console.warn("Scout status failed to load team list:", error);
        setEventTeams([]);
        setTeamLoadNote("Unable to load teams right now.");
      } finally {
        setTeamsLoading(false);
      }
    }
    void loadTeams();
  }, [selectedEvent, selectedFormType, scheduleTeams, userData?.teamId]);

  const visibleMatches = useMemo(() => {
    const activeSet = new Set(activeCategories);
    return matches.filter((match) => {
      const category = getMatchCategoryFromRow(match);
      if (activeCategories.length > 0 && !activeSet.has(category)) return false;
      const range = categoryRangesParsed[category];
      if (!range) return true;
      return match.matchNumber >= range.start && match.matchNumber <= range.end;
    });
  }, [matches, activeCategories, categoryRangesParsed]);

  const allianceMatches = useMemo(() => {
    if (!isAllianceCoverageForm(selectedFormType)) return [] as AllianceMatchRow[];
    const teamNumber = Number(userData?.teamId || 0);
    if (!Number.isFinite(teamNumber) || teamNumber <= 0) return [] as AllianceMatchRow[];
    return visibleMatches
      .map((match) => {
        if (match.red.includes(teamNumber)) {
          return { ...match, alliance: "red" as const, allianceTeams: match.red };
        }
        if (match.blue.includes(teamNumber)) {
          return { ...match, alliance: "blue" as const, allianceTeams: match.blue };
        }
        return null;
      })
      .filter((row): row is AllianceMatchRow => Boolean(row));
  }, [selectedFormType, userData?.teamId, visibleMatches]);

  const showMatchFilters = isMatchBasedForm(selectedFormType);
  const showMatchCoverage = selectedFormType === "match-scout" || selectedFormType === "lead-scout";
  const showTeamCoverage = isTeamCoverageForm(selectedFormType);
  const showAllianceCoverage = isAllianceCoverageForm(selectedFormType);
  const teamCoverageTeams = showTeamCoverage
    ? eventTeams.length > 0
      ? eventTeams
      : scheduleTeams
    : [];
  const coverageLabel = showTeamCoverage
    ? "Teams Scouted"
    : selectedFormType === "helper"
    ? "Reports"
    : "Matches Scouted";
  const emptySummaryText = showTeamCoverage
    ? "No team scouting entries found for this selection."
    : selectedFormType === "helper"
    ? "No helper report entries found for this selection."
    : "No match scouting entries found for this selection.";

  return (
    <AnalyticsShell
      entriesCount={displayEntries.length}
      selectedGame={selectedGame}
      onSelectedGameChange={(game) => setSelectedGame(game as AnalyticsGame)}
      practiceMatchesOnly={practiceMatchesOnly}
      onPracticeMatchesOnlyChange={setPracticeMatchesOnly}
      selectedEvent={selectedEvent}
      eventOptions={eventOptions}
      onSelectedEventChange={setSelectedEvent}
    >
      <h1 className="text-3xl font-bold mb-2 theme-text">Scout Status</h1>
      <p className="text-gray-600 mb-6">Who has scouted and which match robots are covered.</p>
      <DataSourceCredits className="mb-6 max-w-3xl" />

      {loadingEntries ? (
        <LoadingSpinner message="Loading scouting entries..." />
      ) : (
        <>
          <div className="bg-white rounded-xl shadow-md p-4 mb-6">
            <h2 className="text-lg font-semibold mb-3">Form Type</h2>
            <div className="flex flex-wrap gap-2">
              {FORM_OPTIONS.map((option) => {
                const active = selectedFormType === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setSelectedFormType(option.id)}
                    className={`px-3 py-1 rounded border text-sm ${
                      active ? "text-white" : "bg-white text-gray-700 border-gray-300"
                    }`}
                    style={active ? { backgroundColor: "var(--primary-color)", borderColor: "var(--primary-color)" } : undefined}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          {showMatchFilters ? (
            <div className="bg-white rounded-xl shadow-md p-4 mb-6">
              <h2 className="text-lg font-semibold mb-3">Match Filters</h2>
              <div className="flex flex-wrap gap-2 mb-3">
                {CATEGORY_OPTIONS.map((option) => {
                  const active = activeCategories.includes(option.id);
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() =>
                        setActiveCategories((prev) =>
                          prev.includes(option.id) ? prev.filter((id) => id !== option.id) : [...prev, option.id]
                        )
                      }
                      className={`px-3 py-1 rounded border text-sm ${
                        active ? "text-white" : "bg-white text-gray-700 border-gray-300"
                      }`}
                      style={active ? { backgroundColor: "var(--primary-color)", borderColor: "var(--primary-color)" } : undefined}
                    >
                      {option.label}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setActiveCategories(CATEGORY_OPTIONS.map((option) => option.id))}
                  className="px-3 py-1 rounded border text-sm bg-white text-gray-700 border-gray-300"
                >
                  Select All
                </button>
                <button
                  type="button"
                  onClick={() => setActiveCategories([])}
                  className="px-3 py-1 rounded border text-sm bg-white text-gray-700 border-gray-300"
                >
                  Clear
                </button>
              </div>
              <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
                {CATEGORY_OPTIONS.map((option) => (
                  <label key={`range-${option.id}`} className="text-sm text-gray-700 flex flex-col gap-1">
                    <span>
                      {option.short} Range (e.g. {option.short}1-{option.short}36)
                    </span>
                    <input
                      type="text"
                      value={categoryRanges[option.id]}
                      onChange={(event) =>
                        setCategoryRanges((prev) => ({ ...prev, [option.id]: event.target.value }))
                      }
                      placeholder="1-36"
                      className="border rounded px-3 py-1.5 text-sm"
                    />
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-md p-4 mb-6">
              <h2 className="text-lg font-semibold mb-1">Match Filters</h2>
              <p className="text-sm text-gray-600">
                Match-category filters are only applied for match-based forms.
              </p>
            </div>
          )}

          <div className="bg-white rounded-xl shadow-md overflow-x-auto mb-6">
            <table className="w-full min-w-[520px]">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Scout</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{coverageLabel}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Entries</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Submit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {scoutStats.length === 0 ? (
                  <tr>
                    <td className="px-4 py-4 text-sm text-gray-600" colSpan={4}>
                      {emptySummaryText}
                    </td>
                  </tr>
                ) : (
                  scoutStats.map((row) => (
                    <tr key={row.id} data-analytics-search-item="true">
                      <td className="px-4 py-3 font-medium">{row.name}</td>
                      <td className="px-4 py-3">{row.matches.size}</td>
                      <td className="px-4 py-3">{row.entries}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {row.last ? new Date(row.last).toLocaleString() : "-"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {showMatchCoverage && (
            <div className="bg-white rounded-xl shadow-md overflow-x-auto">
              <div className="p-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold mb-1">Match Coverage</h2>
                <p className="text-sm text-gray-600">
                  Check whether each scheduled robot has a scouting entry. Multiple checkmarks mean multiple submissions.
                </p>
              </div>
              {selectedEvent === "all" ? (
                <div className="p-4 text-sm text-gray-600">Select a specific event to view match coverage.</div>
              ) : scheduleLoading ? (
                <div className="p-4">
                  <LoadingSpinner message="Loading match schedule..." />
                </div>
              ) : visibleMatches.length === 0 ? (
                <div className="p-4 text-sm text-gray-600">No matches found for the selected event.</div>
              ) : (
                <table className="w-full min-w-[900px]">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Match</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Red 1</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Red 2</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Red 3</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Blue 1</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Blue 2</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Blue 3</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {visibleMatches.map((match) => {
                      const matchKey = normalizeMatchLabel(match.label).matchId || `${match.level}-${match.matchNumber}`;
                      const timeLabel = match.time
                        ? new Date(match.time * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                        : "TBD";
                      const allTeams = [...match.red, ...match.blue];
                      const cells = allTeams.map((team) => {
                        const count = coverage.get(`${matchKey}::${team}`) || 0;
                        return (
                          <td key={`${match.key}-${team}`} className="px-4 py-3 text-sm">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold">{team}</span>
                              {count > 0 ? (
                                <span className="flex items-center gap-1">{renderCheckMarks(count)}</span>
                              ) : (
                                <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4 text-red-600">
                                  <path
                                    fill="currentColor"
                                    d="M5.3 4.3 4.3 5.3 9 10l-4.7 4.7 1 1L10 11l4.7 4.7 1-1L11 10l4.7-4.7-1-1L10 9 5.3 4.3z"
                                  />
                                </svg>
                              )}
                            </div>
                          </td>
                        );
                      });
                      return (
                        <tr key={match.key} data-analytics-search-item="true">
                          <td className="px-4 py-3 font-medium">{match.label}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">{timeLabel}</td>
                          {cells}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {showAllianceCoverage && (
            <div className="bg-white rounded-xl shadow-md overflow-x-auto">
              <div className="p-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold mb-1">Your Alliance Coverage</h2>
                <p className="text-sm text-gray-600">
                  Only matches that include your team are shown. A single form submission covers the whole alliance.
                </p>
              </div>
              {selectedEvent === "all" ? (
                <div className="p-4 text-sm text-gray-600">Select a specific event to view alliance coverage.</div>
              ) : scheduleLoading ? (
                <div className="p-4">
                  <LoadingSpinner message="Loading match schedule..." />
                </div>
              ) : allianceMatches.length === 0 ? (
                <div className="p-4 text-sm text-gray-600">No matches found for your team in this selection.</div>
              ) : (
                <table className="w-full min-w-[720px]">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Match</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Team 1</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Team 2</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Team 3</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {allianceMatches.map((match) => {
                      const matchKey = normalizeMatchLabel(match.label).matchId || `${match.level}-${match.matchNumber}`;
                      const timeLabel = match.time
                        ? new Date(match.time * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                        : "TBD";
                      const count = coverage.get(matchKey) || 0;
                      return (
                        <tr key={match.key} data-analytics-search-item="true">
                          <td className="px-4 py-3 font-medium">{match.label}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">{timeLabel}</td>
                          {match.allianceTeams.map((team) => (
                            <td key={`${match.key}-${team}`} className="px-4 py-3 text-sm">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold">{team}</span>
                                {count > 0 ? (
                                  <span className="flex items-center gap-1">{renderCheckMarks(count)}</span>
                                ) : (
                                  <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4 text-red-600">
                                    <path
                                      fill="currentColor"
                                      d="M5.3 4.3 4.3 5.3 9 10l-4.7 4.7 1 1L10 11l4.7 4.7 1-1L11 10l4.7-4.7-1-1L10 9 5.3 4.3z"
                                    />
                                  </svg>
                                )}
                              </div>
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {showTeamCoverage && (
            <div className="bg-white rounded-xl shadow-md">
              <div className="p-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold mb-1">Team Coverage</h2>
                <p className="text-sm text-gray-600">
                  Check whether each team has a scouting entry. Multiple checkmarks mean multiple submissions.
                </p>
              </div>
              {selectedEvent === "all" ? (
                <div className="p-4 text-sm text-gray-600">Select a specific event to view team coverage.</div>
              ) : teamsLoading ? (
                <div className="p-4">
                  <LoadingSpinner message="Loading team list..." />
                </div>
              ) : teamCoverageTeams.length === 0 ? (
                <div className="p-4 text-sm text-gray-600">No teams found for the selected event.</div>
              ) : (
                <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  {teamCoverageTeams.map((team) => {
                    const count = coverage.get(team) || 0;
                    return (
                      <div key={team} className="border rounded-lg px-3 py-2 flex items-center justify-between">
                        <span className="font-semibold">{team}</span>
                        {count > 0 ? (
                          <span className="flex items-center gap-1">{renderCheckMarks(count)}</span>
                        ) : (
                          <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4 text-red-600">
                            <path
                              fill="currentColor"
                              d="M5.3 4.3 4.3 5.3 9 10l-4.7 4.7 1 1L10 11l4.7 4.7 1-1L11 10l4.7-4.7-1-1L10 9 5.3 4.3z"
                            />
                          </svg>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {teamLoadNote && teamCoverageTeams.length > 0 && (
                <div className="px-4 pb-4 text-xs text-gray-500">{teamLoadNote}</div>
              )}
            </div>
          )}

          {selectedFormType === "helper" && (
            <div className="bg-white rounded-xl shadow-md">
              <div className="p-4 text-sm text-gray-600">
                Helper reports do not include match-level coverage.
              </div>
            </div>
          )}
        </>
      )}
    </AnalyticsShell>
  );
}

export default function ScoutStatusPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["team-coach", "lead-scout", "coach"]}>
      <ScoutStatusContent />
    </ProtectedRoute>
  );
}
