// Match times for the dashboard (P13). The FIRST API's schedule gives each
// match's start as event-local *wall time with no offset* ("2025-11-08T09:00:00").
// Reading that with `new Date(...)` would mean "9:00 in the viewer's timezone",
// which is wrong for anyone not at the venue — and the dashboard shows a
// countdown, so it must be a real instant. Pure and tested.

const WALL_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

function validZone(timeZone: string | null | undefined): timeZone is string {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** How far `timeZone`'s wall clock is ahead of UTC at instant `ts`, in ms (e.g. Los Angeles in November: -8h). */
export function tzOffsetMs(ts: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ts));
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(ts / 1000) * 1000;
}

/**
 * The instant (ms since epoch) a FIRST API time string means. A string that
 * carries its own offset or "Z" is taken as written; a bare wall time is read
 * in `timeZone` (the event's), falling back to the viewer's own timezone when
 * the event has none. `null` for a missing or unparseable value.
 */
export function parseEventTime(value: string | null | undefined, timeZone: string | null | undefined): number | null {
  if (!value) return null;
  const m = WALL_TIME.exec(value.trim());
  if (!m) {
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : t;
  }
  const [, y, mo, d, h, mi, s, offset] = m;
  const parts = [Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0)] as const;

  if (offset) {
    if (offset === "Z") return Date.UTC(...parts);
    const sign = offset.startsWith("-") ? -1 : 1;
    const digits = offset.replace(/[^0-9]/g, "");
    return Date.UTC(...parts) - sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4))) * 60_000;
  }

  if (!validZone(timeZone)) return new Date(...parts).getTime();

  // Wall time -> instant: guess, correct by the zone's offset, and re-check once in case a DST edge moved it.
  const guess = Date.UTC(...parts);
  let instant = guess - tzOffsetMs(guess, timeZone);
  const second = guess - tzOffsetMs(instant, timeZone);
  if (second !== instant) instant = second;
  return instant;
}

/** The viewer's own IANA timezone (their device's), or null when the browser will not say. */
export function viewerTimeZone(): string | null {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** Do the two zones show the same wall clock at this instant? (Zone names can differ while the clocks agree, and the other way round across daylight-saving changes.) */
export function sameClock(ms: number, a: string, b: string): boolean {
  return tzOffsetMs(ms, a) === tzOffsetMs(ms, b);
}

/**
 * A match time for the viewer: "Sat 9:00 AM" on the VIEWER's clock, since `ms` is a real instant. When the event's clock differs from the viewer's at that instant,
 * the zone name is added and the event's own clock is shown beside it ("Sat 7:00 AM PST (Sat 11:00 PM at the event)"), so a far-away event is never misread. An
 * event with no known zone is shown on the viewer's clock alone. Label it "Scheduled" in the UI: the API's time is a plan, not a promise.
 */
export function formatScheduled(ms: number, eventZone: string | null | undefined, viewerZone: string | null = viewerTimeZone()): string {
  const base: Intl.DateTimeFormatOptions = { weekday: "short", hour: "numeric", minute: "2-digit" };
  const at = new Date(ms);
  const viewer = validZone(viewerZone) ? viewerZone : undefined;
  const plain = new Intl.DateTimeFormat(undefined, viewer ? { ...base, timeZone: viewer } : base);
  if (!validZone(eventZone) || !viewer || sameClock(ms, eventZone, viewer)) return plain.format(at);
  const named = new Intl.DateTimeFormat(undefined, { ...base, timeZone: viewer, timeZoneName: "short" }).format(at);
  const atEvent = new Intl.DateTimeFormat(undefined, { ...base, timeZone: eventZone }).format(at);
  return `${named} (${atEvent} at the event)`;
}

/** Time of day only, "9:00 AM", on the viewer's clock: for lists already grouped by day. */
export function formatClock(ms: number, _eventZone?: string | null, viewerZone: string | null = viewerTimeZone()): string {
  const options: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  if (validZone(viewerZone)) options.timeZone = viewerZone;
  return new Intl.DateTimeFormat(undefined, options).format(new Date(ms));
}

/** "just now", "5 min ago", "3 h ago", "2 d ago". A timestamp in the future reads as "just now". */
export function timeAgo(ms: number, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((nowMs - ms) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/** "12m 05s", "1h 12m", "2d 3h"; "Now" once it has arrived. */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return "Now";
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}
