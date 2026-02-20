"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { db } from "@/app/firebase";
import { useAuth } from "@/app/AuthContext";
import { APP_EVENT_BY_KEY, type AppEvent } from "@/app/utils/events";
import type { TBAEvent } from "@/app/utils/tba-api";

function EventDetailsContent() {
  const params = useParams();
  const eventKey = params.eventKey as string;
  const { userData } = useAuth();

  const [event, setEvent] = useState<AppEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "teams" | "schedule">("overview");

  useEffect(() => {
    async function loadEventDetails() {
      if (!eventKey) return;
      setLoading(true);
      try {
        const appEvent = APP_EVENT_BY_KEY[eventKey];
        if (appEvent) {
          setEvent(appEvent);
          return;
        }

        const year = Number(eventKey.slice(0, 4));
        if (!userData?.teamId) {
          setEvent({
            key: eventKey,
            name: eventKey.toUpperCase(),
            location: "Location TBD",
            city: "TBD",
            state_prov: "",
            country: "USA",
            startDate: `${Number.isFinite(year) ? year : new Date().getFullYear()}-01-01`,
            endDate: `${Number.isFinite(year) ? year : new Date().getFullYear()}-01-01`,
            week: 0,
            event_type: "Event",
          });
          return;
        }

        const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
        const teamData = teamDoc.exists() ? teamDoc.data() : {};
        const encryptedKey =
          typeof teamData.tbaApiKeyEncrypted === "string" ? teamData.tbaApiKeyEncrypted.trim() : "";
        const plainKey = typeof teamData.tbaApiKey === "string" ? teamData.tbaApiKey.trim() : "";

        if (Number.isFinite(year) && (encryptedKey || plainKey)) {
          const response = await fetch("/api/tba/events", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ year, encryptedKey, plainKey }),
          });
          if (response.ok) {
            const payload = await response.json();
            const events = Array.isArray(payload.events) ? (payload.events as TBAEvent[]) : [];
            const tbaEvent = events.find((item) => item.key === eventKey);
            if (tbaEvent) {
              setEvent({
                key: tbaEvent.key,
                name: tbaEvent.name,
                location: [tbaEvent.city, tbaEvent.state_prov, tbaEvent.country].filter(Boolean).join(", "),
                city: tbaEvent.city || "TBD",
                state_prov: tbaEvent.state_prov || "",
                country: tbaEvent.country || "USA",
                startDate: tbaEvent.start_date,
                endDate: tbaEvent.end_date,
                week: typeof tbaEvent.week === "number" ? tbaEvent.week : 0,
                event_type: "Regional",
              });
              return;
            }
          }
        }

        setEvent({
          key: eventKey,
          name: eventKey.toUpperCase(),
          location: "Location TBD",
          city: "TBD",
          state_prov: "",
          country: "USA",
          startDate: `${Number.isFinite(year) ? year : new Date().getFullYear()}-01-01`,
          endDate: `${Number.isFinite(year) ? year : new Date().getFullYear()}-01-01`,
          week: 0,
          event_type: "Event",
        });
      } finally {
        setLoading(false);
      }
    }

    void loadEventDetails();
  }, [eventKey, userData?.teamId]);

  if (loading) {
    return (
      <div className="flex h-screen bg-gray-100">
        <Sidebar />
        <div className="flex-1 overflow-y-auto flex items-center justify-center">
          <p className="text-xl text-gray-600">Loading event...</p>
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
            <p className="text-xl text-gray-600">Event not found</p>
            <p className="text-sm text-gray-500 mt-2">Check the event key and try again.</p>
          </div>
        </div>
      </div>
    );
  }

  const eventStart = new Date(`${event.startDate}T12:00:00`);
  const eventEnd = new Date(`${event.endDate}T12:00:00`);
  const daysUntil = Math.ceil((eventStart.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
  const isActive = new Date() >= eventStart && new Date() <= eventEnd;

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-8">
          <div className="bg-white rounded-xl shadow-md p-6 mb-6 border-l-4" style={{ borderColor: "var(--primary-color)" }}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h1 className="text-3xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>
                  {event.name}
                </h1>
                <p className="text-lg text-gray-600">
                  {eventStart.toLocaleDateString("en-US", { month: "long", day: "numeric" })} - {eventEnd.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                </p>
                <p className="text-gray-600">
                  {event.city}, {event.state_prov}, {event.country}
                </p>
              </div>
              {isActive ? (
                <div className="px-4 py-2 rounded-lg bg-green-100 text-green-800 font-semibold">
                  LIVE NOW
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

            <div className="grid grid-cols-3 gap-4 mt-6 pt-6 border-t border-gray-200">
              <div className="text-center">
                <p className="text-sm text-gray-600">Event Type</p>
                <p className="text-2xl font-bold" style={{ color: "var(--primary-color)" }}>
                  {event.event_type}
                </p>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-600">Week</p>
                <p className="text-2xl font-bold" style={{ color: "var(--primary-color)" }}>
                  {event.week}
                </p>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-600">Event Key</p>
                <p className="text-lg font-mono font-bold" style={{ color: "var(--primary-color)" }}>
                  {event.key}
                </p>
              </div>
            </div>
          </div>

          <div className="flex gap-2 mb-6">
            <button
              onClick={() => setActiveTab("overview")}
              className={`px-4 py-2 rounded-lg font-medium ${
                activeTab === "overview"
                  ? "text-white"
                  : "bg-white text-gray-700 hover:bg-gray-50"
              }`}
              style={activeTab === "overview" ? { backgroundColor: "var(--primary-color)" } : {}}
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
              style={activeTab === "teams" ? { backgroundColor: "var(--primary-color)" } : {}}
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
              style={activeTab === "schedule" ? { backgroundColor: "var(--primary-color)" } : {}}
            >
              Schedule
            </button>
          </div>

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
                    The {event.name} is a {event.event_type} competition in the FIRST Robotics season.
                  </p>
                  <p>
                    Teams will compete in {event.city}, {event.state_prov} from {eventStart.toLocaleDateString("en-US", { month: "long", day: "numeric" })} to {eventEnd.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.
                  </p>
                  <p className="text-sm text-gray-500 mt-4">
                    Team lists and match schedules will be available from The Blue Alliance API once the event approaches.
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === "teams" && (
            <div className="bg-white rounded-xl shadow-md p-8 text-center">
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

