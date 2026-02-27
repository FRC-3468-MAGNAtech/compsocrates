"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import { useAuth } from "@/app/AuthContext";
import { db } from "@/app/firebase";

type PracticeSessionRecord = {
  id: string;
  scoutNameSummary: string;
  scoutId: string;
  matchSummary: string;
  matchType: string;
  game: string;
  teamSummary: string;
  eventKey: string;
  eventName: string;
  totalScoutedScore: number;
  averageAccuracy?: number;
  submittedAt: number;
};

type ScoutingEntry = Record<string, unknown>;

function formatMatchId(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "-";
  const fx = raw.match(/^f(\d+)$/i);
  if (fx) return `F${fx[1]}`;
  const qx = raw.match(/^q(\d+)$/i);
  if (qx) return `Q${qx[1]}`;
  const px = raw.match(/^p(\d+)$/i);
  if (px) return `P${px[1]}`;
  return raw;
}

function formatMatchType(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "-";
  if (raw.toLowerCase() === "finals") return "Finals";
  if (raw.toLowerCase() === "qualification") return "Qualification";
  if (raw.toLowerCase() === "practice") return "Practice";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function getEntryGame(entry: ScoutingEntry): "REEFSCAPE" | "REBUILT" {
  const explicit = String(entry.game || "").trim().toUpperCase();
  if (explicit === "REBUILT" || explicit === "REEFSCAPE") return explicit;
  const eventKey = String(entry.eventKey || "").trim().toLowerCase();
  if (eventKey === "2026week0") return "REBUILT";
  return "REEFSCAPE";
}

function computeRebuiltScore(entry: ScoutingEntry): number {
  const direct = Number(entry.scoutedScore);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const estimated = Number(entry.estimatedScore);
  if (Number.isFinite(estimated) && estimated > 0) return estimated;

  const auto = (entry.auto as Record<string, unknown> | undefined) || {};
  const teleop = (entry.teleop as Record<string, unknown> | undefined) || {};
  const endgame = (entry.endgame as Record<string, unknown> | undefined) || {};

  const fuel =
    Number(auto.estimatedFuel || 0) +
    Number(teleop.estimatedFuel || 0) +
    Number(endgame.estimatedFuel || 0);
  const autoClimb = Boolean(auto.successfulClimb) ? 15 : 0;
  const endStatus = String(endgame.status || "").toLowerCase();
  const teleopClimb =
    endStatus === "level-1" ? 10 :
    endStatus === "level-2" ? 20 :
    endStatus === "level-3" ? 30 : 0;
  return Math.max(0, Math.round(fuel + autoClimb + teleopClimb));
}

function computeEntryScore(entry: ScoutingEntry): number {
  if (getEntryGame(entry) === "REBUILT") {
    return computeRebuiltScore(entry);
  }
  const num = (field: string) => Number(entry[field] || 0);
  let score = 0;
  if (Boolean(entry.leftStartingZone)) score += 3;
  score += num("autoCoralL1") * 3;
  score += num("autoCoralL2") * 4;
  score += num("autoCoralL3") * 6;
  score += num("autoCoralL4") * 7;
  score += num("autoAlgaeProcessorScored") * 6;
  score += num("autoAlgaeNetScored") * 4;
  score += num("teleopCoralL1") * 2;
  score += num("teleopCoralL2") * 3;
  score += num("teleopCoralL3") * 4;
  score += num("teleopCoralL4") * 5;
  score += num("teleopProcessorScored") * 6;
  score += num("teleopNetRobotScored") * 4;
  score += num("teleopNetHumanScored") * 4;
  score += num("penaltyPoints");
  const end = String(entry.stageStatus || "").toLowerCase();
  if (end.includes("deep")) score += 12;
  else if (end.includes("shallow")) score += 6;
  else if (end.includes("park") || end.includes("barge")) score += 2;
  return score;
}

function buildSummary(values: string[], max = 3): string {
  if (values.length === 0) return "-";
  if (values.length <= max) return values.join(", ");
  return `${values.slice(0, max).join(", ")} +${values.length - max} more`;
}

function PracticeSessionIdsContent() {
  const { userData } = useAuth();
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<PracticeSessionRecord[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    void loadRecords();
  }, [userData?.teamId]);

  async function loadRecords() {
    setLoading(true);
    try {
      const [sessionsSnap, scoutingSnap] = await Promise.all([
        getDocs(collection(db, "practiceSessions")),
        getDocs(collection(db, "scouting")),
      ]);
      const entriesBySession = new Map<string, ScoutingEntry[]>();
      scoutingSnap.docs.forEach((entryDoc) => {
        const data = entryDoc.data() as ScoutingEntry;
        const sessionId = String(data.practiceSessionId || "").trim();
        if (!sessionId) return;
        const current = entriesBySession.get(sessionId) || [];
        current.push(data);
        entriesBySession.set(sessionId, current);
      });

      const loaded = sessionsSnap.docs
        .map((sessionDoc) => {
          const data = sessionDoc.data() as Record<string, unknown>;
          const sessionId = sessionDoc.id;
          const sessionEntries = entriesBySession.get(sessionId) || [];
          const scouts = Array.from(
            new Set(sessionEntries.map((entry) => String(entry.scoutName || "").trim()).filter(Boolean))
          );
          const matchIds = Array.from(
            new Set(
              sessionEntries
                .map((entry) => String(entry.matchId || entry.matchNumber || "").trim())
                .filter(Boolean)
                .map(formatMatchId)
            )
          );
          const teams = Array.from(
            new Set(sessionEntries.map((entry) => String(entry.teamNumber || "").trim()).filter(Boolean))
          );
          const accuracies = sessionEntries
            .map((entry) => Number(entry.accuracy))
            .filter((value) => Number.isFinite(value) && value > 0);
          const computedEntryScore = sessionEntries.reduce((sum, entry) => {
            const direct = Number(entry.scoutedScore);
            return sum + (Number.isFinite(direct) && direct > 0 ? direct : computeEntryScore(entry));
          }, 0);
          const sessionScoutedScore = Number(data.scoutedScore || data.totalScoutedScore || 0);
          const totalScoutedScore =
            Number.isFinite(sessionScoutedScore) && sessionScoutedScore > 0
              ? sessionScoutedScore
              : computedEntryScore;
          const submittedAt = sessionEntries.reduce((latest, entry) => {
            const ts = Number(entry.submittedAt || entry.timestamp || 0);
            return ts > latest ? ts : latest;
          }, Number(data.timestamp || 0));
          const rawMatchType =
            String(data.matchType || "").trim() ||
            String(sessionEntries[0]?.matchType || "").trim() ||
            "practice";
          const game = String(data.game || sessionEntries[0]?.game || "").trim();

          return {
            id: sessionId,
            scoutNameSummary: buildSummary(scouts.length ? scouts : [String(data.scoutName || "").trim()].filter(Boolean)),
            scoutId: String(data.scoutId || ""),
            matchSummary: buildSummary(matchIds.length ? matchIds : [String(data.matchKey || "").trim()].filter(Boolean)),
            matchType: formatMatchType(rawMatchType),
            game,
            teamSummary: buildSummary(teams),
            eventKey: String(data.eventKey || ""),
            eventName: String(data.eventName || ""),
            totalScoutedScore: Math.round(totalScoutedScore),
            averageAccuracy:
              accuracies.length > 0 ? Math.round(accuracies.reduce((sum, value) => sum + value, 0) / accuracies.length) : undefined,
            submittedAt,
          } as PracticeSessionRecord;
        })
        .sort((a, b) => b.submittedAt - a.submittedAt);
      setRecords(loaded);
    } catch (error) {
      console.error("Error loading practice session IDs:", error);
      alert("Failed to load practice session IDs.");
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return records;
    return records.filter((record) =>
      [
        record.id,
        record.scoutNameSummary,
        record.scoutId,
        record.matchSummary,
        record.matchType,
        record.game,
        record.teamSummary,
        record.eventKey,
        record.eventName,
        String(record.totalScoutedScore),
        String(record.averageAccuracy || ""),
        record.submittedAt ? new Date(record.submittedAt).toLocaleString() : "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [records, search]);

  if (!userData?.isTeamAdmin) {
    return (
      <div className="flex h-screen bg-gray-50">
        <Sidebar />
        <div className="flex-1 overflow-auto p-8">
          <div className="max-w-xl bg-white rounded-xl shadow-md p-6">
            <h1 className="text-2xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>Practice Session IDs</h1>
            <p className="text-gray-600">Only team admins can access this page.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 overflow-auto p-8">
        <h1 className="text-3xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>Practice Session IDs</h1>
        <p className="text-gray-600 mb-6">Search practice session document IDs from Firebase.</p>

        <div className="bg-white rounded-xl shadow-md p-4 mb-4 flex gap-3 items-center">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by session ID, scout, match, team, event, or score"
            className="flex-1 border rounded p-2"
          />
          <button
            onClick={() => void loadRecords()}
            disabled={loading}
            className="px-3 py-2 rounded text-white disabled:opacity-60"
            style={{ backgroundColor: "var(--primary-color)" }}
          >
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="bg-white rounded-xl shadow-md p-8">
            <LoadingSpinner message="Loading practice session IDs..." />
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-md overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-gray-500">Document ID</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-gray-500">Scout</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-gray-500">Match</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-gray-500">Type/Game</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-gray-500">Team</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-gray-500">Event</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-gray-500">Score/Accuracy</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-gray-500">Submitted</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((record) => (
                  <tr key={record.id} className="border-t">
                    <td className="px-4 py-3 font-mono text-sm">{record.id}</td>
                    <td className="px-4 py-3 text-sm">{record.scoutNameSummary || record.scoutId || "-"}</td>
                    <td className="px-4 py-3 text-sm">{record.matchSummary || "-"}</td>
                    <td className="px-4 py-3 text-sm">
                      <div>{record.matchType || "-"}</div>
                      <div className="text-xs text-gray-500">{record.game || "-"}</div>
                    </td>
                    <td className="px-4 py-3 text-sm">{record.teamSummary || "-"}</td>
                    <td className="px-4 py-3 text-sm">{record.eventName || record.eventKey || "-"}</td>
                    <td className="px-4 py-3 text-sm">
                      <div>{Number.isFinite(record.totalScoutedScore) ? record.totalScoutedScore : "-"}</div>
                      <div className="text-xs text-gray-500">
                        {typeof record.averageAccuracy === "number" ? `${record.averageAccuracy}%` : "-"}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm">{record.submittedAt ? new Date(record.submittedAt).toLocaleString() : "-"}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-gray-500">No records found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function PracticeSessionIdsPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["coach", "scout"]}>
      <PracticeSessionIdsContent />
    </ProtectedRoute>
  );
}

