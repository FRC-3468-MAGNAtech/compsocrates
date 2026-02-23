"use client";

import { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import { useAuth } from "@/app/AuthContext";
import { getUpcomingEvents, type UpcomingEvent } from "@/app/utils/stats-calculator";
import { getEventMatches, type TBAMatch } from "@/app/utils/tba-api";

type MatchRow = {
  key: string;
  label: string;
  time: number;
  red: number[];
  blue: number[];
};

function matchLabel(match: TBAMatch) {
  if (match.comp_level === "qm") return `Qualification ${match.match_number}`;
  if (match.comp_level === "f") return `Finals ${match.match_number}`;
  if (match.comp_level === "sf") return `Semifinal ${match.set_number}-${match.match_number}`;
  if (match.comp_level === "qf") return `Quarterfinal ${match.set_number}-${match.match_number}`;
  if (match.comp_level === "ef") return `Octofinal ${match.set_number}-${match.match_number}`;
  return match.key;
}

function MatchListContent() {
  const { userData } = useAuth();
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<UpcomingEvent[]>([]);
  const [activeEventKey, setActiveEventKey] = useState("");
  const [matchesByEvent, setMatchesByEvent] = useState<Record<string, MatchRow[]>>({});

  useEffect(() => {
    async function load() {
      if (!userData?.teamId) return;
      setLoading(true);
      try {
        const [allEvents, teamDoc] = await Promise.all([
          getUpcomingEvents(userData.teamId),
          getDoc(doc(db, "teams", userData.teamId)),
        ]);
        const attendanceByEvent = (teamDoc.exists() ? teamDoc.data().eventAttendees : {}) as Record<string, string[]> | undefined;
        const normalizedUid = String(userData.uid || "").trim();
        const normalizedName = String(userData.displayName || "").trim().toLowerCase();
        const visibleEvents = userData.isTeamAdmin
          ? allEvents
          : allEvents.filter((event) => {
              const attendees = attendanceByEvent?.[event.key] || [];
              return attendees.some((value) => {
                const safe = String(value || "").trim();
                return safe === normalizedUid || safe.toLowerCase() === normalizedName;
              });
            });
        setEvents(visibleEvents);
        setActiveEventKey(visibleEvents[0]?.key || "");

        const matches = await Promise.all(
          visibleEvents.map(async (event) => {
            const rows = await getEventMatches(event.key);
            const normalized = rows
              .sort((a, b) => {
                if (a.comp_level !== b.comp_level) return a.comp_level.localeCompare(b.comp_level);
                if (a.set_number !== b.set_number) return a.set_number - b.set_number;
                return a.match_number - b.match_number;
              })
              .map((match) => ({
                key: match.key,
                label: matchLabel(match),
                time: match.actual_time || match.predicted_time || match.time || 0,
                red: match.alliances.red.team_keys.map((k) => parseInt(k.replace("frc", ""), 10)).filter(Number.isFinite),
                blue: match.alliances.blue.team_keys.map((k) => parseInt(k.replace("frc", ""), 10)).filter(Number.isFinite),
              }));
            return [event.key, normalized] as const;
          })
        );
        setMatchesByEvent(Object.fromEntries(matches));
      } catch (error) {
        console.error("Failed to load match list:", error);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [userData?.teamId, userData?.uid, userData?.displayName, userData?.isTeamAdmin]);

  const activeMatches = useMemo(() => matchesByEvent[activeEventKey] || [], [matchesByEvent, activeEventKey]);

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto p-8">
        <h1 className="text-3xl font-bold mb-2 theme-text">Match List</h1>
        <p className="text-gray-600 mb-6">API-synced match schedule for your visible events.</p>
        {loading ? (
          <LoadingSpinner message="Loading matches..." />
        ) : (
          <>
            <div className="bg-white rounded-xl shadow-md p-4 mb-4 overflow-x-auto">
              <div className="inline-flex gap-2">
                {events.map((event) => (
                  <button
                    key={event.key}
                    onClick={() => setActiveEventKey(event.key)}
                    className={`px-4 py-2 rounded-lg whitespace-nowrap ${activeEventKey === event.key ? "text-white" : "bg-gray-100 text-gray-700"}`}
                    style={activeEventKey === event.key ? { backgroundColor: "var(--primary-color)" } : {}}
                  >
                    {event.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-md overflow-x-auto">
              <table className="w-full min-w-[840px]">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Match</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Red Alliance</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Blue Alliance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {activeMatches.map((match) => (
                    <tr key={match.key}>
                      <td className="px-4 py-3 font-medium">{match.label}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {match.time > 0 ? new Date(match.time * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "TBD"}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">{match.red.join(", ") || "-"}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{match.blue.join(", ") || "-"}</td>
                    </tr>
                  ))}
                  {activeMatches.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-500">No matches available.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function MatchListPage() {
  return (
    <ProtectedRoute requireAuth={true}>
      <MatchListContent />
    </ProtectedRoute>
  );
}
