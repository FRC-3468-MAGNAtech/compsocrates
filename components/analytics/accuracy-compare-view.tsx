"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { AnalyticsLink } from "@/components/analytics/analytics-link";
import { Badge } from "@/components/ui/badge";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Shimmer } from "@/components/ui/shimmer";
import { Switch } from "@/components/ui/switch";
import { normalizeEventKey } from "@/config/event";
import { normalizeCsMatchId } from "@/data/cs/match-id";
import { useAnalyticsData } from "@/lib/analytics/data-context";
import { formatMatchIdLong } from "@/lib/analytics/cs-docs";
import { buildMatchComparison, type TeamComparison } from "@/lib/analytics/rescout-compare";
import { useAccuracyRescouts } from "@/lib/analytics/use-accuracy-rescouts";
import { useAuth } from "@/lib/auth";
import type { PhaseScore, RescoutField } from "@/lib/games/types";
import { cn } from "@/lib/utils";

/** "level-2" / "outpost_side" to "Level 2" / "Outpost Side"; empty and zero-ish values to a dash (CS `toDisplayTitle`). */
function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function formatFieldValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length === 0 ? "-" : value.map((v) => (typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v))).join(", ");
  if (typeof value === "number") return String(value);
  const raw = String(value ?? "").trim();
  return raw === "" ? "-" : titleCase(raw);
}

export function AccuracyCompareView() {
  const params = useSearchParams();
  const { profile } = useAuth();
  const data = useAnalyticsData();
  const { rescouts, loaded: rescoutsLoaded, error } = useAccuracyRescouts(profile?.teamId ?? null);

  const eventKey = normalizeEventKey((params.get("eventKey") ?? "").trim());
  const matchKey = normalizeCsMatchId((params.get("matchKey") ?? "").trim());
  const alliance = (params.get("alliance") ?? "").toLowerCase() === "blue" ? "blue" : "red";

  const comparison = useMemo(() => (eventKey && matchKey ? buildMatchComparison({ entries: data.allEntries, rescouts, eventKey, matchKey, alliance }) : null), [data.allEntries, rescouts, eventKey, matchKey, alliance]);
  const back = (
    <AnalyticsLink href="/analytics/accuracy-verification" className="glass-pill mt-4 inline-flex min-h-11 items-center rounded-full px-5 text-sm font-medium">
      Back to Accuracy Verification
    </AnalyticsLink>
  );

  if (!eventKey || !matchKey) {
    return (
      <GlassPanel className="p-6">
        <p className="text-[var(--muted-foreground)]">Missing match details for comparison.</p>
        {back}
      </GlassPanel>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <GlassPanel className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Accuracy Comparison</h2>
            <p className="text-sm text-[var(--muted-foreground)]">
              {eventKey.toUpperCase()} · {formatMatchIdLong(matchKey)} · {alliance === "red" ? "Red" : "Blue"} Alliance
            </p>
          </div>
          {comparison && comparison.summaryPercent !== null && <Badge variant="glass" className="px-4 py-2 text-sm font-semibold">Line-by-line diff: {comparison.summaryPercent}%</Badge>}
        </div>
      </GlassPanel>

      {error && (
        <GlassPanel className="flex items-start gap-3 py-4 text-sm" role="alert">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden />
          <span>Re-scout data could not be loaded, so only the original scouting is shown.</span>
        </GlassPanel>
      )}

      {!data.loaded || !rescoutsLoaded ? (
        <div aria-busy="true" aria-label="Loading comparison" className="flex flex-col gap-3">
          <Shimmer className="h-40" />
          <Shimmer className="h-64" />
        </div>
      ) : !comparison || comparison.teams.length === 0 ? (
        <GlassPanel className="py-10 text-center text-sm text-[var(--muted-foreground)]">No rescout data available for this match yet.</GlassPanel>
      ) : (
        <ul className="flex flex-col gap-4">
          {comparison.teams.map((team) => (
            <li key={team.teamNumber}>
              <TeamCard team={team} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ScoreLine({ score }: { score: PhaseScore | null }) {
  if (!score) return <span className="text-[var(--muted-foreground)]">-</span>;
  return (
    <span className="tabular-nums">
      Auto {score.auto} · Teleop {score.teleop} · Endgame {score.endgame} · <strong>Total {score.total}</strong>
    </span>
  );
}

function EntryColumn({ label, entry, score }: { label: string; entry: TeamComparison["original"]; score: PhaseScore | null }) {
  return (
    <div className="min-w-0 rounded-2xl border border-[var(--glass-border)] p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{label}</p>
      {entry ? (
        <dl className="mt-1 flex flex-col gap-1 text-sm">
          <div>
            <dt className="sr-only">Scout</dt>
            <dd className="font-medium">{entry.scoutName || "-"}</dd>
          </div>
          <div>
            <dt className="sr-only">Score</dt>
            <dd>
              <ScoreLine score={score} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--muted-foreground)]">Comments</dt>
            <dd className="whitespace-pre-wrap break-words text-[var(--muted-foreground)]">{entry.comments.trim() || "-"}</dd>
          </div>
        </dl>
      ) : (
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">Not available yet.</p>
      )}
    </div>
  );
}

function TeamCard({ team }: { team: TeamComparison }) {
  const [differencesOnly, setDifferencesOnly] = useState(false);
  const fields: RescoutField[] = team.diff?.fields ?? [];
  const shown = differencesOnly ? fields.filter((f) => f.diff > 0) : fields;
  const switchId = `diff-only-${team.teamNumber}`;

  return (
    <GlassPanel className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">
          {team.robotLabel} · Team <span className="tabular-nums">{team.teamNumber}</span>
        </h3>
        {team.diff && <Badge variant={team.diff.diffPercent > 5 ? "warning" : "success"}>Diff {team.diff.diffPercent}%</Badge>}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <EntryColumn label="OG scout" entry={team.original} score={team.originalScore} />
        <EntryColumn label="Exemplar" entry={team.exemplar} score={team.exemplarScore} />
      </div>

      {team.diff ? (
        <div className="mt-4">
          <div className="mb-2 flex min-h-11 items-center gap-3">
            <Switch id={switchId} checked={differencesOnly} onCheckedChange={setDifferencesOnly} aria-label={`Show only the fields that differ for team ${team.teamNumber}`} />
            <label htmlFor={switchId} className="text-sm">
              Differences only
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[26rem] text-sm">
              <caption className="sr-only">Field by field comparison for team {team.teamNumber}</caption>
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                  <th scope="col" className="px-3 py-2 font-medium">
                    Field
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    OG scout
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Exemplar
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Diff
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center text-[var(--muted-foreground)]">
                      The two scouts agree on every field.
                    </td>
                  </tr>
                ) : (
                  shown.map((f) => (
                    <tr key={f.key} className={cn("border-t border-[var(--glass-border)]", f.diff > 0 && "bg-[rgba(var(--glow),0.1)]")}>
                      <th scope="row" className="px-3 py-2 text-left font-normal">
                        {f.label}
                      </th>
                      <td className="px-3 py-2 tabular-nums">{formatFieldValue(f.original)}</td>
                      <td className="px-3 py-2 tabular-nums">{formatFieldValue(f.exemplar)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{f.diff > 0 ? <span className="font-semibold">Differs ({Math.round(f.diff * 100)}%)</span> : <span className="text-[var(--muted-foreground)]">Same</span>}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-[var(--muted-foreground)]">{team.original && team.exemplar ? "These entries are from a game that cannot be compared field by field." : "A field comparison needs both the original and the exemplar entry."}</p>
      )}
    </GlassPanel>
  );
}
