"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDocs, updateDoc, query, where } from "firebase/firestore";
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
  const [repairingRocketCity, setRepairingRocketCity] = useState(false);

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

  async function repairRocketCitySessions() {
    if (!userData?.isTeamAdmin || repairingRocketCity) return;
    if (!confirm("Fix app-testing practice sessions that belong to Rocket City?")) return;

    setRepairingRocketCity(true);
    try {
      const sessionsSnap = await getDocs(query(collection(db, "practiceSessions"), where("eventKey", "==", "app-testing")));
      const targets = sessionsSnap.docs
        .map((sessionDoc) => ({
          id: sessionDoc.id,
          ...(sessionDoc.data() as Record<string, unknown>),
        }) as { id: string } & Record<string, unknown>)
        .filter((session) => {
          const name = String(session.eventName || "").toLowerCase();
          const matchKey = String(session.matchKey || "").toLowerCase();
          return name.includes("rocket city") || matchKey.startsWith("2025alhu_");
        });

      let sessionsUpdated = 0;
      let scoutingUpdated = 0;
      for (const session of targets) {
        await updateDoc(doc(db, "practiceSessions", session.id), {
          eventKey: "2025alhu",
          eventName: "Rocket City Regional",
          repairedAt: Date.now(),
        });
        sessionsUpdated += 1;

        const scoutingSnap = await getDocs(query(collection(db, "scouting"), where("practiceSessionId", "==", session.id)));
        for (const scoutingDoc of scoutingSnap.docs) {
          await updateDoc(doc(db, "scouting", scoutingDoc.id), {
            eventKey: "2025alhu",
            eventName: "Rocket City Regional",
            repairedAt: Date.now(),
          });
          scoutingUpdated += 1;
        }
      }

      await loadRecords();
      alert(`Repaired ${sessionsUpdated} practice sessions and ${scoutingUpdated} linked scouting entries.`);
    } catch (error) {
      console.error("Error repairing Rocket City sessions:", error);
      alert("Failed to repair Rocket City sessions.");
    } finally {
      setRepairingRocketCity(false);
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
          <button
            onClick={() => void repairRocketCitySessions()}
            disabled={repairingRocketCity}
            className="px-3 py-2 rounded bg-blue-600 text-white disabled:opacity-60"
          >
            {repairingRocketCity ? "Repairing..." : "Fix Rocket City"}
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
