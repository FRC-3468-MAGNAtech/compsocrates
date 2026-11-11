"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, Clock, MapPin, RefreshCw, SearchX } from "lucide-react";
import { formatDateRange } from "@/components/event/selected-events-panel";
import { DataSourceCredits } from "@/components/events/data-source-credits";
import { EventName } from "@/components/events/event-name";
import { EventOverview } from "@/components/events/event-overview";
import { RankingsTab } from "@/components/events/rankings-tab";
import { ScheduleTab } from "@/components/events/schedule-tab";
import { TeamsTab } from "@/components/events/teams-tab";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Shimmer } from "@/components/ui/shimmer";
import { StatCard } from "@/components/ui/stat-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BRAND } from "@/config/brand";
import { getEvent } from "@/lib/events/actions";
import { EVENT_DETAILS_TABS, eventBadge, eventKeyYear, locationLabel, parseEventTab, parseHighlightedTeam, type EventDetailsTab } from "@/lib/events/details-model";
import { useEventName } from "@/lib/events/use-event-names";
import { useEventQuery } from "@/lib/events/use-event-query";

const BADGE_VARIANT = { live: "success", upcoming: "glass", done: "outline" } as const;

function BackLink() {
  return (
    <Link
      href="/event"
      className="inline-flex min-h-11 items-center gap-1.5 self-start rounded-full text-sm text-[var(--muted-foreground)] outline-none hover:text-[var(--foreground)] focus-visible:ring-2 focus-visible:ring-[rgba(var(--glow),0.5)]"
    >
      <ArrowLeft className="h-4 w-4" /> Active Events
    </Link>
  );
}

function NotFound({ eventKey, reason }: { eventKey: string; reason: string }) {
  return (
    <GlassPanel className="flex flex-col items-center gap-2 py-10 text-center">
      <SearchX className="h-8 w-8 text-[var(--muted-foreground)]" aria-hidden />
      <p className="font-semibold">Event not found</p>
      <p className="max-w-prose text-sm text-[var(--muted-foreground)]">
        {reason} Check the event key{eventKey ? <> (<span className="font-mono">{eventKey}</span>)</> : null} and try again.
      </p>
    </GlassPanel>
  );
}

/** /events/[eventKey]: one event's information, team list, schedule and rankings (CS /event-details/[eventKey]). */
export function EventDetailsView({ eventKey }: { eventKey: string }) {
  const params = useSearchParams();
  const [tab, setTab] = useState<EventDetailsTab>(() => parseEventTab(params.get("tab")));
  const [now] = useState(() => Date.now());
  const highlighted = parseHighlightedTeam(params.get("team"));

  // A key that doesn't start with a year and a code (CS's "app-testing" fallback, say) is not a TBA event: skip the fetch.
  const year = eventKeyYear(eventKey);
  const query = useEventQuery(year ? `event:${eventKey}` : null, () => getEvent(eventKey, year ?? undefined));
  const event = query.data;

  // The name for the tab title and the fallback heading: the API event's own name, else stored, else the static table, else the key.
  const resolved = useEventName(eventKey, { name: event?.name });
  useEffect(() => {
    const previous = document.title;
    document.title = `${resolved.name} | ${BRAND.title}`;
    return () => {
      document.title = previous;
    };
  }, [resolved.name]);

  let body: React.ReactNode;
  if (!year) {
    body = <NotFound eventKey={eventKey} reason="That isn't an event key from The Blue Alliance (it should start with the year, like 2026arli)." />;
  } else if (query.status === "loading") {
    body = (
      <div role="status" aria-label="Loading event" className="flex flex-col gap-4">
        <Shimmer className="h-32 w-full" />
        <Shimmer className="h-64 w-full" />
      </div>
    );
  } else if (query.status === "error") {
    body = (
      <GlassPanel role="alert" className="flex flex-col items-center gap-3 py-10 text-center">
        <AlertTriangle className="h-8 w-8" style={{ color: "var(--color-primary)" }} aria-hidden />
        <div>
          <div className="font-semibold">
            Couldn&apos;t load <EventName eventKey={eventKey} />
          </div>
          <p className="text-sm text-[var(--muted-foreground)]">{query.error?.message}</p>
        </div>
        <Button variant="glass" onClick={query.refetch} className="gap-2">
          <RefreshCw className="h-4 w-4" /> Retry
        </Button>
      </GlassPanel>
    );
  } else if (!event) {
    body = <NotFound eventKey={eventKey} reason="There's no event with that key." />;
  } else {
    const badge = eventBadge(event, now);
    const location = locationLabel(event);
    body = (
      <>
        <GlassPanel strong className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="break-words text-2xl font-semibold tracking-tight sm:text-3xl">
                <EventName eventKey={event.code} name={event.name} />
              </h1>
              <div className="mt-2 flex flex-col gap-1 text-sm text-[var(--muted-foreground)]">
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden /> {formatDateRange(event.dateStart, event.dateEnd)}
                </span>
                {location && (
                  <span className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden /> {location}
                  </span>
                )}
              </div>
            </div>
            <Badge variant={BADGE_VARIANT[badge.tone]}>{badge.label}</Badge>
          </div>
        </GlassPanel>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <StatCard label="Season" value={String(event.season)} index={0} />
          <StatCard label="Event Key" value={event.code} index={1} />
          <StatCard label="Status" value={badge.label} index={2} />
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as EventDetailsTab)} className="flex flex-col gap-4">
          <div className="-mx-1 overflow-x-auto px-1 pb-1">
            <TabsList className="w-max">
              {EVENT_DETAILS_TABS.map((t) => (
                <TabsTrigger key={t.id} value={t.id} className="min-h-11">
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <GlassPanel>
            <TabsContent value="overview">
              <EventOverview event={event} />
            </TabsContent>
            <TabsContent value="teams">
              <h2 className="mb-3 text-lg font-semibold">Team List</h2>
              <TeamsTab eventKey={event.code} season={event.season} highlighted={highlighted} />
            </TabsContent>
            <TabsContent value="schedule">
              <ScheduleTab eventKey={event.code} season={event.season} />
            </TabsContent>
            <TabsContent value="rankings">
              <h2 className="mb-3 text-lg font-semibold">Rankings</h2>
              <RankingsTab eventKey={event.code} season={event.season} />
            </TabsContent>
          </GlassPanel>
        </Tabs>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <BackLink />
      <DataSourceCredits />
      {body}
    </div>
  );
}
