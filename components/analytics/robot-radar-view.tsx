"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { ClimbBoxPlot } from "@/components/analytics/climb-box-plot";
import { RobotRadarChart } from "@/components/analytics/robot-radar-chart";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Input, Label } from "@/components/ui/input";
import { Shimmer } from "@/components/ui/shimmer";
import { CURRENT_GAME_ID } from "@/config/games";
import { useAnalyticsData, useAnalyticsEntries } from "@/lib/analytics/data-context";
import { useAnalyticsFilters } from "@/lib/analytics/filter-context";
import { resolveEventCodes } from "@/lib/analytics/filters";
import { selectFormEntries } from "@/lib/analytics/form-analytics";
import { buildClimbBoxes } from "@/lib/analytics/climb-box";
import { RADAR_MAX_TEAMS, buildRadarStats, leadSkillByTeam, normalizeSelectedTeams, radarRows, radarSamples } from "@/lib/analytics/robot-radar";
import { useAuth } from "@/lib/auth";
import { useFormEntries } from "@/lib/form-entries";
import { cn } from "@/lib/utils";
import { storageKey } from "@/config/brand";

const STORAGE_KEY = storageKey("robot-radar-teams");

function readStoredTeams(): number[] {
  try {
    return normalizeSelectedTeams((window.localStorage.getItem(STORAGE_KEY) ?? "").split(","));
  } catch {
    return [];
  }
}

/**
 * Robot Radar: a normalized 0-10 build profile for one robot, or two side by side (overlap and the axes that differ by 2 or more are marked),
 * plus the Climb Reliability box plot. Entries follow the shared filters (Game, Event, Practice, Accuracy); the Agility axis comes from the
 * team's Lead Scout entries in the same events.
 */
export function RobotRadarView() {
  const { profile } = useAuth();
  const data = useAnalyticsData();
  const { filters } = useAnalyticsFilters();
  const { entries, loaded } = useAnalyticsEntries();
  const { entries: formEntries } = useFormEntries(profile?.teamId ?? null);

  const [selected, setSelected] = useState<number[]>([]);
  const [query, setQuery] = useState("");
  // Restored after mount: localStorage does not exist during the server render.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore of the saved selection
    setSelected(readStoredTeams());
  }, []);
  const choose = (next: number[]) => {
    setSelected(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next.join(","));
    } catch {
      // the selection just isn't remembered
    }
  };

  const { samples, skipped } = useMemo(() => radarSamples(entries), [entries]);

  const leadEntries = useMemo(() => {
    const codes = resolveEventCodes(filters, data.activeEventCodes);
    return selectFormEntries(formEntries, "lead-scout", codes).filter((e) => (e.legacy?.practiceScouted === true) === filters.practice);
  }, [formEntries, filters, data.activeEventCodes]);
  const skill = useMemo(() => leadSkillByTeam(leadEntries), [leadEntries]);

  const { stats, maxAuto, maxActiveFuel } = useMemo(() => buildRadarStats(samples, skill), [samples, skill]);
  const teamOptions = useMemo(() => [...stats.values()].sort((a, b) => a.teamNumber - b.teamNumber), [stats]);
  const visibleOptions = teamOptions.filter((t) => query.trim() === "" || String(t.teamNumber).includes(query.replace(/\D/g, "")));

  const [teamA, teamB = null] = selected;
  const statA = teamA !== undefined ? stats.get(teamA) : undefined;
  const statB = teamB !== null ? stats.get(teamB) : undefined;
  const rows = useMemo(() => radarRows(statA, statB, maxAuto, maxActiveFuel), [statA, statB, maxAuto, maxActiveFuel]);
  const boxes = useMemo(() => buildClimbBoxes(samples, selected), [samples, selected]);

  const toggle = (team: number) => choose(selected.includes(team) ? selected.filter((t) => t !== team) : selected.length >= RADAR_MAX_TEAMS ? selected : [...selected, team]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Robot Radar</h2>
        <p className="max-w-2xl text-sm text-[var(--muted-foreground)]">
          Normalized 0-10 build profile for {CURRENT_GAME_ID} robots. Add a second team to compare overlap and synergy.
        </p>
      </div>

      {!loaded ? (
        <div aria-busy="true" aria-label="Loading robot radar" className="flex flex-col gap-3">
          <Shimmer className="h-24" />
          <Shimmer className="h-80" />
        </div>
      ) : teamOptions.length === 0 ? (
        <GlassPanel className="py-12 text-center text-sm text-[var(--muted-foreground)]">
          {entries.length > 0
            ? `The radar is built for ${CURRENT_GAME_ID} scouting; the entries in this view are from another game.`
            : "No scouted data with the current filters. Try lowering the Accuracy threshold, or confirm accuracy has been recalculated."}
        </GlassPanel>
      ) : (
        <>
          {skipped > 0 && (
            <p className="text-xs text-[var(--muted-foreground)]">
              {skipped} {skipped === 1 ? "entry" : "entries"} from other games {skipped === 1 ? "is" : "are"} not used.
            </p>
          )}

          <GlassPanel className="flex flex-col gap-3 p-4">
            <fieldset className="flex flex-col gap-3">
              <legend className="text-sm font-semibold">
                Teams <span className="font-normal text-[var(--muted-foreground)]">({selected.length}/{RADAR_MAX_TEAMS}, pick up to two)</span>
              </legend>
              {selected.length > 0 && (
                <ul className="flex flex-wrap gap-2" aria-label="Selected teams">
                  {selected.map((team) => (
                    <li key={team}>
                      <Button variant="glass" size="md" className="min-h-11" onClick={() => toggle(team)} aria-label={`Remove team ${team}`}>
                        Team {team} <X className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <div>
                <Label htmlFor="radar-team-search">Find a team</Label>
                <Input id="radar-team-search" value={query} onChange={(e) => setQuery(e.target.value)} inputMode="numeric" placeholder="Team number..." className="sm:w-56" />
              </div>
              <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto" role="group" aria-label="Teams with scouted data">
                {visibleOptions.length === 0 ? (
                  <p className="text-sm text-[var(--muted-foreground)]">No teams found for this filter.</p>
                ) : (
                  visibleOptions.map((t) => {
                    const on = selected.includes(t.teamNumber);
                    const disabled = !on && selected.length >= RADAR_MAX_TEAMS;
                    return (
                      <Button
                        key={t.teamNumber}
                        variant={on ? "primary" : "outline"}
                        size="md"
                        className={cn("min-h-11 tabular-nums", disabled && "opacity-40")}
                        aria-pressed={on}
                        disabled={disabled}
                        onClick={() => toggle(t.teamNumber)}
                      >
                        {t.teamNumber}
                        <span className={cn("text-xs", on ? "opacity-80" : "text-[var(--muted-foreground)]")} aria-label={`${t.entryCount} entries`}>
                          {t.entryCount}
                        </span>
                      </Button>
                    );
                  })
                )}
              </div>
            </fieldset>
          </GlassPanel>

          {selected.length === 0 ? (
            <GlassPanel className="py-10 text-center text-sm text-[var(--muted-foreground)]">Pick a team above to generate its radar.</GlassPanel>
          ) : !statA ? (
            <GlassPanel className="py-10 text-center text-sm text-[var(--muted-foreground)]">No {CURRENT_GAME_ID} scouting data available for team {teamA} with these filters.</GlassPanel>
          ) : (
            <>
              <GlassPanel className="p-4">
                <RobotRadarChart rows={rows} teamA={statA.teamNumber} teamB={statB ? statB.teamNumber : null} />
                {(statA.ratings === 0 || (statB && statB.ratings === 0)) && (
                  <p className="mt-3 text-xs text-[var(--muted-foreground)]">
                    Agility reads 0 for a team with no Lead Scout rating in these events.
                  </p>
                )}
                {teamB !== null && !statB && <p className="mt-3 text-xs text-[var(--muted-foreground)]">No {CURRENT_GAME_ID} scouting data for team {teamB} with these filters, so it is drawn as zero.</p>}
              </GlassPanel>

              <GlassPanel className="p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-base font-semibold">Climb Reliability ({CURRENT_GAME_ID})</h3>
                  <span className="text-xs text-[var(--muted-foreground)]">Follows the Accuracy filter</span>
                </div>
                <ClimbBoxPlot boxes={boxes} />
              </GlassPanel>
            </>
          )}
        </>
      )}
    </div>
  );
}
