"use client";

import { useState } from "react";
import { AnalyticsLink } from "@/components/analytics/analytics-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { SECTION_PREVIEW, type AllianceGroup, type HighAccuracyMatch } from "@/lib/analytics/accuracy-verification";
import type { Rescout, RescoutAlliance } from "@/lib/analytics/rescouts";
import { EventName } from "@/components/events/event-name";
import { cn } from "@/lib/utils";

/** A titled list that shows the first few rows and a View all / View less toggle (CS `SectionCard`). */
export function SectionCard<T>({ title, description, items, empty, children }: { title: string; description?: string; items: readonly T[]; empty: string; children: (visible: T[]) => React.ReactNode }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? [...items] : items.slice(0, SECTION_PREVIEW);
  return (
    <GlassPanel className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{title}</h3>
          {description && <p className="mt-1 text-sm text-[var(--muted-foreground)]">{description}</p>}
        </div>
        {items.length > SECTION_PREVIEW && (
          <Button variant="outline" size="md" className="min-h-11 shrink-0" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
            {showAll ? "View less" : "View all"}
          </Button>
        )}
      </div>
      {items.length === 0 ? <p className="mt-4 text-sm text-[var(--muted-foreground)]">{empty}</p> : <div className="mt-4 flex flex-col gap-3">{children(visible)}</div>}
    </GlassPanel>
  );
}

export function CompareLink({ eventKey, matchKey, alliance }: { eventKey: string; matchKey: string; alliance: RescoutAlliance }) {
  return (
    <AnalyticsLink
      href="/analytics/accuracy-compare"
      params={{ eventKey, matchKey, alliance }}
      className="glass-pill mt-2 inline-flex min-h-11 items-center rounded-full px-4 text-xs font-medium"
    >
      Compare
    </AnalyticsLink>
  );
}

/** One re-scout request: match, robot, event, scout, status and accuracy, with a Compare link once its alliance is fully re-scouted. */
export function RescoutRow({ row, showScout, complete, onDelete }: { row: Rescout; showScout?: boolean; complete: boolean; onDelete?: (row: Rescout) => void }) {
  return (
    <div className="rounded-2xl border border-[var(--glass-border)] p-3">
      <p className="font-semibold">
        {row.matchLabel || "Match"} - Team {row.teamNumber || "-"}
      </p>
      <p className="text-xs text-[var(--muted-foreground)]">
        {row.eventKey ? <EventName eventKey={row.eventKey} name={row.eventName} /> : row.eventName || "Event"} - {showScout ? `${row.scoutName || "Scout"} - ` : ""}
        {row.status || "pending"}
      </p>
      <p className="text-xs text-[var(--muted-foreground)]">Rescout Accuracy: {row.accuracy !== null ? `${row.accuracy}%` : "-"}</p>
      <div className="flex flex-wrap items-center gap-2">
        {complete && row.eventKey && row.matchKey && row.alliance && <CompareLink eventKey={row.eventKey} matchKey={row.matchKey} alliance={row.alliance} />}
        {onDelete && (
          <Button variant="outline" size="md" className="mt-2 min-h-11 border-red-400/40 text-red-300" onClick={() => onDelete(row)}>
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}

function AllianceBox({ match, alliance, complete, rescoutAccuracy, onRescout }: { match: HighAccuracyMatch; alliance: AllianceGroup; complete: boolean; rescoutAccuracy: number | null; onRescout: (match: HighAccuracyMatch, alliance: AllianceGroup) => void }) {
  return (
    <div className="rounded-2xl bg-white/5 p-3">
      <p className="text-sm font-semibold">
        <span aria-hidden className={cn("mr-2 inline-block h-2.5 w-2.5 rounded-full", alliance.alliance === "red" ? "bg-red-400" : "bg-blue-400")} />
        {alliance.alliance === "red" ? "Red Alliance" : "Blue Alliance"} - Accuracy {alliance.accuracy ?? "-"}%
      </p>
      <p className="text-xs text-[var(--muted-foreground)]">Scouts: {alliance.scouts.join(", ") || "Unknown"}</p>
      <p className="text-xs text-[var(--muted-foreground)]">Teams: {alliance.teams.join(", ") || "-"}</p>
      {complete && (
        <>
          <p className="mt-2 text-xs text-[var(--muted-foreground)]">Rescout Accuracy: {rescoutAccuracy !== null ? `${rescoutAccuracy}%` : "-"}</p>
          <CompareLink eventKey={match.eventKey} matchKey={match.matchKey} alliance={alliance.alliance} />
        </>
      )}
      <div>
        <Button size="md" className="mt-2 min-h-11" onClick={() => onRescout(match, alliance)} aria-label={`Re-scout the ${alliance.alliance} alliance of ${match.matchLabel}`}>
          Re-scout
        </Button>
      </div>
    </div>
  );
}

export function HighAccuracyCard({ match, isComplete, accuracyOf, onRescout }: { match: HighAccuracyMatch; isComplete: (match: HighAccuracyMatch, alliance: RescoutAlliance) => boolean; accuracyOf: (match: HighAccuracyMatch, alliance: RescoutAlliance) => number | null; onRescout: (match: HighAccuracyMatch, alliance: AllianceGroup) => void }) {
  return (
    <div className="rounded-2xl border border-[var(--glass-border)] p-4">
      <div className="mb-3">
        <p className="font-semibold">{match.eventName}</p>
        <p className="text-sm text-[var(--muted-foreground)]">{match.matchLabel}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {match.alliances.map((alliance) => (
          <AllianceBox key={alliance.alliance} match={match} alliance={alliance} complete={isComplete(match, alliance.alliance)} rescoutAccuracy={accuracyOf(match, alliance.alliance)} onRescout={onRescout} />
        ))}
      </div>
    </div>
  );
}

export function VerifiedBadge({ verified, accuracy }: { verified: boolean; accuracy: number }) {
  return (
    <Badge variant={verified ? "success" : "warning"} className="px-3 py-1 font-semibold">
      {verified ? "Verified" : "Review"} / {accuracy}%
    </Badge>
  );
}
