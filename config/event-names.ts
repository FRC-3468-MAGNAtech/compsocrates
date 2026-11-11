/**
 * Static event names: the last-but-one step of the name chain in `lib/events/names.ts` (API name, then a name stored in
 * the team's own data, then this table, then the raw key). Pure data and one pure getter: no `server-only`, no Node
 * APIs, safe to import from client code.
 *
 * Every entry comes from CompSocrates's own code, where it states a real name; nothing here is invented:
 * - `app/utils/events.ts` (APP_EVENTS): 2026arli "Arkansas Regional", 2026lake "Bayou Regional".
 * - `app/utils/analyticsEvents.ts`: 2025alhu "Rocket City Regional", 2025lake "Bayou Regional", 2023mslr "Magnolia
 *   Regional", 2023lake "Bayou Regional", app-testing "App Testing".
 * - `app/components/AnalyticsShell.tsx` and the Einstein import scripts: 2025cmptx "Einstein Field"; AnalyticsShell and the
 *   week-0 import scripts (`--event-name` defaults to "Week 0"): 2026week0 and week0 "Week 0".
 * - `app/scripts/setup-practice-matches.ts` (EVENTS): 2026tuis "Istanbul Regional", 2026okok "Oklahoma Regional",
 *   2026cosp "Pikes Peak Regional".
 *
 * Keys are lowercase. Legacy spellings that `config/event.ts` aliases (`2026labr` is `2026lake`) are resolved by
 * `staticEventName` before the lookup, so the aliases are not repeated here, but `2025lake` stays listed because CS
 * itself names it (a 2025 Reefscape event) and `2025` data may still carry that key.
 */
import { EVENT_CONFIG, normalizeEventKey, type EventConfig } from "@/config/event";

export const EVENT_NAMES: Readonly<Record<string, string>> = {
  "2026arli": "Arkansas Regional",
  "2026lake": "Bayou Regional",
  "2026tuis": "Istanbul Regional",
  "2026okok": "Oklahoma Regional",
  "2026cosp": "Pikes Peak Regional",
  "2026week0": "Week 0",
  week0: "Week 0",
  "2025alhu": "Rocket City Regional",
  "2025lake": "Bayou Regional",
  "2025cmptx": "Einstein Field",
  "2023mslr": "Magnolia Regional",
  "2023lake": "Bayou Regional",
  "app-testing": "App Testing",
};

/**
 * The static name for an event key, or null when the table has none. The key is trimmed and lowercased, a legacy alias
 * (`config/event.ts` `eventKeyAliases`) is resolved first, and the key as typed is tried last, so `2026LABR` and
 * `2025lake` both read "Bayou Regional".
 */
export function staticEventName(eventKey: string, config: EventConfig = EVENT_CONFIG): string | null {
  const raw = String(eventKey ?? "").trim().toLowerCase();
  if (!raw) return null;
  const canonical = normalizeEventKey(raw, config);
  const own = (key: string) => (Object.prototype.hasOwnProperty.call(EVENT_NAMES, key) ? EVENT_NAMES[key] : null);
  return own(canonical) ?? own(raw);
}
