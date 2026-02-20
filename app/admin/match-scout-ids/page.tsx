"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import { useAuth } from "@/app/AuthContext";
import { db } from "@/app/firebase";

type MatchScoutRecord = {
  id: string;
  scoutName: string;
  scoutId: string;
  matchId: string;
  matchType: string;
  teamNumber: string;
  game: string;
  eventKey: string;
  eventName: string;
  scoutedScore: number;
  accuracy: number;
  notes: string;
  submittedAt: number;
};

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

function MatchScoutIdsContent() {
  const { userData } = useAuth();
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<MatchScoutRecord[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    void loadRecords();
  }, [userData?.teamId]);

  async function loadRecords() {
    setLoading(true);
    try {
      const scoutingSnap = await getDocs(collection(db, "scouting"));
      const loaded = scoutingSnap.docs
        .map((entryDoc) => {
          const data = entryDoc.data() as Record<string, unknown>;
          const isPractice = Boolean(data.isPracticeScouting) || Boolean(data.practiceMode) || Boolean(data.practiceSessionId);
          if (isPractice) return null;
          return {
            id: entryDoc.id,
            scoutName: String(data.scoutName || ""),
            scoutId: String(data.scoutId || ""),
            matchId: String(data.matchId || ""),
            matchType: String(data.matchType || ""),
            teamNumber: String(data.teamNumber || ""),
            game: String(data.game || ""),
            eventKey: String(data.eventKey || ""),
            eventName: String(data.eventName || ""),
            scoutedScore: Number(data.scoutedScore || 0),
            accuracy: Number(data.accuracy || 0),
            notes: String(data.notes || ""),
            submittedAt: Number(data.submittedAt || data.timestamp || 0),
          } as MatchScoutRecord;
        })
        .filter((value): value is MatchScoutRecord => Boolean(value))
        .sort((a, b) => b.submittedAt - a.submittedAt);
      setRecords(loaded);
    } catch (error) {
      console.error("Error loading match scout IDs:", error);
      alert("Failed to load match scout IDs.");
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
        record.scoutName,
        record.scoutId,
        record.matchId,
        record.matchType,
        record.teamNumber,
        record.game,
        record.eventKey,
        record.eventName,
        String(record.scoutedScore),
        String(record.accuracy),
        record.notes,
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
            <h1 className="text-2xl font-bold mb-2" style={{ color: "#c42221" }}>Match Scout IDs</h1>
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
        <h1 className="text-3xl font-bold mb-2" style={{ color: "#c42221" }}>Match Scout IDs</h1>
        <p className="text-gray-600 mb-6">Search official match scouting document IDs from Firebase.</p>

        <div className="bg-white rounded-xl shadow-md p-4 mb-4 flex gap-3 items-center">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by ID, scout, match, team, or event"
            className="flex-1 border rounded p-2"
          />
          <button
            onClick={() => void loadRecords()}
            disabled={loading}
            className="px-3 py-2 rounded text-white disabled:opacity-60"
            style={{ backgroundColor: "#c42221" }}
          >
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="bg-white rounded-xl shadow-md p-8">
            <LoadingSpinner message="Loading match scout IDs..." />
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
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-gray-500">Notes</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((record) => (
                  <tr key={record.id} className="border-t">
                    <td className="px-4 py-3 font-mono text-sm">{record.id}</td>
                    <td className="px-4 py-3 text-sm">{record.scoutName || record.scoutId || "-"}</td>
                    <td className="px-4 py-3 text-sm">{formatMatchId(record.matchId)}</td>
                    <td className="px-4 py-3 text-sm">
                      <div>{formatMatchType(record.matchType)}</div>
                      <div className="text-xs text-gray-500">{record.game || "-"}</div>
                    </td>
                    <td className="px-4 py-3 text-sm">{record.teamNumber || "-"}</td>
                    <td className="px-4 py-3 text-sm">{record.eventName || record.eventKey || "-"}</td>
                    <td className="px-4 py-3 text-sm">
                      <div>{Number.isFinite(record.scoutedScore) ? record.scoutedScore : "-"}</div>
                      <div className="text-xs text-gray-500">{Number.isFinite(record.accuracy) && record.accuracy > 0 ? `${record.accuracy}%` : "-"}</div>
                    </td>
                    <td className="px-4 py-3 text-sm">{record.submittedAt ? new Date(record.submittedAt).toLocaleString() : "-"}</td>
                    <td className="px-4 py-3 text-sm max-w-xs truncate" title={record.notes || ""}>{record.notes || "-"}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-gray-500">No records found.</td>
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

export default function MatchScoutIdsPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["coach", "scout"]}>
      <MatchScoutIdsContent />
    </ProtectedRoute>
  );
}
