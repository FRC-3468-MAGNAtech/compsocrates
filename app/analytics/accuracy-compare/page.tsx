"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import AnalyticsShell from "@/app/components/AnalyticsShell";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import { useAuth } from "@/app/AuthContext";
import { canAccessForm, normalizeFormAccessOverrides, type FormAccessOverrides } from "@/app/utils/roles";
import { isPracticeScoutedEntry, normalizeMatchLabel, type AnalyticsGame } from "@/app/utils/analyticsEvents";
import { normalizeEventKey } from "@/app/utils/events";
import ExpandableNotesCell from "@/app/components/ExpandableNotesCell";
import { computeRescoutDiff } from "@/app/utils/rescoutComparison";

type Entry = {
  id?: string;
  eventKey?: string;
  matchKey?: string;
  matchId?: string;
  matchNumber?: string;
  matchType?: "qualification" | "practice" | "finals";
  teamNumber?: string;
  scoutName?: string;
  isPracticeScouting?: boolean;
  practiceMode?: string;
  practiceSessionId?: string;
  startingPosition?: string;
  leftStartingZone?: boolean;
  autoCoralMissed?: number;
  autoCoralL1?: number;
  autoCoralL2?: number;
  autoCoralL3?: number;
  autoCoralL4?: number;
  autoAlgaeProcessorMissed?: number;
  autoAlgaeProcessorScored?: number;
  autoAlgaeNetMissed?: number;
  autoAlgaeNetScored?: number;
  teleopCoralMissed?: number;
  teleopCoralL1?: number;
  teleopCoralL2?: number;
  teleopCoralL3?: number;
  teleopCoralL4?: number;
  teleopAlgaeRemoved?: boolean;
  teleopProcessorMissed?: number;
  teleopProcessorScored?: number;
  teleopNetRobotMissed?: number;
  teleopNetRobotScored?: number;
  teleopNetHumanMissed?: number;
  teleopNetHumanScored?: number;
  failedClimb?: number;
  stageStatus?: string;
  incidents?: string[];
  notes?: string;
  submittedAt?: number;
  timestamp?: number;
  game?: string;
  auto?: {
    preloadScale?: number;
    bpsScale?: number;
    carryingScale?: number;
    failedClimb?: number;
    cycleTimes?: number[];
    estimatedFuel?: number;
    counterOverride?: number;
    counterOverrideMissedFuel?: number;
    humanPlayerFuel?: number;
    successfulClimb?: boolean;
    wonAuto?: boolean;
    hubActivationOverride?: boolean;
  };
  teleop?: {
    bpsScale?: number;
    carryingScale?: number;
    transitionCycles?: number[];
    shift1Cycles?: number[];
    shift2Cycles?: number[];
    shift3Cycles?: number[];
    shift4Cycles?: number[];
    transitionOverride?: number;
    transitionMissedFuel?: number;
    shift1Override?: number;
    shift1MissedFuel?: number;
    shift2Override?: number;
    shift2MissedFuel?: number;
    shift3Override?: number;
    shift3MissedFuel?: number;
    shift4Override?: number;
    shift4MissedFuel?: number;
    humanPlayerFuel?: number;
    shiftParityFromWonAuto?: boolean;
    estimatedFuel?: number;
  };
  endgame?: {
    cycleTimes?: number[];
    counterOverride?: number;
    counterOverrideMissedFuel?: number;
    humanPlayerFuel?: number;
    estimatedFuel?: number;
    failedClimb?: number;
    status?: string;
  };
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
  game?: string;
  status?: string;
  submittedAt?: number;
  updatedAt?: number;
  createdAt?: number;
  practiceSessionId?: string;
};

type ComparisonRow = {
  id: string;
  label: string;
  entry: Entry | null;
};

const INCIDENT_LABELS: Record<string, string> = {
  died: "Died During Match",
  "never-started": "Never Started Match",
  disabled: "Disabled by FRC",
  recovered: "Recovered from Freeze",
  tipped: "Tipped Over",
  "yellow-card": "Yellow Card",
  "red-card": "Red Card",
};

const REBUILT_PRELOAD_RANGES = ["0", "1-2", "3-4", "5-6", "7-8"];
const REBUILT_BPS_RANGES = ["0", "1-3", "4-6", "7-9", "10-13", "14-17", "18-21", "22-24", "25+"];
const REBUILT_CARRY_RANGES = ["0", "1-12", "13-23", "23-32", "33-42", "43-53", "54-64", "65-74", "75+"];
const REBUILT_BPS_VALUES = [0, 2, 5, 8, 12, 16, 20, 23, 25];
const REBUILT_CARRY_VALUES = [0, 12, 23, 32, 42, 53, 64, 74, 75];
const REBUILT_BPS_MAX = REBUILT_BPS_RANGES.length - 1;
const REBUILT_CARRY_MAX = REBUILT_CARRY_RANGES.length - 1;

function rebuiltPreloadRange(scale?: number) {
  const idx = Math.max(0, Math.min(REBUILT_BPS_MAX, Number(scale ?? 0)));
  return REBUILT_PRELOAD_RANGES[idx];
}

function rebuiltBpsRange(scale?: number) {
  const idx = Math.max(0, Math.min(4, Number(scale ?? 0)));
  return REBUILT_BPS_RANGES[idx];
}

function rebuiltCarryRange(scale?: number) {
  const idx = Math.max(0, Math.min(REBUILT_CARRY_MAX, Number(scale ?? 0)));
  return REBUILT_CARRY_RANGES[idx];
}

function rebuiltFuelFromCycles(cycles: number[] | undefined, bpsScale: number, carryScale: number) {
  if (!Array.isArray(cycles) || cycles.length === 0) return 0;
  const bps = REBUILT_BPS_VALUES[Math.max(0, Math.min(REBUILT_BPS_MAX, Number(bpsScale || 0)))] || 0;
  const carryCap = REBUILT_CARRY_VALUES[Math.max(0, Math.min(REBUILT_CARRY_MAX, Number(carryScale || 0)))] || 0;
  return cycles.reduce((sum, seconds) => {
    const sec = Number(seconds || 0);
    if (!Number.isFinite(sec) || sec <= 0) return sum;
    return sum + Math.max(0, Math.round(Math.min(carryCap, bps * sec)));
  }, 0);
}

function rebuiltAutoFuelFromCycles(cycles: number[] | undefined, preloadScale: number, bpsScale: number, carryScale: number) {
  if (!Array.isArray(cycles) || cycles.length === 0) return 0;
  const preloadCap = [0, 2, 4, 6, 8][Math.max(0, Math.min(4, Number(preloadScale || 0)))] || 0;
  const bps = REBUILT_BPS_VALUES[Math.max(0, Math.min(REBUILT_BPS_MAX, Number(bpsScale || 0)))] || 0;
  const carryCap = REBUILT_CARRY_VALUES[Math.max(0, Math.min(REBUILT_CARRY_MAX, Number(carryScale || 0)))] || 0;
  return cycles.reduce((sum, seconds, index) => {
    const sec = Number(seconds || 0);
    if (!Number.isFinite(sec) || sec <= 0) return sum;
    const capacity = index === 0 && preloadCap > 0 ? preloadCap : carryCap;
    return sum + Math.max(0, Math.round(Math.min(capacity, bps * sec)));
  }, 0);
}

function applyFuelOverride(
  estimated: number,
  overrideValue: number | undefined,
  missedValue: number | undefined
) {
  const override = Number(overrideValue || 0);
  if (override > 0) return override;
  const missed = Math.max(0, Number(missedValue || 0));
  return Math.max(0, estimated - missed);
}

function getRebuiltFuelBreakdown(entry: Entry) {
  const autoPreloadScale = Number(entry.auto?.preloadScale || 0);
  const autoBpsScale = Number(entry.auto?.bpsScale || 0);
  const autoCarryScale = Number(entry.auto?.carryingScale || 0);
  const teleBpsScale = Number(entry.teleop?.bpsScale || 0);
  const teleCarryScale = Number(entry.teleop?.carryingScale || 0);

  const autoEstimated = rebuiltAutoFuelFromCycles(entry.auto?.cycleTimes, autoPreloadScale, autoBpsScale, autoCarryScale);
  const transitionEstimated = rebuiltFuelFromCycles(entry.teleop?.transitionCycles, teleBpsScale, teleCarryScale);
  const shift1Estimated = rebuiltFuelFromCycles(entry.teleop?.shift1Cycles, teleBpsScale, teleCarryScale);
  const shift2Estimated = rebuiltFuelFromCycles(entry.teleop?.shift2Cycles, teleBpsScale, teleCarryScale);
  const shift3Estimated = rebuiltFuelFromCycles(entry.teleop?.shift3Cycles, teleBpsScale, teleCarryScale);
  const shift4Estimated = rebuiltFuelFromCycles(entry.teleop?.shift4Cycles, teleBpsScale, teleCarryScale);
  const endgameEstimated = rebuiltFuelFromCycles(entry.endgame?.cycleTimes, teleBpsScale, teleCarryScale);

  const autoSectionFuel = applyFuelOverride(autoEstimated, entry.auto?.counterOverride, entry.auto?.counterOverrideMissedFuel);
  const transitionFuel = applyFuelOverride(transitionEstimated, entry.teleop?.transitionOverride, entry.teleop?.transitionMissedFuel);
  const shift1Fuel = applyFuelOverride(shift1Estimated, entry.teleop?.shift1Override, entry.teleop?.shift1MissedFuel);
  const shift2Fuel = applyFuelOverride(shift2Estimated, entry.teleop?.shift2Override, entry.teleop?.shift2MissedFuel);
  const shift3Fuel = applyFuelOverride(shift3Estimated, entry.teleop?.shift3Override, entry.teleop?.shift3MissedFuel);
  const shift4Fuel = applyFuelOverride(shift4Estimated, entry.teleop?.shift4Override, entry.teleop?.shift4MissedFuel);
  const endgameSectionFuel = applyFuelOverride(endgameEstimated, entry.endgame?.counterOverride, entry.endgame?.counterOverrideMissedFuel);
  const autoSectionEstimated = Number(entry.auto?.counterOverride || 0) <= 0 && autoEstimated > 0;
  const transitionEstimatedUsed = Number(entry.teleop?.transitionOverride || 0) <= 0 && transitionEstimated > 0;
  const shift1EstimatedUsed = Number(entry.teleop?.shift1Override || 0) <= 0 && shift1Estimated > 0;
  const shift2EstimatedUsed = Number(entry.teleop?.shift2Override || 0) <= 0 && shift2Estimated > 0;
  const shift3EstimatedUsed = Number(entry.teleop?.shift3Override || 0) <= 0 && shift3Estimated > 0;
  const shift4EstimatedUsed = Number(entry.teleop?.shift4Override || 0) <= 0 && shift4Estimated > 0;
  const endgameSectionEstimated = Number(entry.endgame?.counterOverride || 0) <= 0 && endgameEstimated > 0;

  const autoHumanFuel = Number(entry.auto?.humanPlayerFuel || 0);
  const teleHumanFuel = Number(entry.teleop?.humanPlayerFuel || 0);
  const endgameHumanFuel = Number(entry.endgame?.humanPlayerFuel || 0);
  const countShiftsTwoFour =
    typeof entry.teleop?.shiftParityFromWonAuto === "boolean"
      ? entry.teleop.shiftParityFromWonAuto
      : Boolean(entry.auto?.wonAuto);

  const autoFuel = autoSectionFuel + autoHumanFuel;
  const teleFuel = transitionFuel + (countShiftsTwoFour ? shift2Fuel + shift4Fuel : shift1Fuel + shift3Fuel) + teleHumanFuel;
  const teleEstimatedUsed = countShiftsTwoFour
    ? transitionEstimatedUsed || shift2EstimatedUsed || shift4EstimatedUsed
    : transitionEstimatedUsed || shift1EstimatedUsed || shift3EstimatedUsed;
  const endgameFuel = endgameSectionFuel + endgameHumanFuel;

  return {
    autoFuel,
    autoSectionEstimated,
    autoHumanFuel,
    transitionFuel,
    transitionEstimatedUsed,
    shift1Fuel,
    shift1EstimatedUsed,
    shift2Fuel,
    shift2EstimatedUsed,
    shift3Fuel,
    shift3EstimatedUsed,
    shift4Fuel,
    shift4EstimatedUsed,
    teleHumanFuel,
    teleFuel,
    teleEstimatedUsed,
    endgameSectionFuel,
    endgameSectionEstimated,
    endgameHumanFuel,
    endgameFuel,
  };
}
function formatFuelValue(value: number, isEstimated: boolean) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  return isEstimated ? `~${value}` : String(value);
}

function formatCyclesCell(cycles: number[] | undefined) {
  return Array.isArray(cycles) && cycles.length > 0 ? cycles.map((v) => Number(v).toFixed(2)).join(", ") : "-";
}

function displayEntryText(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "0" || raw.toLowerCase() === "n/a" || raw.toLowerCase() === "unknown") return "-";
  return raw;
}

function toDisplayTitle(value: unknown) {
  const raw = displayEntryText(value);
  if (raw === "-") return raw;
  return raw
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function matchLabel(entry: Entry) {
  function remapLegacyFinalLabel(rawLabel: string) {
    const parsed = String(rawLabel || "").trim().toUpperCase().match(/^F(\d+)$/);
    if (!parsed) return rawLabel;
    const number = Number(parsed[1] || 0);
    if (number >= 1 && number <= 13) return `SF${number}`;
    if (number >= 14 && number <= 16) return `F${number - 13}`;
    return rawLabel;
  }

  const num = entry.matchNumber || "-";
  const matchId = String(entry.matchId || "").trim();
  const matchIdMatch = matchId.match(/^(qf|sf|f)(\d+)(?:m(\d+))?$/i);
  if (matchIdMatch) {
    const prefix = matchIdMatch[1].toUpperCase();
    const setNumber = Number(matchIdMatch[2] || 0);
    const matchNumber = Number(matchIdMatch[3] || 0);
    if (prefix === "QF" || prefix === "SF") {
      return `${prefix}${setNumber || "-"}`;
    }
    if (prefix === "F") {
      return remapLegacyFinalLabel(`F${matchNumber || setNumber || "-"}`);
    }
  }
  if (entry.matchType === "practice") return `P${num}`;
  if (entry.matchType === "qualification") return `Q${num}`;
  if (entry.matchType === "finals") return remapLegacyFinalLabel(`F${num}`);
  return num;
}

function normalizeAlliance(value: unknown): "red" | "blue" | null {
  const raw = String(value || "").toLowerCase().trim();
  if (raw.startsWith("r")) return "red";
  if (raw.startsWith("b")) return "blue";
  return null;
}

function getEntryTime(entry: Entry): number {
  const raw = Number(entry.submittedAt ?? entry.timestamp ?? 0);
  return Number.isFinite(raw) ? raw : 0;
}

function resolveAlliance(entry: Entry): "red" | "blue" | null {
  return normalizeAlliance((entry as Record<string, unknown>).alliance || (entry as Record<string, unknown>).allianceColor);
}

function normalizeMatchId(value: string): string {
  const parsed = normalizeMatchLabel(value || "");
  return parsed.matchId || String(value || "").trim();
}

export default function AccuracyComparePage() {
  return (
    <ProtectedRoute>
      <AccuracyCompareContent />
    </ProtectedRoute>
  );
}

function AccuracyCompareContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { userData } = useAuth();
  const [formAccessOverrides, setFormAccessOverrides] = useState<FormAccessOverrides>({});
  const teamId = userData?.teamId;
  const eventKey = normalizeEventKey(String(searchParams.get("eventKey") || "").trim());
  const matchKey = normalizeMatchId(String(searchParams.get("matchKey") || "").trim());
  const alliance = String(searchParams.get("alliance") || "").toLowerCase() === "blue" ? "blue" : "red";
  const canSee = canAccessForm({ formKey: "accuracy-verification", user: userData, formAccessOverrides });

  const [entries, setEntries] = useState<Entry[]>([]);
  const [rescouts, setRescouts] = useState<RescoutEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (userData?.formAccessOverrides) {
      setFormAccessOverrides(normalizeFormAccessOverrides(userData.formAccessOverrides));
    }
  }, [userData?.formAccessOverrides]);

  useEffect(() => {
    if (!teamId || !canSee) return;
    let isActive = true;
    async function load() {
      setLoading(true);
      try {
        const scoutingSnap = await getDocs(query(collection(db, "scouting"), where("teamId", "==", teamId)));
        const rows = scoutingSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })) as Entry[];
        const rescoutSnap = await getDocs(query(collection(db, "accuracyRescouts"), where("teamId", "==", teamId)));
        const rescoutRows = rescoutSnap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Omit<RescoutEntry, "id">),
        })) as RescoutEntry[];
        const sessionIds = Array.from(
          new Set(rescoutRows.map((row) => String(row.practiceSessionId || "").trim()).filter((id) => id.length > 0))
        );
        const extraEntries: Entry[] = [];
        for (let i = 0; i < sessionIds.length; i += 10) {
          const chunk = sessionIds.slice(i, i + 10);
          const sessionSnap = await getDocs(query(collection(db, "scouting"), where("practiceSessionId", "in", chunk)));
          sessionSnap.docs.forEach((docSnap) => {
            extraEntries.push({ id: docSnap.id, ...docSnap.data() } as Entry);
          });
        }
        if (!isActive) return;
        const merged = new Map<string, Entry>();
        [...rows, ...extraEntries].forEach((entry) => {
          if (entry.id) merged.set(entry.id, entry);
        });
        setEntries(Array.from(merged.values()));
        setRescouts(rescoutRows);
      } catch (error) {
        console.error("Failed loading comparison data:", error);
      } finally {
        if (isActive) setLoading(false);
      }
    }
    void load();
    return () => {
      isActive = false;
    };
  }, [teamId, canSee]);

  if (!canSee) {
    return (
      <div className="flex h-screen bg-gray-100">
        <div className="m-auto text-center text-gray-600">You do not have access to Accuracy Verification.</div>
      </div>
    );
  }

  const rescoutGroup = useMemo(() => {
    const submitted = rescouts.filter((row) => {
      if (!row.matchKey || !row.eventKey) return false;
      if (normalizeEventKey(String(row.eventKey || "").trim()) !== eventKey) return false;
      if (normalizeMatchId(String(row.matchKey || "").trim()) !== matchKey) return false;
      if ((row.alliance || "red") !== alliance) return false;
      const isSubmitted =
        String(row.status || "").toLowerCase() === "submitted" ||
        Boolean(row.practiceSessionId) ||
        Boolean(row.submittedAt);
      return isSubmitted;
    });
    const byTeam = new Map<number, RescoutEntry>();
    submitted.forEach((row) => {
      const teamNumber = typeof row.teamNumber === "number" ? row.teamNumber : Number(row.teamNumber || 0);
      if (!Number.isFinite(teamNumber) || teamNumber <= 0) return;
      const existing = byTeam.get(teamNumber);
      if (!existing) {
        byTeam.set(teamNumber, row);
        return;
      }
      const existingTime = Number(existing.submittedAt || existing.updatedAt || existing.createdAt || 0);
      const currentTime = Number(row.submittedAt || row.updatedAt || row.createdAt || 0);
      if (currentTime > 0 && (existingTime === 0 || currentTime < existingTime)) {
        byTeam.set(teamNumber, row);
      }
    });
    return Array.from(byTeam.values());
  }, [rescouts, eventKey, matchKey, alliance]);

  const teamOrder = useMemo(() => {
    const teams = rescoutGroup
      .map((row) => Number(row.teamNumber || 0))
      .filter((num) => Number.isFinite(num) && num > 0);
    if (teams.length > 0) return teams.sort((a, b) => a - b);
    const fallback = entries
      .filter((entry) => !isPracticeScoutedEntry(entry))
      .filter((entry) => normalizeEventKey(String(entry.eventKey || "").trim()) === eventKey)
      .filter((entry) => normalizeMatchId(String(entry.matchKey || entry.matchId || "")) === matchKey)
      .filter((entry) => resolveAlliance(entry) === alliance)
      .map((entry) => Number(entry.teamNumber || 0))
      .filter((num) => Number.isFinite(num) && num > 0);
    return Array.from(new Set(fallback)).sort((a, b) => a - b);
  }, [rescoutGroup, entries, eventKey, matchKey, alliance]);

  const originalEntriesByTeam = useMemo(() => {
    const map = new Map<number, Entry>();
    entries
      .filter((entry) => !isPracticeScoutedEntry(entry))
      .filter((entry) => normalizeEventKey(String(entry.eventKey || "").trim()) === eventKey)
      .filter((entry) => normalizeMatchId(String(entry.matchKey || entry.matchId || "")) === matchKey)
      .filter((entry) => resolveAlliance(entry) === alliance)
      .forEach((entry) => {
        const teamNumber = Number(entry.teamNumber || 0);
        if (!Number.isFinite(teamNumber) || teamNumber <= 0) return;
        const existing = map.get(teamNumber);
        if (!existing || getEntryTime(entry) < getEntryTime(existing)) {
          map.set(teamNumber, entry);
        }
      });
    return map;
  }, [entries, eventKey, matchKey, alliance]);

  const practiceEntriesBySession = useMemo(() => {
    const map = new Map<string, Entry[]>();
    entries
      .filter((entry) => isPracticeScoutedEntry(entry))
      .forEach((entry) => {
        const sessionId = String((entry as Record<string, unknown>).practiceSessionId || "").trim();
        if (!sessionId) return;
        const list = map.get(sessionId) || [];
        list.push(entry);
        map.set(sessionId, list);
      });
    return map;
  }, [entries]);

  const comparisonRows = useMemo<ComparisonRow[]>(() => {
    const rows: ComparisonRow[] = [];
    teamOrder.forEach((teamNumber, index) => {
      const original = originalEntriesByTeam.get(teamNumber) || null;
      const rescout = rescoutGroup.find((row) => Number(row.teamNumber || 0) === teamNumber);
      let exemplar: Entry | null = null;
      if (rescout?.practiceSessionId) {
        const candidates = practiceEntriesBySession.get(rescout.practiceSessionId) || [];
        exemplar = candidates.find((entry) => Number(entry.teamNumber || 0) === teamNumber) || null;
      }
      const robotLabel = `Robot ${index + 1}`;
      rows.push({
        id: `${teamNumber}-og`,
        label: `OG Scout • ${robotLabel}`,
        entry: original,
      });
      rows.push({
        id: `${teamNumber}-exemplar`,
        label: `Exemplar • ${robotLabel}`,
        entry: exemplar,
      });
    });
    return rows;
  }, [teamOrder, originalEntriesByTeam, rescoutGroup, practiceEntriesBySession]);

  const comparisonSummary = useMemo(() => {
    let totalDiff = 0;
    let count = 0;
    teamOrder.forEach((teamNumber) => {
      const original = originalEntriesByTeam.get(teamNumber);
      const rescout = rescoutGroup.find((row) => Number(row.teamNumber || 0) === teamNumber);
      let exemplar: Entry | null = null;
      if (rescout?.practiceSessionId) {
        const candidates = practiceEntriesBySession.get(rescout.practiceSessionId) || [];
        exemplar = candidates.find((entry) => Number(entry.teamNumber || 0) === teamNumber) || null;
      }
      if (original && exemplar) {
        totalDiff += computeRescoutDiff(original as Record<string, unknown>, exemplar as Record<string, unknown>).diffPercent;
        count += 1;
      }
    });
    if (count === 0) return null;
    return Math.round((totalDiff / count) * 10) / 10;
  }, [teamOrder, originalEntriesByTeam, rescoutGroup, practiceEntriesBySession]);

  const selectedGame = useMemo<AnalyticsGame>(() => {
    const rescoutGame = rescoutGroup.find((row) => row.game)?.game || "";
    const candidate = comparisonRows.find((row) => row.entry?.game)?.entry?.game || rescoutGame || "";
    return String(candidate || "").toUpperCase() === "REBUILT" ? "REBUILT" : "REEFSCAPE";
  }, [comparisonRows, rescoutGroup]);

  if (loading) {
    return (
      <AnalyticsShell
        entriesCount={entries.length}
        selectedGame={selectedGame}
        onSelectedGameChange={() => {}}
        allowedGames={[selectedGame]}
      >
        <LoadingSpinner message="Loading comparison..." />
      </AnalyticsShell>
    );
  }

  if (!eventKey || !matchKey) {
    return (
      <AnalyticsShell
        entriesCount={entries.length}
        selectedGame={selectedGame}
        onSelectedGameChange={() => {}}
        allowedGames={[selectedGame]}
      >
        <div className="bg-white rounded-xl shadow p-6">
          <p className="text-gray-600">Missing match details for comparison.</p>
          <button
            type="button"
            className="mt-4 px-4 py-2 rounded text-white"
            style={{ backgroundColor: "var(--primary-color)" }}
            onClick={() => router.push("/analytics/accuracy-verification")}
          >
            Back to Accuracy Verification
          </button>
        </div>
      </AnalyticsShell>
    );
  }

  const preMatchColSpan = 2;

  return (
    <AnalyticsShell
      entriesCount={entries.length}
      selectedGame={selectedGame}
      onSelectedGameChange={() => {}}
      allowedGames={[selectedGame]}
    >
      <div className="space-y-4">
        <div className="bg-white rounded-xl shadow p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold" style={{ color: "var(--primary-color)" }}>
                Accuracy Comparison
              </h1>
              <p className="text-sm text-gray-600">
                {eventKey.toUpperCase()} • {matchKey.toUpperCase()} • {alliance.toUpperCase()} Alliance
              </p>
            </div>
            {typeof comparisonSummary === "number" && (
              <div className="px-4 py-2 rounded-full bg-gray-100 text-sm font-semibold text-gray-700">
                Line-by-line diff: {comparisonSummary}%
              </div>
            )}
          </div>
        </div>

        {comparisonRows.length === 0 ? (
          <div className="bg-white rounded-xl shadow p-6">
            <p className="text-gray-600">No rescout data available for this match yet.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow h-[calc(100vh-320px)] table-scroll overflow-x-auto">
            {selectedGame === "REBUILT" ? (
              <table>
                <thead className="sticky-header">
                  <tr>
                    <th className="sticky-left-group sticky-row-1 bg-red-300 text-center" colSpan={2}>Information</th>
                    <th className="sticky-left-2 sticky-row-1 bg-yellow-300 text-center" colSpan={preMatchColSpan}>Pre-Match</th>
                    <th className="bg-green-300 text-center" colSpan={7}>Autonomous</th>
                    <th className="bg-blue-300 text-center" colSpan={14}>Teleoperated</th>
                    <th className="bg-purple-300 text-center" colSpan={5}>Endgame</th>
                    <th className="bg-pink-300 text-center" colSpan={3}>General</th>
                  </tr>
                  <tr>
                    <th className="sticky-left-group sticky-row-2 bg-red-200 text-center" colSpan={2}>Information</th>
                    <th className="sticky-left-2 sticky-row-2 bg-yellow-200 text-center" colSpan={preMatchColSpan}>Pre-Match</th>
                    <th className="bg-green-200 text-center" colSpan={3}>Stats</th>
                    <th className="bg-green-200 text-center" colSpan={2}>Fuel</th>
                    <th className="bg-green-200 text-center" colSpan={1}>Climb</th>
                    <th className="bg-green-200 text-center" colSpan={1}>Cycles</th>
                    <th className="bg-blue-200 text-center" colSpan={9}>Fuel</th>
                    <th className="bg-blue-200 text-center" colSpan={5}>Cycles</th>
                    <th className="bg-purple-200 text-center" colSpan={1}>Fuel</th>
                    <th className="bg-purple-200 text-center" colSpan={1}>Human Player</th>
                    <th className="bg-purple-200 text-center" colSpan={1}>End Place</th>
                    <th className="bg-purple-200 text-center" colSpan={1}>Climb</th>
                    <th className="bg-purple-200 text-center" colSpan={1}>Cycles</th>
                    <th className="bg-pink-200 text-center" colSpan={1}>Incidents</th>
                    <th className="bg-pink-200 text-center" colSpan={1}>Score</th>
                    <th className="bg-pink-200 text-center" colSpan={1}>Comments</th>
                  </tr>
                  <tr>
                    <th className="sticky-left-0 sticky-row-3 text-center">Match</th>
                    <th className="sticky-left-1 sticky-row-3 text-center">Team</th>
                    <th className="sticky-left-2 sticky-row-3 text-center">Scout</th>
                    <th className="text-center">Starting Position</th>
                    <th className="text-center">Preload</th>
                    <th className="text-center">BPS</th>
                    <th className="text-center">Carry</th>
                    <th className="text-center">Auto Fuel</th>
                    <th className="text-center">Human</th>
                    <th className="text-center">Auto Climb</th>
                    <th className="text-center">Cycles</th>
                    <th className="text-center">BPS</th>
                    <th className="text-center">Carry</th>
                    <th className="text-center">Transition</th>
                    <th className="text-center">Shift 1</th>
                    <th className="text-center">Shift 2</th>
                    <th className="text-center">Shift 3</th>
                    <th className="text-center">Shift 4</th>
                    <th className="text-center">Human</th>
                    <th className="text-center">Teleop Fuel</th>
                    <th className="text-center">Transition Cycles</th>
                    <th className="text-center">Shift 1 Cycles</th>
                    <th className="text-center">Shift 2 Cycles</th>
                    <th className="text-center">Shift 3 Cycles</th>
                    <th className="text-center">Shift 4 Cycles</th>
                    <th className="text-center">End Fuel</th>
                    <th className="text-center">Human</th>
                    <th className="text-center">End Place</th>
                    <th className="text-center">Climb</th>
                    <th className="text-center">Cycles</th>
                    <th className="text-center">Incidents</th>
                    <th className="text-center">Total</th>
                    <th className="text-center">Comments</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonRows.map((row) => {
                    const entry = row.entry;
                    const safeEntry = entry || {};
                    const fuel = getRebuiltFuelBreakdown(safeEntry);
                    const autoFuel = fuel.autoFuel;
                    const teleFuel = fuel.teleFuel;
                    const endgameFuel = fuel.endgameFuel;
                    const autoClimb = safeEntry.auto?.successfulClimb ? 15 : 0;
                    const end = String(safeEntry.endgame?.status || "").toLowerCase();
                    const endgameClimb = end === "level-1" ? 10 : end === "level-2" ? 20 : end === "level-3" ? 30 : 0;
                    const totalUsed = autoFuel + teleFuel + endgameFuel + autoClimb + endgameClimb;
                    return (
                      <tr key={row.id}>
                        <td className="sticky-left-0 bg-white font-semibold text-center">
                          <div className="text-[10px] uppercase text-gray-500">{row.label}</div>
                          <div>{entry ? matchLabel(entry) : "-"}</div>
                        </td>
                        <td className="sticky-left-1 bg-white font-semibold text-center">{displayEntryText(entry?.teamNumber)}</td>
                        <td className="sticky-left-2 bg-white text-center">{displayEntryText(entry?.scoutName)}</td>
                        <td className="text-center">{toDisplayTitle(entry?.startingPosition)}</td>
                        <td className="text-center">{rebuiltPreloadRange(entry?.auto?.preloadScale)}</td>
                        <td className="text-center">{rebuiltBpsRange(entry?.auto?.bpsScale)}</td>
                        <td className="text-center">{rebuiltCarryRange(entry?.auto?.carryingScale)}</td>
                        <td className="text-center">{formatFuelValue(autoFuel, fuel.autoSectionEstimated)}</td>
                        <td className="text-center">{fuel.autoHumanFuel}</td>
                        <td className="text-center">{autoClimb}</td>
                        <td className="text-center" style={{ minWidth: "140px", whiteSpace: "normal", overflowWrap: "anywhere" }}>{formatCyclesCell(entry?.auto?.cycleTimes)}</td>
                        <td className="text-center">{rebuiltBpsRange(entry?.teleop?.bpsScale)}</td>
                        <td className="text-center">{rebuiltCarryRange(entry?.teleop?.carryingScale)}</td>
                        <td className="text-center">{formatFuelValue(fuel.transitionFuel, fuel.transitionEstimatedUsed)}</td>
                        <td className="text-center">{formatFuelValue(fuel.shift1Fuel, fuel.shift1EstimatedUsed)}</td>
                        <td className="text-center">{formatFuelValue(fuel.shift2Fuel, fuel.shift2EstimatedUsed)}</td>
                        <td className="text-center">{formatFuelValue(fuel.shift3Fuel, fuel.shift3EstimatedUsed)}</td>
                        <td className="text-center">{formatFuelValue(fuel.shift4Fuel, fuel.shift4EstimatedUsed)}</td>
                        <td className="text-center">{fuel.teleHumanFuel}</td>
                        <td className="text-center">{formatFuelValue(teleFuel, fuel.teleEstimatedUsed)}</td>
                        <td className="text-center" style={{ minWidth: "140px", whiteSpace: "normal", overflowWrap: "anywhere" }}>{formatCyclesCell(entry?.teleop?.transitionCycles)}</td>
                        <td className="text-center" style={{ minWidth: "140px", whiteSpace: "normal", overflowWrap: "anywhere" }}>{formatCyclesCell(entry?.teleop?.shift1Cycles)}</td>
                        <td className="text-center" style={{ minWidth: "140px", whiteSpace: "normal", overflowWrap: "anywhere" }}>{formatCyclesCell(entry?.teleop?.shift2Cycles)}</td>
                        <td className="text-center" style={{ minWidth: "140px", whiteSpace: "normal", overflowWrap: "anywhere" }}>{formatCyclesCell(entry?.teleop?.shift3Cycles)}</td>
                        <td className="text-center" style={{ minWidth: "140px", whiteSpace: "normal", overflowWrap: "anywhere" }}>{formatCyclesCell(entry?.teleop?.shift4Cycles)}</td>
                        <td className="text-center">{formatFuelValue(fuel.endgameFuel, fuel.endgameSectionEstimated)}</td>
                        <td className="text-center">{fuel.endgameHumanFuel}</td>
                        <td className="text-center">{toDisplayTitle(entry?.endgame?.status || entry?.stageStatus || "-")}</td>
                        <td className="text-center">{endgameClimb}</td>
                        <td className="text-center" style={{ minWidth: "140px", whiteSpace: "normal", overflowWrap: "anywhere" }}>{formatCyclesCell(entry?.endgame?.cycleTimes)}</td>
                        <td className="text-center">
                          {entry?.incidents?.map((incident) => INCIDENT_LABELS[incident] || incident).join(", ") || "-"}
                        </td>
                        <td className="text-center font-semibold">{totalUsed || "-"}</td>
                        <td className="text-left align-top" style={{ minWidth: "220px", maxWidth: "360px" }}>
                          <ExpandableNotesCell text={entry?.notes} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <table>
                <thead className="sticky-header">
                  <tr>
                    <th className="sticky-left-group sticky-row-1 bg-red-300 text-center" colSpan={2}>Information</th>
                    <th className="sticky-left-2 sticky-row-1 bg-yellow-300 text-center" colSpan={preMatchColSpan}>Pre-Match</th>
                    <th className="bg-green-300 text-center" colSpan={10}>Autonomous</th>
                    <th className="bg-blue-300 text-center" colSpan={13}>Teleoperated</th>
                    <th className="bg-purple-300 text-center" colSpan={2}>Endgame</th>
                    <th className="bg-pink-300 text-center" colSpan={2}>General</th>
                  </tr>
                  <tr>
                    <th className="sticky-left-group sticky-row-2 bg-red-200 text-center" colSpan={2}>Information</th>
                    <th className="sticky-left-2 sticky-row-2 bg-yellow-200 text-center" colSpan={preMatchColSpan}>Pre-Match</th>
                    <th className="bg-green-200 text-center" colSpan={5}>Coral</th>
                    <th className="bg-green-200 text-center" colSpan={4}>Algae</th>
                    <th className="bg-green-200 text-center" colSpan={1}>Leave</th>
                    <th className="bg-blue-200 text-center" colSpan={6}>Coral</th>
                    <th className="bg-blue-200 text-center" colSpan={4}>Algae</th>
                    <th className="bg-blue-200 text-center" colSpan={1}>HP Net</th>
                    <th className="bg-blue-200 text-center" colSpan={2}>Climb</th>
                    <th className="bg-purple-200 text-center" colSpan={1}>End</th>
                    <th className="bg-purple-200 text-center" colSpan={1}>Failed</th>
                    <th className="bg-pink-200 text-center" colSpan={1}>Incidents</th>
                    <th className="bg-pink-200 text-center" colSpan={1}>Comments</th>
                  </tr>
                  <tr>
                    <th className="sticky-left-0 sticky-row-3 text-center">Match</th>
                    <th className="sticky-left-1 sticky-row-3 text-center">Team</th>
                    <th className="sticky-left-2 sticky-row-3 text-center">Scout</th>
                    <th className="text-center">Starting Position</th>
                    <th className="text-center">Leave</th>
                    <th className="text-center">Auto Coral Missed</th>
                    <th className="text-center">Auto Coral L1</th>
                    <th className="text-center">Auto Coral L2</th>
                    <th className="text-center">Auto Coral L3</th>
                    <th className="text-center">Auto Coral L4</th>
                    <th className="text-center">Auto Proc Missed</th>
                    <th className="text-center">Auto Proc Scored</th>
                    <th className="text-center">Auto Net Missed</th>
                    <th className="text-center">Auto Net Scored</th>
                    <th className="text-center">Tele Coral Missed</th>
                    <th className="text-center">Tele Coral L1</th>
                    <th className="text-center">Tele Coral L2</th>
                    <th className="text-center">Tele Coral L3</th>
                    <th className="text-center">Tele Coral L4</th>
                    <th className="text-center">Tele Algae Removed</th>
                    <th className="text-center">Tele Proc Missed</th>
                    <th className="text-center">Tele Proc Scored</th>
                    <th className="text-center">Tele Net Robot Missed</th>
                    <th className="text-center">Tele Net Robot Scored</th>
                    <th className="text-center">Tele Net Human Missed</th>
                    <th className="text-center">Tele Net Human Scored</th>
                    <th className="text-center">Failed Climb</th>
                    <th className="text-center">Stage Status</th>
                    <th className="text-center">Incidents</th>
                    <th className="text-center">Comments</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonRows.map((row) => {
                    const entry = row.entry;
                    return (
                      <tr key={row.id}>
                        <td className="sticky-left-0 bg-white font-semibold text-center">
                          <div className="text-[10px] uppercase text-gray-500">{row.label}</div>
                          <div>{entry ? matchLabel(entry) : "-"}</div>
                        </td>
                        <td className="sticky-left-1 bg-white font-semibold text-center">{displayEntryText(entry?.teamNumber)}</td>
                        <td className="sticky-left-2 bg-white text-center">{displayEntryText(entry?.scoutName)}</td>
                        <td className="text-center">{toDisplayTitle(entry?.startingPosition)}</td>
                        <td className="text-center">{entry?.leftStartingZone ? "Y" : "N"}</td>
                        <td className="text-center">{displayEntryText(entry?.autoCoralMissed)}</td>
                        <td className="text-center">{displayEntryText(entry?.autoCoralL1)}</td>
                        <td className="text-center">{displayEntryText(entry?.autoCoralL2)}</td>
                        <td className="text-center">{displayEntryText(entry?.autoCoralL3)}</td>
                        <td className="text-center">{displayEntryText(entry?.autoCoralL4)}</td>
                        <td className="text-center">{displayEntryText(entry?.autoAlgaeProcessorMissed)}</td>
                        <td className="text-center">{displayEntryText(entry?.autoAlgaeProcessorScored)}</td>
                        <td className="text-center">{displayEntryText(entry?.autoAlgaeNetMissed)}</td>
                        <td className="text-center">{displayEntryText(entry?.autoAlgaeNetScored)}</td>
                        <td className="text-center">{displayEntryText(entry?.teleopCoralMissed)}</td>
                        <td className="text-center">{displayEntryText(entry?.teleopCoralL1)}</td>
                        <td className="text-center">{displayEntryText(entry?.teleopCoralL2)}</td>
                        <td className="text-center">{displayEntryText(entry?.teleopCoralL3)}</td>
                        <td className="text-center">{displayEntryText(entry?.teleopCoralL4)}</td>
                        <td className="text-center">{entry?.teleopAlgaeRemoved ? "Y" : "N"}</td>
                        <td className="text-center">{displayEntryText(entry?.teleopProcessorMissed)}</td>
                        <td className="text-center">{displayEntryText(entry?.teleopProcessorScored)}</td>
                        <td className="text-center">{displayEntryText(entry?.teleopNetRobotMissed)}</td>
                        <td className="text-center">{displayEntryText(entry?.teleopNetRobotScored)}</td>
                        <td className="text-center">{displayEntryText(entry?.teleopNetHumanMissed)}</td>
                        <td className="text-center">{displayEntryText(entry?.teleopNetHumanScored)}</td>
                        <td className="text-center">{displayEntryText(entry?.failedClimb)}</td>
                        <td className="text-center">{toDisplayTitle(entry?.stageStatus || "-")}</td>
                        <td className="text-center">
                          {entry?.incidents?.map((incident) => INCIDENT_LABELS[incident] || incident).join(", ") || "-"}
                        </td>
                        <td className="text-left align-top" style={{ minWidth: "220px", maxWidth: "360px" }}>
                          <ExpandableNotesCell text={entry?.notes} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </AnalyticsShell>
  );
}

