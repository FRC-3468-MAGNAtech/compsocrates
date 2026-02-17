"use client";

import { useEffect, useMemo, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import { APP_EVENTS } from "@/app/utils/events";
import { filterEventsByLocation, getEventsByYear, type TBAEvent } from "@/app/utils/tba-api";

function EventSelectionContent() {
  const { userData } = useAuth();
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [events, setEvents] = useState<TBAEvent[]>([]);

  useEffect(() => {
    async function loadSelection() {
      if (!userData?.teamId) return;
      const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
      if (!teamDoc.exists()) return;
      const data = teamDoc.data();
      setSelectedEvents(Array.isArray(data.selectedEvents) ? data.selectedEvents : []);
    }
    loadSelection();
  }, [userData?.teamId]);

  useEffect(() => {
    async function loadEvents() {
      setLoadingEvents(true);
      try {
        const year = new Date().getFullYear();
        const tbaEvents = await getEventsByYear(year);
        setEvents(
          tbaEvents
            .filter((event) => event.country === "USA")
            .sort((a, b) => a.start_date.localeCompare(b.start_date))
        );
      } catch (error) {
        console.error("Failed to load events from TBA, using fallback list:", error);
        setEvents(
          APP_EVENTS.map((event) => ({
            key: event.key,
            name: event.name,
            event_code: event.key,
            event_type: 0,
            start_date: event.startDate,
            end_date: event.endDate,
            year: new Date(event.startDate).getFullYear(),
            city: event.location,
            state_prov: "",
            country: "USA",
            week: 0,
          }))
        );
      } finally {
        setLoadingEvents(false);
      }
    }
    loadEvents();
  }, []);

  const filteredEvents = useMemo(() => {
    if (!searchTerm.trim()) return events;
    return filterEventsByLocation(events, searchTerm);
  }, [events, searchTerm]);

  function toggleEvent(eventKey: string) {
    setSelectedEvents((prev) =>
      prev.includes(eventKey) ? prev.filter((key) => key !== eventKey) : [...prev, eventKey]
    );
  }

  async function saveSelection() {
    if (!userData?.teamId) return;
    setSaving(true);
    try {
      await setDoc(doc(db, "teams", userData.teamId), { selectedEvents }, { merge: true });
      alert("Event selection saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto p-8">
        <h1 className="text-3xl font-bold mb-2 theme-text">Event Selection</h1>
        <p className="text-gray-600 mb-6">Select which events your team is attending.</p>

        <div className="max-w-3xl mb-4">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by event name, city, or state"
            className="w-full border rounded-lg p-3"
          />
        </div>

        {loadingEvents ? (
          <div className="bg-white rounded-xl p-8 text-center">Loading events...</div>
        ) : (
          <div className="max-w-3xl space-y-4">
            {filteredEvents.map((event) => {
              const checked = selectedEvents.includes(event.key);
              const location = [event.city, event.state_prov].filter(Boolean).join(", ");
              return (
                <label
                  key={event.key}
                  className={`block bg-white rounded-xl border-2 p-5 cursor-pointer transition-colors ${
                    checked ? "border-green-500" : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleEvent(event.key)}
                      className="mt-1 w-5 h-5"
                    />
                    <div>
                      <h2 className="text-lg font-semibold">{event.name}</h2>
                      <p className="text-sm text-gray-600">{location || "Location TBD"}</p>
                      <p className="text-sm text-gray-500">
                        {new Date(`${event.start_date}T12:00:00`).toLocaleDateString()} -{" "}
                        {new Date(`${event.end_date}T12:00:00`).toLocaleDateString()}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">{event.key}</p>
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        )}

        <button
          onClick={saveSelection}
          disabled={saving}
          className="mt-6 px-6 py-3 rounded text-white font-semibold disabled:opacity-50"
          style={{ background: "var(--primary-gradient)" }}
        >
          {saving ? "Saving..." : "Save Event Selection"}
        </button>
      </div>
    </div>
  );
}

export default function EventSelectionPage() {
  return (
    <ProtectedRoute requireAuth={true}>
      <EventSelectionContent />
    </ProtectedRoute>
  );
}
