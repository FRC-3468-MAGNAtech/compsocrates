"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";

// Event data for the two specific events
const EVENT_DATA: Record<string, any> = {
  "2026arli": {
    key: "2026arli",
    name: "Arkansas Regional",
    city: "Little Rock",
    state_prov: "AR",
    country: "USA",
    startDate: "2026-03-14",
    endDate: "2026-03-17",
    week: 3,
    event_type: "Regional"
  },
  "2026labr": {
    key: "2026labr",
    name: "Bayou Regional",
    city: "Kenner",
    state_prov: "LA",
    country: "USA",
    startDate: "2026-03-26",
    endDate: "2026-03-29",
    week: 4,
    event_type: "Regional"
  }
};

function EventDetailsContent() {
  const params = useParams();
  const eventKey = params.eventKey as string;
  
  const [event, setEvent] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "teams" | "schedule">("overview");

  useEffect(() => {
    loadEventData();
  }, [eventKey]);

  function loadEventData() {
    const eventData = EVENT_DATA[eventKey];
    if (eventData) {
      setEvent(eventData);
    }
  }

  if (!event) {
    return (
      <div className="flex h-screen bg-gray-100">
        <Sidebar />
        <div className="flex-1 overflow-y-auto flex items-center justify-center">
          <div className="text-center">
            <div className="text-6xl mb-4">❌</div>
            <p className="text-xl text-gray-600">Event not found</p>
            <p className="text-sm text-gray-500 mt-2">Valid event keys: 2026arli, 2026labr</p>
          </div>
        </div>
      </div>
    );
  }

  const daysUntil = Math.ceil((new Date(event.startDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
  const isActive = new Date() >= new Date(event.startDate) && new Date() <= new Date(event.endDate);

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
                  📅 {new Date(event.startDate).toLocaleDateString("en-US", { month: "long", day: "numeric" })} - {new Date(event.endDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                </p>
                <p className="text-gray-600">
                  📍 {event.city}, {event.state_prov}, {event.country}
                </p>
              </div>
              {isActive ? (
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
                <p className="text-sm text-gray-600">Event Type</p>
                <p className="text-2xl font-bold" style={{ color: "#c42221" }}>
                  {event.event_type}
                </p>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-600">Week</p>
                <p className="text-2xl font-bold" style={{ color: "#c42221" }}>
                  {event.week}
                </p>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-600">Event Key</p>
                <p className="text-lg font-mono font-bold" style={{ color: "#c42221" }}>
                  {event.key}
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
              Teams
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
              Schedule
            </button>
          </div>

          {/* CONTENT */}
          {activeTab === "overview" && (
            <div className="space-y-6">
              <div className="bg-white rounded-xl shadow-md p-6">
                <h2 className="text-xl font-semibold mb-4">Event Information</h2>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-600">Location</p>
                    <p className="font-semibold">{event.city}, {event.state_prov}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Event Type</p>
                    <p className="font-semibold">{event.event_type}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Week</p>
                    <p className="font-semibold">Week {event.week}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Event Key</p>
                    <p className="font-semibold font-mono">{event.key}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-md p-6">
                <h2 className="text-xl font-semibold mb-4">About This Event</h2>
                <div className="space-y-3 text-gray-700">
                  <p>
                    The {event.name} is a {event.event_type} competition in the FIRST Robotics Competition 2026 season.
                  </p>
                  <p>
                    Teams will compete in {event.city}, {event.state_prov} from {new Date(event.startDate).toLocaleDateString("en-US", { month: "long", day: "numeric" })} to {new Date(event.endDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.
                  </p>
                  <p className="text-sm text-gray-500 mt-4">
                    ℹ️ Team lists and match schedules will be available from The Blue Alliance API once the event approaches.
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === "teams" && (
            <div className="bg-white rounded-xl shadow-md p-8 text-center">
              <div className="text-6xl mb-4">👥</div>
              <h2 className="text-2xl font-semibold mb-2">Team List Coming Soon</h2>
              <p className="text-gray-600">
                Team information will be available from The Blue Alliance API as the event approaches.
              </p>
              <p className="text-sm text-gray-500 mt-4">
                Check back closer to the event date for the full team list.
              </p>
            </div>
          )}

          {activeTab === "schedule" && (
            <div className="bg-white rounded-xl shadow-md p-8 text-center">
              <div className="text-6xl mb-4">📅</div>
              <h2 className="text-2xl font-semibold mb-2">Match Schedule Coming Soon</h2>
              <p className="text-gray-600">
                Match schedule will be available from The Blue Alliance API once released.
              </p>
              <p className="text-sm text-gray-500 mt-4">
                Qualification and playoff match schedules will appear here when available.
              </p>
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