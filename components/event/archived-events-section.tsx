"use client";

import { useState } from "react";
import { Archive, ArchiveRestore, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { GlassPanel } from "@/components/ui/glass-panel";
import { STATUS_BADGE, formatDateRange } from "@/components/event/selected-events-panel";
import { getEventStatus } from "@/lib/events/event-status";
import { useNamedEvents } from "@/lib/events/use-event-names";
import type { EventInfo } from "@/lib/events/types";
import { cn } from "@/lib/utils";

type Props = {
  /** Archived events, with their resolved names (the shared name chain runs here, so an archived event keeps its name). */
  archived: EventInfo[];
  /** Current events from an earlier season than the program's current one: what "Archive all previous seasons" would archive. */
  previousSeason: EventInfo[];
  /** Admins and the owner archive and restore; everyone else only reads the list. */
  canEdit: boolean;
  now: number;
  onRestore: (event: EventInfo) => void;
  onArchiveAll: (events: EventInfo[]) => void;
};

/**
 * Event Select's collapsed "Archived" section, and the "Archive all previous seasons" action (with a confirmation that says
 * how many events it will archive). Archiving only hides an event from the pickers; nothing is deleted and Restore undoes it.
 */
export function ArchivedEventsSection({ archived: rawArchived, previousSeason, canEdit, now, onRestore, onArchiveAll }: Props) {
  const archived = useNamedEvents(rawArchived);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  if (archived.length === 0 && !(canEdit && previousSeason.length > 0)) return null;

  return (
    <GlassPanel className="flex flex-col gap-3" data-testid="archived-events">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="archived-events-list"
          className="flex min-h-[2.75rem] items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]"
          data-testid="archived-toggle"
        >
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden />
          Archived ({archived.length})
        </button>
        {canEdit && previousSeason.length > 0 && (
          <Button variant="glass" size="sm" className="gap-2" onClick={() => setConfirming(true)} data-testid="archive-previous">
            <Archive className="h-4 w-4" aria-hidden /> Archive all previous seasons ({previousSeason.length})
          </Button>
        )}
      </div>

      {open && (
        <ul id="archived-events-list" className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="archived-events-list">
          {archived.length === 0 && <li className="text-sm text-[var(--muted-foreground)]">Nothing archived.</li>}
          {archived.map((event) => {
            const status = STATUS_BADGE[getEventStatus(event, now)];
            return (
              <li key={event.code} className="flex items-center gap-2 rounded-xl p-2.5" data-testid={`archived-${event.code}`}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium" title={event.name}>
                    {event.name}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted-foreground)]">
                    <span>{event.code}</span>
                    {event.dateStart && event.dateEnd && <span>{formatDateRange(event.dateStart, event.dateEnd)}</span>}
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </div>
                </div>
                {canEdit && (
                  <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => onRestore(event)} aria-label={`Restore ${event.name}`}>
                    <ArchiveRestore className="h-4 w-4" aria-hidden /> Restore
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogTitle>Archive all previous seasons?</DialogTitle>
          <DialogDescription>
            This will archive {previousSeason.length} {previousSeason.length === 1 ? "event" : "events"} from earlier seasons. They leave the event pickers
            (scouting, assignments, match list, dashboard). Nothing is deleted, Analytics still uses all of their data, and you can restore any of them.
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                onArchiveAll(previousSeason);
                setConfirming(false);
              }}
              data-testid="archive-previous-confirm"
            >
              Archive {previousSeason.length}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </GlassPanel>
  );
}
