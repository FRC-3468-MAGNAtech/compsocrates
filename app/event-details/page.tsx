"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import { APP_EVENTS } from "@/app/utils/events";
import type { TBAEvent } from "@/app/utils/tba-api";

type EventCard = {
  key: string;
  name: string;
  city?: string;
  state_prov?: string;
  start_date: string;
  end_date: string;
};

function EventDetailsIndexContent() {
  const { userData } = useAuth();
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [eventsToShow, setEventsToShow] = useState<EventCard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadSelectedEventsAndEvents() {
      if (!userData?.teamId) {
        setEventsToShow(
          APP_EVENTS.map((event) => ({
            key: event.key,
            name: event.name,
            city: event.city,
            state_prov: event.state_prov,
            start_date: event.startDate,
            end_date: event.endDate,
          }))
        );
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
        if (!teamDoc.exists()) return;
        const data = teamDoc.data();
        const selected = Array.isArray(data.selectedEvents) ? data.selectedEvents : [];
        setSelectedEvents(selected);

        const encryptedKey =
          typeof data.tbaApiKeyEncrypted === "string" ? data.tbaApiKeyEncrypted.trim() : "";
        const plainKey = typeof data.tbaApiKey === "string" ? data.tbaApiKey.trim() : "";
        const fallback = APP_EVENTS.map((event) => ({
          key: event.key,
          name: event.name,
          city: event.city,
          state_prov: event.state_prov,
          start_date: event.startDate,
          end_date: event.endDate,
        }));
        if (!encryptedKey && !plainKey) {
          const scopedFallback =
            selected.length > 0 ? fallback.filter((event) => selected.includes(event.key)) : fallback;
          setEventsToShow(scopedFallback);
          return;
        }

        const years = new Set<number>();
        if (selected.length > 0) {
          selected.forEach((eventKey) => {
            const year = Number(eventKey.slice(0, 4));
            if (Number.isFinite(year)) years.add(year);
          });
        }
        if (years.size === 0) years.add(new Date().getFullYear());

        const responses = await Promise.all(
          Array.from(years).map(async (year) => {
            const response = await fetch("/api/tba/events", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ year, encryptedKey, plainKey }),
            });
            if (!response.ok) return [] as TBAEvent[];
            const payload = await response.json();
            return Array.isArray(payload.events) ? (payload.events as TBAEvent[]) : [];
          })
        );
        const fromTBA = responses.flat().map((event) => ({
          key: event.key,
          name: event.name,
          city: event.city,
          state_prov: event.state_prov,
          start_date: event.start_date,
          end_date: event.end_date,
        }));
        const scoped = selected.length > 0 ? fromTBA.filter((event) => selected.includes(event.key)) : fromTBA;
        if (scoped.length > 0) {
          setEventsToShow(scoped);
        } else {
          const scopedFallback =
            selected.length > 0 ? fallback.filter((event) => selected.includes(event.key)) : fallback;
          setEventsToShow(scopedFallback);
        }
      } finally {
        setLoading(false);
      }
    }
    loadSelectedEventsAndEvents();
  }, [userData?.teamId]);

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto p-8">
        <h1 className="text-3xl font-bold mb-2 theme-text">Event Details</h1>
        <p className="text-gray-600 mb-6">Choose an event to view schedules, teams, and details.</p>

        {loading ? (
          <div className="bg-white rounded-xl shadow-md p-6">Loading events...</div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {eventsToShow.map((event) => {
              const location = [event.city, event.state_prov].filter(Boolean).join(", ");
              return (
                <Link
                  key={event.key}
                  href={`/event-details/${event.key}`}
                  className="bg-white rounded-xl shadow-md p-6 border border-gray-200 hover:border-gray-300"
                >
                  <h2 className="text-xl font-semibold mb-2">{event.name}</h2>
                  <p className="text-gray-600 mb-2">{location || "Location TBD"}</p>
                  <p className="text-sm text-gray-500">
                    {new Date(`${event.start_date}T12:00:00`).toLocaleDateString()} -{" "}
                    {new Date(`${event.end_date}T12:00:00`).toLocaleDateString()}
                  </p>
                  {selectedEvents.length > 0 && (
                    <p className="text-xs text-gray-500 mt-1">{event.key}</p>
                  )}
                </Link>
              );
            })}
          </div>
        )}
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
