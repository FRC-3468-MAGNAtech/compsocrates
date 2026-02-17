"use client";

import { useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import { APP_EVENTS } from "@/app/utils/events";

function EventSelectionContent() {
  const { userData } = useAuth();
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

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

        <div className="max-w-3xl space-y-4">
          {APP_EVENTS.map((event) => {
            const checked = selectedEvents.includes(event.key);
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
                    <p className="text-sm text-gray-600">{event.location}</p>
                    <p className="text-sm text-gray-500">
                      {new Date(`${event.startDate}T12:00:00`).toLocaleDateString()} -{" "}
                      {new Date(`${event.endDate}T12:00:00`).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              </label>
            );
          })}
        </div>

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
