import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase/client", () => ({ db: {}, isFirebaseConfigured: () => true }));
vi.mock("@/lib/program/data", () => ({ programData: () => null, useProgramData: () => null }));
vi.mock("@/lib/program/context", () => ({ useProgram: () => "frc", useProgramConfig: () => ({ connection: { features: { live: true } } }) }));

import { LIVE_CONFIG } from "@/lib/live/config";
import { showsLivePill } from "@/lib/live/pill-pages";
import { isPresenceActive } from "@/lib/live-presence";

const NOW = 1_800_000_000_000;
const seen = (agoMs: number) => ({ toMillis: () => NOW - agoMs });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("live presence timing", () => {
  it("beats every 40 s and counts a scout active for 120 s", () => {
    expect(LIVE_CONFIG.PRESENCE_HEARTBEAT_INTERVAL_MS).toBe(40_000);
    expect(LIVE_CONFIG.PRESENCE_STALE_MS).toBe(120_000);
  });

  it("one missed beat never marks a scout stale; three missed ones do", () => {
    const beat = LIVE_CONFIG.PRESENCE_HEARTBEAT_INTERVAL_MS;
    expect(isPresenceActive(seen(0))).toBe(true);
    expect(isPresenceActive(seen(beat))).toBe(true); // just beat
    expect(isPresenceActive(seen(2 * beat))).toBe(true); // ONE beat missed (the last write is two intervals old)
    expect(isPresenceActive(seen(3 * beat))).toBe(false); // two beats missed: gone
    expect(LIVE_CONFIG.PRESENCE_STALE_MS).toBeGreaterThan(2 * beat); // the rule the numbers must keep
  });

  it("a missing or odd timestamp is not active", () => {
    expect(isPresenceActive(null)).toBe(false);
    expect(isPresenceActive({})).toBe(false);
  });
});

describe("where the live pill (and its presence listener) is mounted", () => {
  it.each(["/dashboard", "/practice-scouting", "/practice-scouting/live"])("%s shows it", (p) => expect(showsLivePill(p)).toBe(true));
  it.each(["/", "/scout", "/analytics", "/analytics/teams", "/assignments", "/admin", "/account", "/dashboardx"])("%s does not", (p) => expect(showsLivePill(p)).toBe(false));
});

describe("presence read fan-out (arithmetic on the config, not a measurement)", () => {
  // Every heartbeat is one changed document, billed once per open tab that listens to the team's presence.
  const readsPerHour = (liveScouts: number, listeningTabs: number, intervalMs: number) => liveScouts * (3_600_000 / intervalMs) * listeningTabs;
  it("6 live scouts and 18 listening tabs: 19,440 reads an hour at 20 s become 9,720 at 40 s, before counting the pill's narrower mount", () => {
    expect(readsPerHour(6, 18, 20_000)).toBe(19_440);
    expect(readsPerHour(6, 18, LIVE_CONFIG.PRESENCE_HEARTBEAT_INTERVAL_MS)).toBe(9_720);
  });
});
