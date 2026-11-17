"use client";

import { Label } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { withEventYear } from "@/lib/events/names";

export const ALL_EVENTS = "__all__";

/** Which event the Scout Status setup panel edits targets for (or all of them, read-only). The shared select, the same in every program. */
export function EventTargetSelect({ value, events, onChange }: { value: string; events: readonly { eventCode: string; eventName: string }[]; onChange: (eventCode: string) => void }) {
  const label = value === ALL_EVENTS ? "All selected events (totals, read-only)" : (() => { const picked = events.find((e) => e.eventCode === value); return picked ? withEventYear(picked.eventName, picked.eventCode) : value; })();
  return (
    <div className="ml-auto flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
      <Label htmlFor="scout-status-event">Editing targets for</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id="scout-status-event" className="w-64" data-testid="scout-status-event-select">
          <SelectValue>{label}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_EVENTS}>All selected events (totals, read-only)</SelectItem>
          {events.map((e) => (
            <SelectItem key={e.eventCode} value={e.eventCode}>
              {withEventYear(e.eventName, e.eventCode)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
