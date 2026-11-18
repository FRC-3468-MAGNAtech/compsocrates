"use client";

import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Progress } from "@/components/ui/progress";
import { Shimmer } from "@/components/ui/shimmer";
import { DAILY_FREE_READS, displayKey, type Source } from "@/lib/read-meter/model";
import { useReadUsage } from "@/lib/read-meter/usage-client";

/**
 * Admin Panel > Read usage (platform owner only, the same tab in every program): documents read today and over the last 14 days, by page, by collection and the
 * ten biggest sources, against the 50,000-reads-a-day free allowance. Reading it costs at most about 15 document reads (one per day) and happens only when the
 * tab opens or on Refresh. The owner is checked on the server.
 */
export function ReadUsagePanel() {
  const { state, error, loading, refresh } = useReadUsage();
  const today = state?.summary.today;
  return (
    <div className="space-y-4">
      <GlassPanel className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Read usage</h2>
          <Button size="sm" variant="outline" onClick={refresh} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </Button>
        </div>
        <p className="flex gap-2 text-sm text-[var(--muted-foreground)]">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            Counts documents returned to the app by page loads and live lists (what the browsers and the listed server routes read), by Pacific-time day. It does NOT see the reads Firestore
            bills for evaluating security rules, so the Firebase console&apos;s Usage number will be higher: compare the two. Reading this tab costs about 15 reads.
          </span>
        </p>
        {error && <p className="text-sm text-red-400">{error}</p>}
        {!error && loading && !state && <Shimmer className="h-24" />}
        {state && !state.enabled && (
          <p className="rounded-xl border border-[var(--border)] p-3 text-sm">
            The meter is OFF, so nothing new is being counted. To turn it on, create the field <strong>readMeterEnabled</strong> (boolean, <strong>true</strong>) on the document{" "}
            <strong>appSettings/global</strong> in the Firestore console. Browsers pick it up within a minute or so.
          </p>
        )}
        {today && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-2xl font-semibold tabular-nums">{today.total.toLocaleString("en-US")}</span>
              <span className="text-sm text-[var(--muted-foreground)]">
                reads today ({today.day}) of {DAILY_FREE_READS.toLocaleString("en-US")} free · browsers {today.client.toLocaleString("en-US")} · server routes {today.server.toLocaleString("en-US")}
              </span>
            </div>
            <Progress value={today.total} max={DAILY_FREE_READS} label="Reads today against the free daily limit" valueText={`${today.total} of ${DAILY_FREE_READS} reads`} done={false} />
          </div>
        )}
      </GlassPanel>

      {state && (
        <>
          <GlassPanel className="space-y-2">
            <h3 className="font-semibold">Last 14 days</h3>
            <ul className="divide-y divide-[var(--border)] text-sm">
              {state.summary.days.map((d) => (
                <li key={d.day} className="flex justify-between gap-3 py-1.5 tabular-nums">
                  <span>{d.day}</span>
                  <span>{d.total.toLocaleString("en-US")}</span>
                </li>
              ))}
            </ul>
          </GlassPanel>
          <div className="grid gap-4 md:grid-cols-2">
            <SourceList title="Today by page" rows={state.summary.byPage} />
            <SourceList title="Today by collection" rows={state.summary.byCollection} />
          </div>
          <SourceList title="Top 10 sources today (page > collection)" rows={state.summary.top} />
        </>
      )}
    </div>
  );
}

function SourceList({ title, rows }: { title: string; rows: Source[] }) {
  return (
    <GlassPanel className="space-y-2">
      <h3 className="font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">Nothing counted today.</p>
      ) : (
        <ul className="divide-y divide-[var(--border)] text-sm">
          {rows.slice(0, 15).map((r) => (
            <li key={r.source} className="flex justify-between gap-3 py-1.5">
              <span className="min-w-0 break-words">{displayKey(r.source)}</span>
              <span className="shrink-0 tabular-nums">{r.docs.toLocaleString("en-US")}</span>
            </li>
          ))}
        </ul>
      )}
    </GlassPanel>
  );
}
