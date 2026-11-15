"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ImportedLibraryPanel } from "@/components/admin/library/imported-library-panel";
import { ManualLibraryPanel } from "@/components/admin/library/manual-library-panel";
import { useAuth } from "@/lib/auth";
import { useLibraryAdapter } from "@/lib/library/adapter";
import { useProgramConfig } from "@/lib/program/context";
import { useTeamDoc, setUsePlaceholderVideo } from "@/lib/team";

type LibraryView = "api" | "manual";

/**
 * Admin Panel > Match Library: ONE panel for every program. Two tabs (events imported from the events API, and events entered by hand) over the
 * program's library adapter; what a program does differently (scores optional, a schedule instead of played matches, a time on a match) comes from
 * `ProgramConfig.library`. Never a second panel per program.
 */
export function MatchLibraryPanel({ onOpenRescore }: { onOpenRescore: () => void }) {
  const [view, setView] = useState<LibraryView>("api");
  const { library } = useProgramConfig();

  return (
    <GlassPanel className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Match Library</h2>
          <p className="text-xs text-[var(--muted-foreground)]">Import real events for practice scouting, or enter matches by hand for events whose scores aren&apos;t in the FIRST API. No videos are added automatically.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {library.backfill && <UpdateLibraryButton />}
          {library.placeholderVideoSwitch && <PlaceholderVideoSwitch />}
        </div>
      </div>

      <Tabs value={view} onValueChange={(v) => setView(v as LibraryView)}>
        <TabsList>
          <TabsTrigger value="api">Imported (FIRST API)</TabsTrigger>
          <TabsTrigger value="manual">Manual events</TabsTrigger>
        </TabsList>
      </Tabs>

      {view === "manual" ? <ManualLibraryPanel onOpenRescore={onOpenRescore} /> : <ImportedLibraryPanel />}
    </GlassPanel>
  );
}

/** FIX3: stamps matches imported before publishing existed (no `origin`/`published`) so scouts can see them. Idempotent; also runs automatically for admins. */
function UpdateLibraryButton() {
  const { user } = useAuth();
  const adapter = useLibraryAdapter();
  const [updating, setUpdating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const update = async () => {
    if (!user || !adapter.backfill) return;
    setUpdating(true);
    setMessage(null);
    try {
      const result = await adapter.backfill({ uid: user.uid });
      setMessage(result.matchesStamped === 0 && result.eventsCreated === 0 ? "Everything is already up to date." : `Updated ${result.matchesStamped} match${result.matchesStamped === 1 ? "" : "es"} and ${result.eventsCreated} event record${result.eventsCreated === 1 ? "" : "s"}.`);
    } catch (err) {
      console.error("library update failed:", err);
      setMessage("Couldn't update the library. Check your connection and try again.");
    } finally {
      setUpdating(false);
    }
  };

  return (
    <>
      <Button variant="ghost" size="sm" className="gap-1.5" disabled={updating} onClick={() => void update()} title="Makes matches imported before the manual-match update visible to scouts. Safe to run again.">
        <RefreshCw className={updating ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} /> Update library
      </Button>
      {message && <span className="text-xs text-[var(--muted-foreground)]">{message}</span>}
    </>
  );
}

/** Test switch on the team document: practice matches without a video use a placeholder. */
function PlaceholderVideoSwitch() {
  const { profile } = useAuth();
  const teamId = profile?.teamId ?? null;
  const { team } = useTeamDoc(teamId);
  return (
    <>
      <span className="text-xs text-[var(--muted-foreground)]">Use placeholder video for testing</span>
      <Switch checked={team?.usePlaceholderVideo ?? false} onCheckedChange={(v) => teamId && void setUsePlaceholderVideo(teamId, v)} disabled={!teamId} />
    </>
  );
}
