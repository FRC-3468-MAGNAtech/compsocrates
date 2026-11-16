"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { GitCommitVertical, Search, X } from "lucide-react";
import { EntryCard } from "@/components/changelog/entry-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Shimmer } from "@/components/ui/shimmer";
import { Switch } from "@/components/ui/switch";
import { CHANGE_TYPES, type ChangeType } from "@/lib/changelog";
import { useAuth } from "@/lib/auth";
import { markChangelogSeen, usePlatformFeed } from "@/lib/platform-changelog/client";
import { countByCategory, entriesForProgram, filterPlatformEntries, latestVisiblePublishedMs } from "@/lib/platform-changelog/model";
import { PROGRAMS } from "@/config/programs";
import { useProgram } from "@/lib/program/context";
import { useProgramData } from "@/lib/program/data";
import { cn } from "@/lib/utils";

// ONE changelog for the whole site (Session 7): the same page and the same feed in every program. The default view shows the items tagged for the
// current program plus the ones tagged for every program; "Show all programs" shows everything with a small program badge on the items that are not
// for everyone. Entries are written by the platform owner (Admin Panel > Changelog), never per team. No team is needed to open this page.

export default function ChangelogPage() {
  const { user, profile } = useAuth();
  const program = useProgram();
  const port = useProgramData();
  const { entries, loaded, error: loadError, reload } = usePlatformFeed();

  const [showAll, setShowAll] = useState(false);
  const [types, setTypes] = useState<ChangeType[]>([]);
  const [query, setQuery] = useState("");
  // Per-card open/closed choices the reader has made; anything not here follows the default below.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  // Opening the page clears the nav dot (and so does something new being published while you look). Same write as before; skipped for an account
  // with no profile in this program (it has no user document to stamp, and no dot either).
  const latest = useMemo(() => latestVisiblePublishedMs(entries, program), [entries, program]);
  const stampedFor = useRef<number | null | undefined>(undefined);
  const uid = user?.uid ?? null;
  const hasProfile = profile !== null && profile !== undefined;
  const [seenError, setSeenError] = useState<string | null>(null);
  useEffect(() => {
    if (!uid || !hasProfile || !loaded || loadError || stampedFor.current === latest) return;
    stampedFor.current = latest;
    markChangelogSeen(uid, port).then(
      () => setSeenError(null),
      (err: unknown) => setSeenError(err instanceof Error ? err.message : "Couldn't record the changelog visit.")
    );
  }, [uid, hasProfile, loaded, loadError, latest, port]);

  const scoped = useMemo(() => entriesForProgram(entries, showAll ? null : program), [entries, showAll, program]);
  const filterActive = types.length > 0 || query.trim() !== "";
  const shown = useMemo(() => filterPlatformEntries(scoped, { types, query }), [scoped, types, query]);
  const current = shown.filter((e) => !e.legacy);
  const legacy = shown.filter((e) => e.legacy);
  const counts = useMemo(() => countByCategory(scoped), [scoped]);
  // The newest two current entries start open; while filtering or searching every match opens so the hit is visible. Legacy entries start closed.
  const defaultOpen = useMemo(() => (filterActive ? new Set(shown.map((e) => e.id)) : new Set(current.slice(0, 2).map((e) => e.id))), [filterActive, shown, current]);
  const isExpanded = (id: string) => overrides[id] ?? defaultOpen.has(id);
  const setAll = (open: boolean) => setOverrides((o) => ({ ...o, ...Object.fromEntries(shown.map((e) => [e.id, open])) }));
  const toggleType = (t: ChangeType) => setTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  const programLabel = PROGRAMS[program].brand.label;

  const timeline = (list: typeof shown) => (
    <ol className="relative flex flex-col gap-5 pl-6">
      <div className="absolute bottom-2 left-[9px] top-2 w-px bg-[var(--glass-border)]" aria-hidden />
      {list.map((entry) => (
        <li key={entry.id} className="relative list-none">
          <span className="absolute -left-6 top-6 flex h-[18px] w-[18px] items-center justify-center rounded-full" style={{ background: entry.legacy ? undefined : "var(--theme-gradient)" }} aria-hidden>
            <GitCommitVertical className={cn("h-3 w-3", entry.legacy ? "text-[var(--muted-foreground)]" : "text-white")} />
          </span>
          <EntryCard entry={entry} expanded={isExpanded(entry.id)} onToggle={() => setOverrides((o) => ({ ...o, [entry.id]: !isExpanded(entry.id) }))} showProgramBadges={showAll} />
        </li>
      ))}
    </ol>
  );

  return (
    <div className="flex flex-col gap-6">
      {seenError && (
        <p role="alert" className="text-sm text-red-400">
          {seenError} The unread dot will stay until it is saved.
        </p>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Changelog</h1>
          <p className="text-sm text-[var(--muted-foreground)]">What&apos;s new, improved, and fixed.</p>
        </div>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <Switch checked={showAll} onCheckedChange={setShowAll} aria-label="Show all programs" />
          <span>Show all programs</span>
        </label>
      </div>

      {/* The filter bar is always rendered, so nothing jumps when the entries arrive. */}
      <div className="flex flex-col gap-3">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" aria-hidden />
          <Input aria-label="Search the changelog" className="pl-10 pr-10" placeholder="Search versions, titles, and changes" value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-[var(--muted-foreground)] hover:bg-white/10 hover:text-[var(--foreground)]">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setTypes([])}
            aria-pressed={types.length === 0}
            className={cn("rounded-full border px-3.5 py-1 text-xs font-semibold transition-colors", types.length === 0 ? "border-transparent bg-white/15 text-[var(--foreground)]" : "border-[var(--glass-border)] text-[var(--muted-foreground)] hover:bg-white/6")}
          >
            All
          </button>
          {CHANGE_TYPES.map((t) => {
            const on = types.includes(t.id);
            return (
              <button key={t.id} type="button" onClick={() => toggleType(t.id)} aria-pressed={on} className={cn("rounded-full px-3.5 py-1 text-xs font-semibold transition-[opacity,box-shadow]", t.pill, on ? "shadow-[0_0_16px_1px_rgba(var(--glow),0.45)]" : "opacity-60 hover:opacity-100")}>
                {t.label} <span className={cn("opacity-70 transition-opacity", !loaded && "opacity-0")}>{counts[t.id]}</span>
              </button>
            );
          })}
          <span className="mx-1 hidden h-4 w-px bg-[var(--glass-border)] sm:block" aria-hidden />
          <Button variant="ghost" size="sm" onClick={() => setAll(true)} disabled={shown.length === 0}>
            Expand all
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setAll(false)} disabled={shown.length === 0}>
            Collapse all
          </Button>
        </div>
      </div>

      {!loaded ? (
        <div className="relative flex flex-col gap-5 pl-6" aria-busy="true" aria-label="Loading the changelog">
          <div className="absolute bottom-2 left-[9px] top-2 w-px bg-[var(--glass-border)]" aria-hidden />
          {[0, 1, 2].map((i) => (
            <div key={i} className="glass-card flex h-[104px] flex-col gap-3 p-5">
              <Shimmer className="h-4 w-1/3" />
              <Shimmer className="h-5 w-2/3" />
              <Shimmer className="h-3 w-1/2" />
            </div>
          ))}
        </div>
      ) : loadError ? (
        <div role="alert" className="glass-card flex flex-col items-center gap-3 p-10 text-center">
          <p className="font-medium">The changelog didn&apos;t load.</p>
          <p className="max-w-sm text-sm text-[var(--muted-foreground)]">{loadError}</p>
          <Button variant="outline" size="sm" onClick={reload}>
            Try again
          </Button>
        </div>
      ) : shown.length === 0 ? (
        <div className="glass-card flex flex-col items-center gap-3 p-10 text-center">
          <p className="font-medium">{entries.length === 0 ? "Nothing here yet." : scoped.length === 0 ? `Nothing for ${programLabel} yet.` : "No entries match."}</p>
          <p className="max-w-sm text-sm text-[var(--muted-foreground)]">
            {entries.length === 0
              ? "Release notes will show up here once they are published."
              : scoped.length === 0
                ? "Turn on Show all programs to see the notes for every program."
                : "Try a different search, or clear the filters."}
          </p>
          {entries.length > 0 && scoped.length === 0 && (
            <Button variant="outline" size="sm" onClick={() => setShowAll(true)}>
              Show all programs
            </Button>
          )}
          {scoped.length > 0 && filterActive && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setTypes([]);
                setQuery("");
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {current.length > 0 && timeline(current)}
          {legacy.length > 0 && (
            <section aria-labelledby="changelog-legacy" className="flex flex-col gap-4">
              <div>
                <h2 id="changelog-legacy" className="text-lg font-semibold tracking-tight">
                  Legacy
                </h2>
                <p className="text-sm text-[var(--muted-foreground)]">Release notes from the earlier CompSocrates.</p>
              </div>
              {timeline(legacy)}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
