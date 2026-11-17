"use client";

import { useMemo, useState } from "react";
import { CalendarX2, TriangleAlert } from "lucide-react";
import { CURRENT_GAME_ID } from "@/config/games";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Label } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shimmer } from "@/components/ui/shimmer";
import { useAnalyticsData, useSingleEvent } from "@/lib/analytics/data-context";
import { useSingleEventMode } from "@/lib/analytics/filter-context";
import {
  CONFIDENCE_TIERS,
  DEFAULT_CONFIDENCE_TIER,
  PREDICTION_SOURCES,
  isPredictionSource,
  predictTeams,
  predictionHistory,
  scheduleMatches,
  teamsInSchedule,
  type ScheduleMatch,
} from "@/lib/analytics/match-prediction";
import { useEventMatches } from "@/lib/analytics/use-event-data";
import { cn } from "@/lib/utils";
import type { ConfidenceTier, PredictionSource, TacticalPrediction } from "@/lib/games/types";

/**
 * Match Prediction: auto-filled tactical projections (start, role, climb %, points) for every team in the chosen event's schedule,
 * from the team's scouting history. The numbers come from the game plugin's `predict`; the Event is the shared filter bar's.
 */
export function MatchPredictionView() {
  useSingleEventMode();
  const data = useAnalyticsData();
  const single = useSingleEvent();
  const [source, setSource] = useState<PredictionSource>("combined");
  const [tier, setTier] = useState<ConfidenceTier>(DEFAULT_CONFIDENCE_TIER);

  const requests = useMemo(() => (single.code ? [{ code: single.code, season: single.event?.season ?? data.season }] : []), [single.code, single.event?.season, data.season]);
  const { matches: official, loading: matchesLoading, error: matchesError } = useEventMatches(requests);

  const schedule = useMemo(() => scheduleMatches(official), [official]);
  const history = useMemo(() => predictionHistory(data.allEntries), [data.allEntries]);
  const predictions = useMemo(() => predictTeams(teamsInSchedule(schedule), history.docs, source, tier), [schedule, history.docs, source, tier]);

  const loading = !data.loaded || (single.code !== null && matchesLoading);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Match Prediction</h2>
          <p className="max-w-2xl text-sm text-[var(--muted-foreground)]">
            Auto-filled tactical projections for every match in the selected event: predicted starting position, role, climb probability and estimated points, from
            historical scouting data.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="prediction-source">Data source</Label>
            <Select value={source} onValueChange={(v) => isPredictionSource(v) && setSource(v)}>
              <SelectTrigger id="prediction-source" className="w-52">
                <SelectValue>{PREDICTION_SOURCES.find((s) => s.value === source)?.label}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {PREDICTION_SOURCES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="prediction-confidence">Confidence</Label>
            <Select value={String(tier)} onValueChange={(v) => setTier(Number(v) as ConfidenceTier)}>
              <SelectTrigger id="prediction-confidence" className="w-28">
                <SelectValue>{tier}%</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {CONFIDENCE_TIERS.map((t) => (
                  <SelectItem key={t} value={String(t)}>
                    {t}%
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {history.skipped > 0 && (
        <p className="text-xs text-[var(--muted-foreground)]">
          {history.skipped} {history.skipped === 1 ? "entry" : "entries"} from other games {history.skipped === 1 ? "is" : "are"} not used: predictions are built for {CURRENT_GAME_ID} only.
        </p>
      )}

      {matchesError && !loading && (
        <GlassPanel className="flex items-start gap-3 py-4 text-sm" role="alert">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden />
          <span>Unable to load the match schedule for this event right now. Try again in a moment.</span>
        </GlassPanel>
      )}

      {loading ? (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading match schedule">
          <Shimmer className="h-40" />
          <Shimmer className="h-40" />
        </div>
      ) : single.code === null ? (
        <GlassPanel className="flex flex-col items-center gap-3 py-12 text-center">
          <CalendarX2 className="h-8 w-8 text-[var(--muted-foreground)]" aria-hidden />
          <div>
            <div className="font-semibold">No event selected</div>
            <p className="text-sm text-[var(--muted-foreground)]">Set an active event or pick one in the Event filter above.</p>
          </div>
        </GlassPanel>
      ) : schedule.length === 0 ? (
        <GlassPanel className="py-12 text-center text-sm text-[var(--muted-foreground)]">No matches found for this event yet.</GlassPanel>
      ) : (
        <ul className="flex flex-col gap-4">
          {schedule.map((match) => (
            <MatchCard key={match.key} match={match} predictions={predictions} />
          ))}
        </ul>
      )}
    </div>
  );
}

function MatchCard({ match, predictions }: { match: ScheduleMatch; predictions: ReadonlyMap<string, TacticalPrediction> }) {
  return (
    <li>
      <GlassPanel className="p-4">
        <h3 className="mb-3 text-base font-semibold">{match.title}</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <Alliance label="Red Alliance" tone="red" teams={match.red} predictions={predictions} />
          <Alliance label="Blue Alliance" tone="blue" teams={match.blue} predictions={predictions} />
        </div>
      </GlassPanel>
    </li>
  );
}

function Alliance({ label, tone, teams, predictions }: { label: string; tone: "red" | "blue"; teams: string[]; predictions: ReadonlyMap<string, TacticalPrediction> }) {
  return (
    <div>
      <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
        <span aria-hidden className={cn("h-2.5 w-2.5 rounded-full", tone === "red" ? "bg-red-400" : "bg-blue-400")} />
        {label}
      </p>
      <ul className="flex flex-col gap-2">
        {teams.map((team) => (
          <PredictionRow key={team} team={team} prediction={predictions.get(team)} />
        ))}
      </ul>
    </div>
  );
}

function PredictionRow({ team, prediction }: { team: string; prediction?: TacticalPrediction }) {
  const samples = prediction?.sampleSize ?? 0;
  return (
    <li className="rounded-2xl border border-[var(--glass-border)] p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold tabular-nums">Team {team}</p>
        <p className="text-xs text-[var(--muted-foreground)]">
          {samples} {samples === 1 ? "match" : "matches"}
        </p>
      </div>
      {prediction && samples > 0 ? (
        <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <Fact label="Start" value={prediction.startingPosition} />
          <Fact label="Role" value={prediction.role} />
          <Fact label="Climb %" value={`${prediction.climbProbability}%`} />
          <Fact label="Est. points" value={String(prediction.estimatedPoints)} emphasized />
        </dl>
      ) : (
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">No historical data yet.</p>
      )}
    </li>
  );
}

function Fact({ label, value, emphasized }: { label: string; value: string; emphasized?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-[var(--muted-foreground)]">{label}</dt>
      <dd className={emphasized ? "font-semibold tabular-nums" : "font-medium"}>{value}</dd>
    </div>
  );
}
