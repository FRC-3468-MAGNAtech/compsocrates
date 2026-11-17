import { describe, expect, it } from "vitest";
import { formatScheduled, parseEventTime, sameClock } from "@/lib/dashboard/time";
import { getEventStatus } from "@/lib/events/event-status";
import { isIanaZone, resolveEventTimeZone, withResolvedTimeZone, zoneFromLocation } from "./event-timezone";

// An event's clock comes from where the event is, never from one fixed correction applied to every event.
describe("resolveEventTimeZone", () => {
  it("uses the API's own zone when it is a real one, whatever the location says", () => {
    expect(resolveEventTimeZone({ timezone: "America/Chicago", country: "Australia", stateProv: "NSW" })).toBe("America/Chicago");
  });

  it("maps a Windows-style zone name from the API", () => {
    expect(resolveEventTimeZone({ timezone: "AUS Eastern Standard Time" })).toBe("Australia/Sydney");
    expect(resolveEventTimeZone({ timezone: "W. Australia Standard Time" })).toBe("Australia/Perth");
    expect(resolveEventTimeZone({ timezone: "Pacific Standard Time" })).toBe("America/Los_Angeles");
  });

  it("with no usable zone, finds it from the location: each Australian state has its own", () => {
    const au = (stateProv: string) => resolveEventTimeZone({ timezone: null, country: "Australia", stateProv });
    expect(au("NSW")).toBe("Australia/Sydney");
    expect(au("New South Wales")).toBe("Australia/Sydney");
    expect(au("WA")).toBe("Australia/Perth");
    expect(au("Queensland")).toBe("Australia/Brisbane");
    expect(au("VIC")).toBe("Australia/Melbourne");
    expect(au("")).toBe("Australia/Sydney");
  });

  it("US states and Canadian provinces, by abbreviation or name; other countries by country", () => {
    expect(resolveEventTimeZone({ country: "USA", stateProv: "CA" })).toBe("America/Los_Angeles");
    expect(resolveEventTimeZone({ country: "United States", stateProv: "Louisiana" })).toBe("America/Chicago");
    expect(resolveEventTimeZone({ country: "USA", stateProv: "NY" })).toBe("America/New_York");
    expect(resolveEventTimeZone({ country: "Canada", stateProv: "ON" })).toBe("America/Toronto");
    expect(resolveEventTimeZone({ country: "Israel" })).toBe("Asia/Jerusalem");
    expect(resolveEventTimeZone({ country: "Chinese Taipei" })).toBe("Asia/Taipei");
  });

  it("says null (the viewer's clock) rather than guessing: unknown country, or a multi-zone country with no state", () => {
    expect(resolveEventTimeZone({})).toBeNull();
    expect(resolveEventTimeZone({ country: "Atlantis" })).toBeNull();
    expect(resolveEventTimeZone({ country: "USA" })).toBeNull();
    expect(zoneFromLocation({ country: "USA", stateProv: "ZZ" })).toBeNull();
  });

  it("every zone it can return is one the platform knows", () => {
    for (const place of [{ country: "Australia", stateProv: "TAS" }, { country: "USA", stateProv: "HI" }, { country: "Canada", stateProv: "NL" }, { country: "Brazil" }]) {
      expect(isIanaZone(resolveEventTimeZone(place))).toBe(true);
    }
    expect(withResolvedTimeZone({ timezone: "AUS Eastern Standard Time", country: "Australia" }).timezone).toBe("Australia/Sydney");
  });
});

describe("a match time is the event's wall clock, so one event's zone never moves another's", () => {
  const wall = "2026-11-14T09:00:00";
  const sydney = resolveEventTimeZone({ country: "Australia", stateProv: "NSW" })!;
  const la = resolveEventTimeZone({ country: "USA", stateProv: "CA" })!;
  const perth = resolveEventTimeZone({ country: "Australia", stateProv: "WA" })!;

  it("the same wall time is a different instant in each zone, by exactly the zones' difference", () => {
    const syd = parseEventTime(wall, sydney)!;
    const lax = parseEventTime(wall, la)!;
    const per = parseEventTime(wall, perth)!;
    expect(syd).toBe(Date.UTC(2026, 10, 13, 22, 0)); // Sydney is UTC+11 in November
    expect(lax).toBe(Date.UTC(2026, 10, 14, 17, 0)); // Los Angeles is UTC-8
    expect(per).toBe(Date.UTC(2026, 10, 14, 1, 0)); // Perth is UTC+8
  });

  it("fixing one zone leaves the others' instants alone (nothing is shifted globally)", () => {
    const before = parseEventTime(wall, la);
    parseEventTime(wall, sydney);
    expect(parseEventTime(wall, la)).toBe(before);
  });

  it("a time that carries its own offset is taken as written, in any event zone", () => {
    expect(parseEventTime("2026-11-14T09:00:00+11:00", la)).toBe(Date.UTC(2026, 10, 13, 22, 0));
    expect(parseEventTime("2026-11-14T09:00:00Z", sydney)).toBe(Date.UTC(2026, 10, 14, 9, 0));
  });

  it("is shown on the viewer's clock and, when the event's clock differs, also on the event's", () => {
    const ms = parseEventTime(wall, sydney)!; // 2026-11-13 22:00 UTC
    const text = formatScheduled(ms, sydney, la);
    expect(text).toMatch(/at the event\)$/);
    expect(text).toContain("2:00"); // 22:00 UTC is 2:00 PM in Los Angeles
    expect(text).toContain("9:00"); // and 9:00 AM at the event
  });

  it("a viewer in the event's own zone sees the plain time, nothing extra", () => {
    const ms = parseEventTime(wall, la)!;
    const text = formatScheduled(ms, la, la);
    expect(text).toContain("9:00");
    expect(text).not.toContain("at the event");
    expect(sameClock(ms, la, la)).toBe(true);
    expect(sameClock(ms, la, sydney)).toBe(false);
  });

  it("no known event zone: just the viewer's clock", () => {
    expect(formatScheduled(Date.UTC(2026, 10, 14, 17, 0), null, la)).not.toContain("at the event");
  });
});

describe("event status uses the event's zone, found from its location when the API gives none", () => {
  it("Sydney's Saturday is already Saturday while Los Angeles is still on Friday", () => {
    const event = { dateStart: "2026-11-14", dateEnd: "2026-11-14" };
    const instant = Date.UTC(2026, 10, 13, 20, 0); // Fri 12:00 in Los Angeles, Sat 07:00 in Sydney
    expect(getEventStatus({ ...event, country: "Australia", stateProv: "NSW" }, instant)).toBe("in-progress");
    expect(getEventStatus({ ...event, country: "USA", stateProv: "CA" }, instant)).toBe("upcoming");
  });
});
