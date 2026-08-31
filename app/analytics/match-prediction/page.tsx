"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "@/app/firebase";
import { useAuth } from "@/app/AuthContext";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import AnalyticsShell from "@/app/components/AnalyticsShell";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import { getTeamEventOptions, type DetectedEventOption } from "@/app/utils/eventDetection";
import {
  buildTacticalPrediction,
  type ConfidenceTier,
  type PredictionEntry,
  type PredictionSource,
  type TacticalPrediction,
} from "@/app/utils/predictionEngine";

type TbaMatchRow = {
  key?: string;
  comp_level?: string;
  set_number?: number;
  match_number?: number;
  alliances?: {
    red?: { team_keys?: string[] };
    blue?: { team_keys?: string[] };
  };
};

function matchLevelLabel(level: string | undefined): string {
  if (level === "qm") return "Qualification";
  if (level === "qf") return "Quarterfinal";
  if (level === "sf") return "Semifinal";
  if (level === "f") return "Final";
  if (level === "pr") return "Practice";
  return "Match";
}

function teamKeysToNumbers(keys: string[] | undefined): string[] {
  return (keys || []).map((key) => key.replace(/^frc/i, "").trim()).filter(Boolean);
}

function sortMatches(rows: TbaMatchRow[]): TbaMatchRow[] {
  const levelRank: Record<string, number> = { pr: 0, qm: 1, qf: 2, sf: 3, f: 4 };
  return [...rows].sort((a, b) => {
    const rankDiff = (levelRank[a.comp_level || ""] ?? 5) - (levelRank[b.comp_level || ""] ?? 5);
    if (rankDiff !== 0) return rankDiff;
    return (a.match_number || 0) - (b.match_number || 0);
  });
}

function PredictionContent() {
  const { userData } = useAuth();
  const [events, setEvents] = useState<DetectedEventOption[]>([]);
  const [selectedEvent, setSelectedEvent] = useState("");
  const [source, setSource] = useState<PredictionSource>("combined");
  const [confidenceTier, setConfidenceTier] = useState<ConfidenceTier>(85);
  const [matches, setMatches] = useState<TbaMatchRow[]>([]);
  const [historicalEntries, setHistoricalEntries] = useState<PredictionEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadEvents() {
      if (!userData?.teamId) return;
      const options = await getTeamEventOptions(userData.teamId);
      setEvents(options);
      setSelectedEvent((prev) => prev || options[0]?.key || "");
    }
    void loadEvents();
  }, [userData?.teamId]);

  useEffect(() => {
    async function loadHistoricalEntries() {
      try {
        const snap = await getDocs(collection(db, "scouting"));
        const rows = snap.docs
          .map((row) => row.data() as PredictionEntry)
          .filter((row) => String(row.game || "REBUILT").toUpperCase() === "REBUILT");
        setHistoricalEntries(rows);
      } catch (loadError) {
        console.error("Failed to load scouting history for predictions:", loadError);
        setHistoricalEntries([]);
      }
    }
    void loadHistoricalEntries();
  }, []);

  useEffect(() => {
    async function loadMatches() {
      if (!selectedEvent || !userData?.teamId) {
        setMatches([]);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
        const encryptedKey = String(teamDoc.data()?.tbaApiKeyEncrypted || "").trim();
        const plainKey = String(teamDoc.data()?.tbaApiKey || "").trim();
        if (!encryptedKey && !plainKey) {
          setError("Add a TBA API key in Settings to load the match schedule for this event.");
          setMatches([]);
          return;
        }
        const response = await fetch("/api/tba/matches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventKey: selectedEvent, encryptedKey, plainKey }),
        });
        if (!response.ok) {
          setError("Unable to load the match schedule for this event right now.");
          setMatches([]);
          return;
        }
        const payload = (await response.json()) as { matches?: TbaMatchRow[] };
        setMatches(sortMatches(Array.isArray(payload.matches) ? payload.matches : []));
      } catch (loadError) {
        console.error("Failed to load event matches for predictions:", loadError);
        setError("Unable to load the match schedule for this event right now.");
        setMatches([]);
      } finally {
        setLoading(false);
      }
    }
    void loadMatches();
  }, [selectedEvent, userData?.teamId]);

  const allTeamNumbers = useMemo(() => {
    const set = new Set<string>();
    matches.forEach((match) => {
      teamKeysToNumbers(match.alliances?.red?.team_keys).forEach((team) => set.add(team));
      teamKeysToNumbers(match.alliances?.blue?.team_keys).forEach((team) => set.add(team));
    });
    return set;
  }, [matches]);

  const predictionsByTeam = useMemo(() => {
    const next: Record<string, TacticalPrediction> = {};
    allTeamNumbers.forEach((team) => {
      next[team] = buildTacticalPrediction(team, historicalEntries, "REBUILT", source, confidenceTier);
    });
    return next;
  }, [allTeamNumbers, confidenceTier, historicalEntries, source]);

  return (
    <AnalyticsShell
      entriesCount={matches.length}
      selectedGame="REBUILT"
      onSelectedGameChange={() => {}}
      selectedEvent={selectedEvent}
      eventOptions={events.map((event) => ({ id: event.key, name: event.name || event.key }))}
      onSelectedEventChange={setSelectedEvent}
      extraControls={
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            Data Source
            <select
              className="rounded border border-gray-300 px-2 py-1 text-sm"
              value={source}
              onChange={(event) => setSource(event.target.value as PredictionSource)}
            >
              <option value="official">Official Event Data</option>
              <option value="practice">Practice Scouted Data</option>
              <option value="combined">Combined Hybrid</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            Confidence
            <select
              className="rounded border border-gray-300 px-2 py-1 text-sm"
              value={confidenceTier}
              onChange={(event) => setConfidenceTier(Number(event.target.value) as ConfidenceTier)}
            >
              <option value={75}>75%</option>
              <option value={85}>85%</option>
              <option value={90}>90%</option>
            </select>
          </label>
        </div>
      }
    >
      <h1 className="text-3xl font-bold mb-2 theme-text">Match Prediction</h1>
      <p className="text-gray-600 mb-6">
        Auto-filled tactical projections for every match in the selected event — predicted starting position, role,
        climb probability, and estimated point contribution, sourced from historical scouting data.
      </p>

      {error && (
        <div className="mb-6 rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">{error}</div>
      )}

      {loading ? (
        <LoadingSpinner message="Loading match schedule..." />
      ) : matches.length === 0 ? (
        <div className="bg-white rounded-xl shadow-md p-6 text-sm text-gray-600">
          No matches found for this event yet.
        </div>
      ) : (
        <div className="space-y-4">
          {matches.map((match) => {
            const redTeams = teamKeysToNumbers(match.alliances?.red?.team_keys);
            const blueTeams = teamKeysToNumbers(match.alliances?.blue?.team_keys);
            return (
              <div key={match.key || `${match.comp_level}-${match.match_number}`} className="bg-white rounded-xl shadow-md p-4">
                <h2 className="text-lg font-semibold mb-3">
                  {matchLevelLabel(match.comp_level)} {match.match_number}
                </h2>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold uppercase text-red-700 mb-2">Red Alliance</p>
                    <div className="space-y-2">
                      {redTeams.map((team) => (
                        <PredictionRow key={team} team={team} prediction={predictionsByTeam[team]} />
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase text-blue-700 mb-2">Blue Alliance</p>
                    <div className="space-y-2">
                      {blueTeams.map((team) => (
                        <PredictionRow key={team} team={team} prediction={predictionsByTeam[team]} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AnalyticsShell>
  );
}

function PredictionRow({ team, prediction }: { team: string; prediction?: TacticalPrediction }) {
  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <div className="flex items-center justify-between">
        <p className="font-semibold">Team {team}</p>
        <p className="text-sm text-gray-500">
          {prediction?.sampleSize ?? 0} match{prediction?.sampleSize === 1 ? "" : "es"}
        </p>
      </div>
      {prediction ? (
        <div className="mt-2 grid grid-cols-2 gap-2 text-sm text-gray-700 sm:grid-cols-4">
          <div>
            <p className="text-xs text-gray-500">Start</p>
            <p className="font-medium">{prediction.startingPosition}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Role</p>
            <p className="font-medium">{prediction.role}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Climb %</p>
            <p className="font-medium">{prediction.climbProbability}%</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Est. Points</p>
            <p className="font-medium theme-text">{prediction.estimatedPoints}</p>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-sm text-gray-500">No historical data yet.</p>
      )}
    </div>
  );
}

export default function MatchPredictionPage() {
  return (
    <ProtectedRoute requireAuth={true}>
      <PredictionContent />
    </ProtectedRoute>
  );
}
