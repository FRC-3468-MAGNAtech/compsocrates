"use client";

import { useState } from "react";
import { AlertTriangle, RefreshCw, X } from "lucide-react";
import { useEventNameFailure } from "@/lib/events/use-event-names";
import { cn } from "@/lib/utils";

/**
 * Admin-only notice for the Event Select page: shown when event names could not be loaded for a reason an admin can fix
 * (the TBA key is missing or rejected, or server sign-in is not configured). The names still show from the saved and
 * built-in lists meanwhile. Dismissing hides this message until a different one appears.
 */
export function EventNamesNotice({ className }: { className?: string }) {
  const failure = useEventNameFailure();
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (!failure || dismissed === failure.error.message) return null;
  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-2 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-2.5 text-xs font-medium text-amber-300",
        className
      )}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1">Event names could not be loaded: {failure.error.message}</span>
      <button
        type="button"
        onClick={failure.retry}
        aria-label="Try loading event names again"
        className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-amber-300 hover:bg-white/10 sm:min-h-8 sm:min-w-8"
      >
        <RefreshCw className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => setDismissed(failure.error.message)}
        aria-label="Dismiss"
        className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-amber-300 hover:bg-white/10 sm:min-h-8 sm:min-w-8"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
