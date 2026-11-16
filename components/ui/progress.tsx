import { cn } from "@/lib/utils";

/**
 * The one progress bar. Accessible: `role="progressbar"` with the current, minimum and maximum values and a label (the caller says what it measures).
 * `value` and `max` are the real numbers (7 of 10), not percentages; the bar is the capped ratio.
 */
export function Progress({
  value,
  max,
  label,
  valueText,
  className,
  done,
}: {
  value: number;
  max: number;
  /** What the bar measures, for screen readers ("Practice sessions completed"). */
  label: string;
  /** A spoken form of the value ("3 of 5 sessions"); defaults to "value of max". */
  valueText?: string;
  className?: string;
  /** The goal is reached: the bar takes the success color. */
  done?: boolean;
}) {
  const safeMax = max > 0 ? max : 1;
  const now = Math.max(0, Math.min(value, safeMax));
  const percent = Math.round((now / safeMax) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={now}
      aria-valuetext={valueText ?? `${now} of ${safeMax}`}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10", className)}
    >
      <div className={cn("h-full rounded-full", done ? "bg-emerald-500" : "bg-[var(--color-primary)]")} style={{ width: `${percent}%` }} />
    </div>
  );
}
