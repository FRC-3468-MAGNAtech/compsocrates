"use client";

import { Megaphone } from "lucide-react";
import { AnnouncementsBoard } from "@/components/announcements/announcements-board";
import { Widget } from "@/components/dashboard/widget";
import { Button } from "@/components/ui/button";
import { useDashboard } from "@/lib/dashboard/data";
import { useTeamAnnouncements } from "@/lib/announcements/store";

/**
 * CS "Team Communication" (announcements, strategy notes, match alerts for the whole team), as a dashboard card: compose, the team's posts newest
 * first, and Delete for a team admin. The listener lives here, not in the DashboardProvider: only the roles that show the card pay for it.
 */
export function AnnouncementsWidget() {
  const d = useDashboard();
  const state = useTeamAnnouncements(d.teamId);
  const actor = d.uid ? { uid: d.uid, name: d.userName } : null;
  return (
    <Widget
      title="Team communication"
      icon={Megaphone}
      size="wide"
      status={!state.loaded ? "loading" : state.error ? "error" : "ready"}
      errorText="Couldn't load announcements."
      headerRight={
        state.error ? (
          <Button size="sm" variant="glass" className="min-h-11" onClick={state.retry}>
            Try again
          </Button>
        ) : undefined
      }
    >
      <AnnouncementsBoard state={state} teamId={d.teamId} actor={actor} canDelete={d.isAdmin} listClassName="max-h-72 overflow-y-auto" />
    </Widget>
  );
}
