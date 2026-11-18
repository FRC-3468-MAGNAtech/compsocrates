"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, Shuffle, VideoOff } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LoadError } from "@/components/practice/load-error";
import { ChipSummary } from "@/components/practice/chip-summary";
import { useAuth } from "@/lib/auth";
import { useTeamDoc } from "@/lib/team";
import { useForms } from "@/lib/forms/forms-context";
import { useProgramData } from "@/lib/program/data";
import { usePersonalMode } from "@/lib/personal/context";
import { useLibraryMatchesBySeason } from "@/lib/match-library";
import { useTeamPracticeSessions } from "@/lib/practice-sessions";
import { buildMatchRows, pickRandomMatchRow, type MatchRow } from "@/lib/practice-match-rows";
import { DIFFICULTY_CLASSNAMES, DIFFICULTY_LABELS, type Difficulty } from "@/lib/difficulty";
import { MATCH_TYPE_PREFIX } from "@/lib/analytics/game-schema";
import { cn } from "@/lib/utils";
import { eventTitle } from "@/lib/events/names";

const STATUS_BADGE: Record<MatchRow["status"], { label: string; className: string }> = {
  fresh: { label: "Fresh", className: "bg-emerald-500/15 text-emerald-300 border border-emerald-400/30" },
  opened: { label: "Opened", className: "bg-amber-500/15 text-amber-300 border border-amber-400/30" },
  scouted: { label: "Scouted", className: "bg-sky-500/15 text-sky-300 border border-sky-400/30" },
};

export function MatchSelect({
  seasonId,
  difficulty,
  onBack,
  onStart,
}: {
  seasonId: string;
  /** Null: every difficulty (and matches with no official score yet). */
  difficulty: Difficulty | null;
  onBack: () => void;
  onStart: (row: MatchRow) => void;
}) {
  const { user, profile } = useAuth();
  const teamId = profile?.teamId ?? null;
  const { team } = useTeamDoc(teamId);
  // A program with its own library has no video entry yet: a match without one is scouted against the timer placeholder instead of being unstartable.
  const ownLibrary = useProgramData()?.library != null;
  // No team (personal practice): the shared official matches mostly have no video entered, so a match without one is scouted against the timer placeholder.
  const { personal } = usePersonalMode();
  const usePlaceholder = (team?.usePlaceholderVideo ?? false) || ownLibrary || personal;
  const { matches, loaded: matchesLoaded, error: matchesError, retry: retryMatches } = useLibraryMatchesBySeason(seasonId);
  const { sessions, loaded: sessionsLoaded, error: sessionsError, retry: retrySessions } = useTeamPracticeSessions(teamId);
  const loadError = matchesError ?? sessionsError;
  const seasonName = useForms().seasonFor(seasonId).name;

  // The events that have published matches, from the library (not the team's own event list or its archived events). Every program picks an event first.
  const events = useMemo(() => {
    const byCode = new Map<string, string>();
    for (const m of matches) if (!byCode.has(m.eventCode)) byCode.set(m.eventCode, m.eventName || m.eventCode);
    return [...byCode].map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [matches]);
  const [chosenEvent, setChosenEvent] = useState<string | null>(null);
  const eventCode = events.find((e) => e.code === chosenEvent)?.code ?? events[0]?.code ?? null;

  const rows = useMemo(() => {
    if (!user) return [];
    const all = buildMatchRows(matches, sessions, user.uid, difficulty);
    return all.filter((r) => r.eventCode === eventCode);
  }, [matches, sessions, user, difficulty, eventCode]);
  const startable = useMemo(() => rows.filter((r) => r.hasVideo || usePlaceholder), [rows, usePlaceholder]);

  const handleRandomize = () => {
    const picked = pickRandomMatchRow(startable);
    if (picked) onStart(picked);
  };

  const loaded = matchesLoaded && sessionsLoaded;
  const nothingPublished = matches.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" className="gap-1.5" onClick={onBack}>
          <ChevronLeft className="h-4 w-4" /> Back
        </Button>
        <ChipSummary seasonName={seasonName} difficulty={difficulty} />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-bold">Pick a match</h2>
        <div className="flex flex-wrap items-end gap-3">
          {events.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="practice-event">Event</Label>
              <Select value={eventCode ?? ""} onValueChange={setChosenEvent}>
                <SelectTrigger id="practice-event" className="w-64" data-testid="practice-event-select">
                  <SelectValue>{(() => { const picked = events.find((e) => e.code === eventCode); return picked ? eventTitle(picked) : eventCode; })()}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {events.map((e) => (
                    <SelectItem key={e.code} value={e.code}>
                      {eventTitle(e)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <Button className="gap-2" disabled={startable.length === 0} onClick={handleRandomize}>
            <Shuffle className="h-4 w-4" /> Randomize
          </Button>
        </div>
      </div>

      {!loaded ? (
        <div className="glass-card h-48 animate-pulse" aria-busy="true" />
      ) : loadError ? (
        <LoadError
          failure={loadError}
          onRetry={() => {
            retryMatches();
            retrySessions();
          }}
        />
      ) : nothingPublished ? (
        <GlassPanel className="py-10 text-center text-sm text-[var(--muted-foreground)]" data-testid="practice-empty">
          No practice matches published yet. Ask an admin to publish a library match.
        </GlassPanel>
      ) : rows.length === 0 ? (
        <GlassPanel className="py-10 text-center text-sm text-[var(--muted-foreground)]">
          {difficulty === null ? "No matches to scout in this event yet" : `No ${DIFFICULTY_LABELS[difficulty].toLowerCase()} matches in this event yet`}. Try another event or difficulty, or ask an admin to publish more matches.
        </GlassPanel>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row) => {
            const disabled = !row.hasVideo && !usePlaceholder;
            const status = STATUS_BADGE[row.status];
            return (
              <GlassPanel
                key={`${row.libraryMatchId}-${row.alliance}`}
                interactive={!disabled}
                onClick={() => !disabled && onStart(row)}
                className={cn("flex flex-wrap items-center gap-3 p-4", disabled && "opacity-50")}
              >
                <Badge variant="glass" className="shrink-0 font-mono">
                  {MATCH_TYPE_PREFIX[row.matchType]}
                  {row.matchNumber}
                </Badge>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    row.alliance === "red" ? "bg-red-500/15 text-red-300" : "bg-blue-500/15 text-blue-300"
                  )}
                >
                  {row.alliance}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.teams.join(" & ")}</span>
                {row.manual && (
                  <Badge variant="outline" className="shrink-0 text-[10px]" title="Entered by hand — this event's scores aren't in the FIRST API">
                    Manual
                  </Badge>
                )}
                {row.difficulty ? (
                  <Badge className={DIFFICULTY_CLASSNAMES[row.difficulty]}>{DIFFICULTY_LABELS[row.difficulty]}</Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px]">
                    No official score yet
                  </Badge>
                )}
                <Badge className={status.className}>
                  {status.label}
                  {row.byYou ? " · by you" : ""}
                </Badge>
                {disabled && (
                  <Badge variant="outline" className="gap-1 text-[10px]">
                    <VideoOff className="h-3 w-3" /> No video yet
                  </Badge>
                )}
              </GlassPanel>
            );
          })}
        </div>
      )}
    </div>
  );
}
