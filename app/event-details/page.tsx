"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { collection, doc, setDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { LoadingSpinner } from "@/app/components/LoadingSpinner";
import { Download, Users, Calendar, MapPin } from "lucide-react";

const EVENT_DATA: Record<string, any> = {
  "2026arli": {
    key: "2026arli",
    name: "Arkansas Regional",
    city: "Little Rock",
    state_prov: "AR",
    country: "USA",
    startDate: "2026-03-18",
    endDate: "2026-03-21",
    week: 3,
    event_type: "Regional"
  },
  "2026labr": {
    key: "2026labr",
    name: "Bayou Regional",
    city: "Kenner",
    state_prov: "LA",
    country: "USA",
    startDate: "2026-04-01",
    endDate: "2026-04-04",
    week: 4,
    event_type: "Regional"
  }
};

interface Team {
  team_number: number;
  nickname: string;
  city: string;
  state_prov: string;
  country: string;
}

function EventDetailsContent() {
  const params = useParams();
  const eventKey = params.eventKey as string;
  
  const [event, setEvent] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "teams" | "schedule">("overview");
  const [teams, setTeams] = useState<Team[]>([]);
  const [importing, setImporting] = useState(false);
  const [loadingTeams, setLoadingTeams] = useState(false);

  useEffect(() => {
    loadEventData();
    loadTeamsFromFirebase();
  }, [eventKey]);

  function loadEventData() {
    const eventData = EVENT_DATA[eventKey];
    if (eventData) {
      setEvent(eventData);
    }
  }

  async function loadTeamsFromFirebase() {
    if (!eventKey) return;
    
    setLoadingTeams(true);
    try {
      const q = query(
        collection(db, "eventTeams"),
        where("eventKey", "==", eventKey)
      );
      const snapshot = await getDocs(q);
      const teamData = snapshot.docs.map(doc => doc.data() as Team);
      setTeams(teamData);
    } catch (error) {
      console.error("Error loading teams:", error);
    } finally {
      setLoadingTeams(false);
    }
  }

  async function importTeamsFromTBA() {
    if (!event) return;
    
    setImporting(true);
    try {
      // Fetch teams from TBA API
      const response = await fetch(\`https://www.thebluealliance.com/api/v3/event/\${eventKey}/teams\`, {
        headers: {
          'X-TBA-Auth-Key': 'your-tba-api-key-here' // NOTE: Should come from settings
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch teams from TBA');
      }

      const tbaTeams: Team[] = await response.json();

      // Save teams to Firebase
      let saved = 0;
      for (const team of tbaTeams) {
        const teamDoc = {
          eventKey: eventKey,
          team_number: team.team_number,
          nickname: team.nickname,
          city: team.city,
          state_prov: team.state_prov,
          country: team.country,
          imported_at: Date.now()
        };

        await setDoc(
          doc(db, "eventTeams", \`\${eventKey}_\${team.team_number}\`),
          teamDoc
        );
        saved++;
      }

      alert(\`Successfully imported \${saved} teams!\`);
      loadTeamsFromFirebase();
    } catch (error) {
      console.error("Error importing teams:", error);
      alert("Failed to import teams. Make sure TBA API key is configured.");
    } finally {
      setImporting(false);
    }
  }

  if (!event) {
    return (
      <div className="flex h-screen bg-gray-100">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <LoadingSpinner />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-8">
          {/* Event Header */}
          <div className="bg-white rounded-xl shadow-md p-6 mb-6">
            <h1 className="text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
              {event.name}
            </h1>
            <div className="flex flex-wrap gap-4 text-gray-600">
              <div className="flex items-center gap-2">
                <MapPin size={20} />
                <span>{event.city}, {event.state_prov}</span>
              </div>
              <div className="flex items-center gap-2">
                <Calendar size={20} />
                <span>
                  {new Date(event.startDate).toLocaleDateString()} - {new Date(event.endDate).toLocaleDateString()}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Users size={20} />
                <span>{teams.length} teams</span>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="bg-white rounded-xl shadow-md mb-6">
            <div className="border-b border-gray-200">
              <nav className="flex">
                <button
                  onClick={() => setActiveTab("overview")}
                  className={\`px-6 py-4 text-sm font-medium border-b-2 \${
                    activeTab === "overview"
                      ? "border-red-600 text-red-600"
                      : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                  }\`}
                >
                  Overview
                </button>
                <button
                  onClick={() => setActiveTab("teams")}
                  className={\`px-6 py-4 text-sm font-medium border-b-2 \${
                    activeTab === "teams"
                      ? "border-red-600 text-red-600"
                      : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                  }\`}
                >
                  Teams ({teams.length})
                </button>
                <button
                  onClick={() => setActiveTab("schedule")}
                  className={\`px-6 py-4 text-sm font-medium border-b-2 \${
                    activeTab === "schedule"
                      ? "border-red-600 text-red-600"
                      : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                  }\`}
                >
                  Schedule
                </button>
              </nav>
            </div>

            <div className="p-6">
              {activeTab === "overview" && (
                <div>
                  <h2 className="text-xl font-semibold mb-4">Event Information</h2>
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-gray-600">Event Type</p>
                      <p className="font-medium">{event.event_type}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Week</p>
                      <p className="font-medium">Week {event.week}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Location</p>
                      <p className="font-medium">{event.city}, {event.state_prov}, {event.country}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Teams Registered</p>
                      <p className="font-medium">{teams.length} teams</p>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "teams" && (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-semibold">Teams</h2>
                    <button
                      onClick={importTeamsFromTBA}
                      disabled={importing}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Download size={16} />
                      {importing ? "Importing..." : "Import from TBA"}
                    </button>
                  </div>

                  {loadingTeams ? (
                    <LoadingSpinner />
                  ) : teams.length === 0 ? (
                    <div className="text-center py-12">
                      <Users size={48} className="mx-auto text-gray-400 mb-4" />
                      <p className="text-gray-600 mb-4">No teams imported yet</p>
                      <button
                        onClick={importTeamsFromTBA}
                        disabled={importing}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg inline-flex items-center gap-2"
                      >
                        <Download size={16} />
                        Import Teams from TBA
                      </button>
                    </div>
                  ) : (
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {teams.map(team => (
                        <div key={team.team_number} className="border border-gray-200 rounded-lg p-4 hover:border-red-300 hover:shadow-md transition-all">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-2xl font-bold" style={{ color: "#c42221" }}>
                              {team.team_number}
                            </span>
                          </div>
                          <h3 className="font-semibold mb-1">{team.nickname}</h3>
                          <p className="text-sm text-gray-600">
                            {team.city}, {team.state_prov}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === "schedule" && (
                <div className="text-center py-12">
                  <Calendar size={48} className="mx-auto text-gray-400 mb-4" />
                  <p className="text-gray-600">Match schedule coming soon</p>
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
    <ProtectedRoute requireAuth={true}>
      <EventDetailsContent />
    </ProtectedRoute>
  );
}
