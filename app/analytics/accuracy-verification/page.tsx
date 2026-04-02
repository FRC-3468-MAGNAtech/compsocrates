"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { addDoc, collection, getDoc, getDocs, query, where, doc, updateDoc, deleteDoc } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import AnalyticsShell from "@/app/components/AnalyticsShell";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import { useAuth } from "@/app/AuthContext";
import { FormAccessOverrides, canAccessForm, getUserRoles, normalizeFormAccessOverrides } from "@/app/utils/roles";
import {
  entryMatchesAnalyticsFilters,
  getEventOptionsForEntries,
  getEventsForGame,
  isPracticeScoutedEntry,
  normalizeMatchLabel,
  type AnalyticsGame,
} from "@/app/utils/analyticsEvents";
import { normalizeEventKey } from "@/app/utils/events";
import { formatMatchLabelLong, getMatchLabelMeta } from "@/app/utils/displayFormat";
import { getEventMatches, type TBAMatch } from "@/app/utils/tba-api";
import { fetchFirstSchedule, splitFirstAllianceTeams } from "@/app/utils/firstSchedule";
import { computeRescoutDiff } from "@/app/utils/rescoutComparison";

type ScoutingEntry = {
  id: string;
  eventKey?: string;
  eventName?: string;
  matchId?: string;
  matchKey?: string;
  matchLabel?: string;
  matchType?: string;
  matchNumber?: string;
  teamNumber?: string;
  alliance?: string;
  allianceColor?: string;
  assignedAlliance?: string;
  scoutName?: string;
  scoutId?: string;
  entryType?: string;
  formType?: string;
  game?: string;
  submittedAt?: number;
  timestamp?: number;
  createdAt?: number;
  accuracyScriptStatus?: string;
  scriptStatus?: string;
  allianceAccuracy?: number | string;
  accuracy?: number | string;
};

type RescoutEntry = {
  id: string;
  teamId?: string;
  eventKey?: string;
  eventName?: string;
  matchKey?: string;
  matchLabel?: string;
  alliance?: "red" | "blue";
  teamNumber?: number;
  scoutId?: string;
  scoutName?: string;
  status?: string;
  accuracy?: number;
  scoutedScore?: number;
  officialScore?: number;
  penaltyPoints?: number;
  comparisonDiffPercent?: number;
  comparisonComputedAt?: number;
  criticalFlag?: boolean;
  createdAt?: number;
  updatedAt?: number;
  submittedAt?: number;
  practiceSessionId?: string;
  originalScouts?: string[];
};

type AllianceGroup = {
  alliance: "red" | "blue";
  teams: number[];
  scouts: string[];
  accuracy: number | null;
  status: string;
};

type HighAccuracyMatch = {
  key: string;
  eventKey: string;
  eventName: string;
  matchKey: string;
  matchLabel: string;
  sortOrder: number;
  matchAccuracy: number | null;
  alliances: AllianceGroup[];
};

type MatchAllianceMap = Record<string, { red: number[]; blue: number[] }>;

function normalizeAlliance(value: unknown): "red" | "blue" | null {
  const raw = String(value || "").toLowerCase().trim();
  if (raw.startsWith("r")) return "red";
  if (raw.startsWith("b")) return "blue";
  return null;
}

function resolveAlliance(entry: ScoutingEntry): "red" | "blue" | null {
  return (
    normalizeAlliance(entry.alliance) ||
    normalizeAlliance(entry.allianceColor) ||
    normalizeAlliance(entry.assignedAlliance)
  );
}

function getEntryTime(entry: ScoutingEntry): number {
  const raw = Number(entry.submittedAt ?? entry.timestamp ?? entry.createdAt ?? 0);
  return Number.isFinite(raw) ? raw : 0;
}

function parseTeamNumber(value: unknown): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const digits = raw.match(/\d+/)?.[0];
  const num = Number(digits ?? raw);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function resolveMatchKey(entry: ScoutingEntry): string {
  const rawMatch = String(entry.matchId || entry.matchKey || entry.matchLabel || "").trim();
  if (!rawMatch) return "";
  const parsed = normalizeMatchLabel(rawMatch);
  return parsed.matchId || rawMatch;
}

function resolveMatchLabel(entry: ScoutingEntry): string {
  const rawMatch = String(entry.matchLabel || entry.matchId || entry.matchKey || "").trim();
  if (!rawMatch) return "-";
  const parsed = normalizeMatchLabel(rawMatch);
  return formatMatchLabelLong(parsed.matchId || rawMatch);
}

function resolveAccuracy(entry: ScoutingEntry): number | null {
  const candidate = entry.allianceAccuracy ?? entry.accuracy;
  if (typeof candidate === "string") {
    const cleaned = candidate.replace(/%/g, "").trim();
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const raw = Number(candidate ?? NaN);
  return Number.isFinite(raw) ? raw : null;
}

function isAccuracyComplete(entry: ScoutingEntry): boolean {
  const status = String(entry.accuracyScriptStatus || entry.scriptStatus || "").toLowerCase().trim();
  return status === "complete";
}

function calculateAccuracy(scottedScore: number, officialScore: number): number {
  if (!officialScore) return 0;
  const error = Math.abs(officialScore - scottedScore);
  return Math.round(Math.max(0, (1 - error / officialScore) * 100));
}

function normalizeMatchId(value: string): string {
  const parsed = normalizeMatchLabel(value || "");
  return parsed.matchId || String(value || "").trim();
}

function resolveAllianceFromSchedule(entry: ScoutingEntry, matchAllianceMap: MatchAllianceMap): "red" | "blue" | null {
  const teamNumber = parseTeamNumber(entry.teamNumber);
  if (!teamNumber) return null;
  const matchKey = resolveMatchKey(entry);
  if (!matchKey) return null;
  const eventKey = normalizeEventKey(String(entry.eventKey || "").trim());
  if (!eventKey) return null;
  const schedule = matchAllianceMap[`${eventKey}::${matchKey}`];
  if (!schedule) return null;
  if (schedule.red.includes(teamNumber)) return "red";
  if (schedule.blue.includes(teamNumber)) return "blue";
  return null;
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function inferEventKeyFromMatchKey(matchKey: string): string {
  const parsed = String(matchKey || "").trim().match(/^(\d{4}[a-z0-9]+)_/i);
  return parsed?.[1] || "";
}

export default function AccuracyVerificationPage() {
  return (
    <ProtectedRoute>
      <AccuracyVerificationContent />
    </ProtectedRoute>
  );
}

function AccuracyVerificationContent() {
  const router = useRouter();
  const { userData } = useAuth();
  const roles = getUserRoles(userData);
  const [formAccessOverrides, setFormAccessOverrides] = useState<FormAccessOverrides>({});
  const canSee = canAccessForm({ formKey: "accuracy-verification", user: userData, formAccessOverrides });
  const canManageAll = Boolean(userData?.isTeamAdmin);

  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<ScoutingEntry[]>([]);
  const [rescouts, setRescouts] = useState<RescoutEntry[]>([]);
  const [selectedGame, setSelectedGame] = useState<AnalyticsGame>("REBUILT");
  const [selectedEvent, setSelectedEvent] = useState<string>("all");
  const [eventOptions, setEventOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [showAllCritical, setShowAllCritical] = useState(false);
  const [showAllHighAccuracy, setShowAllHighAccuracy] = useState(false);
  const [showAllMine, setShowAllMine] = useState(false);
  const [showAllAll, setShowAllAll] = useState(false);
  const [activeRescout, setActiveRescout] = useState<HighAccuracyMatch | null>(null);
  const [activeAlliance, setActiveAlliance] = useState<AllianceGroup | null>(null);
  const [savingRescout, setSavingRescout] = useState(false);
  const [matchAllianceMap, setMatchAllianceMap] = useState<MatchAllianceMap>({});

  useEffect(() => {
    const teamId = userData?.teamId;
    if (!teamId) return;
    const resolvedTeamId = String(teamId);
    let isActive = true;
    async function loadOverrides() {
      try {
        const teamSnap = await getDoc(doc(db, "teams", resolvedTeamId));
        if (!isActive) return;
        if (teamSnap.exists()) {
          const data = teamSnap.data() as Record<string, unknown>;
          setFormAccessOverrides(normalizeFormAccessOverrides(data.formAccessOverrides));
        } else {
          setFormAccessOverrides({});
        }
      } catch (error) {
        console.error("Failed loading permissions overrides:", error);
        setFormAccessOverrides({});
      }
    }
    void loadOverrides();
    return () => {
      isActive = false;
    };
  }, [userData?.teamId]);

  useEffect(() => {
    const teamId = userData?.teamId;
    if (!teamId || !canSee) return;
    let isActive = true;
    async function loadData() {
      setLoading(true);
      try {
        const snap = await getDocs(query(collection(db, "scouting"), where("teamId", "==", teamId)));
        const rows: ScoutingEntry[] = snap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Omit<ScoutingEntry, "id">),
        }));
        if (!isActive) return;
        const rescoutSnap = await getDocs(query(collection(db, "accuracyRescouts"), where("teamId", "==", teamId)));
        if (!isActive) return;
        const rescoutRows: RescoutEntry[] = rescoutSnap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Omit<RescoutEntry, "id">),
        })).filter((row) => String(row.status || "").toLowerCase() !== "deleted");
        const sessionIds = Array.from(
          new Set(rescoutRows.map((row) => String(row.practiceSessionId || "").trim()).filter((id) => id.length > 0))
        );
        const extraEntries: ScoutingEntry[] = [];
        for (let i = 0; i < sessionIds.length; i += 10) {
          const chunk = sessionIds.slice(i, i + 10);
          const sessionSnap = await getDocs(query(collection(db, "scouting"), where("practiceSessionId", "in", chunk)));
          sessionSnap.docs.forEach((docSnap) => {
            extraEntries.push({
              id: docSnap.id,
              ...(docSnap.data() as Omit<ScoutingEntry, "id">),
            });
          });
        }
        const mergedMap = new Map<string, ScoutingEntry>();
        [...rows, ...extraEntries].forEach((entry) => {
          if (entry.id) mergedMap.set(entry.id, entry);
        });
        const mergedRows = Array.from(mergedMap.values());
        setEntries(mergedRows);
        setEventOptions(getEventOptionsForEntries(mergedRows, selectedGame));
        setRescouts(rescoutRows);
      } catch (error) {
        console.error("Failed loading accuracy verification data:", error);
      } finally {
        if (isActive) setLoading(false);
      }
    }
    void loadData();
    return () => {
      isActive = false;
    };
  }, [userData?.teamId, canSee, selectedGame]);

  useEffect(() => {
    if (!eventOptions.length) return;
    if (!eventOptions.some((option) => option.id === selectedEvent)) {
      setSelectedEvent(eventOptions[0]?.id || "all");
    }
  }, [eventOptions, selectedEvent]);

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (isPracticeScoutedEntry(entry as Parameters<typeof isPracticeScoutedEntry>[0])) return false;
      const eventId = selectedEvent === "all" ? "all" : selectedEvent;
      const normalizedEntry = {
        ...entry,
        game: entry.game || selectedGame,
      } as ScoutingEntry;
      const eventOptionsForGame = getEventsForGame(selectedGame);
      const matchesFilters = entryMatchesAnalyticsFilters(
        normalizedEntry,
        selectedGame,
        eventId,
        eventOptionsForGame
      );
      if (matchesFilters) return true;
      if (eventId === "all") return true;
      const option = eventOptionsForGame.find((event) => normalizeEventKey(event.id) === normalizeEventKey(eventId));
      if (!option) return false;
      const entryName = normalizeName(String(entry.eventName || ""));
      const optionName = normalizeName(String(option.name || ""));
      return Boolean(entryName && optionName && entryName === optionName);
    });
  }, [entries, selectedEvent, selectedGame]);

  const matchListEventKeys = useMemo(() => {
    if (selectedEvent !== "all") return [selectedEvent];
    const keys = new Set<string>();
    filteredEntries.forEach((entry) => {
      const key = normalizeEventKey(String(entry.eventKey || "").trim());
      if (key) keys.add(key);
    });
    return Array.from(keys);
  }, [filteredEntries, selectedEvent]);

  useEffect(() => {
    const teamId = userData?.teamId;
    if (!teamId || !canSee) return;
    if (matchListEventKeys.length === 0) {
      setMatchAllianceMap({});
      return;
    }
    let isActive = true;
    async function loadMatchAlliances() {
      try {
        const teamSnap = await getDoc(doc(db, "teams", String(teamId)));
        const encryptedKey = String(teamSnap.data()?.tbaApiKeyEncrypted || "").trim();
        const plainKey = String(teamSnap.data()?.tbaApiKey || "").trim();
        const map: MatchAllianceMap = {};

        for (const rawEventKey of matchListEventKeys) {
          const eventKey = normalizeEventKey(String(rawEventKey || "").trim());
          if (!eventKey) continue;
          let matches: TBAMatch[] = [];
          try {
            const response = await fetch("/api/tba/matches", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ eventKey, encryptedKey, plainKey }),
            });
            if (response.ok) {
              const payload = (await response.json()) as { matches?: TBAMatch[] };
              if (Array.isArray(payload.matches)) matches = payload.matches;
            }
          } catch (error) {
            console.warn("Accuracy verification TBA proxy failed:", error);
          }

          if (matches.length === 0) {
            try {
              matches = await getEventMatches(eventKey, plainKey || undefined);
            } catch (error) {
              console.warn("Accuracy verification direct TBA fetch failed:", error);
            }
          }

          matches.forEach((match) => {
            const parsed = normalizeMatchLabel(match.key || "");
            const matchId = parsed.matchId || "";
            if (!matchId) return;
            const red = match.alliances?.red?.team_keys
              ?.map((k) => Number(String(k).replace("frc", "")))
              .filter((n) => Number.isFinite(n)) as number[] | undefined;
            const blue = match.alliances?.blue?.team_keys
              ?.map((k) => Number(String(k).replace("frc", "")))
              .filter((n) => Number.isFinite(n)) as number[] | undefined;
            if (!red && !blue) return;
            map[`${eventKey}::${matchId}`] = { red: red || [], blue: blue || [] };
          });

          const firstPractice = await fetchFirstSchedule(eventKey, "Practice");
          firstPractice.forEach((match) => {
            const { red, blue } = splitFirstAllianceTeams(match);
            if (red.length === 0 && blue.length === 0) return;
            const matchId = normalizeMatchLabel(`Practice ${match.matchNumber}`).matchId || "";
            if (!matchId) return;
            const key = `${eventKey}::${matchId}`;
            if (!map[key]) map[key] = { red, blue };
          });
        }

        if (isActive) setMatchAllianceMap(map);
      } catch (error) {
        console.warn("Failed loading match list alliances:", error);
        if (isActive) setMatchAllianceMap({});
      }
    }
    void loadMatchAlliances();
    return () => {
      isActive = false;
    };
  }, [userData?.teamId, canSee, matchListEventKeys]);

  const highAccuracyMatches = useMemo<HighAccuracyMatch[]>(() => {
    const byMatch = new Map<string, HighAccuracyMatch>();
    filteredEntries.forEach((entry) => {
      const alliance = resolveAlliance(entry) || resolveAllianceFromSchedule(entry, matchAllianceMap);
      if (!alliance) return;
      const matchKey = resolveMatchKey(entry);
      if (!matchKey) return;
      const eventKey = normalizeEventKey(String(entry.eventKey || "").trim());
      const eventName = String(entry.eventName || eventKey || "Event").trim() || "Event";
      const matchLabel = resolveMatchLabel(entry);
      const meta = getMatchLabelMeta(matchKey);
      const sortOrder = meta.order * 10000 + (meta.matchNumber || 0);
      const key = `${eventKey}::${matchKey}`;
      if (!byMatch.has(key)) {
        byMatch.set(key, {
          key,
          eventKey,
          eventName,
          matchKey,
          matchLabel,
          sortOrder,
          matchAccuracy: null,
          alliances: [],
        });
      }
      const group = byMatch.get(key)!;
      let allianceGroup = group.alliances.find((item) => item.alliance === alliance);
      if (!allianceGroup) {
        allianceGroup = { alliance, teams: [], scouts: [], accuracy: null, status: "complete" };
        group.alliances.push(allianceGroup);
      }
      const teamNumber = parseTeamNumber(entry.teamNumber);
      if (teamNumber && !allianceGroup.teams.includes(teamNumber)) allianceGroup.teams.push(teamNumber);
      const scoutName = String(entry.scoutName || "").trim();
      if (scoutName && !allianceGroup.scouts.includes(scoutName)) allianceGroup.scouts.push(scoutName);
      const accuracy = resolveAccuracy(entry);
      if (accuracy !== null) {
        allianceGroup.accuracy = Math.max(allianceGroup.accuracy ?? 0, accuracy);
        group.matchAccuracy = Math.max(group.matchAccuracy ?? 0, accuracy);
      }
    });

    const matches = Array.from(byMatch.values())
      .map((match) => {
        const eligibleAlliances = match.alliances
          .filter((alliance) => alliance.teams.length === 3 && (alliance.accuracy ?? 0) >= 75)
          .sort((a, b) => (a.alliance === "red" ? -1 : 1));
        const bestAccuracy = eligibleAlliances.reduce(
          (max, alliance) => Math.max(max, alliance.accuracy ?? 0),
          0
        );
        return {
          ...match,
          alliances: eligibleAlliances,
          matchAccuracy: bestAccuracy || null,
        };
      })
      .filter((match) => match.alliances.length > 0)
      .sort((a, b) => {
        const accDiff = (b.matchAccuracy ?? -1) - (a.matchAccuracy ?? -1);
        if (accDiff !== 0) return accDiff;
        return (a.eventName || "").localeCompare(b.eventName || "") || b.sortOrder - a.sortOrder;
      });
    return matches;
  }, [filteredEntries, matchAllianceMap]);

  const criticalFlags = useMemo(() => rescouts.filter((row) => row.criticalFlag), [rescouts]);

  const originalScoutingByKey = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    entries.forEach((entry) => {
      if (isPracticeScoutedEntry(entry as Parameters<typeof isPracticeScoutedEntry>[0])) return;
      const alliance = resolveAlliance(entry);
      if (!alliance) return;
      const teamNumber = parseTeamNumber(entry.teamNumber);
      if (!teamNumber) return;
      const eventKey = normalizeEventKey(String(entry.eventKey || "").trim());
      const matchKey = normalizeMatchId(resolveMatchKey(entry));
      if (!eventKey || !matchKey) return;
      const key = `${eventKey}::${matchKey}::${alliance}::${teamNumber}`;
      const existing = map.get(key);
      if (!existing || getEntryTime(entry) < getEntryTime(existing as ScoutingEntry)) {
        map.set(key, entry as unknown as Record<string, unknown>);
      }
    });
    return map;
  }, [entries]);

  const practiceScoutingBySessionId = useMemo(() => {
    const map = new Map<string, Record<string, unknown>[]>();
    entries.forEach((entry) => {
      if (!isPracticeScoutedEntry(entry as Parameters<typeof isPracticeScoutedEntry>[0])) return;
      const sessionId = String((entry as unknown as Record<string, unknown>).practiceSessionId || "").trim();
      if (!sessionId) return;
      const list = map.get(sessionId) || [];
      list.push(entry as unknown as Record<string, unknown>);
      map.set(sessionId, list);
    });
    return map;
  }, [entries]);

  const rescoutGroups = useMemo(() => {
    const map = new Map<string, {
      key: string;
      eventKey: string;
      matchKey: string;
      alliance: "red" | "blue";
      rescouts: RescoutEntry[];
      teamNumbers: number[];
      officialScore: number | null;
      totalScoutedScore: number | null;
      accuracy: number | null;
      penaltyPoints: number | null;
    }>();
    rescouts.forEach((row) => {
      const isSubmitted =
        String(row.status || "").toLowerCase() === "submitted" ||
        Boolean(row.practiceSessionId) ||
        Boolean(row.submittedAt);
      if (!isSubmitted) return;
      const alliance = String(row.alliance || "").toLowerCase() === "blue" ? "blue" : "red";
      const teamNumber = typeof row.teamNumber === "number" ? row.teamNumber : Number(row.teamNumber || 0);
      if (!Number.isFinite(teamNumber) || teamNumber <= 0) return;
      const eventKey = normalizeEventKey(String(row.eventKey || "").trim());
      const matchKey = normalizeMatchId(String(row.matchKey || "").trim());
      if (!matchKey || !eventKey) return;
      const key = `${eventKey}::${matchKey}::${alliance}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          eventKey,
          matchKey,
          alliance,
          rescouts: [],
          teamNumbers: [],
          officialScore: null,
          totalScoutedScore: null,
          accuracy: null,
          penaltyPoints: null,
        });
      }
      const group = map.get(key)!;
      const existing = group.rescouts.find((entry) => Number(entry.teamNumber || 0) === teamNumber);
      if (existing) {
        const existingTime = Number(existing.submittedAt || existing.updatedAt || existing.createdAt || 0);
        const currentTime = Number(row.submittedAt || row.updatedAt || row.createdAt || 0);
        if (currentTime > 0 && (existingTime === 0 || currentTime < existingTime)) {
          group.rescouts = group.rescouts.filter((entry) => Number(entry.teamNumber || 0) !== teamNumber);
          group.rescouts.push(row);
        }
      } else {
        group.rescouts.push(row);
        group.teamNumbers.push(teamNumber);
      }
      if (typeof row.officialScore === "number" && Number.isFinite(row.officialScore)) {
        group.officialScore = Math.max(group.officialScore ?? 0, row.officialScore);
      }
      if (typeof row.penaltyPoints === "number" && Number.isFinite(row.penaltyPoints)) {
        group.penaltyPoints = Math.max(group.penaltyPoints ?? 0, row.penaltyPoints);
      }
    });

    map.forEach((group) => {
      if (group.teamNumbers.length < 3) return;
      const totalScoutedScore = group.rescouts.reduce((sum, row) => {
        const score = typeof row.scoutedScore === "number" ? row.scoutedScore : Number(row.scoutedScore || 0);
        return sum + (Number.isFinite(score) ? score : 0);
      }, 0);
      const penalty = typeof group.penaltyPoints === "number" ? group.penaltyPoints : 0;
      group.totalScoutedScore = totalScoutedScore + penalty;
      if (group.officialScore && Number.isFinite(group.officialScore)) {
        group.accuracy = calculateAccuracy(group.totalScoutedScore ?? 0, group.officialScore);
      }
    });

    return map;
  }, [rescouts]);

  const rescoutGroupByKey = useMemo(() => {
    const map = new Map<string, (typeof rescoutGroups extends Map<string, infer T> ? T : never)>();
    rescoutGroups.forEach((group) => {
      map.set(group.key, group);
    });
    return map;
  }, [rescoutGroups]);

  function getRescoutGroupKey(eventKey: string, matchKey: string, alliance: "red" | "blue") {
    return `${normalizeEventKey(eventKey)}::${normalizeMatchId(matchKey)}::${alliance}`;
  }

  function isRescoutComplete(eventKey: string, matchKey: string, alliance: "red" | "blue") {
    const key = getRescoutGroupKey(eventKey, matchKey, alliance);
    const group = rescoutGroupByKey.get(key);
    return Boolean(group && group.teamNumbers.length === 3);
  }

  function getRescoutAccuracy(eventKey: string, matchKey: string, alliance: "red" | "blue") {
    const key = getRescoutGroupKey(eventKey, matchKey, alliance);
    const group = rescoutGroupByKey.get(key);
    return typeof group?.accuracy === "number" ? group.accuracy : null;
  }

  const comparisonByGroup = useMemo(() => {
    const map = new Map<string, { diffPercent: number }>();
    rescoutGroups.forEach((group) => {
      if (group.teamNumbers.length < 3) return;
      if ((group.accuracy ?? 0) < 95) return;
      let totalDiff = 0;
      let count = 0;
      group.rescouts.forEach((row) => {
        const sessionId = String(row.practiceSessionId || "").trim();
        if (!sessionId) return;
        const teamNumber = Number(row.teamNumber || 0);
        const candidates = practiceScoutingBySessionId.get(sessionId) || [];
        const exemplar = candidates.find((entry) => Number(entry.teamNumber || 0) === teamNumber);
        if (!exemplar) return;
        const originalKey = `${group.eventKey}::${group.matchKey}::${group.alliance}::${teamNumber}`;
        const original = originalScoutingByKey.get(originalKey);
        if (!original) return;
        const diff = computeRescoutDiff(original, exemplar).diffPercent;
        totalDiff += diff;
        count += 1;
      });
      if (count === 0) return;
      map.set(group.key, { diffPercent: Math.round((totalDiff / count) * 10) / 10 });
    });
    return map;
  }, [rescoutGroups, practiceScoutingBySessionId, originalScoutingByKey]);

  useEffect(() => {
    const updates: Array<Promise<void>> = [];
    rescoutGroups.forEach((group) => {
      if (group.teamNumbers.length < 3) return;

      // Persist group accuracy for visibility, even if below threshold.
      group.rescouts.forEach((row) => {
        const nextAccuracy = typeof group.accuracy === "number" ? group.accuracy : null;
        const needsAccuracyUpdate = row.accuracy !== nextAccuracy;
        if (!needsAccuracyUpdate) return;
        updates.push(
          updateDoc(doc(db, "accuracyRescouts", row.id), {
            accuracy: nextAccuracy,
          }).then(() => {})
        );
      });

      if ((group.accuracy ?? 0) < 95) {
        group.rescouts.forEach((row) => {
          if (row.criticalFlag) {
            updates.push(
              updateDoc(doc(db, "accuracyRescouts", row.id), {
                criticalFlag: false,
              }).then(() => {})
            );
          }
        });
        return;
      }
      const comparison = comparisonByGroup.get(group.key);
      if (!comparison) return;
      const isCritical = comparison.diffPercent > 5;
      group.rescouts.forEach((row) => {
        const needsUpdate =
          row.criticalFlag !== isCritical ||
          typeof row.comparisonDiffPercent !== "number";
        if (!needsUpdate) return;
        updates.push(
          updateDoc(doc(db, "accuracyRescouts", row.id), {
            criticalFlag: isCritical,
            comparisonDiffPercent: comparison.diffPercent,
            comparisonComputedAt: Date.now(),
          }).then(() => {})
        );
      });
    });
    if (updates.length > 0) {
      void Promise.allSettled(updates);
    }
  }, [rescoutGroups, comparisonByGroup]);

  const rescoutsByTeam = useMemo(() => {
    const map = new Map<string, RescoutEntry>();
    rescouts.forEach((row) => {
      const isSubmitted =
        String(row.status || "").toLowerCase() === "submitted" ||
        Boolean(row.practiceSessionId) ||
        Boolean(row.submittedAt);
      if (!isSubmitted) return;
      const eventKey = normalizeEventKey(String(row.eventKey || "").trim());
      const matchKey = normalizeMatchId(String(row.matchKey || "").trim());
      const teamNumber = Number(row.teamNumber || 0);
      if (!eventKey || !matchKey || !Number.isFinite(teamNumber) || teamNumber <= 0) return;
      const key = `${eventKey}::${matchKey}::${teamNumber}`;
      map.set(key, row);
    });

    rescoutGroups.forEach((group) => {
      if (group.teamNumbers.length < 3) return;
      if ((group.accuracy ?? 0) >= 95) return;
      group.teamNumbers.forEach((teamNumber) => {
        const key = `${group.eventKey}::${group.matchKey}::${teamNumber}`;
        map.delete(key);
      });
    });
    return map;
  }, [rescoutGroups, rescouts]);

  const myRescouts = useMemo(() => {
    const myId = userData?.uid;
    return rescouts
      .filter((row) => row.scoutId && row.scoutId === myId)
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  }, [rescouts, userData?.uid]);

  async function handleRescout(teamNumber: number) {
    if (!userData?.teamId || !userData?.uid || !activeRescout || !activeAlliance) return;
    if (savingRescout) return;
    setSavingRescout(true);
    try {
      const safeTeamId = String(userData.teamId);
      const rawEventKey = normalizeEventKey(String(activeRescout.eventKey || "").trim());
      const eventKeyFromMatch = normalizeEventKey(inferEventKeyFromMatchKey(safeMatchKey));
      const eventKeyFromName =
        eventOptions.find(
          (event) => normalizeName(String(event.name || "")) === normalizeName(String(activeRescout.eventName || ""))
        )?.id || "";
      const fallbackEventKey = normalizeEventKey(String(eventKeyFromMatch || eventKeyFromName || "").trim());
      const safeEventKey =
        rawEventKey && rawEventKey !== "all"
          ? rawEventKey
          : fallbackEventKey && fallbackEventKey !== "all"
          ? fallbackEventKey
          : "";
      const safeMatchKey = resolveMatchKey({
        matchId: activeRescout.matchKey,
        matchKey: activeRescout.matchKey,
        matchLabel: activeRescout.matchLabel,
      } as ScoutingEntry);
      const safeMatchLabel = activeRescout.matchLabel || resolveMatchLabel({
        matchId: activeRescout.matchKey,
        matchKey: activeRescout.matchKey,
        matchLabel: activeRescout.matchLabel,
      } as ScoutingEntry);
      const safeEventName =
        activeRescout.eventName ||
        eventOptions.find((event) => normalizeEventKey(event.id) === normalizeEventKey(selectedEvent))?.name ||
        safeEventKey ||
        "Event";
      const safeAlliance = activeAlliance.alliance || "red";
      if (!safeEventKey) {
        alert("Unable to determine event key for this match. Please select a specific event and try again.");
        return;
      }

      const docRef = await addDoc(collection(db, "accuracyRescouts"), {
        teamId: safeTeamId,
        eventKey: safeEventKey,
        eventName: safeEventName,
        matchKey: safeMatchKey,
        matchLabel: safeMatchLabel,
        game: selectedGame,
        alliance: safeAlliance,
        teamNumber,
        scoutId: userData.uid,
        scoutName: userData.displayName || "",
        status: "pending",
        accuracy: null,
        criticalFlag: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        originalScouts: activeAlliance.scouts || [],
      });
      setActiveRescout(null);
      setActiveAlliance(null);
      const params = new URLSearchParams({
        rescoutId: docRef.id,
        matchKey: safeMatchKey,
        teamNumber: String(teamNumber),
        alliance: safeAlliance,
        game: selectedGame,
        eventKey: safeEventKey,
        eventName: safeEventName,
      });
      router.push(`/practice-scouting?${params.toString()}`);
    } catch (error) {
      console.error("Failed to create rescout entry:", error);
      const message = error instanceof Error ? error.message : String(error);
      alert(`Could not start rescout request: ${message}`);
    } finally {
      setSavingRescout(false);
    }
  }

  async function handleDeleteRescout(rescoutId: string) {
    if (!confirm("Delete this rescout entry?")) return;
    try {
      await deleteDoc(doc(db, "accuracyRescouts", rescoutId));
      setRescouts((prev) => prev.filter((row) => row.id !== rescoutId));
    } catch (error) {
      console.error("Failed deleting rescout:", error);
      try {
        await updateDoc(doc(db, "accuracyRescouts", rescoutId), {
          status: "deleted",
          deletedAt: Date.now(),
        });
        setRescouts((prev) => prev.filter((row) => row.id !== rescoutId));
      } catch (fallbackError) {
        console.error("Fallback delete failed:", fallbackError);
        alert("Could not delete rescout entry.");
      }
    }
  }

  function openComparison(eventKey: string, matchKey: string, alliance: "red" | "blue") {
    const params = new URLSearchParams({
      eventKey: normalizeEventKey(eventKey),
      matchKey: normalizeMatchId(matchKey),
      alliance,
    });
    router.push(`/analytics/accuracy-compare?${params.toString()}`);
  }

  if (!canSee) {
    return (
      <div className="flex h-screen bg-gray-100">
        <div className="m-auto text-center text-gray-600">You do not have access to Accuracy Verification.</div>
      </div>
    );
  }

  if (loading) {
    return (
      <AnalyticsShell
        entriesCount={filteredEntries.length}
        selectedGame={selectedGame}
        onSelectedGameChange={(game) => setSelectedGame(game as AnalyticsGame)}
        selectedEvent={selectedEvent}
        eventOptions={eventOptions}
        onSelectedEventChange={(eventId) => setSelectedEvent(eventId)}
      >
        <div className="py-10">
          <LoadingSpinner message="Loading accuracy verification..." />
        </div>
      </AnalyticsShell>
    );
  }

  const criticalVisible = showAllCritical ? criticalFlags : criticalFlags.slice(0, 6);
  const highAccuracyVisible = showAllHighAccuracy ? highAccuracyMatches : highAccuracyMatches.slice(0, 6);
  const myVisible = showAllMine ? myRescouts : myRescouts.slice(0, 6);
  const allVisible = showAllAll ? rescouts : rescouts.slice(0, 6);

  return (
    <AnalyticsShell
      entriesCount={filteredEntries.length}
      selectedGame={selectedGame}
      onSelectedGameChange={(game) => setSelectedGame(game as AnalyticsGame)}
      selectedEvent={selectedEvent}
      eventOptions={eventOptions}
      onSelectedEventChange={(eventId) => setSelectedEvent(eventId)}
    >
      <div className="space-y-6">
        <div className="bg-white rounded-xl shadow p-6">
          <h1 className="text-2xl font-bold" style={{ color: "var(--primary-color)" }}>
            Accuracy Verification
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            High-accuracy matches are ready to be re-scouted by experienced scouts for verification.
          </p>
        </div>

        <SectionCard
          title="Critical Flagged Matches"
          description="Matches where re-scouted accuracy diverges from live scouting."
          items={criticalVisible}
          emptyLabel="No critical flags yet."
          showToggle={criticalFlags.length > 6}
          onToggle={() => setShowAllCritical((v) => !v)}
          showAll={showAllCritical}
        >
          {criticalVisible.map((row) => (
            <div key={row.id} className="border rounded-lg p-3">
              <p className="font-semibold">
                {row.matchLabel || "Match"} - Team {row.teamNumber ?? "-"}
              </p>
              <p className="text-xs text-gray-600">
                {row.eventName || row.eventKey || "Event"} - {row.scoutName || "Rescout"}
              </p>
              <p className="text-xs text-gray-600">
                Rescout Accuracy: {typeof row.accuracy === "number" ? `${row.accuracy}%` : "-"}
              </p>
              {row.eventKey && row.matchKey && row.alliance && isRescoutComplete(row.eventKey, row.matchKey, row.alliance) && (
                <button
                  type="button"
                  onClick={() => openComparison(String(row.eventKey), String(row.matchKey), row.alliance || "red")}
                  className="mt-2 px-2 py-1 rounded border text-xs hover:bg-gray-50"
                >
                  Compare
                </button>
              )}
            </div>
          ))}
        </SectionCard>

        <SectionCard
          title="High Accuracy Matches"
          description="Matches with ≥75% alliance accuracy and a full 3-team alliance."
          items={highAccuracyVisible}
          emptyLabel="No high-accuracy matches available yet."
          showToggle={highAccuracyMatches.length > 6}
          onToggle={() => setShowAllHighAccuracy((v) => !v)}
          showAll={showAllHighAccuracy}
        >
          {highAccuracyVisible.map((match) => (
            <div key={match.key} className="border rounded-lg p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold">{match.eventName}</p>
                  <p className="text-sm text-gray-600">{match.matchLabel}</p>
                </div>
                <button
                  className="px-3 py-1.5 rounded text-sm text-white"
                  style={{ backgroundColor: "var(--primary-color)" }}
                  onClick={() => {
                    setActiveRescout(match);
                    setActiveAlliance(match.alliances[0]);
                  }}
                >
                  Re-scout
                </button>
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                {match.alliances.map((alliance) => (
                  <div key={`${match.key}-${alliance.alliance}`} className="bg-gray-50 rounded p-3">
                    <p className="text-sm font-semibold">
                      {alliance.alliance === "red" ? "Red Alliance" : "Blue Alliance"} - Accuracy{" "}
                      {alliance.accuracy ?? "-"}%
                    </p>
                    <p className="text-xs text-gray-600">
                      Scouts: {alliance.scouts.join(", ") || "Unknown"}
                    </p>
                    <p className="text-xs text-gray-600">
                      Teams: {alliance.teams.join(", ") || "-"}
                    </p>
                    {isRescoutComplete(match.eventKey, match.matchKey, alliance.alliance) && (
                      <>
                        <p className="text-xs text-gray-600 mt-2">
                          Rescout Accuracy: {typeof getRescoutAccuracy(match.eventKey, match.matchKey, alliance.alliance) === "number"
                            ? `${getRescoutAccuracy(match.eventKey, match.matchKey, alliance.alliance)}%`
                            : "-"}
                        </p>
                        <button
                          type="button"
                          onClick={() => openComparison(match.eventKey, match.matchKey, alliance.alliance)}
                          className="mt-2 px-2 py-1 rounded border text-xs hover:bg-gray-100"
                        >
                          Compare
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </SectionCard>

        <SectionCard
          title="Your Re-scouted Matches"
          description="Matches you have re-scouted or are currently working on."
          items={myVisible}
          emptyLabel="You have not re-scouted any matches yet."
          showToggle={myRescouts.length > 6}
          onToggle={() => setShowAllMine((v) => !v)}
          showAll={showAllMine}
        >
          {myVisible.map((row) => (
            <div key={row.id} className="border rounded-lg p-3">
              <p className="font-semibold">
                {row.matchLabel || "Match"} - Team {row.teamNumber ?? "-"}
              </p>
              <p className="text-xs text-gray-600">
                {row.eventName || row.eventKey || "Event"} - {row.status || "pending"}
              </p>
              <p className="text-xs text-gray-600">
                Rescout Accuracy: {typeof row.accuracy === "number" ? `${row.accuracy}%` : "-"}
              </p>
              {row.eventKey && row.matchKey && row.alliance && isRescoutComplete(row.eventKey, row.matchKey, row.alliance) && (
                <button
                  type="button"
                  onClick={() => openComparison(String(row.eventKey), String(row.matchKey), row.alliance || "red")}
                  className="mt-2 px-2 py-1 rounded border text-xs hover:bg-gray-50"
                >
                  Compare
                </button>
              )}
            </div>
          ))}
        </SectionCard>

          {canManageAll && (
          <SectionCard
            title="All Re-scouted Matches"
            description="All re-scout submissions for this team."
            items={allVisible}
            emptyLabel="No re-scout submissions yet."
            showToggle={rescouts.length > 6}
            onToggle={() => setShowAllAll((v) => !v)}
            showAll={showAllAll}
          >
            {allVisible.map((row) => (
              <div key={row.id} className="border rounded-lg p-3">
                <p className="font-semibold">
                  {row.matchLabel || "Match"} - Team {row.teamNumber ?? "-"}
                </p>
                <p className="text-xs text-gray-600">
                  {row.eventName || row.eventKey || "Event"} - {row.scoutName || "Scout"} - {row.status || "pending"}
                </p>
                <p className="text-xs text-gray-600">
                  Rescout Accuracy: {typeof row.accuracy === "number" ? `${row.accuracy}%` : "-"}
                </p>
                {row.eventKey && row.matchKey && row.alliance && isRescoutComplete(row.eventKey, row.matchKey, row.alliance) && (
                  <button
                    type="button"
                    onClick={() => openComparison(String(row.eventKey), String(row.matchKey), row.alliance || "red")}
                    className="mt-2 px-2 py-1 rounded border text-xs hover:bg-gray-50"
                  >
                    Compare
                  </button>
                )}
                {canManageAll && (
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() => handleDeleteRescout(row.id)}
                      className="px-2 py-1 rounded border text-xs text-red-700 border-red-200 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            ))}
          </SectionCard>
        )}
      </div>

      {activeRescout && activeAlliance && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xl font-bold">Re-scout Match</h2>
              <button onClick={() => setActiveRescout(null)} className="px-3 py-1 rounded border hover:bg-gray-50">
                Close
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              {activeRescout.eventName} - {activeRescout.matchLabel} - {activeAlliance.alliance.toUpperCase()} Alliance
            </p>
            <div className="grid grid-cols-1 gap-2">
              {activeAlliance.teams.map((team) => {
                const key = `${normalizeEventKey(activeRescout.eventKey)}::${normalizeMatchId(activeRescout.matchKey)}::${team}`;
                const exists = rescoutsByTeam.has(key);
                return (
                  <button
                    key={team}
                    disabled={exists || savingRescout}
                    onClick={() => void handleRescout(team)}
                    className={`px-4 py-2 rounded border text-left ${
                      exists ? "bg-gray-100 text-gray-400 cursor-not-allowed" : "hover:bg-gray-50"
                    }`}
                  >
                    Team {team} {exists ? "(Already Re-Scouted)" : ""}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </AnalyticsShell>
  );
}

type SectionCardProps = {
  title: string;
  description?: string;
  items: unknown[];
  emptyLabel: string;
  emptyContent?: React.ReactNode;
  showToggle: boolean;
  showAll: boolean;
  onToggle: () => void;
  children: React.ReactNode;
};

function SectionCard({
  title,
  description,
  items,
  emptyLabel,
  emptyContent,
  showToggle,
  showAll,
  onToggle,
  children,
}: SectionCardProps) {
  return (
    <div className="bg-white rounded-xl shadow p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{title}</h2>
          {description && <p className="text-sm text-gray-600 mt-1">{description}</p>}
        </div>
        {showToggle && (
          <button onClick={onToggle} className="text-sm px-3 py-1 rounded border hover:bg-gray-50">
            {showAll ? "View Less" : "View All"}
          </button>
        )}
      </div>
      <div className="mt-4 space-y-3">
        {items.length === 0 ? emptyContent ?? <p className="text-sm text-gray-500">{emptyLabel}</p> : children}
      </div>
    </div>
  );
}
