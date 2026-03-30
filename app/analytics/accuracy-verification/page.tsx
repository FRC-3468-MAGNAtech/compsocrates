"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { addDoc, collection, getDoc, getDocs, query, where, doc } from "firebase/firestore";
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
  criticalFlag?: boolean;
  createdAt?: number;
  updatedAt?: number;
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
  alliances: AllianceGroup[];
};

function normalizeAlliance(value: unknown): "red" | "blue" | null {
  const raw = String(value || "").toLowerCase().trim();
  if (raw.startsWith("r")) return "red";
  if (raw.startsWith("b")) return "blue";
  return null;
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
  const canManageAll = Boolean(userData?.isTeamAdmin) || roles.includes("team-coach");

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
        setEntries(rows);
        setEventOptions(getEventOptionsForEntries(rows, selectedGame));
        const rescoutSnap = await getDocs(query(collection(db, "accuracyRescouts"), where("teamId", "==", teamId)));
        if (!isActive) return;
        const rescoutRows: RescoutEntry[] = rescoutSnap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Omit<RescoutEntry, "id">),
        }));
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
      return entryMatchesAnalyticsFilters(normalizedEntry, selectedGame, eventId, getEventsForGame(selectedGame));
    });
  }, [entries, selectedEvent, selectedGame]);

  const highAccuracyMatches = useMemo<HighAccuracyMatch[]>(() => {
    const byMatch = new Map<string, HighAccuracyMatch>();
    filteredEntries.forEach((entry) => {
      if (!isAccuracyComplete(entry)) return;
      const alliance = normalizeAlliance(entry.alliance);
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
      if (accuracy !== null) allianceGroup.accuracy = accuracy;
    });

    const matches = Array.from(byMatch.values())
      .filter((match) => {
        const red = match.alliances.find((alliance) => alliance.alliance === "red");
        const blue = match.alliances.find((alliance) => alliance.alliance === "blue");
      const redAccuracy = red?.accuracy ?? null;
      const blueAccuracy = blue?.accuracy ?? null;
      if (!(redAccuracy !== null && blueAccuracy !== null)) return false;
      if (redAccuracy < 75 || blueAccuracy < 75) return false;
      return red?.teams.length === 3 && blue?.teams.length === 3;
    })
      .map((match) => ({
        ...match,
        alliances: match.alliances
          .filter((alliance) => alliance.teams.length === 3)
          .sort((a, b) => (a.alliance === "red" ? -1 : 1)),
      }))
      .filter((match) => match.alliances.length === 2)
      .sort((a, b) => (a.eventName || "").localeCompare(b.eventName || "") || b.sortOrder - a.sortOrder);
    return matches;
  }, [filteredEntries]);

  const criticalFlags = useMemo(() => rescouts.filter((row) => row.criticalFlag), [rescouts]);

  const rescoutsByTeam = useMemo(() => {
    const map = new Map<string, RescoutEntry>();
    rescouts.forEach((row) => {
      const key = `${row.matchKey || ""}::${row.teamNumber || ""}`;
      map.set(key, row);
    });
    return map;
  }, [rescouts]);

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
      const docRef = await addDoc(collection(db, "accuracyRescouts"), {
        teamId: userData.teamId,
        eventKey: activeRescout.eventKey,
        eventName: activeRescout.eventName,
        matchKey: activeRescout.matchKey,
        matchLabel: activeRescout.matchLabel,
        game: selectedGame,
        alliance: activeAlliance.alliance,
        teamNumber,
        scoutId: userData.uid,
        scoutName: userData.displayName || "",
        status: "pending",
        accuracy: null,
        criticalFlag: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        originalScouts: activeAlliance.scouts,
      });
      setActiveRescout(null);
      setActiveAlliance(null);
      router.push(`/practice-scouting?rescoutId=${docRef.id}`);
    } catch (error) {
      console.error("Failed to create rescout entry:", error);
      alert("Could not start rescout request.");
    } finally {
      setSavingRescout(false);
    }
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
      <div className="flex h-screen bg-gray-100">
        <div className="m-auto">
          <LoadingSpinner message="Loading accuracy verification..." />
        </div>
      </div>
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
            </div>
          ))}
        </SectionCard>

        <SectionCard
          title="High Accuracy Matches"
          description="Matches with completed accuracy scripts and full team coverage."
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
                const key = `${activeRescout.matchKey}::${team}`;
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
                    Team {team} {exists ? "(Already re-scouted)" : ""}
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
        {items.length === 0 ? <p className="text-sm text-gray-500">{emptyLabel}</p> : children}
      </div>
    </div>
  );
}
