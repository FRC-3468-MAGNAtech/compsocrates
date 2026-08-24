"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { addDoc, collection, getDoc, getDocs, query, where, doc, updateDoc, deleteDoc } from "firebase/firestore";
import Link from "next/link";
import {
  ArrowUpRight,
  BadgeCheck,
  ChevronDown,
  ChevronUp,
  Flag,
  ScanEye,
  ShieldAlert,
  Trash2,
  Users,
} from "lucide-react";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
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
import {
  Action,
  Chip,
  CommandBar,
  Deck,
  HudCanvas,
  HudViewport,
  PageIntro,
  Surface,
} from "@/app/components/Hud";

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
    <ProtectedRoute formKey="accuracy-verification">
      <AccuracyVerificationContent />
    </ProtectedRoute>
  );
}

function AccuracyVerificationContent() {
  const router = useRouter();
  const { userData } = useAuth();
  getUserRoles(userData);
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
      const safeMatchKey = resolveMatchKey({
        matchId: activeRescout.matchKey,
        matchKey: activeRescout.matchKey,
        matchLabel: activeRescout.matchLabel,
      } as ScoutingEntry);
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

  const criticalVisible = showAllCritical ? criticalFlags : criticalFlags.slice(0, 6);
  const highAccuracyVisible = showAllHighAccuracy ? highAccuracyMatches : highAccuracyMatches.slice(0, 6);
  const myVisible = showAllMine ? myRescouts : myRescouts.slice(0, 6);
  const allVisible = showAllAll ? rescouts : rescouts.slice(0, 6);

  return (
    <HudCanvas>
      <CommandBar>
        <Link href="/dashboard" className="flex items-center gap-2 rounded-full py-1.5 pl-2 pr-4">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-red-800 via-red-600 to-amber-300 text-xs font-black text-white shadow-lg shadow-red-900/25">
            CS
          </span>
          <span className="hidden font-display text-lg text-slate-950 sm:inline">CompSocrates</span>
        </Link>
        <select
          value={selectedGame}
          onChange={(event) => setSelectedGame(event.target.value as AnalyticsGame)}
          className="!min-h-0 !rounded-full !border-transparent !bg-transparent px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-red-900"
        >
          <option value="REBUILT">Rebuilt</option>
          <option value="REEFSCAPE">Reefscape</option>
        </select>
        <select
          value={selectedEvent}
          onChange={(event) => setSelectedEvent(event.target.value)}
          className="!min-h-0 !rounded-full !border-transparent !bg-transparent px-3 py-1.5 text-xs font-semibold text-slate-700"
        >
          <option value="all">All Events</option>
          {eventOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        <Action variant="ghost" onClick={() => router.push("/dashboard")}>
          Dashboard
        </Action>
      </CommandBar>

      <HudViewport>
        <PageIntro
          eyebrow="Scout Trust Matrix"
          title="Accuracy Verification"
          subtitle="High-accuracy matches surface here first — ready for an experienced scout to re-walk the alliance and confirm the ground truth before it feeds strategy."
          actions={<Chip icon={ScanEye} label="Entries" value={filteredEntries.length} tone="gold" />}
        />

        {loading ? (
          <div className="mt-10 grid place-items-center py-20">
            <Surface className="px-8 py-6 text-sm font-semibold text-slate-600">Loading accuracy verification…</Surface>
          </div>
        ) : (
          <div className="mt-10 grid gap-6 xl:grid-cols-[1fr_0.72fr]">
            {/* Left column: the primary high-accuracy re-scout queue, the dominant deck */}
            <div className="flex flex-col gap-6">
              <StackSection
                icon={BadgeCheck}
                priority="high"
                eyebrow="Ready to verify"
                title="High Accuracy Matches"
                description="≥75% alliance accuracy with a complete 3-team alliance."
                total={highAccuracyMatches.length}
                visibleCount={highAccuracyVisible.length}
                showAll={showAllHighAccuracy}
                onToggle={() => setShowAllHighAccuracy((v) => !v)}
                emptyLabel="No high-accuracy matches available yet."
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  {highAccuracyVisible.map((match, index) => (
                    <Surface
                      key={match.key}
                      interactive
                      className={`p-4 ${index % 3 === 1 ? "sm:translate-y-3" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-800/70">{match.eventName}</p>
                          <p className="mt-1 font-display text-xl text-slate-950">{match.matchLabel}</p>
                        </div>
                        <Action
                          variant="primary"
                          className="!px-3 !py-1.5 !text-xs"
                          onClick={() => {
                            setActiveRescout(match);
                            setActiveAlliance(match.alliances[0]);
                          }}
                        >
                          Re-scout
                        </Action>
                      </div>
                      <div className="mt-4 flex flex-col gap-2">
                        {match.alliances.map((alliance) => (
                          <div
                            key={`${match.key}-${alliance.alliance}`}
                            className={`rounded-2xl border px-3 py-2.5 text-sm ${
                              alliance.alliance === "red"
                                ? "border-red-300/50 bg-red-50/40"
                                : "border-sky-300/50 bg-sky-50/40"
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-slate-900">
                                {alliance.alliance === "red" ? "Red" : "Blue"} Alliance
                              </span>
                              <span className="font-data font-bold text-red-800">{alliance.accuracy ?? "-"}%</span>
                            </div>
                            <p className="mt-1 text-xs text-slate-600">
                              Scouts: {alliance.scouts.join(", ") || "Unknown"}
                            </p>
                            <p className="text-xs text-slate-600">Teams: {alliance.teams.join(", ") || "-"}</p>
                            {isRescoutComplete(match.eventKey, match.matchKey, alliance.alliance) && (
                              <div className="mt-2 flex items-center justify-between gap-2">
                                <span className="font-data text-xs font-semibold text-slate-700">
                                  Rescout:{" "}
                                  {typeof getRescoutAccuracy(match.eventKey, match.matchKey, alliance.alliance) === "number"
                                    ? `${getRescoutAccuracy(match.eventKey, match.matchKey, alliance.alliance)}%`
                                    : "-"}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => openComparison(match.eventKey, match.matchKey, alliance.alliance)}
                                  className="inline-flex items-center gap-1 rounded-full border border-amber-300/60 bg-white/60 px-2.5 py-1 text-[11px] font-bold text-amber-950 hover:bg-white"
                                >
                                  Compare <ArrowUpRight className="h-3 w-3" />
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </Surface>
                  ))}
                </div>
              </StackSection>

              <StackSection
                icon={Users}
                priority="normal"
                eyebrow="Your queue"
                title="Your Re-scouted Matches"
                description="Matches you have re-scouted or are currently working on."
                total={myRescouts.length}
                visibleCount={myVisible.length}
                showAll={showAllMine}
                onToggle={() => setShowAllMine((v) => !v)}
                emptyLabel="You have not re-scouted any matches yet."
              >
                <div className="flex flex-col gap-3">
                  {myVisible.map((row) => (
                    <RescoutRow
                      key={row.id}
                      row={row}
                      subtitle={row.status || "pending"}
                      isComplete={Boolean(row.eventKey && row.matchKey && row.alliance && isRescoutComplete(row.eventKey, row.matchKey, row.alliance))}
                      onCompare={() => openComparison(String(row.eventKey), String(row.matchKey), row.alliance || "red")}
                    />
                  ))}
                </div>
              </StackSection>

              {canManageAll && (
                <StackSection
                  icon={Users}
                  priority="normal"
                  eyebrow="Team oversight"
                  title="All Re-scouted Matches"
                  description="Every re-scout submission for this team."
                  total={rescouts.length}
                  visibleCount={allVisible.length}
                  showAll={showAllAll}
                  onToggle={() => setShowAllAll((v) => !v)}
                  emptyLabel="No re-scout submissions yet."
                >
                  <div className="flex flex-col gap-3">
                    {allVisible.map((row) => (
                      <RescoutRow
                        key={row.id}
                        row={row}
                        subtitle={`${row.scoutName || "Scout"} · ${row.status || "pending"}`}
                        isComplete={Boolean(row.eventKey && row.matchKey && row.alliance && isRescoutComplete(row.eventKey, row.matchKey, row.alliance))}
                        onCompare={() => openComparison(String(row.eventKey), String(row.matchKey), row.alliance || "red")}
                        onDelete={() => handleDeleteRescout(row.id)}
                      />
                    ))}
                  </div>
                </StackSection>
              )}
            </div>

            {/* Right column: critical flags — the alarm deck, offset to feel like a satellite panel */}
            <div className="flex flex-col gap-6 xl:translate-y-6">
              <StackSection
                icon={ShieldAlert}
                priority="critical"
                eyebrow="Needs attention"
                title="Critical Flagged Matches"
                description="Re-scouted accuracy diverges from live scouting by more than 5%."
                total={criticalFlags.length}
                visibleCount={criticalVisible.length}
                showAll={showAllCritical}
                onToggle={() => setShowAllCritical((v) => !v)}
                emptyLabel="No critical flags yet."
              >
                <div className="flex flex-col gap-3">
                  {criticalVisible.map((row) => (
                    <RescoutRow
                      key={row.id}
                      row={row}
                      subtitle={row.eventName || row.eventKey || "Event"}
                      tone="critical"
                      isComplete={Boolean(row.eventKey && row.matchKey && row.alliance && isRescoutComplete(row.eventKey, row.matchKey, row.alliance))}
                      onCompare={() => openComparison(String(row.eventKey), String(row.matchKey), row.alliance || "red")}
                    />
                  ))}
                </div>
              </StackSection>
            </div>
          </div>
        )}
      </HudViewport>

      {activeRescout && activeAlliance && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/30 p-4 backdrop-blur-sm">
          <Surface raised className="w-full max-w-lg p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-2xl text-slate-950">Re-scout Match</h2>
              <button
                onClick={() => setActiveRescout(null)}
                className="rounded-full border border-white/70 bg-white/50 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-white/80"
              >
                Close
              </button>
            </div>
            <p className="mt-2 text-sm text-slate-600">
              {activeRescout?.eventName || "-"} · {activeRescout?.matchLabel || "-"} ·{" "}
              <span className="font-bold">{activeAlliance?.alliance?.toUpperCase() || ""} Alliance</span>
            </p>
            <div className="mt-5 flex flex-col gap-2.5">
              {(activeAlliance?.teams || []).map((team) => {
                const key = `${normalizeEventKey(activeRescout?.eventKey || "")}::${normalizeMatchId(activeRescout?.matchKey || "")}::${team}`;
                const exists = rescoutsByTeam.has(key);
                return (
                  <button
                    key={team}
                    disabled={exists || savingRescout}
                    onClick={() => void handleRescout(team)}
                    className={`rounded-2xl border px-4 py-3 text-left font-data font-semibold transition ${
                      exists
                        ? "cursor-not-allowed border-slate-200 bg-slate-100/70 text-slate-400"
                        : "border-amber-300/60 bg-white/60 text-slate-900 hover:bg-white/85"
                    }`}
                  >
                    Team {team} {exists ? "(Already Re-Scouted)" : ""}
                  </button>
                );
              })}
            </div>
          </Surface>
        </div>
      )}
    </HudCanvas>
  );
}

type StackSectionProps = {
  icon: React.ElementType;
  priority: "normal" | "high" | "critical";
  eyebrow: string;
  title: string;
  description?: string;
  total: number;
  visibleCount: number;
  showAll: boolean;
  onToggle: () => void;
  emptyLabel: string;
  children: React.ReactNode;
};

function StackSection({
  icon: Icon,
  priority,
  eyebrow,
  title,
  description,
  total,
  visibleCount,
  showAll,
  onToggle,
  emptyLabel,
  children,
}: StackSectionProps) {
  return (
    <Deck priority={priority}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div
            className={`mt-1 grid h-10 w-10 shrink-0 place-items-center rounded-full ${
              priority === "critical"
                ? "bg-red-800/90 text-white"
                : priority === "high"
                ? "bg-gradient-to-br from-amber-300 to-amber-500 text-red-950"
                : "bg-white/60 text-red-800"
            }`}
          >
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-red-900/60">{eyebrow}</p>
            <h2 className="mt-1 font-display text-2xl text-slate-950">{title}</h2>
            {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
          </div>
        </div>
        {total > 6 && (
          <button
            onClick={onToggle}
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/70 bg-white/50 px-3 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-white/80"
          >
            {showAll ? "Less" : "All"} {showAll ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        )}
      </div>
      <div className="mt-5">{visibleCount === 0 ? <p className="text-sm text-slate-500">{emptyLabel}</p> : children}</div>
    </Deck>
  );
}

function RescoutRow({
  row,
  subtitle,
  tone = "normal",
  isComplete,
  onCompare,
  onDelete,
}: {
  row: RescoutEntry;
  subtitle: string;
  tone?: "normal" | "critical";
  isComplete: boolean;
  onCompare: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className={`rounded-2xl border px-4 py-3 ${
        tone === "critical" ? "border-red-400/50 bg-red-50/50" : "border-white/70 bg-white/45"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-display text-base text-slate-950">
            {row.matchLabel || "Match"} · Team {row.teamNumber ?? "-"}
          </p>
          <p className="mt-0.5 text-xs text-slate-600">{subtitle}</p>
        </div>
        {tone === "critical" && <Flag className="h-4 w-4 shrink-0 text-red-700" />}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="font-data text-sm font-bold text-red-800">
          {typeof row.accuracy === "number" ? `${row.accuracy}%` : "-"}
        </span>
        <div className="flex items-center gap-2">
          {isComplete && (
            <button
              type="button"
              onClick={onCompare}
              className="inline-flex items-center gap-1 rounded-full border border-amber-300/60 bg-white/60 px-2.5 py-1 text-[11px] font-bold text-amber-950 hover:bg-white"
            >
              Compare <ArrowUpRight className="h-3 w-3" />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex items-center gap-1 rounded-full border border-red-300/60 bg-white/50 px-2.5 py-1 text-[11px] font-bold text-red-800 hover:bg-red-50"
            >
              <Trash2 className="h-3 w-3" /> Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
