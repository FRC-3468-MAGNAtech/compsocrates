"use client";

import Link from "@/components/program/link";
import { QueryBoundary } from "@/components/events/query-boundary";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { getRankingsForEvent, getTeamsForEvent } from "@/lib/events/actions";
import { recordLabel, sortRankings, teamNameMap } from "@/lib/events/details-model";
import { useEventQuery } from "@/lib/events/use-event-query";

/** Official qualification rankings, with team names from the team list when it has loaded. */
export function RankingsTab({ eventKey, season }: { eventKey: string; season: number }) {
  const query = useEventQuery(`rankings:${eventKey}:${season}`, () => getRankingsForEvent(eventKey, season));
  const teams = useEventQuery(`teams:${eventKey}:${season}`, () => getTeamsForEvent(eventKey, season));
  const names = teamNameMap(teams.data ?? []);
  const rows = query.data ? sortRankings(query.data) : [];

  return (
    <QueryBoundary query={query} what="rankings" empty="No rankings yet. They appear once qualification matches have been played.">
      <Table aria-label="Qualification rankings">
        <THead>
          <TR>
            <TH scope="col">Rank</TH>
            <TH scope="col">Team</TH>
            <TH scope="col">W-L-T</TH>
            <TH scope="col" className="hidden sm:table-cell">
              Played
            </TH>
            <TH scope="col">RP</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((row) => (
            <TR key={row.teamNumber}>
              <TD className="font-semibold tabular-nums">{row.rank}</TD>
              <TD>
                <Link
                  href={`/analytics/teams/${row.teamNumber}`}
                  className="inline-flex min-h-11 items-center rounded-md outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[rgba(var(--glow),0.5)]"
                >
                  <span className="font-semibold tabular-nums">{row.teamNumber}</span>
                  {names.get(row.teamNumber) && <span className="ml-2 text-[var(--muted-foreground)]">{names.get(row.teamNumber)}</span>}
                </Link>
              </TD>
              <TD className="tabular-nums">{recordLabel(row)}</TD>
              <TD className="hidden tabular-nums sm:table-cell">{row.matchesPlayed}</TD>
              <TD className="tabular-nums">{row.rankingPoints ?? "–"}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </QueryBoundary>
  );
}
