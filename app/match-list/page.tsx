"use client";

import { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import DataSourceCredits from "@/app/components/DataSourceCredits";
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

function compLevelPriority(compLevel: string) {
  if (compLevel === "qm") return 0;
  if (compLevel === "ef") return 1;
  if (compLevel === "qf") return 2;
  if (compLevel === "sf") return 3;
  if (compLevel === "f") return 4;
  return 99;
}

async function fetchMatchesForEvent(eventKey: string, encryptedKey: string, plainKey: string): Promise<TBAMatch[]> {
  try {
    const response = await fetch("/api/tba/matches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventKey, encryptedKey, plainKey }),
    });
    if (response.ok) {
      const payload = (await response.json()) as { matches?: TBAMatch[] };
      if (Array.isArray(payload.matches)) return payload.matches;
    }
  } catch (error) {
    console.warn("Match list TBA proxy failed:", error);
  }

  try {
    return await getEventMatches(eventKey, plainKey || undefined);
  } catch (error) {
    console.warn("Match list direct TBA fetch failed:", error);
    return [];
  }
}

function isPastEvent(event: UpcomingEvent) {
  const now = Date.now();
  const end = new Date(`${event.endDate}T23:59:59`).getTime();
  return Number.isFinite(end) && now > end;
}

function sortDashboardEvents(events: UpcomingEvent[]) {
  return [...events].sort((a, b) => {
    const aPast = isPastEvent(a);
    const bPast = isPastEvent(b);
    if (aPast !== bPast) return aPast ? 1 : -1;
    const aTime = new Date(`${a.startDate}T12:00:00`).getTime();
    const bTime = new Date(`${b.startDate}T12:00:00`).getTime();
    return aTime - bTime;
  });
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
        const orderedEvents = sortDashboardEvents(allEvents);
        setEvents(orderedEvents);
        setActiveEventKey(orderedEvents[0]?.key || "");

        const encryptedKey = String(teamDoc.data()?.tbaApiKeyEncrypted || "").trim();
        const plainKey = String(teamDoc.data()?.tbaApiKey || "").trim();
        const matches = await Promise.all(
          orderedEvents.map(async (event) => {
            try {
              const rows = await fetchMatchesForEvent(event.key, encryptedKey, plainKey);
              const normalized = rows
                .sort((a, b) => {
                  const levelDiff = compLevelPriority(a.comp_level) - compLevelPriority(b.comp_level);
                  if (levelDiff !== 0) return levelDiff;
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
            } catch (error) {
              console.warn(`Match list failed for ${event.key}:`, error);
              return [event.key, []] as const;
            }
          })
        );
        const byEvent = Object.fromEntries(matches);
        setMatchesByEvent(byEvent);
        const firstWithMatches = orderedEvents.find((event) => (byEvent[event.key] || []).length > 0);
        setActiveEventKey(firstWithMatches?.key || orderedEvents[0]?.key || "");
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
        <DataSourceCredits className="mb-6 max-w-3xl" />
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
            {events.length === 0 ? (
              <div className="bg-white rounded-xl shadow-md p-6 text-sm text-gray-600">
                No visible events found. Ask a team lead to mark event attendance in Event Selection.
              </div>
            ) : activeMatches.length === 0 ? (
              <div className="bg-white rounded-xl shadow-md p-6 text-sm text-gray-600">
                No matches are available for the selected event yet.
              </div>
            ) : (
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
                  </tbody>
                </table>
              </div>
            )}
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
