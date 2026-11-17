import { describe, expect, it } from "vitest";
import { entriesToCsv, parseCsv } from "@/lib/analytics/csv";
import type { GameSchema } from "@/lib/analytics/game-schema";
import type { ScoutEntry } from "@/lib/scout-entries";

// A two-column schema is enough: the event name column is added by entriesToCsv, not by the schema.
const col = (key: string, label: string, getValue: (e: ScoutEntry) => unknown) => ({ key, phase: "Information", category: "Information", label, type: "text", getValue });
const withEvent = { id: "t", name: "t", columns: [col("team", "Team", (e) => e.teamNumber), col("event", "Event", (e) => e.eventCode), col("scout", "Scout", (e) => e.scoutName)] } as unknown as GameSchema;
const withoutEvent = { id: "t", name: "t", columns: [col("team", "Team", (e) => e.teamNumber), col("scout", "Scout", (e) => e.scoutName)] } as unknown as GameSchema;
const entry = (eventCode: string) => ({ teamNumber: 254, scoutName: "Ada", eventCode }) as unknown as ScoutEntry;

describe("entriesToCsv: event name column", () => {
  it("adds an Event Name column right after the event code column", () => {
    const [header, ...rows] = parseCsv(entriesToCsv(withEvent, [entry("2026lake"), entry("2026zzzz")], (s) => s));
    expect(header).toEqual(["Information - Information - Team", "Information - Information - Event", "Information - Information - Event Name", "Information - Information - Scout"]);
    expect(rows[0]).toEqual(["254", "2026lake", "Bayou Regional", "Ada"]);
    // an event the static table does not know falls back to its key
    expect(rows[1]).toEqual(["254", "2026zzzz", "2026zzzz", "Ada"]);
  });

  it("uses the caller's resolver (the live API names) when given", () => {
    const [, row] = parseCsv(entriesToCsv(withEvent, [entry("2026lake")], (s) => s, { eventName: (k) => `API name of ${k}` }));
    expect(row[2]).toBe("API name of 2026lake");
  });

  it("leaves the columns alone when the schema has no event column, unless includeEvent is set", () => {
    expect(parseCsv(entriesToCsv(withoutEvent, [entry("2026lake")], (s) => s))[0]).toHaveLength(2);
    const [header, row] = parseCsv(entriesToCsv(withoutEvent, [entry("2026arli")], (s) => s, { includeEvent: true }));
    expect(header.slice(-2)).toEqual(["Event", "Event Name"]);
    expect(row.slice(-2)).toEqual(["2026arli", "Arkansas Regional"]);
  });

  it("an entry with no event leaves the name cell empty", () => {
    const [, row] = parseCsv(entriesToCsv(withEvent, [entry("")], (s) => s));
    expect(row[2]).toBe("");
  });
});
