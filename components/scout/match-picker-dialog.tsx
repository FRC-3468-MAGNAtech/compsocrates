"use client";

import Link from "@/components/program/link";
import { useState } from "react";
import { CalendarX2, Clock, Keyboard, List } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Label } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GlassSkeletonCard } from "@/components/ui/glass-skeleton";
import { BracketPicker } from "@/components/scout/bracket-picker";
import { useEventQuery } from "@/lib/events/use-event-query";
import { getMatchesForEvent } from "@/lib/events/actions";
import type { EventInfo, EventMatch, MatchType } from "@/lib/events/types";
import { MATCH_TYPE_PREFIX } from "@/lib/analytics/game-schema";

export type AssignedMatch = { type: MatchType; match: EventMatch };

/** CS match picker marks: a match already scouted, or one assigned to the scout. */
export type MatchMark = "scouted" | "assigned";

const TABS: { value: MatchType; label: string }[] = [
  { value: "Practice", label: "Practice" },
  { value: "Qualification", label: "Qualification" },
  { value: "Playoff", label: "Finals" },
];

export function MatchPickerDialog({
  open,
  onOpenChange,
  activeEvent,
  onSelect,
  marks,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeEvent: EventInfo | null;
  onSelect: (assigned: AssignedMatch) => void;
  /** Optional marks for the practice and qualification lists (Scouted / Assigned to you). */
  marks?: (type: MatchType, matchNumber: number) => MatchMark | null;
}) {
  const [tab, setTab] = useState<MatchType>("Qualification");
  const [manualMode, setManualMode] = useState(false);
  const [manualType, setManualType] = useState<MatchType>("Qualification");
  const [manualNumber, setManualNumber] = useState("");

  const choose = (assigned: AssignedMatch) => {
    onSelect(assigned);
    onOpenChange(false);
  };

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setManualMode(false);
      setManualNumber("");
    }
  };

  const confirmManual = () => {
    const n = Number(manualNumber);
    if (!manualNumber || !Number.isFinite(n) || n <= 0) return;
    // A synthetic match: no roster/score data exists for it, since it's not
    // coming from the FIRST API at all. Downstream code already treats an
    // unmatched (eventCode, type, number) as "no official data" gracefully
    // (accuracy shows "-", no false "team not in match" flag).
    const match: EventMatch = {
      id: `${manualType}-manual-${n}`,
      matchNumber: n,
      type: manualType,
      description: null,
      series: null,
      played: false,
      redTeams: [],
      blueTeams: [],
      redScore: null,
      blueScore: null,
      redPenaltyPoints: null,
      bluePenaltyPoints: null,
      startTime: null,
    };
    choose({ type: manualType, match });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[min(95vw,820px)] max-h-[85vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <DialogTitle>Pick a match</DialogTitle>
            <DialogDescription>
              {manualMode
                ? "Type in the match type and number directly."
                : "Choose the match type, then tap the match you're scouting."}
            </DialogDescription>
          </div>
          {activeEvent && (
            <Button
              variant="glass"
              size="sm"
              className="shrink-0 gap-1.5"
              onClick={() => {
                if (!manualMode) setManualType(tab);
                setManualMode((m) => !m);
              }}
            >
              {manualMode ? <List className="h-3.5 w-3.5" /> : <Keyboard className="h-3.5 w-3.5" />}
              {manualMode ? "Browse matches" : "Enter manually"}
            </Button>
          )}
        </div>

        {!activeEvent ? (
          <NoActiveEvent />
        ) : manualMode ? (
          <div className="mt-4 flex flex-col gap-3">
            <div>
              <Label htmlFor="manual-match-type">Match type</Label>
              <Select value={manualType} onValueChange={(v) => setManualType(v as MatchType)}>
                <SelectTrigger id="manual-match-type">
                  <SelectValue>{TABS.find((t) => t.value === manualType)?.label}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {TABS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="manual-match-number">Match number</Label>
              <Input
                id="manual-match-number"
                type="number"
                inputMode="numeric"
                min={1}
                value={manualNumber}
                onChange={(e) => setManualNumber(e.target.value)}
                placeholder="12"
                autoFocus
              />
            </div>
            <p className="text-xs text-[var(--muted-foreground)]">
              Use this for practice matches (never tracked by the FIRST API) or a match that hasn&apos;t synced yet.
            </p>
            <Button size="lg" disabled={!manualNumber} onClick={confirmManual}>
              Use {MATCH_TYPE_PREFIX[manualType]}
              {manualNumber || "…"}
            </Button>
          </div>
        ) : (
          <Tabs value={tab} onValueChange={(v) => setTab(v as MatchType)} className="mt-4 flex flex-col gap-4">
            <TabsList>
              {TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value="Practice">
              <MatchList
                eventCode={activeEvent.code}
                season={activeEvent.season}
                type="Practice"
                marks={marks}
                onSelect={(match) => choose({ type: "Practice", match })}
              />
            </TabsContent>
            <TabsContent value="Qualification">
              <MatchList
                eventCode={activeEvent.code}
                season={activeEvent.season}
                type="Qualification"
                marks={marks}
                onSelect={(match) => choose({ type: "Qualification", match })}
              />
            </TabsContent>
            <TabsContent value="Playoff">
              <BracketPicker
                eventCode={activeEvent.code}
                season={activeEvent.season}
                onSelect={(match) => choose({ type: "Playoff", match })}
              />
            </TabsContent>
            <button
              type="button"
              onClick={() => {
                setManualType(tab);
                setManualMode(true);
              }}
              className="self-start text-xs text-[var(--muted-foreground)] underline underline-offset-4 hover:text-[var(--foreground)]"
            >
              Can&apos;t find your match? Enter it manually.
            </button>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

function NoActiveEvent() {
  return (
    <div className="glass-card mt-4 flex flex-col items-center gap-3 p-8 text-center">
      <CalendarX2 className="h-8 w-8 text-[var(--muted-foreground)]" />
      <div>
        <div className="font-semibold">No active event selected</div>
        <p className="text-sm text-[var(--muted-foreground)]">Pick an event first so matches can load.</p>
      </div>
      <Link href="/event">
        <Button variant="glass" size="sm">
          Go to Active Event
        </Button>
      </Link>
    </div>
  );
}

function MatchList({
  eventCode,
  season,
  type,
  onSelect,
  marks,
}: {
  eventCode: string;
  season: number;
  type: MatchType;
  onSelect: (match: EventMatch) => void;
  marks?: (type: MatchType, matchNumber: number) => MatchMark | null;
}) {
  const query = useEventQuery(`matches:${eventCode}:${season}:${type}`, () => getMatchesForEvent(eventCode, type, season));

  if (query.status === "loading") {
    return (
      <div className="flex flex-col gap-2">
        <GlassSkeletonCard className="h-14 p-3" />
        <GlassSkeletonCard className="h-14 p-3" />
        <GlassSkeletonCard className="h-14 p-3" />
      </div>
    );
  }
  if (query.status === "error") {
    return (
      <div className="glass-card p-6 text-center text-sm text-[var(--muted-foreground)]">
        Couldn&apos;t load matches &mdash; {query.error?.message}
      </div>
    );
  }
  if (query.status === "empty") {
    return (
      <div className="glass-card p-6 text-center text-sm text-[var(--muted-foreground)]">
        {type === "Practice"
          ? "Practice matches aren't tracked by the FIRST API."
          : `No ${type.toLowerCase()} matches yet — check back once the event starts.`}
      </div>
    );
  }

  return (
    <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto pr-1">
      {(query.data ?? []).map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => onSelect(m)}
          className="glass-card flex min-h-14 flex-wrap items-center justify-between gap-2 p-3.5 text-left transition-colors hover:bg-white/8"
        >
          <div className="flex items-center gap-3">
            <span className="font-semibold">
              {MATCH_TYPE_PREFIX[type]}
              {m.matchNumber}
            </span>
            {(() => {
              const mark = marks?.(type, m.matchNumber) ?? null;
              return mark ? <Badge variant={mark === "scouted" ? "success" : "accent"}>{mark === "scouted" ? "Scouted" : "Assigned"}</Badge> : null;
            })()}
            {m.startTime && (
              <span className="flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
                <Clock className="h-3 w-3" />
                {new Date(m.startTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </span>
            )}
          </div>
          <div className="text-xs">
            <span className="text-red-300">{m.redTeams.join(", ")}</span>
            <span className="mx-1.5 text-[var(--muted-foreground)]">vs</span>
            <span className="text-blue-300">{m.blueTeams.join(", ")}</span>
          </div>
        </button>
      ))}
    </div>
  );
}
