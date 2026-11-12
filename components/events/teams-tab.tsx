"use client";

import { useEffect } from "react";
import Link from "@/components/program/link";
import { QueryBoundary } from "@/components/events/query-boundary";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { getTeamsForEvent } from "@/lib/events/actions";
import { sortTeams } from "@/lib/events/details-model";
import { useEventQuery } from "@/lib/events/use-event-query";
import { cn } from "@/lib/utils";

const teamLink = "inline-flex min-h-11 items-center rounded-md outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[rgba(var(--glow),0.5)]";

/** The event's team list (CS "Team List"). A `?team=` number is highlighted and scrolled into view. */
export function TeamsTab({ eventKey, season, highlighted }: { eventKey: string; season: number; highlighted: number | null }) {
  const query = useEventQuery(`teams:${eventKey}:${season}`, () => getTeamsForEvent(eventKey, season));
  const teams = query.data ? sortTeams(query.data) : [];

  const found = highlighted !== null && teams.some((t) => t.teamNumber === highlighted);
  useEffect(() => {
    if (!found) return;
    document.getElementById(`team-${highlighted}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [found, highlighted]);

  return (
    <QueryBoundary query={query} what="teams" empty="No teams returned for this event yet.">
      <Table aria-label="Teams at this event">
        <THead>
          <TR>
            <TH scope="col">Team</TH>
            <TH scope="col">Name</TH>
            <TH scope="col" className="hidden sm:table-cell">
              Location
            </TH>
          </TR>
        </THead>
        <TBody>
          {teams.map((team) => (
            <TR key={team.teamNumber} id={`team-${team.teamNumber}`} className={cn(highlighted === team.teamNumber && "bg-[rgba(var(--glow),0.18)]")}>
              <TD className="font-semibold tabular-nums">
                <Link href={`/analytics/teams/${team.teamNumber}`} className={teamLink}>
                  {team.teamNumber}
                </Link>
              </TD>
              <TD>
                <Link href={`/analytics/teams/${team.teamNumber}`} className={teamLink}>
                  {team.nameShort || team.nameFull || `Team ${team.teamNumber}`}
                </Link>
              </TD>
              <TD className="hidden text-[var(--muted-foreground)] sm:table-cell">{[team.city, team.stateProv].filter(Boolean).join(", ")}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </QueryBoundary>
  );
}
