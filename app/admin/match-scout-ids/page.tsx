"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import { useAuth } from "@/app/AuthContext";
import { db } from "@/app/firebase";

type TeamMember = { uid: string; displayName: string };
type MatchScoutRecord = {
  id: string;
  scoutName: string;
  scoutId: string;
  matchId: string;
  teamNumber: string;
  eventKey: string;
  eventName: string;
  submittedAt: number;
};

function chunk<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
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
    if (!userData?.teamId) return;
    setLoading(true);
    try {
      const membersSnap = await getDocs(query(collection(db, "users"), where("teamId", "==", userData.teamId)));
      const members: TeamMember[] = membersSnap.docs.map((memberDoc) => ({
        uid: memberDoc.id,
        displayName: String(memberDoc.data().displayName || ""),
      }));
      const memberIds = members.map((member) => member.uid).filter(Boolean);
      const memberNames = members.map((member) => member.displayName).filter(Boolean);

      const byId = new Map<string, MatchScoutRecord>();

      for (const ids of chunk(memberIds, 30)) {
        const snap = await getDocs(query(collection(db, "scouting"), where("scoutId", "in", ids)));
        snap.docs.forEach((entryDoc) => {
          const data = entryDoc.data() as Record<string, unknown>;
          const isPractice = Boolean(data.isPracticeScouting) || Boolean(data.practiceMode) || Boolean(data.practiceSessionId);
          if (isPractice) return;
          byId.set(entryDoc.id, {
            id: entryDoc.id,
            scoutName: String(data.scoutName || ""),
            scoutId: String(data.scoutId || ""),
            matchId: String(data.matchId || ""),
            teamNumber: String(data.teamNumber || ""),
            eventKey: String(data.eventKey || ""),
            eventName: String(data.eventName || ""),
            submittedAt: Number(data.submittedAt || data.timestamp || 0),
          });
        });
      }

      for (const name of memberNames) {
        const snap = await getDocs(query(collection(db, "scouting"), where("scoutName", "==", name)));
        snap.docs.forEach((entryDoc) => {
          if (byId.has(entryDoc.id)) return;
          const data = entryDoc.data() as Record<string, unknown>;
          const isPractice = Boolean(data.isPracticeScouting) || Boolean(data.practiceMode) || Boolean(data.practiceSessionId);
          if (isPractice) return;
          byId.set(entryDoc.id, {
            id: entryDoc.id,
            scoutName: String(data.scoutName || ""),
            scoutId: String(data.scoutId || ""),
            matchId: String(data.matchId || ""),
            teamNumber: String(data.teamNumber || ""),
            eventKey: String(data.eventKey || ""),
            eventName: String(data.eventName || ""),
            submittedAt: Number(data.submittedAt || data.timestamp || 0),
          });
        });
      }

      const loaded = Array.from(byId.values()).sort((a, b) => b.submittedAt - a.submittedAt);
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
        record.teamNumber,
        record.eventKey,
        record.eventName,
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
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-gray-500">Team</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-gray-500">Event</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((record) => (
                  <tr key={record.id} className="border-t">
                    <td className="px-4 py-3 font-mono text-sm">{record.id}</td>
                    <td className="px-4 py-3 text-sm">{record.scoutName || record.scoutId || "-"}</td>
                    <td className="px-4 py-3 text-sm">{record.matchId || "-"}</td>
                    <td className="px-4 py-3 text-sm">{record.teamNumber || "-"}</td>
                    <td className="px-4 py-3 text-sm">{record.eventName || record.eventKey || "-"}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-500">No records found.</td>
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

