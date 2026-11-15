"use client";

import { useMemo } from "react";
import { ReliabilityPill } from "@/components/analytics/reliability-pill";
import { Widget } from "@/components/dashboard/widget";
import { KeyNumber, teamHref } from "@/components/dashboard/shared";
import { BookOpen, Check, Medal, Star } from "lucide-react";
import { useDashboard } from "@/lib/dashboard/data";
import { useJudgeBookSession } from "@/lib/judge-book/use-judge-book-session";
import { usePageAccess } from "@/lib/page-access/store";
import { useProgramConfig } from "@/lib/program/context";
import { strengthBullets } from "@/lib/dashboard/insights";
import { formatRecord } from "@/lib/dashboard/schedule";

/** Our team on one card: official rank and record, average scored, and reliability. */
export function TeamSummaryWidget() {
  const d = useDashboard();
  const stats = d.ourStats;

  return (
    <Widget
      title="Our team summary"
      icon={Medal}
      size="medium"
      status={d.first.loading || !d.entriesLoaded ? "loading" : "ready"}
      href={d.ourNumber !== null ? teamHref(d.ourNumber, d.event?.code ?? null) : undefined}
      linkLabel="Our team profile"
    >
      <div className="grid grid-cols-3 gap-3">
        <KeyNumber label="Rank" value={d.ourRanking ? `#${d.ourRanking.rank}` : "-"} />
        <KeyNumber label="Record" value={formatRecord(d.record)} />
        <KeyNumber label="Avg scored" value={stats ? stats.avgTotal.toFixed(1) : "-"} hint={stats ? `${stats.entryCount} scouted` : "Not scouted yet"} />
      </div>
      {stats && <div className="flex flex-wrap items-center gap-2"><ReliabilityPill team={stats} schema={d.schema} /></div>}
    </Widget>
  );
}

/** Talking points generated from our own numbers — each one appears only while it's true. */
export function StrengthBulletsWidget() {
  const d = useDashboard();
  const bullets = useMemo(
    () => strengthBullets({ stats: d.ourStats, schema: d.schema, scoutedRank: d.ourScoutedRank, fieldSize: d.fieldSize, officialRank: d.ourRanking?.rank ?? null, record: d.record }),
    [d.ourStats, d.schema, d.ourScoutedRank, d.fieldSize, d.ourRanking, d.record]
  );

  return (
    <Widget
      title="Our strengths"
      icon={Star}
      size="medium"
      status={d.first.loading || !d.entriesLoaded ? "loading" : bullets.length === 0 ? "empty" : "ready"}
      href={d.ourNumber !== null ? teamHref(d.ourNumber, d.event?.code ?? null) : undefined}
      linkLabel="Our team profile"
      emptyText="Strengths appear here as more of our matches are scouted and results come in."
    >
      <ul className="flex flex-col gap-1.5">
        {bullets.map((b) => (
          <li key={b} className="flex items-start gap-2 text-sm">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </Widget>
  );
}

/**
 * Judge Awards dashboard: points at the Judge Book (replaces the old "Judging notes" placeholder). Only for a program that has the page: one that lists
 * `/judge-book` among its unavailable paths renders nothing and never touches the Judge Book data. Also nothing for someone who cannot open the
 * page (page access, id "judge-book"), so the card is never a dead link.
 */
export function JudgeBookWidget() {
  const program = useProgramConfig();
  const access = usePageAccess();
  if (program.unavailablePaths.includes("/judge-book") || !access.can("judge-book")) return null;
  return <JudgeBookCard />;
}

/** Mounted only when the viewer may open the Judge Book, so its live read is never started otherwise. */
function JudgeBookCard() {
  const { cards, loaded, error } = useJudgeBookSession();
  const latest = useMemo(() => [...cards].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3), [cards]);

  return (
    <Widget
      title="Judge Book"
      icon={BookOpen}
      size="small"
      status={error ? "error" : !loaded ? "loading" : cards.length === 0 ? "empty" : "ready"}
      href="/judge-book"
      linkLabel="Open Judge Book"
      emptyText="No cards yet. Open the Judge Book to add the questions judges ask and your answers."
    >
      <p className="text-sm text-[var(--muted-foreground)]">Your team&apos;s questions and answers for judging, in one place.</p>
      <KeyNumber label="Cards" value={String(cards.length)} />
      {latest.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {latest.map((c) => (
            <li key={c.id} className="truncate">
              {c.prompt}
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}
