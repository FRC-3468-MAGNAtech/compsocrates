"use client";

import { useEffect, useMemo, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import DataSourceCredits from "@/app/components/DataSourceCredits";
import { useAuth } from "@/app/AuthContext";
import { APP_EVENTS, dedupeEventKeys, normalizeEventKey } from "@/app/utils/events";
import { filterEventsByLocation, type TBAEvent } from "@/app/utils/tba-api";

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
      const selected = Array.isArray(data.selectedEvents)
        ? dedupeEventKeys(data.selectedEvents.map((value: unknown) => String(value || "")))
        : [];
      setSelectedEvents(selected);
    }
    loadSelection();
  }, [userData?.teamId]);

  useEffect(() => {
    async function loadEvents() {
      if (!userData?.teamId) return;
      setLoadingEvents(true);
      try {
        const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
        const teamData = teamDoc.exists() ? teamDoc.data() : {};
        const encryptedKey =
          typeof teamData.tbaApiKeyEncrypted === "string" ? teamData.tbaApiKeyEncrypted.trim() : "";
        const plainKey =
          typeof teamData.tbaApiKey === "string" ? teamData.tbaApiKey.trim() : "";
        const year = new Date().getFullYear();
        if (!encryptedKey && !plainKey) {
          throw new Error("Team TBA key is not configured.");
        }

        const response = await fetch("/api/tba/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ year, encryptedKey, plainKey }),
        });
        if (!response.ok) {
          throw new Error(`Unable to load events (${response.status})`);
        }
        const payload = await response.json();
        setEvents(Array.isArray(payload.events) ? payload.events : []);
      } catch (error) {
        console.error("Falling back to static event list:", error);
        setEvents(
          APP_EVENTS.map((event) => ({
            key: event.key,
            name: event.name,
            event_code: event.key,
            event_type: 0,
            start_date: event.startDate,
            end_date: event.endDate,
            year: new Date(event.startDate).getFullYear(),
            city: event.city,
            state_prov: event.state_prov,
            country: event.country,
            week: event.week,
          }))
        );
      }
      setLoadingEvents(false);
    }
    loadEvents();
  }, [userData?.teamId]);

  const filteredEvents = useMemo(() => {
    const scoped = searchTerm.trim() ? filterEventsByLocation(events, searchTerm) : events;
    const sorted = [...scoped].sort((a, b) => {
      const aTime = new Date(`${a.start_date}T12:00:00`).getTime();
      const bTime = new Date(`${b.start_date}T12:00:00`).getTime();
      return aTime - bTime;
    });
    const byName = new Map<string, TBAEvent>();
    sorted.forEach((event) => {
      const key = String(event.name || "").trim().toLowerCase();
      if (!key || !byName.has(key)) {
        byName.set(key, event);
      }
    });
    return Array.from(byName.values());
  }, [events, searchTerm]);

  function toggleEvent(eventKey: string) {
    const normalizedKey = normalizeEventKey(eventKey);
    setSelectedEvents((prev) =>
      prev.includes(normalizedKey) ? prev.filter((key) => key !== normalizedKey) : [...prev, normalizedKey]
    );
  }

  async function saveSelection() {
    if (!userData?.teamId) return;
    setSaving(true);
    try {
      const normalizedSelection = dedupeEventKeys(selectedEvents);
      await setDoc(doc(db, "teams", userData.teamId), { selectedEvents: normalizedSelection }, { merge: true });
      setSelectedEvents(normalizedSelection);
      alert("Event selection saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto p-8 pb-32">
        <h1 className="text-3xl font-bold mb-2 theme-text">Event Selection</h1>
        <p className="text-gray-600 mb-6">Select which events your team is attending.</p>
        <DataSourceCredits className="mb-6 max-w-3xl" />

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

      </div>
      <button
        onClick={saveSelection}
        disabled={saving}
        className="fixed bottom-4 right-6 md:right-8 z-40 px-6 py-3 rounded text-white font-semibold disabled:opacity-50 shadow-lg"
        style={{ background: "var(--primary-gradient)" }}
      >
        {saving ? "Saving..." : "Save Event Selection"}
      </button>
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
