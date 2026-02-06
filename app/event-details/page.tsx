"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { getEvent, getEventTeams, getEventMatches, formatMatchType, getDaysUntilEvent, isEventActive, type TBAEvent, type TBATeam, type TBAMatch } from "@/app/utils/tba-api";

function EventDetailsContent() {
  const searchParams = useSearchParams();
  const eventKey = searchParams.get("event") || "2026arli"; // Default to Arkansas Regional
  
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
                  Completed
                </div>
              )}
            </div>

            {/* STATS */}
            <div className="grid grid-cols-3 gap-4 mt-6 pt-6 border-t border-gray-200">
              <div className="text-center">
                <p className="text-sm text-gray-600">Teams</p>
                <p className="text-2xl font-bold" style={{ color: "#c42221" }}>
                  {teams.length}
                </p>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-600">Matches</p>
                <p className="text-2xl font-bold" style={{ color: "#c42221" }}>
                  {matches.length}
                </p>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-600">Week</p>
                <p className="text-2xl font-bold" style={{ color: "#c42221" }}>
                  {event.week === null ? "N/A" : event.week}
                </p>
              </div>
            </div>
          </div>

          {/* TABS */}
          <div className="flex gap-2 mb-6">
            <button
              onClick={() => setActiveTab("overview")}
              className={`px-4 py-2 rounded-lg font-medium ${
                activeTab === "overview"
                  ? "text-white"
                  : "bg-white text-gray-700 hover:bg-gray-50"
              }`}
              style={activeTab === "overview" ? { backgroundColor: "#c42221" } : {}}
            >
              Overview
            </button>
            <button
              onClick={() => setActiveTab("teams")}
              className={`px-4 py-2 rounded-lg font-medium ${
                activeTab === "teams"
                  ? "text-white"
                  : "bg-white text-gray-700 hover:bg-gray-50"
              }`}
              style={activeTab === "teams" ? { backgroundColor: "#c42221" } : {}}
            >
              Teams ({teams.length})
            </button>
            <button
              onClick={() => setActiveTab("schedule")}
              className={`px-4 py-2 rounded-lg font-medium ${
                activeTab === "schedule"
                  ? "text-white"
                  : "bg-white text-gray-700 hover:bg-gray-50"
              }`}
              style={activeTab === "schedule" ? { backgroundColor: "#c42221" } : {}}
            >
              Schedule ({matches.length})
            </button>
          </div>

          {/* CONTENT */}
          {activeTab === "overview" && (
            <div className="space-y-6">
              <div className="bg-white rounded-xl shadow-md p-6">
                <h2 className="text-xl font-semibold mb-4">Event Information</h2>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-600">Event Code</p>
                    <p className="font-semibold">{event.event_code}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Event Type</p>
                    <p className="font-semibold">{event.event_type === 0 ? "Regional" : event.event_type === 1 ? "District" : "Other"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Year</p>
                    <p className="font-semibold">{event.year}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Week</p>
                    <p className="font-semibold">{event.week === null ? "Championship/Offseason" : `Week ${event.week}`}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-md p-6">
                <h2 className="text-xl font-semibold mb-4">Quick Stats</h2>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <span className="text-gray-700">Total Teams</span>
                    <span className="font-bold" style={{ color: "#c42221" }}>{teams.length}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <span className="text-gray-700">Qualification Matches</span>
                    <span className="font-bold" style={{ color: "#c42221" }}>
                      {matches.filter(m => m.comp_level === "qm").length}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <span className="text-gray-700">Playoff Matches</span>
                    <span className="font-bold" style={{ color: "#c42221" }}>
                      {matches.filter(m => m.comp_level !== "qm").length}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "teams" && (
            <div className="bg-white rounded-xl shadow-md overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Team Number
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Name
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Location
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {teams.map((team) => (
                      <tr key={team.key} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="font-bold" style={{ color: "#c42221" }}>
                            {team.team_number}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div>
                            <p className="font-semibold">{team.nickname}</p>
                            <p className="text-sm text-gray-600">{team.name}</p>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          {team.city}, {team.state_prov}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "schedule" && (
            <div className="bg-white rounded-xl shadow-md overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Match
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Red Alliance
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Blue Alliance
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Time
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {matches.map((match) => (
                      <tr key={match.key} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap font-semibold">
                          {formatMatchType(match.comp_level, match.set_number, match.match_number)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex gap-2">
                            {match.alliances.red.team_keys.map(key => (
                              <span key={key} className="px-2 py-1 bg-red-100 text-red-800 rounded text-sm font-medium">
                                {key.replace("frc", "")}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex gap-2">
                            {match.alliances.blue.team_keys.map(key => (
                              <span key={key} className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-sm font-medium">
                                {key.replace("frc", "")}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          {match.predicted_time ? new Date(match.predicted_time * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "TBD"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
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