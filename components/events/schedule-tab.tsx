"use client";

import Link from "next/link";
import { QueryBoundary } from "@/components/events/query-boundary";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { getMatchesForEvent } from "@/lib/events/actions";
import { matchLabel, matchWinner, sortSchedule } from "@/lib/events/details-model";
import { useEventQuery } from "@/lib/events/use-event-query";
import { cn } from "@/lib/utils";
import type { FtcMatch, MatchType } from "@/lib/ftc/types";

function TeamList({ teams, side }: { teams: number[]; side: "red" | "blue" }) {
  return (
    <span className="flex flex-wrap gap-x-2">
      {teams.map((n) => (
        <Link
          key={n}
          href={`/analytics/teams/${n}`}
          className={cn("inline-flex min-h-11 items-center tabular-nums outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[rgba(var(--glow),0.5)]", side === "red" ? "text-red-300" : "text-blue-300")}
        >
          {n}
        </Link>
      ))}
    </span>
  );
}

function Score({ match, side }: { match: FtcMatch; side: "red" | "blue" }) {
  const score = side === "red" ? match.redScore : match.blueScore;
  if (!match.played || score === null) return <span className="text-[var(--muted-foreground)]">–</span>;
  const winner = matchWinner(match);
  return <span className={cn("tabular-nums", winner === side && "font-semibold")}>{score}</span>;
}

function MatchTable({ matches, caption }: { matches: FtcMatch[]; caption: string }) {
  return (
    <Table aria-label={caption}>
      <THead>
        <TR>
          <TH scope="col">Match</TH>
          <TH scope="col">Red</TH>
          <TH scope="col">Blue</TH>
          <TH scope="col">Score</TH>
        </TR>
      </THead>
      <TBody>
        {sortSchedule(matches).map((match) => (
          <TR key={match.id}>
            <TD className="whitespace-nowrap font-medium">{matchLabel(match)}</TD>
            <TD>
              <TeamList teams={match.redTeams} side="red" />
            </TD>
            <TD>
              <TeamList teams={match.blueTeams} side="blue" />
            </TD>
            <TD className="whitespace-nowrap">
              {match.played ? (
                <>
                  <Score match={match} side="red" /> <span className="text-[var(--muted-foreground)]">&ndash;</span> <Score match={match} side="blue" />
                </>
              ) : (
                <Badge variant="outline">Scheduled</Badge>
              )}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

function Section({ eventKey, season, type, title }: { eventKey: string; season: number; type: Extract<MatchType, "Qualification" | "Playoff">; title: string }) {
  const query = useEventQuery(`matches:${eventKey}:${season}:${type}`, () => getMatchesForEvent(eventKey, type, season));
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{title}</h3>
      <QueryBoundary query={query} what={`${title.toLowerCase()} matches`} empty={`${title} matches aren't scheduled yet.`}>
        <MatchTable matches={query.data ?? []} caption={`${title} matches`} />
      </QueryBoundary>
    </section>
  );
}

/** Qualification and playoff schedule with scores (CS shows a "coming soon" card here; the data comes from the event facade). */
export function ScheduleTab({ eventKey, season }: { eventKey: string; season: number }) {
  return (
    <div className="flex flex-col gap-8">
      <Section eventKey={eventKey} season={season} type="Qualification" title="Qualification" />
      <Section eventKey={eventKey} season={season} type="Playoff" title="Playoff" />
    </div>
  );
}
