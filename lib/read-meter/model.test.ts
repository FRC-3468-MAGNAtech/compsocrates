import { describe, expect, it } from "vitest";
import { addCount, collectionKeyOf, describeEstimate, displayKey, pacificDayKey, pageKeyOf, parseFlushBody, recentDayKeys, sanitizeKey, summarizeUsage, totalOf, type Counts } from "./model";

describe("the meter's day and keys", () => {
  it("rolls over at midnight Pacific, not UTC", () => {
    expect(pacificDayKey(new Date("2026-03-10T06:59:00Z"))).toBe("2026-03-09"); // 11:59 PM PDT
    expect(pacificDayKey(new Date("2026-03-10T07:01:00Z"))).toBe("2026-03-10");
    expect(pacificDayKey(new Date("2026-01-10T07:59:00Z"))).toBe("2026-01-09"); // PST
  });
  it("lists recent days, newest first, without repeats", () => {
    expect(recentDayKeys(new Date("2026-03-10T20:00:00Z"), 3)).toEqual(["2026-03-10", "2026-03-09", "2026-03-08"]);
  });
  it("names pages without the program prefix or ids", () => {
    expect(pageKeyOf("/frc/analytics/teams/254")).toBe("analytics~teams~[id]");
    expect(displayKey("analytics~teams~[id]")).toBe("analytics/teams/[id]");
    expect(pageKeyOf("/ftc/dashboard?role=x")).toBe("dashboard");
    expect(pageKeyOf("/frc")).toBe("home");
    expect(pageKeyOf("/events/2026arli/matches/extra")).toBe("events~2026arli~matches");
  });
  it("collapses ids in collection paths and makes keys safe", () => {
    expect(collectionKeyOf("liveMatches/2026x_q1/scouts")).toBe("liveMatches~{id}~scouts");
    expect(sanitizeKey("a.b/c")).toBe("a~b~c");
    expect(sanitizeKey("")).toBe("unknown");
  });
});

describe("flush bodies", () => {
  it("accepts bounded whole numbers and sanitizes keys", () => {
    expect(parseFlushBody({ counts: { "dash.board": { scouting: 12 } } })).toEqual({ ok: true, counts: { "dash~board": { scouting: 12 } } });
  });
  it.each([
    [null],
    [{ counts: [] }],
    [{ counts: { p: { c: -1 } } }],
    [{ counts: { p: { c: 1.5 } } }],
    [{ counts: { p: { c: 2_000_000 } } }],
    [{ counts: { p: "x" } }],
  ])("refuses %j", (body) => {
    expect(parseFlushBody(body)).toEqual({ ok: false });
  });
  it("refuses too many keys", () => {
    const wide: Counts = {};
    for (let i = 0; i < 201; i += 1) addCount(wide, "p", `c${i}`, 1);
    expect(parseFlushBody({ counts: wide })).toEqual({ ok: false });
  });
});

describe("summaries", () => {
  const today = { day: "2026-03-10", total: 90, client: { total: 70, pages: { dashboard: { scouting: 50, users: 20 } } as Counts }, server: { total: 20, routes: { "api/platform/changelog": { platformChangelog: 20 } } as Counts } };
  it("totals, by page, by collection and the top sources", () => {
    const s = summarizeUsage([{ day: "2026-03-10", data: today }, { day: "2026-03-09", data: null }]);
    expect(s.today).toEqual({ day: "2026-03-10", total: 90, client: 70, server: 20 });
    expect(s.days[1]).toEqual({ day: "2026-03-09", total: 0, client: 0, server: 0 });
    expect(s.byPage[0]).toEqual({ source: "dashboard", docs: 70 });
    expect(s.byCollection.map((c) => c.source)).toEqual(["scouting", "users", "platformChangelog"].sort((a, b) => ({ scouting: 50, users: 20, platformChangelog: 20 }[b as "users"] - { scouting: 50, users: 20, platformChangelog: 20 }[a as "users"]) || a.localeCompare(b)));
    expect(s.top[0]).toEqual({ source: "dashboard > scouting", docs: 50 });
    expect(s.top.length).toBeLessThanOrEqual(10);
  });
  it("counts and describes estimates", () => {
    expect(totalOf({ a: { x: 2, y: 3 }, b: { x: 5 } })).toBe(10);
    expect(describeEstimate([{ label: "entries", docs: 1234 }, { label: "sessions", docs: 250 }]).text).toContain("About 1,484 documents");
  });
});
