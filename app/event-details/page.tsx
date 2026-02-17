"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import { APP_EVENTS } from "@/app/utils/events";

function EventDetailsIndexContent() {
  const { userData } = useAuth();
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);

  useEffect(() => {
    async function loadSelectedEvents() {
      if (!userData?.teamId) return;
      const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
      if (!teamDoc.exists()) return;
      const data = teamDoc.data();
      setSelectedEvents(Array.isArray(data.selectedEvents) ? data.selectedEvents : []);
    }
    loadSelectedEvents();
  }, [userData?.teamId]);

  const eventsToShow =
    selectedEvents.length > 0
      ? APP_EVENTS.filter((event) => selectedEvents.includes(event.key))
      : APP_EVENTS;

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto p-8">
        <h1 className="text-3xl font-bold mb-2 theme-text">Event Details</h1>
        <p className="text-gray-600 mb-6">Choose an event to view schedules, teams, and details.</p>

        <div className="grid md:grid-cols-2 gap-4">
          {eventsToShow.map((event) => (
            <Link
              key={event.key}
              href={`/event-details/${event.key}`}
              className="bg-white rounded-xl shadow-md p-6 border border-gray-200 hover:border-gray-300"
            >
              <h2 className="text-xl font-semibold mb-2">{event.name}</h2>
              <p className="text-gray-600 mb-2">{event.location}</p>
              <p className="text-sm text-gray-500">
                {new Date(`${event.startDate}T12:00:00`).toLocaleDateString()} -{" "}
                {new Date(`${event.endDate}T12:00:00`).toLocaleDateString()}
              </p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function EventDetailsPage() {
  return (
    <ProtectedRoute requireAuth={true}>
      <EventDetailsIndexContent />
    </ProtectedRoute>
  );
}
