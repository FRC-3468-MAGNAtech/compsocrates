"use client";

import { Megaphone } from "lucide-react";
import { AnnouncementsBoard } from "@/components/announcements/announcements-board";
import { GlassPanel } from "@/components/ui/glass-panel";
import { useAuth } from "@/lib/auth";
import { useTeamAnnouncements } from "@/lib/announcements/store";
import { usePermissions } from "@/lib/permissions";

/** CS's "Team Communication" card as it sat on the Team Management page: a heading and blurb over the board. */
export function AnnouncementsPanel({ teamId }: { teamId: string | null }) {
  const { user, profile } = useAuth();
  const { isAdmin } = usePermissions();
  const state = useTeamAnnouncements(teamId);
  const actor = user ? { uid: user.uid, name: profile?.name ?? user.displayName ?? "" } : null;
  return (
    <GlassPanel className="flex flex-col gap-3">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          <Megaphone className="h-4 w-4" aria-hidden /> Team Communication
        </h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">Post announcements, strategy notes, and match alerts for the whole team to see.</p>
      </div>
      <AnnouncementsBoard state={state} teamId={teamId} actor={actor} canDelete={isAdmin} listClassName="max-h-96 overflow-y-auto" />
    </GlassPanel>
  );
}
