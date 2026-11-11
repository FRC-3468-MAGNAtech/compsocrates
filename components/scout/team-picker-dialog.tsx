"use client";

import { useMemo, useState } from "react";
import { Keyboard, List } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { GlassSkeletonCard } from "@/components/ui/glass-skeleton";
import { Button } from "@/components/ui/button";
import { useEventQuery } from "@/lib/events/use-event-query";
import { getTeamsForEvent } from "@/lib/events/actions";
import { TEAM_MARK_LABEL, type TeamMark } from "@/components/scout/team-status";
import type { EventTeam } from "@/lib/events/types";
import { cn } from "@/lib/utils";

export function TeamPickerDialog({
  open,
  onOpenChange,
  eventCode,
  season,
  priorityTeamNumbers,
  marks,
  highlightTeam,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventCode: string;
  season: number;
  priorityTeamNumbers?: number[];
  /** CS TeamPickerModal marks for the picked match: Scouted (not pickable here, as in CS), Sub Assigned, Sub Req, Assigned. */
  marks?: ReadonlyMap<number, TeamMark>;
  /** The scout's own robot in this match: ringed like CS's highlighted team and listed first. */
  highlightTeam?: number | null;
  onSelect: (teamNumber: number) => void;
}) {
  const [search, setSearch] = useState("");
  const [manualMode, setManualMode] = useState(false);
  const [manualNumber, setManualNumber] = useState("");
  const teamsQuery = useEventQuery(`teams:${eventCode}:${season}`, () => getTeamsForEvent(eventCode, season));

  const teams = useMemo(() => {
    const list = teamsQuery.data ?? [];
    const prioritized = new Set(priorityTeamNumbers ?? []);
    const q = search.trim().toLowerCase();
    const filtered = q
      ? list.filter((t) => String(t.teamNumber).includes(q) || t.nameShort.toLowerCase().includes(q))
      : list;
    const rank = (n: number) => (n === highlightTeam ? 0 : prioritized.has(n) ? 1 : 2);
    return [...filtered].sort((a, b) => {
      const aP = rank(a.teamNumber);
      const bP = rank(b.teamNumber);
      return aP !== bP ? aP - bP : a.teamNumber - b.teamNumber;
    });
  }, [teamsQuery.data, search, priorityTeamNumbers, highlightTeam]);

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setSearch("");
      setManualMode(false);
      setManualNumber("");
    }
  };

  const confirmManual = () => {
    const n = Number(manualNumber);
    if (!manualNumber || !Number.isFinite(n) || n <= 0) return;
    onSelect(n);
    handleOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[min(92vw,560px)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <DialogTitle>Pick a team</DialogTitle>
            <DialogDescription>
              {manualMode ? "Type in a team number directly." : "Teams registered for this event."}
            </DialogDescription>
          </div>
          <Button
            variant="glass"
            size="sm"
            className="shrink-0 gap-1.5"
            onClick={() => setManualMode((m) => !m)}
          >
            {manualMode ? <List className="h-3.5 w-3.5" /> : <Keyboard className="h-3.5 w-3.5" />}
            {manualMode ? "Browse list" : "Enter manually"}
          </Button>
        </div>

        {manualMode ? (
          <div className="mt-4 flex flex-col gap-3">
            <div>
              <Label htmlFor="manual-team-number">Team number</Label>
              <Input
                id="manual-team-number"
                type="number"
                inputMode="numeric"
                min={1}
                value={manualNumber}
                onChange={(e) => setManualNumber(e.target.value)}
                placeholder="12345"
                autoFocus
              />
            </div>
            <p className="text-xs text-[var(--muted-foreground)]">
              Use this if the team isn&apos;t registered for this event yet, or the FIRST API hasn&apos;t synced it.
            </p>
            <Button size="lg" disabled={!manualNumber} onClick={confirmManual}>
              Use Team {manualNumber || "…"}
            </Button>
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by number or name..."
              autoFocus
            />
            <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto pr-1">
              {teamsQuery.status === "loading" && (
                <>
                  <GlassSkeletonCard className="h-16 p-3.5" />
                  <GlassSkeletonCard className="h-16 p-3.5" />
                  <GlassSkeletonCard className="h-16 p-3.5" />
                </>
              )}
              {teamsQuery.status === "error" && (
                <div className="glass-card flex flex-col items-center gap-2 p-6 text-center text-sm text-[var(--muted-foreground)]">
                  Couldn&apos;t load teams &mdash; {teamsQuery.error?.message}
                  <Button variant="glass" size="sm" onClick={teamsQuery.refetch}>
                    Retry
                  </Button>
                </div>
              )}
              {teamsQuery.status === "empty" && (
                <div className="glass-card p-6 text-center text-sm text-[var(--muted-foreground)]">
                  No teams found for this event yet.
                </div>
              )}
              {teamsQuery.status === "success" && teams.length === 0 && (
                <div className="glass-card p-6 text-center text-sm text-[var(--muted-foreground)]">
                  No teams match &ldquo;{search}&rdquo;.
                </div>
              )}
              {teamsQuery.status === "success" &&
                teams.map((team) => (
                  <TeamRow
                    key={team.teamNumber}
                    team={team}
                    prioritized={priorityTeamNumbers?.includes(team.teamNumber) ?? false}
                    mark={marks?.get(team.teamNumber) ?? null}
                    highlighted={team.teamNumber === highlightTeam}
                    onClick={() => {
                      onSelect(team.teamNumber);
                      handleOpenChange(false);
                    }}
                  />
                ))}
            </div>
            <button
              type="button"
              onClick={() => setManualMode(true)}
              className="self-start text-xs text-[var(--muted-foreground)] underline underline-offset-4 hover:text-[var(--foreground)]"
            >
              Can&apos;t find your team? Enter it manually.
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const MARK_VARIANT: Record<TeamMark, "success" | "warning" | "glass" | "outline"> = { scouted: "success", subAssigned: "warning", subRequested: "warning", assigned: "glass" };

function TeamRow({ team, prioritized, mark, highlighted, onClick }: { team: EventTeam; prioritized: boolean; mark: TeamMark | null; highlighted: boolean; onClick: () => void }) {
  const done = mark === "scouted";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={done}
      aria-label={`${team.teamNumber} ${team.nameShort}${mark ? `, ${TEAM_MARK_LABEL[mark]}` : ""}`}
      data-testid={`team-row-${team.teamNumber}`}
      data-mark={mark ?? undefined}
      className={cn(
        "glass-card flex min-h-14 items-center justify-between gap-3 p-3.5 text-left transition-colors hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-50",
        (prioritized || highlighted) && "ring-1 ring-[rgba(var(--glow),0.5)]",
        highlighted && "ring-2"
      )}
    >
      <div className="min-w-0">
        <div className="font-semibold">{team.teamNumber}</div>
        <div className="truncate text-xs text-[var(--muted-foreground)]">{team.nameShort}</div>
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
        {mark && <Badge variant={MARK_VARIANT[mark]}>{TEAM_MARK_LABEL[mark]}</Badge>}
        {prioritized && <Badge variant="accent">In match</Badge>}
      </div>
    </button>
  );
}
