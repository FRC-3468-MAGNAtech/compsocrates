"use client";

import { Suspense, useCallback, useMemo, useState } from "react";
import Link from "@/components/program/link";
import { AlertTriangle, FlaskConical } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { FiltersBar } from "@/components/scout-stats/filters-bar";
import { MyScoutingCard } from "@/components/scout-stats/my-scouting-card";
import { PlatformBadge } from "@/components/scout-stats/platform-badge";
import { Badge } from "@/components/ui/badge";
import { GameSelect } from "@/components/scout-stats/game-select";
import { useAuth } from "@/lib/auth";
import { useForms } from "@/lib/forms/forms-context";
import { usePathname, useSearchParams } from "@/lib/program/navigation";
import { useProgramConfig } from "@/lib/program/context";
import { filterByGame, readGameParam } from "@/lib/scout-stats/game-filter";
import { useActiveEvents } from "@/lib/active-event";
import { orderPrimaryFirst } from "@/lib/active-events";
import { useAssignments } from "@/lib/assignments";
import type { EventInfo } from "@/lib/events/types";
import { eventTitle } from "@/lib/events/names";
import { matchSortValue } from "@/lib/analytics/game-schema";
import { getPercentColor } from "@/lib/accuracy/engine";
import { computeScoutStats } from "@/lib/scout-stats/engine";
import { useRealEventOptions, useScoutStatsSources } from "@/lib/scout-stats/use-scout-stats";
import type { RankingBasisId, RealEventCalculationScope, ScoutCategory } from "@/lib/scout-stats/types";
import type { RoleId } from "@/lib/roles";

const CATEGORIES: ScoutCategory[] = ["trial", "competitive", "real-event"];

/** One active event's "my upcoming assignments" — its own component because the assignments subscription is a hook, and a team can now have several active events. */
function UpcomingAssignmentsPanel({ teamId, uid, event }: { teamId: string | null; uid: string; event: EventInfo }) {
  const { assignments } = useAssignments(teamId, event.code);
  const mine = !assignments?.current
    ? []
    : assignments.current.slots.filter((s) => s.scoutUid === uid).sort((a, b) => matchSortValue(a) - matchSortValue(b));

  return (
    <GlassPanel className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">My upcoming assignments &mdash; {eventTitle(event)}</h2>
      {mine.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">No assignments yet for this event.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {mine.map((s, i) => (
            <div key={i} className="glass-card flex items-center gap-3 p-3 text-sm">
              <Badge variant="glass" className="font-mono">
                {s.matchType} {s.matchNumber}
              </Badge>
              <span>Team {s.teamNumber}</span>
              <span className="text-[var(--muted-foreground)]">{s.slot}</span>
            </div>
          ))}
        </div>
      )}
    </GlassPanel>
  );
}

// useSearchParams (the selected game lives in the URL, like Analytics' filters) needs a Suspense boundary so the page can still be prerendered.
export default function MyScoutingPage() {
  return (
    <Suspense fallback={<div className="glass-card h-64 animate-pulse" />}>
      <MyScoutingContent />
    </Suspense>
  );
}

function MyScoutingContent() {
  const { user, profile } = useAuth();
  const teamId = profile?.teamId ?? null;
  // Cross-event page: its stats read every selected event, archived ones included (archiving only affects event pickers).
  const { allEvents: activeEvents, storedPrimaryCode: primaryCode, events: pickerEvents, primaryCode: pickerPrimaryCode } = useActiveEvents();
  const orderedActiveEvents = useMemo(() => orderPrimaryFirst({ events: activeEvents, primaryCode }), [activeEvents, primaryCode]);
  // The upcoming-assignments panels are per event (Assignments is an event picker), so they skip archived events.
  const assignmentEvents = useMemo(() => orderPrimaryFirst({ events: pickerEvents, primaryCode: pickerPrimaryCode }), [pickerEvents, pickerPrimaryCode]);

  // Game select: the program's games, the current one by default, kept in the URL (`?game=`; `all` = every game).
  const { seasons, defaultSeasonId } = useForms();
  const { event: eventRules } = useProgramConfig();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const seasonIds = useMemo(() => seasons.map((s) => s.id), [seasons]);
  const seasonId = readGameParam(searchParams.get("game"), seasonIds, defaultSeasonId);
  const fallbackSeasonId = eventRules.unspecifiedGameId && seasonIds.includes(eventRules.unspecifiedGameId) ? eventRules.unspecifiedGameId : defaultSeasonId;
  const setSeasonId = useCallback(
    (next: string) => {
      const params = new URLSearchParams(queryString);
      params.set("game", next === "" ? "all" : next);
      window.history.replaceState(null, "", `${pathname}?${params.toString()}`);
    },
    [pathname, queryString]
  );
  const gameName = seasons.find((s) => s.id === seasonId)?.name ?? "";

  const [roleFilter, setRoleFilter] = useState<RoleId[]>([]);
  const [eventFilter, setEventFilter] = useState<string[]>([]);
  const [rankingBasis, setRankingBasis] = useState<RankingBasisId>("preserve");
  const [realEventScope, setRealEventScope] = useState<RealEventCalculationScope>({ eventCode: null, variant: "plain" });

  const rawSources = useScoutStatsSources(teamId);
  // Entries and sessions of the selected game; one without a `game` field counts as the program's unspecified game (FRC: REEFSCAPE, as old CS did).
  const sources = useMemo(() => {
    const options = { seasonId, seasonIds, fallbackSeasonId };
    return {
      ...rawSources,
      entries: filterByGame(rawSources.entries, (e) => e.game, options),
      sessions: filterByGame(rawSources.sessions, (s) => (s as { game?: unknown }).game, options),
    };
  }, [rawSources, seasonId, seasonIds, fallbackSeasonId]);
  const eventOptions = useRealEventOptions(sources.entries, orderedActiveEvents);

  // Derived (not effect-corrected — see the matching comment in
  // app/(app)/scout-accuracy/page.tsx) so turning a filter back on restores
  // the user's last ranking-basis choice instead of forgetting it.
  const roleActive = roleFilter.length > 0;
  const eventActive = eventFilter.length > 0;
  const effectiveRankingBasis: RankingBasisId =
    (rankingBasis === "role" && !roleActive) ||
    (rankingBasis === "event" && !eventActive) ||
    (rankingBasis === "both" && !(roleActive && eventActive))
      ? "preserve"
      : rankingBasis;

  const resultsByCategory = useMemo(() => {
    if (!sources.loaded) return null;
    const results: Record<ScoutCategory, ReturnType<typeof computeScoutStats>> = {} as never;
    for (const category of CATEGORIES) {
      results[category] = computeScoutStats({
        category,
        members: sources.members,
        sessions: sources.sessions,
        entries: sources.entries,
        libraryMatchesById: sources.libraryMatchesById,
        attendance: sources.attendance,
        roleFilter,
        eventFilter,
        rankingBasis: effectiveRankingBasis,
        realEventScope,
        seasonId: seasonId || null,
      });
    }
    return results;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sources.loaded,
    sources.members,
    sources.sessions,
    sources.entries,
    sources.libraryMatchesById,
    sources.attendance,
    roleFilter,
    eventFilter,
    effectiveRankingBasis,
    realEventScope.eventCode,
    realEventScope.variant,
    seasonId,
  ]);

  const recentSessions = useMemo(() => {
    if (!resultsByCategory || !user) return [];
    const trial = resultsByCategory.trial.detailsByUid.get(user.uid)?.recentPracticeSessions ?? [];
    const competitive = resultsByCategory.competitive.detailsByUid.get(user.uid)?.recentPracticeSessions ?? [];
    return [...trial, ...competitive].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).slice(0, 8);
  }, [resultsByCategory, user]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My Scouting</h1>
          <p className="text-sm text-[var(--muted-foreground)]">Your own accuracy, activity, and rank across every category.</p>
        </div>
        <Link href="/practice-scouting">
          <Button className="gap-2">
            <FlaskConical className="h-4 w-4" /> Start Practice Scouting
          </Button>
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <GameSelect id="my-scouting-game" value={seasonId} onChange={setSeasonId} seasons={seasons} />
      </div>

      {rawSources.sessionsError && (
        <GlassPanel role="alert" className="flex flex-col gap-1 text-sm" data-testid="my-scouting-error">
          <div className="font-semibold">{rawSources.sessionsError.context}</div>
          <div className="text-[var(--muted-foreground)]">
            {rawSources.sessionsError.code}: {rawSources.sessionsError.message}
            {rawSources.sessionsError.path ? ` (${rawSources.sessionsError.path})` : ""}. Your practice numbers below may be incomplete.
          </div>
        </GlassPanel>
      )}

      {!resultsByCategory || !user ? (
        <div className="glass-card h-64 animate-pulse" />
      ) : (
        <>
          {sources.entries.length === 0 && sources.sessions.length === 0 && (
            <GlassPanel className="py-8 text-center text-sm text-[var(--muted-foreground)]" data-testid="my-scouting-empty">
              {seasonId ? `No ${gameName} entries yet` : "No entries yet"}
            </GlassPanel>
          )}
          <FiltersBar
            category="real-event"
            roleFilter={roleFilter}
            onRoleFilterChange={setRoleFilter}
            eventOptions={eventOptions}
            eventFilter={eventFilter}
            onEventFilterChange={setEventFilter}
            rankingBasis={effectiveRankingBasis}
            onRankingBasisChange={setRankingBasis}
            realEventScope={realEventScope}
            onRealEventScopeChange={setRealEventScope}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {CATEGORIES.map((category, i) => {
              const detail = resultsByCategory[category].detailsByUid.get(user.uid);
              if (!detail) return null;
              const rank = resultsByCategory[category].rows.find((r) => r.uid === user.uid)?.rank ?? null;
              return <MyScoutingCard key={category} category={category} detail={detail} rank={rank} index={i} />;
            })}
          </div>

          {assignmentEvents.map((event) => (
            <UpcomingAssignmentsPanel key={event.code} teamId={teamId} uid={user.uid} event={event} />
          ))}

          <GlassPanel className="flex flex-col gap-3">
            <h2 className="text-base font-semibold">Recent practice sessions</h2>
            {recentSessions.length === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)]">No practice sessions yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {recentSessions.map((s) => (
                  <div key={s.sessionId} className={`glass-card flex flex-wrap items-center gap-2 p-3 ${s.excluded ? "opacity-60" : ""}`}>
                    <span className="font-mono text-xs text-[var(--muted-foreground)]">{s.matchLabel}</span>
                    <span className="font-mono text-[11px] text-[var(--muted-foreground)]">{s.sessionId}</span>
                    <PlatformBadge platform={s.platform} />
                    {s.activeFlags.map((f) => (
                      <span key={f.type} className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300" title={f.detail}>
                        <AlertTriangle className="h-3 w-3" /> {f.title}
                      </span>
                    ))}
                    <span className={`ml-auto font-semibold tabular-nums ${s.excluded ? "line-through text-[var(--muted-foreground)]" : s.accuracy !== null ? getPercentColor(s.accuracy) : ""}`}>
                      {s.accuracy === null ? "?" : `${Math.round(s.accuracy)}%`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </GlassPanel>
        </>
      )}
    </div>
  );
}
