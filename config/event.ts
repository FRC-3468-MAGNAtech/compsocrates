/**
 * The ONLY place that names the season, the data APIs, the event-key aliases and the FIRST-code rule.
 * Everything under `lib/events` and `lib/frc` reads from here, so a future event or season is a config
 * swap (see decisions D4, D11, D12 in docs/ROUTES.md).
 *
 * Pure data and pure helpers: no `server-only`, no Node APIs, safe to import from client code. No keys live
 * here: API keys are read on the server only, through lib/server/env.ts.
 */

export type EventConfig = {
  /** The calendar year of the game season. */
  season: number;
  /** Robots per alliance (FRC: 3). */
  allianceSize: number;
  apis: {
    /** The Blue Alliance v3 (events, teams, matches, rankings). Key: server env `NEXT_PUBLIC_TBA_API_KEY` (read on the server only). */
    tba: { baseUrl: string };
    /** FIRST FRC API v3.0 (practice schedule, fallback). Credentials: `FIRST_API_USERNAME` / `FIRST_API_TOKEN`. */
    first: { baseUrl: string };
    /** Statbotics v3 (EPA). No credentials. */
    statbotics: { baseUrl: string };
  };
  /** Old or mistyped TBA event keys -> the current key. Keys are lowercase. */
  eventKeyAliases: Record<string, string>;
  /** TBA key -> FIRST event code where stripping the year is not the right answer (all other keys use the stripped suffix). */
  firstCodeOverrides: Record<string, string>;
  /** Event key used by dev and test teams when no real event is selected. Never sent to an API. */
  fallbackEventKey: string;
  playoff: {
    /** Double-elimination bracket slots are numbered 1..bracketSlots (D11). */
    bracketSlots: number;
    /** Finals f1..fN map to `finalsOffset + N` (f1 -> 14, f2 -> 15, f3 -> 16). */
    finalsOffset: number;
  };
};

export const EVENT_CONFIG: EventConfig = {
  season: 2026,
  allianceSize: 3,
  apis: {
    tba: { baseUrl: "https://www.thebluealliance.com/api/v3" },
    first: { baseUrl: "https://frc-api.firstinspires.org/v3.0" },
    statbotics: { baseUrl: "https://api.statbotics.io/v3" },
  },
  eventKeyAliases: {
    // Legacy Bayou key used during 2025 data seeding.
    "2025lake": "2026lake",
    // Mistyped Bayou key used in early 2026 configs.
    "2026labr": "2026lake",
  },
  firstCodeOverrides: {
    "2026lake": "LAKE",
    "2026labr": "LAKE",
    "2025lake": "LAKE",
  },
  fallbackEventKey: "app-testing",
  playoff: { bracketSlots: 13, finalsOffset: 13 },
};

/** Lowercases, trims and resolves a legacy alias to the current TBA event key. */
export function normalizeEventKey(eventKey: string, config: EventConfig = EVENT_CONFIG): string {
  const trimmed = String(eventKey || "").trim();
  return config.eventKeyAliases[trimmed.toLowerCase()] ?? trimmed.toLowerCase();
}

/** De-duplicates keys after alias resolution, dropping empties and keeping first-seen order. */
export function dedupeEventKeys(eventKeys: string[], config: EventConfig = EVENT_CONFIG): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of eventKeys) {
    const key = normalizeEventKey(raw, config);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/**
 * Every spelling stored data may use for one event: the canonical key, the raw input and each
 * legacy alias that points at it. Firestore queries run once per variant.
 */
export function expandEventKeyAliases(eventKey: string, config: EventConfig = EVENT_CONFIG): string[] {
  const canonical = normalizeEventKey(eventKey, config);
  const variants = new Set<string>();
  if (canonical) variants.add(canonical);
  const raw = String(eventKey || "").trim();
  if (raw) variants.add(raw);
  for (const [legacy, target] of Object.entries(config.eventKeyAliases)) {
    if (target === canonical) variants.add(legacy);
  }
  return Array.from(variants);
}

/**
 * The FIRST FRC API event code for a TBA key: the key with its 4-digit year stripped, upper-cased
 * (`2026arli` -> `ARLI`), with the override table taking precedence (`2026lake` -> `LAKE`).
 */
export function getFirstEventCodeFromTbaKey(key: string, config: EventConfig = EVENT_CONFIG): string {
  const normalized = String(key || "").trim().toLowerCase();
  const override = config.firstCodeOverrides[normalized];
  if (override) return override;
  const suffix = normalized.slice(4).toUpperCase();
  return suffix || normalized.toUpperCase();
}

/** The 4-digit season year at the start of a TBA key, or null when the key has none (e.g. `app-testing`). */
export function getSeasonFromEventKey(key: string): number | null {
  const match = /^(\d{4})[a-z0-9]+$/i.exec(String(key || "").trim());
  return match ? Number(match[1]) : null;
}

/** Whether `key` looks like a real TBA event key (`2026arli`); the fallback sentinel and junk are not. */
export function isTbaEventKey(key: string): boolean {
  return /^\d{4}[a-z0-9]+$/.test(String(key || "").trim().toLowerCase());
}
