"use client";

import { useEventName } from "@/lib/events/use-event-names";
import type { EventNameState } from "@/lib/events/name-store";
import { cn } from "@/lib/utils";

/** The tooltip for a name that is a fallback because the data API failed; undefined when there is nothing to explain. */
export function eventNameTitle(state: Pick<EventNameState, "status" | "source" | "error">): string | undefined {
  if (state.status !== "fallback" || !state.error) return undefined;
  const shown = state.source === "key" ? "the event key is shown" : "a saved name is shown";
  return `The event name could not be loaded, so ${shown}: ${state.error.message}`;
}

/**
 * The name of an event for display, from the shared chain (API, then the team's stored names, then the static table, then
 * the raw key). While the API answer is pending and nothing better than the raw key is known it shows an inline shimmer
 * of about the width of the key (so the line does not jump); otherwise the best known name shows at once and swaps in
 * place when the API answers. When the API failed, the fallback shows quietly with the reason in a `title` tooltip.
 *
 * `name` is a name the caller already holds for this key (an `EventInfo.name`, a row's `eventName`); it counts as a stored
 * name, and a placeholder equal to the key is ignored.
 */
export function EventName({ eventKey, name, className }: { eventKey: string; name?: string | null; className?: string }) {
  const state = useEventName(eventKey, { name });
  return <EventNameText state={state} className={className} />;
}

/** The presentational half (also what the render tests check). */
export function EventNameText({ state, className }: { state: EventNameState; className?: string }) {
  if (state.status === "loading" && state.source === "key") {
    return (
      <span
        aria-busy="true"
        aria-label="Loading event name"
        className={cn("shimmer inline-block h-[1em] max-w-full rounded-md align-middle", className)}
        style={{ width: `${Math.min(Math.max(state.key.length, 8), 24)}ch` }}
      />
    );
  }
  return (
    <span className={className} title={eventNameTitle(state)} data-event-name-source={state.source}>
      {state.name}
    </span>
  );
}
