"use client";

import { Play, Square, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { coerceTimerList, TIMER_LIST_DEFAULTS, timerStats } from "@/lib/forms/values";
import { springSnappy } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** "3.45 s". CS records cycles to 0.01 s. */
export const formatSeconds = (n: number): string => `${n.toFixed(2)} s`;

/**
 * A stopwatch that records cycles (the `timerList` field, CS's "cycle timers"). One big Start / Stop button: Start runs the watch, Stop appends the
 * elapsed seconds to the list as a new cycle. Each recorded cycle can be deleted. Built to be hit one-handed on a phone: the button is a full-width 56px
 * target, delete buttons are 44px, and the elapsed time is large enough to read at arm's length. The watch is measured with `performance.now()`
 * (not by counting ticks), so a slow frame or a backgrounded tab doesn't lose time.
 */
export function TimerList({
  label,
  value,
  onChange,
  disabled,
  maxSeconds = TIMER_LIST_DEFAULTS.maxSeconds,
  maxCycles = TIMER_LIST_DEFAULTS.maxCycles,
  icon,
  helpText,
}: {
  label: string;
  /** The recorded durations, in seconds. */
  value: number[];
  onChange: (value: number[]) => void;
  disabled?: boolean;
  /** The longest one cycle can be (a forgotten running watch is capped at this). */
  maxSeconds?: number;
  /** The most cycles the list holds. */
  maxCycles?: number;
  icon?: ReactNode;
  helpText?: string;
}) {
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      if (startRef.current !== null) setElapsed((performance.now() - startRef.current) / 1000);
    }, 50);
    return () => window.clearInterval(id);
  }, [running]);

  const full = value.length >= maxCycles;
  const stats = timerStats(value);

  const stop = () => {
    const seconds = startRef.current === null ? 0 : (performance.now() - startRef.current) / 1000;
    startRef.current = null;
    setRunning(false);
    setElapsed(0);
    const next = coerceTimerList({ max: maxSeconds, maxCycles }, [...value, seconds]);
    if (next.length > value.length) onChange(next);
  };

  const start = () => {
    startRef.current = performance.now();
    setElapsed(0);
    setRunning(true);
  };

  const cancel = () => {
    startRef.current = null;
    setRunning(false);
    setElapsed(0);
  };

  return (
    <div className={cn("glass-card flex flex-col gap-3 p-4", disabled && "opacity-60")} role="group" aria-label={label} data-testid="timer-list">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold">
            {icon}
            {label}
          </div>
          {helpText && <div className="text-xs text-[var(--muted-foreground)]">{helpText}</div>}
        </div>
        <output aria-live="off" className="shrink-0 font-mono text-2xl font-bold tabular-nums" data-testid="timer-elapsed">
          {formatSeconds(elapsed)}
        </output>
      </div>

      <div className="flex items-center gap-2">
        <motion.button
          type="button"
          disabled={disabled || (!running && full)}
          whileTap={disabled ? undefined : { scale: 0.97 }}
          transition={springSnappy}
          onClick={running ? stop : start}
          aria-label={running ? `Stop ${label} and record the cycle` : `Start ${label}`}
          className="flex h-14 min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl text-base font-semibold text-[var(--color-primary-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(var(--glow),0.5)] disabled:cursor-not-allowed disabled:opacity-60"
          style={{ background: running ? "var(--status-offline)" : "var(--theme-gradient)" }}
        >
          {running ? <Square className="h-5 w-5 fill-current" aria-hidden /> : <Play className="h-5 w-5 fill-current" aria-hidden />}
          {running ? "Stop" : full ? "Cycle limit reached" : "Start"}
        </motion.button>
        {running && (
          <button
            type="button"
            onClick={cancel}
            aria-label={`Discard the running ${label} without recording`}
            className="glass-card flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[var(--glass-border)] text-[var(--muted-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(var(--glow),0.5)]"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        )}
      </div>

      {value.length > 0 && (
        <>
          <ol className="flex flex-col gap-1.5" aria-label={`${label}: recorded cycles`}>
            {value.map((seconds, i) => (
              <li key={`${i}-${seconds}`} className="flex min-h-11 items-center justify-between gap-2 rounded-xl bg-white/5 pl-3 pr-1 text-sm">
                <span className="tabular-nums">
                  <span className="text-[var(--muted-foreground)]">Cycle {i + 1}</span> <span className="font-semibold">{formatSeconds(seconds)}</span>
                </span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange(value.filter((_, j) => j !== i))}
                  aria-label={`Delete cycle ${i + 1} (${formatSeconds(seconds)})`}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[var(--muted-foreground)] hover:bg-white/10 hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(var(--glow),0.5)] disabled:cursor-not-allowed"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </li>
            ))}
          </ol>
          <p className="text-xs tabular-nums text-[var(--muted-foreground)]" data-testid="timer-summary">
            {stats.count} cycle{stats.count === 1 ? "" : "s"} &middot; total {formatSeconds(stats.total)} &middot; average {formatSeconds(stats.avg)}
          </p>
        </>
      )}
    </div>
  );
}
