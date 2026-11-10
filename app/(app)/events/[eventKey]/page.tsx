"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { EventDetailsView } from "@/components/events/event-details-view";
import { Shimmer } from "@/components/ui/shimmer";

// `useSearchParams` (the ?tab= and ?team= links) needs a Suspense boundary for the static build.
export default function EventDetailsPage() {
  const params = useParams<{ eventKey: string }>();
  const eventKey = decodeURIComponent(params.eventKey);
  return (
    <Suspense fallback={<Shimmer className="h-64 w-full" />}>
      <EventDetailsView key={eventKey} eventKey={eventKey} />
    </Suspense>
  );
}
