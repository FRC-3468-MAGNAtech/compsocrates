import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { eventTitle, eventYearLabel, withEventYear } from "@/lib/events/names";
import { createEventNameStore } from "@/lib/events/name-store";

describe("eventYearLabel", () => {
  it("reads the calendar year from a TBA-style key", () => {
    expect(eventYearLabel("2026arli")).toBe("2026");
  });

  it("gives the two-year form for a season-code key", () => {
    expect(eventYearLabel("2025-USCALAB")).toBe("2025-26");
    expect(eventYearLabel("2099-ABC")).toBe("2099-00");
  });

  it("is null when the season is unknown, never a guess", () => {
    for (const key of ["", "   ", "app-testing", "week0", "zzzz", "1800abc", "2200abc"]) expect(eventYearLabel(key)).toBeNull();
  });
});

describe("withEventYear", () => {
  it("adds the year to an FRC name", () => {
    expect(withEventYear("Arkansas Regional", "2026arli")).toBe("Arkansas Regional 2026");
  });

  it("adds the two-year season to a season-code key's name", () => {
    expect(withEventYear("California League Meet", "2025-USCALAB")).toBe("California League Meet 2025-26");
  });

  it("leaves a name that already carries the year", () => {
    expect(withEventYear("Arkansas Regional 2026", "2026arli")).toBe("Arkansas Regional 2026");
    expect(withEventYear("League Meet 2025-26", "2025-USCALAB")).toBe("League Meet 2025-26");
    expect(withEventYear("League Meet 2025–26", "2025-USCALAB")).toBe("League Meet 2025–26");
    expect(withEventYear("2026 Championship", "2025-USCALAB")).toBe("2026 Championship");
  });

  it("leaves a name that has the year in the middle", () => {
    expect(withEventYear("FIRST 2026 Arkansas Regional presented by X", "2026arli")).toBe("FIRST 2026 Arkansas Regional presented by X");
  });

  it("only treats a whole number as the year", () => {
    expect(withEventYear("Event 120260", "2026arli")).toBe("Event 120260 2026");
  });

  it("shows no year when the season is unknown", () => {
    expect(withEventYear("Practice Day", "app-testing")).toBe("Practice Day");
    expect(withEventYear("Unknown event", "")).toBe("Unknown event");
  });

  it("does not decorate a bare key shown as a placeholder", () => {
    expect(withEventYear("2026arli", "2026arli")).toBe("2026arli");
    expect(withEventYear("2025-USCALAB", "2025-USCALAB")).toBe("2025-USCALAB");
  });

  it("eventTitle reads the code and name off a record", () => {
    expect(eventTitle({ code: "2026lake", name: "Bayou Regional" })).toBe("Bayou Regional 2026");
  });
});

describe("the name store: name stays raw, displayName carries the year", () => {
  const store = createEventNameStore({ fetchSeason: async () => ({ ok: true, data: [] }) });

  it("keeps the stored and static names untouched", () => {
    const frc = store.resolve("2026lake");
    expect(frc.name).toBe("Bayou Regional");
    expect(frc.displayName).toBe("Bayou Regional 2026");
    const coded = store.resolve("2025-USCALAB", { "2025-USCALAB": "California League Meet" });
    expect(coded.name).toBe("California League Meet");
    expect(coded.displayName).toBe("California League Meet 2025-26");
  });

  it("an unknown key shows the key and no year", () => {
    const state = store.resolve("app-testing");
    expect(state.displayName).toBe(state.name);
  });
});

// The year is added in `lib/events/names.ts` and the name chain only. A page or component calls `eventTitle` / `withEventYear` (or renders
// `<EventName>`); it never builds the year itself.
describe("no page formats the year itself", () => {
  const root = process.cwd();
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name !== "node_modules" && name !== ".next") walk(full);
      } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(full);
    }
  };
  walk(join(root, "app"));
  walk(join(root, "components"));

  it("no app or components file uses eventYearLabel", () => {
    const offenders = files.filter((f) => /\beventYearLabel\b/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("no app or components file joins an event name to getFullYear()", () => {
    const offenders = files.filter((f) => /(event\w*name\w*[^\n]{0,60}getFullYear|getFullYear[^\n]{0,60}event\w*name)/i.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
