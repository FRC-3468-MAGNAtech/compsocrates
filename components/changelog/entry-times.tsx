import { entryTimeParts, formatDateTime, formatDateTimeFull, type FormatOptions } from "@/lib/platform-changelog/times";

/**
 * "Posted {date and time} · Edited {date and time}" under an entry's title: each part only when the entry has that time (the app never invents one),
 * in the VIEWER's time zone and locale. Each time is a `<time datetime>` whose tooltip is the full timestamp with the zone. The same component renders
 * the Changelog page, the legacy list and the owner's preview, in every program. Renders nothing for an entry with neither time.
 */
export function EntryTimes({ postedAtMs, editedAtMs, format }: { postedAtMs?: number | null; editedAtMs?: number | null; /** For tests only. */ format?: FormatOptions }) {
  const parts = entryTimeParts({ postedAtMs, editedAtMs });
  if (parts.length === 0) return null;
  return (
    <p className="text-xs text-[var(--muted-foreground)]" data-testid="entry-times">
      {parts.map((p, i) => (
        <span key={p.label}>
          {i > 0 && <span aria-hidden> · </span>}
          {p.label}{" "}
          <time dateTime={new Date(p.ms).toISOString()} title={formatDateTimeFull(p.ms, format)}>
            {formatDateTime(p.ms, format)}
          </time>
        </span>
      ))}
    </p>
  );
}
