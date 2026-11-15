"use client";

import { AlertTriangle } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { useTeamPracticeSessions } from "@/lib/practice-sessions";

/**
 * Admins only (the page decides): stored practice sessions that could not be read as a whole session (no scout, an unknown status, a completed session with
 * no match). They are never dropped from the data: this lists them with the reason so an admin can fix or delete them. Renders nothing when there are none.
 */
export function UnreadableSessionsNotice({ teamId }: { teamId: string | null }) {
  const { sessions } = useTeamPracticeSessions(teamId);
  const bad = sessions.filter((s) => s.malformed !== undefined);
  if (bad.length === 0) return null;
  return (
    <GlassPanel role="alert" data-testid="unreadable-sessions" className="flex flex-col gap-2 border border-amber-400/30">
      <div className="flex items-center gap-2 text-sm font-semibold text-amber-300">
        <AlertTriangle className="h-4 w-4" aria-hidden /> {bad.length} practice session{bad.length === 1 ? "" : "s"} couldn&apos;t be read in full
      </div>
      <ul className="flex flex-col gap-1 text-xs text-[var(--muted-foreground)]">
        {bad.map((s) => (
          <li key={s.id}>
            <span className="font-mono">{s.id}</span>: {s.malformed}
          </li>
        ))}
      </ul>
    </GlassPanel>
  );
}
