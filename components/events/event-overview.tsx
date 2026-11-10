import { ExternalLink } from "lucide-react";
import { formatDateRange } from "@/components/event/selected-events-panel";
import { locationLabel, safeWebsite } from "@/lib/events/details-model";
import type { FtcEvent } from "@/lib/ftc/types";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">{label}</dt>
      <dd className="mt-0.5 font-semibold">{children}</dd>
    </div>
  );
}

/** Event Information and About This Event (CS's Overview tab). */
export function EventOverview({ event }: { event: FtcEvent }) {
  const location = locationLabel(event);
  const website = safeWebsite(event.website);
  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="mb-3 text-lg font-semibold">Event Information</h2>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Fact label="Location">{location ?? "Location TBD"}</Fact>
          {event.venue && <Fact label="Venue">{event.venue}</Fact>}
          <Fact label="Dates">{formatDateRange(event.dateStart, event.dateEnd)}</Fact>
          <Fact label="Season">{event.season}</Fact>
          <Fact label="Event Key">
            <span className="font-mono">{event.code}</span>
          </Fact>
          {event.timezone && <Fact label="Timezone">{event.timezone}</Fact>}
          {website && (
            <Fact label="Website">
              <a href={website} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1.5 break-all underline underline-offset-4">
                {website} <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
              </a>
            </Fact>
          )}
        </dl>
      </section>
      <section className="flex flex-col gap-2 text-sm text-[var(--muted-foreground)]">
        <h2 className="text-lg font-semibold text-[var(--foreground)]">About This Event</h2>
        <p>
          {event.name} is a competition in the FIRST Robotics season{location ? `, held in ${location}` : ""} from {formatDateRange(event.dateStart, event.dateEnd)}.
        </p>
        <p>Team lists are loaded from the official FIRST API.</p>
      </section>
    </div>
  );
}
