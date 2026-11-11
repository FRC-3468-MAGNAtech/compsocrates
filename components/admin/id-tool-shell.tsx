"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Check, Copy, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Input, Label } from "@/components/ui/input";
import { Shimmer } from "@/components/ui/shimmer";
import { failureExplanation, reportFirestoreError, type FirestoreFailure } from "@/lib/firestore-errors";

/** Rows drawn at once (the Sessions tab caps at 200 too): a long team history stays responsive, and the search box narrows it. */
export const ID_ROW_CAP = 200;

type OneShot<T> = { data: T | null; error: FirestoreFailure | null; loading: boolean; refreshing: boolean; refresh: () => void };

/**
 * Loads once per team, and again on `refresh()` (CS's "Refresh" button: both pages read with a one-off `getDocs`). The previous rows stay on screen
 * while a refresh runs; a failure keeps them too and shows the reason (CS used `alert`). No team means an empty list, not a spinner.
 */
export function useOneShot<T>(teamId: string | null, load: (teamId: string) => Promise<T>, context: string, empty: T): OneShot<T> {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ teamId: string; attempt: number; data: T | null; error: FirestoreFailure | null } | null>(null);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    if (!teamId) return;
    let cancelled = false;
    loadRef.current(teamId).then(
      (data) => {
        if (!cancelled) setResult({ teamId, attempt, data, error: null });
      },
      (err) => {
        if (cancelled) return;
        const error = reportFirestoreError(context, err, null);
        setResult((prev) => ({ teamId, attempt, data: prev?.teamId === teamId ? prev.data : null, error }));
      }
    );
    return () => {
      cancelled = true;
    };
  }, [teamId, attempt, context]);

  const refresh = useCallback(() => setAttempt((n) => n + 1), []);
  if (!teamId) return { data: empty, error: null, loading: false, refreshing: false, refresh };
  const mine = result?.teamId === teamId ? result : null;
  return { data: mine?.data ?? null, error: mine?.error ?? null, loading: mine === null, refreshing: mine !== null && mine.attempt !== attempt, refresh };
}

/** The tool's frame: title, blurb, a labelled search box with Refresh, the loading / error / empty states, and a "showing N of M" line. */
export function IdToolShell({
  title,
  description,
  searchLabel,
  placeholder,
  search,
  onSearch,
  loading,
  refreshing,
  error,
  onRefresh,
  total,
  shown,
  noun,
  children,
}: {
  title: string;
  description: string;
  searchLabel: string;
  placeholder: string;
  search: string;
  onSearch: (value: string) => void;
  loading: boolean;
  refreshing: boolean;
  error: FirestoreFailure | null;
  onRefresh: () => void;
  /** Rows before the search. */
  total: number;
  /** Rows after the search (the list may draw fewer: `ID_ROW_CAP`). */
  shown: number;
  /** "entries" / "sessions", for the count line and the empty message. */
  noun: string;
  children: ReactNode;
}) {
  const searchId = useId();
  return (
    <div className="flex flex-col gap-4">
      <GlassPanel className="flex flex-col gap-3">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="text-sm text-[var(--muted-foreground)]">{description}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <Label htmlFor={searchId}>{searchLabel}</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" aria-hidden />
              <Input id={searchId} type="search" value={search} onChange={(e) => onSearch(e.target.value)} placeholder={placeholder} className="pl-10 text-base" />
            </div>
          </div>
          <Button variant="glass" className="min-h-11 shrink-0 gap-2" disabled={loading || refreshing} onClick={onRefresh}>
            <RefreshCw className={refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden /> {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
        {!loading && (
          <p className="text-xs text-[var(--muted-foreground)]" aria-live="polite">
            {shown === total ? `${total} ${noun}` : `${shown} of ${total} ${noun}`}
            {shown > ID_ROW_CAP && ` · showing the first ${ID_ROW_CAP}: search to narrow it`}
          </p>
        )}
      </GlassPanel>

      {error && (
        <GlassPanel role="alert" className="flex flex-col gap-2 border-amber-400/30 text-sm">
          <div className="flex items-center gap-2 font-medium text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /> Couldn&apos;t load the {noun}.
          </div>
          <p className="text-[var(--muted-foreground)]">{failureExplanation(error)}</p>
          <Button variant="glass" size="sm" className="min-h-11 self-start" onClick={onRefresh}>
            Try again
          </Button>
        </GlassPanel>
      )}

      {loading ? (
        <GlassPanel className="flex flex-col gap-2" aria-busy="true" aria-label={`Loading ${noun}`}>
          <Shimmer className="h-20 w-full" />
          <Shimmer className="h-20 w-full" />
          <Shimmer className="h-20 w-full" />
        </GlassPanel>
      ) : shown === 0 && !error ? (
        <GlassPanel>
          <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">{search.trim() ? `No ${noun} match “${search.trim()}”.` : `No ${noun} found.`}</p>
        </GlassPanel>
      ) : shown > 0 ? (
        <GlassPanel className="flex flex-col gap-2">{children}</GlassPanel>
      ) : null}
    </div>
  );
}

/** One result card: the document ID in monospace with a 44px Copy button, then labelled fields. */
export function IdRow({ id, fields, notes }: { id: string; fields: { label: string; value: ReactNode; sub?: ReactNode }[]; notes?: string }) {
  return (
    <li className="glass-card flex flex-col gap-3 p-3" data-testid="id-row">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 break-all font-mono text-sm">{id}</span>
        <CopyIdButton id={id} />
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-4">
        {fields.map((f) => (
          <div key={f.label} className="min-w-0">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">{f.label}</dt>
            <dd className="truncate">{f.value}</dd>
            {f.sub !== undefined && <dd className="truncate text-xs text-[var(--muted-foreground)]">{f.sub}</dd>}
          </div>
        ))}
      </dl>
      {notes ? <p className="whitespace-pre-wrap break-words text-xs text-[var(--muted-foreground)]">{notes}</p> : null}
    </li>
  );
}

/** Copies a document ID. Says "Copied" for a moment; if the browser refuses the clipboard it says so instead of pretending. */
export function CopyIdButton({ id }: { id: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const copy = async () => {
    let next: "copied" | "failed" = "copied";
    try {
      await navigator.clipboard.writeText(id);
    } catch {
      next = "failed";
    }
    setState(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1800);
  };

  return (
    <Button variant="glass" size="sm" className="min-h-11 shrink-0 gap-1.5" aria-label={`Copy ID ${id}`} onClick={() => void copy()}>
      {state === "copied" ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
      <span aria-live="polite">{state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}</span>
    </Button>
  );
}
