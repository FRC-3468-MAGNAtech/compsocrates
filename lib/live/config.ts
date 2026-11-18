/** P7: every Live-mode tunable constant in one place, per the prompt's own naming. */
export const LIVE_CONFIG = {
  /** How often an active scouting screen writes a presence heartbeat (every open tab of the team pays one read per beat, so this is the biggest lever on read cost). */
  PRESENCE_HEARTBEAT_INTERVAL_MS: 40_000,
  /** A presence doc counts as "active" if seen within this long: more than two heartbeats, so ONE missed beat never marks a scout stale (lib/live/config.test.ts). */
  PRESENCE_STALE_MS: 120_000,
  /** One scout covering both of an alliance's robots only counts toward notifying if both entries were submitted within this many minutes of each other — in practice, before scores post. */
  LIVE_BOTH_ROBOTS_WINDOW_MINUTES: 10,
  /** The client-side fallback poll (while a pending live session is open) — /api/live/check-scores is also rate-limited server-side on top of this. */
  CLIENT_SCORE_POLL_INTERVAL_MS: 60_000,
};
