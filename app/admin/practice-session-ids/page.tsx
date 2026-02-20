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
  scoutName: string;
  scoutId: string;
  matchKey: string;
  eventKey: string;
  eventName: string;
  mode: string;
  timestamp: number;
};

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
      const sessionsSnap = await getDocs(collection(db, "practiceSessions"));
      const loaded = sessionsSnap.docs
        .map((sessionDoc) => {
          const data = sessionDoc.data() as Record<string, unknown>;
          return {
            id: sessionDoc.id,
            scoutName: String(data.scoutName || ""),
            scoutId: String(data.scoutId || ""),
            matchKey: String(data.matchKey || ""),
            eventKey: String(data.eventKey || ""),
            eventName: String(data.eventName || ""),
            mode: String(data.mode || ""),
            timestamp: Number(data.timestamp || 0),
          } as PracticeSessionRecord;
        })
        .sort((a, b) => b.timestamp - a.timestamp);
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
        record.scoutName,
        record.scoutId,
        record.matchKey,
        record.eventKey,
        record.eventName,
        record.mode,
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
            <h1 className="text-2xl font-bold mb-2" style={{ color: "#c42221" }}>Practice Session IDs</h1>
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
        <h1 className="text-3xl font-bold mb-2" style={{ color: "#c42221" }}>Practice Session IDs</h1>
        <p className="text-gray-600 mb-6">Search practice session document IDs from Firebase.</p>

        <div className="bg-white rounded-xl shadow-md p-4 mb-4 flex gap-3 items-center">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by ID, scout, mode, match key, or event"
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
            <LoadingSpinner message="Loading practice session IDs..." />
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-md overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-gray-500">Session ID</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-gray-500">Scout</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-gray-500">Mode</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-gray-500">Match Key</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-gray-500">Event</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((record) => (
                  <tr key={record.id} className="border-t">
                    <td className="px-4 py-3 font-mono text-sm">{record.id}</td>
                    <td className="px-4 py-3 text-sm">{record.scoutName || record.scoutId || "-"}</td>
                    <td className="px-4 py-3 text-sm capitalize">{record.mode || "-"}</td>
                    <td className="px-4 py-3 text-sm">{record.matchKey || "-"}</td>
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

export default function PracticeSessionIdsPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["coach", "scout"]}>
      <PracticeSessionIdsContent />
    </ProtectedRoute>
  );
}
