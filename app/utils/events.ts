export type AppEvent = {
  key: string;
  name: string;
  location: string;
  city: string;
  state_prov: string;
  country: string;
  startDate: string;
  endDate: string;
  week: number;
  event_type: string;
};

export const APP_EVENTS: AppEvent[] = [
  {
    key: "2026arli",
    name: "Arkansas Regional",
    location: "Little Rock, AR",
    city: "Little Rock",
    state_prov: "AR",
    country: "USA",
    startDate: "2026-03-18",
    endDate: "2026-03-21",
    week: 3,
    event_type: "Regional",
  },
  {
    key: "2026labr",
    name: "Bayou Regional",
    location: "Kenner, LA",
    city: "Kenner",
    state_prov: "LA",
    country: "USA",
    startDate: "2026-04-01",
    endDate: "2026-04-04",
    week: 4,
    event_type: "Regional",
  },
];

export const APP_EVENT_BY_KEY = APP_EVENTS.reduce<Record<string, AppEvent>>((acc, event) => {
  acc[event.key] = event;
  return acc;
}, {});

const EVENT_KEY_ALIASES: Record<string, string> = {
  // Legacy Bayou key used during 2025 data seeding.
  "2025lake": "2026labr",
};

export function normalizeEventKey(eventKey: string): string {
  const trimmed = String(eventKey || "").trim();
  return EVENT_KEY_ALIASES[trimmed] || trimmed;
}

export function dedupeEventKeys(eventKeys: string[]): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();
  eventKeys.forEach((rawKey) => {
    const key = normalizeEventKey(rawKey);
    if (!key || seen.has(key)) return;
    seen.add(key);
    deduped.push(key);
  });
  return deduped;
}
