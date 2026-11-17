"use client";

import { Badge } from "@/components/ui/badge";
import { DIFFICULTY_CLASSNAMES, DIFFICULTY_LABELS } from "@/lib/difficulty";
import type { LibraryAlliance } from "@/lib/match-library";
import { cn } from "@/lib/utils";

/** One alliance in a match table: its teams, then its score, penalty points and difficulty. No official score yet reads "No score", never 0. */
export function AllianceCell({ side, alliance }: { side: "red" | "blue"; alliance: LibraryAlliance }) {
  return (
    <div className={cn("flex flex-col gap-1", side === "red" ? "text-red-300" : "text-blue-300")}>
      <span className="font-mono text-xs">{alliance.teams.length > 0 ? alliance.teams.join(" & ") : "TBD"}</span>
      {alliance.scoreKnown === false ? (
        <span className="text-xs text-[var(--muted-foreground)]">No score</span>
      ) : (
        <span className="flex items-center gap-1.5">
          {alliance.score}
          {alliance.penaltyPoints > 0 && <span className="text-[10px] text-[var(--muted-foreground)]">({alliance.penaltyPoints} pen.)</span>}
          <Badge className={DIFFICULTY_CLASSNAMES[alliance.difficulty]}>{DIFFICULTY_LABELS[alliance.difficulty]}</Badge>
        </span>
      )}
    </div>
  );
}
