"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { getEvent, getEventTeams, getEventMatches, formatMatchType, getDaysUntilEvent, isEventActive, type TBAEvent, type TBATeam, type TBAMatch } from "@/app/utils/tba-api";

function EventDetailsContent() {
  const searchParams = useSearchParams();
  const eventKey = searchParams.get("event") || "2025alhu"; // Default to Rocket City Regional 2025
  
  const [event, setEvent] = useState<TBAEvent | null>(null);
  const [teams, setTeams] = useState<TBATeam[]>([]);
  const [matches, setMatches] = useState<TBAMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "teams" | "schedule">("overview");

  useEffect(() => {
    loadEventData();
  }, [eventKey]);

  async function loadEventData() {
    setLoading(true);
    try {
      const [eventData, teamsData, matchesData] = await Promise.all([
        getEvent(eventKey),
        getEventTeams(eventKey),
        getEventMatches(eventKey),
      ]);
      
      setEvent(eventData);
      setTeams(teamsData);
      setMatches(matchesData.sort((a, b) => a.predicted_time - b.predicted_time));
    } catch (error) {
      console.error("Error loading event data:", error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-screen bg-gray-100">
        <Sidebar />
        <div className="flex-1 overflow-y-auto flex items-center justify-center">
          <div className="text-center">
            <div className="text-6xl mb-4">🔄</div>
            <p className="text-xl text-gray-600">Loading event data...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="flex h-screen bg-gray-100">
        <Sidebar />
        <div className="flex-1 overflow-y-auto flex items-center justify-center">
          <div className="text-center">
            <div className="text-6xl mb-4">❌</div>
            <p className="text-xl text-gray-600">Event not found</p>
          </div>
        </div>
      </div>
    );
  }

  const daysUntil = getDaysUntilEvent(event.start_date);
  const active = isEventActive(event.start_date, event.end_date);

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-8">
          {/* HEADER */}
          <div className="bg-white rounded-xl shadow-md p-6 mb-6 border-l-4" style={{ borderColor: "#c42221" }}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h1 className="text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
                  {event.name}
                </h1>
                <p className="text-lg text-gray-600">
                  📅 {new Date(event.start_date).toLocaleDateString("en-US", { month: "long", day: "numeric" })} - {new Date(event.end_date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                </p>
                <p className="text-gray-600">
                  📍 {event.city}, {event.state_prov}, {event.country}
                </p>
              </div>
              {active ? (
                <div className="px-4 py-2 rounded-lg bg-green-100 text-green-800 font-semibold">
                  🔴 LIVE NOW
                </div>
              ) : daysUntil > 0 ? (
                <div className="px-4 py-2 rounded-lg bg-blue-100 text-blue-800 font-semibold">
                  {daysUntil} days away
                </div>
              ) : (
                <div className="px-4 py-2 rounded-lg bg-gray-100 text-gray-600 font-semibold">
                  Event Completed
                </div>
              )}
            </div>
          </div>

          {/* TABS */}
          <div className="bg-white rounded-xl shadow-md mb-6 overflow-hidden">
            <div className="flex border-b">
              {(["overview", "teams", "schedule"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`
                    flex-1 px-6 py-4 font-semibold transition-colors
                    ${activeTab === tab ? "bg-red-50 text-red-600 border-b-2 border-red-600" : "text-gray-600 hover:bg-gray-50"}
                  `}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>

            <div className="p-6">
              {activeTab === "overview" && (
                <div>
                  <div className="grid md:grid-cols-3 gap-6 mb-6">
                    <div className="bg-gray-50 rounded-lg p-6">
                      <h3 className="text-sm font-semibold text-gray-600 mb-2">Total Teams</h3>
                      <p className="text-3xl font-bold" style={{ color: "#c42221" }}>
                        {teams.length}
                      </p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-6">
                      <h3 className="text-sm font-semibold text-gray-600 mb-2">Total Matches</h3>
                      <p className="text-3xl font-bold" style={{ color: "#c42221" }}>
                        {matches.length}
                      </p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-6">
                      <h3 className="text-sm font-semibold text-gray-600 mb-2">Event Week</h3>
                      <p className="text-3xl font-bold" style={{ color: "#c42221" }}>
                        Week {event.week !== null ? event.week : "N/A"}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "teams" && (
                <div>
                  <h2 className="text-xl font-semibold mb-4">Competing Teams ({teams.length})</h2>
                  <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {teams.map((team) => (
                      <div
                        key={team.key}
                        className="p-4 border rounded-lg hover:border-red-300 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className="w-12 h-12 rounded-lg flex items-center justify-center text-white font-bold"
                            style={{ backgroundColor: "#c42221" }}
                          >
                            {team.team_number}
                          </div>
                          <div className="flex-1">
                            <h3 className="font-semibold">{team.nickname || `Team ${team.team_number}`}</h3>
                            <p className="text-sm text-gray-600">
                              {team.city}, {team.state_prov}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === "schedule" && (
                <div>
                  <h2 className="text-xl font-semibold mb-4">Match Schedule ({matches.length} matches)</h2>
                  <div className="space-y-3">
                    {matches.slice(0, 20).map((match) => (
                      <div
                        key={match.key}
                        className="p-4 border rounded-lg hover:border-red-300 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="font-semibold">
                              {formatMatchType(match.comp_level, match.set_number, match.match_number)}
                            </h3>
                            <p className="text-sm text-gray-600 mt-1">
                              {match.predicted_time
                                ? new Date(match.predicted_time * 1000).toLocaleString()
                                : "Time TBD"}
                            </p>
                          </div>
                          <div className="flex gap-4">
                            <div className="text-right">
                              <p className="text-xs text-gray-600 mb-1">Red Alliance</p>
                              <div className="flex gap-1">
                                {match.alliances.red.team_keys.map((teamKey) => (
                                  <span
                                    key={teamKey}
                                    className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs font-semibold"
                                  >
                                    {teamKey.replace("frc", "")}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-xs text-gray-600 mb-1">Blue Alliance</p>
                              <div className="flex gap-1">
                                {match.alliances.blue.team_keys.map((teamKey) => (
                                  <span
                                    key={teamKey}
                                    className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-semibold"
                                  >
                                    {teamKey.replace("frc", "")}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                    {matches.length > 20 && (
                      <p className="text-center text-gray-600 py-4">
                        Showing first 20 of {matches.length} matches
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function EventDetailsPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["coach", "scout"]}>
      <EventDetailsContent />
    </ProtectedRoute>
  );
}