"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Shuffle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { ChipSummary } from "@/components/practice/chip-summary";
import { getStatus, getPercentColor } from "@/lib/accuracy/engine";
import { getEntriesForSession, type ScoutEntry } from "@/lib/scout-entries";
import { useForms } from "@/lib/forms/forms-context";
import { useProgram, useProgramConfig } from "@/lib/program/context";
import { ComparisonRow, Stat } from "@/components/practice/comparison-row";
import { cardEntranceVariants } from "@/lib/motion";
import type { LibraryMatch } from "@/lib/match-library";
import type { PracticeSession } from "@/lib/practice-sessions";

export function ResultsScreen({
  session,
  libraryMatch,
  onScoutAnother,
  onBackToPracticeScouting,
}: {
  session: PracticeSession;
  libraryMatch: LibraryMatch;
  onScoutAnother: () => void;
  onBackToPracticeScouting: () => void;
}) {
  const [entries, setEntries] = useState<ScoutEntry[] | null>(null);
  const program = useProgram();
  const seasonName = useForms().seasonFor(session.seasonId).name;
  // `practice.noScoreIsResult` (program config): a finished session with no accuracy (the match has no official score yet) is a result, not a loading state.
  // NOTE: with the flag off (FRC), the skeleton below shows until `session.accuracy` is set, so a session whose library match never gets an official score
  // can hang on the skeleton. FRC behavior is deliberately unchanged here; flip FRC's flag in `config/programs/frc.ts` once that is accepted.
  const noAccuracyIsResult = useProgramConfig().practice.noScoreIsResult;
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getEntriesForSession(session.teamId, session.id, program)
      .then((result) => {
        if (!cancelled) setEntries(result);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [session.teamId, session.id, program]);

  if (loadError) {
    return (
      <GlassPanel role="alert" className="flex flex-col gap-3 py-8 text-center text-sm">
        <p>Your session was saved, but the robots&apos; entries couldn&apos;t be loaded for the results. Check your connection and try again.</p>
        <Button variant="glass" className="mx-auto min-h-11" onClick={onBackToPracticeScouting}>
          Back to Practice Scouting
        </Button>
      </GlassPanel>
    );
  }
  if (!entries || (session.accuracy === null && !noAccuracyIsResult) || (noAccuracyIsResult && session.status !== "completed")) {
    return <div className="glass-card h-64 animate-pulse" aria-busy="true" />;
  }
  const hasOfficial = session.officialScore !== null && session.accuracy !== null;

  // One comparison tile per scouted robot (3 for FRC), in scouting order.
  const robotStats = session.robots.map((team, i) => ({ team, total: (entries.find((e) => e.teamNumber === team) ?? entries[i])?.score.total ?? 0 }));
  const accuracy = session.accuracy ?? 0;
  const status = getStatus(accuracy);
  const percentColor = getPercentColor(accuracy);
  const officialAlliance = libraryMatch.alliances[session.alliance ?? "red"];
  const difference = (session.scoutedTotal ?? 0) - (session.officialScore ?? 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <ChipSummary seasonName={seasonName} mode={session.mode} difficulty={session.difficulty} />
        {libraryMatch.origin === "manual" && (
          <Badge variant="outline" className="text-[10px]" title="Entered by hand — this event's scores aren't in the FIRST API">
            Manual
          </Badge>
        )}
      </div>

      <motion.div variants={cardEntranceVariants} initial="hidden" animate="show">
        <GlassPanel strong className="flex flex-col items-center gap-2 py-10 text-center">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Accuracy</span>
          {hasOfficial ? (
            <>
              <span className={`text-6xl font-bold tabular-nums ${percentColor}`} data-testid="practice-accuracy">{Math.round(accuracy)}%</span>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${status.badgeClassName}`}>{status.label}</span>
            </>
          ) : (
            <span className="text-2xl font-semibold text-[var(--muted-foreground)]" data-testid="practice-no-official-score">No official score yet</span>
          )}
        </GlassPanel>
      </motion.div>

      <GlassPanel className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Comparison</h2>
        <ComparisonRow robots={robotStats} penalties={hasOfficial ? (session.penaltyPoints ?? officialAlliance.penaltyPoints) : null} totalLabel="= Your total" total={session.scoutedTotal ?? 0} />
        <div className="my-1 h-px bg-[var(--glass-border)]" />
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <Stat label="Your total" value={session.scoutedTotal ?? 0} />
          {hasOfficial ? (
            <>
              <Stat label="Official score" value={session.officialScore ?? officialAlliance.score} />
              <Stat label="Difference" value={difference} signed />
            </>
          ) : (
            <Stat label="Official score" value="Not entered yet" />
          )}
        </div>
      </GlassPanel>

      <div className="flex flex-wrap gap-3">
        <Button size="lg" className="gap-2" onClick={onScoutAnother}>
          <Shuffle className="h-4 w-4" /> Scout Another Match
        </Button>
        <Button size="lg" variant="glass" className="gap-2" onClick={onBackToPracticeScouting}>
          Back to Practice Scouting <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

