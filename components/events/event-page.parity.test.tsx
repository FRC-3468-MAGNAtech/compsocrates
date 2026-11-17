// The ONE event page rendered for both programs: same layout and components, differences only where the program config says so.
import { readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ProgramId } from "@/config/programs/types";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), useParams: () => ({}), usePathname: () => "/", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/active-event", () => ({ useActiveEvents: () => ({}) }));
vi.mock("@/lib/events/actions", () => ({}));

import { DataSourceCredits } from "@/components/events/data-source-credits";
import { EventDetailsView } from "@/components/events/event-details-view";
import { EventOverview } from "@/components/events/event-overview";
import { ProgramProvider } from "@/lib/program/context";
import { eventBadge } from "@/lib/events/details-model";
import type { EventInfo } from "@/lib/events/types";

const text = (program: ProgramId, node: React.ReactNode) =>
  renderToString(<ProgramProvider program={program}>{node}</ProgramProvider>).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

const event = (over: Partial<EventInfo>): EventInfo => ({
  code: "USCALAB", season: 2025, name: "Lab Qualifier", dateStart: "2025-12-06", dateEnd: "2025-12-07",
  city: "San Diego", stateProv: "CA", country: "USA", venue: "Lab High", website: null, timezone: "America/Los_Angeles", status: "completed", ...over,
});

describe("Overview", () => {
  it("FTC: two-year season, Event Code, FTC wording", () => {
    const html = text("ftc", <EventOverview event={event({})} />);
    expect(html).toContain("2025-26");
    expect(html).toContain("Event Code");
    expect(html).not.toContain("Event Key");
    expect(html).toContain("a competition in the FIRST Tech Challenge season");
    expect(html).toContain("Team lists are loaded from the official FIRST Tech Challenge Events API.");
  });

  it("FRC: unchanged wording and the plain year", () => {
    const html = text("frc", <EventOverview event={event({ code: "2026lake", season: 2026, name: "Bayou Regional" })} />);
    expect(html).toContain("Event Key");
    expect(html).toContain("a competition in the FIRST Robotics season");
    expect(html).toContain("Team lists are loaded from the official FIRST API.");
    expect(html).not.toContain("2026-27");
  });

  it("both show the same sections", () => {
    for (const program of ["frc", "ftc"] as const) {
      const html = text(program, <EventOverview event={event({})} />);
      for (const heading of ["Event Information", "About This Event", "Location", "Dates", "Season"]) expect(html).toContain(heading);
    }
  });
});

describe("Data source credit", () => {
  it("FRC names The Blue Alliance and the FIRST API, as before", () => {
    const html = text("frc", <DataSourceCredits />);
    expect(html).toContain("Event and match data may include information from");
    expect(html).toContain("The Blue Alliance");
    expect(html).toContain("and the official ");
    expect(html).toContain("https://frc-events.firstinspires.org/services/API");
  });
  it("FTC links the FTC Events API page and does not name The Blue Alliance", () => {
    const html = text("ftc", <DataSourceCredits />);
    expect(html).toContain("the official ");
    expect(html).toContain("FIRST Tech Challenge Events API");
    expect(html).toContain("https://ftc-events.firstinspires.org/services/API");
    expect(html).not.toContain("Blue Alliance");
    expect(html).toContain("FIRST asks developers using API data to link back");
  });
});

describe("Event page key handling", () => {
  it("an FTC key shows the loading state (it parsed), under FTC", () => {
    expect(text("ftc", <EventDetailsView eventKey="2025-USCALAB" />)).toContain("Loading event");
    expect(text("ftc", <EventDetailsView eventKey="2025-uscalab" />)).toContain("Loading event");
  });
  it("an FRC key shows the loading state under FRC", () => {
    expect(text("frc", <EventDetailsView eventKey="2026lake" />)).toContain("Loading event");
  });
  it("a key of the other program's shape is Event not found, with that program's wording", () => {
    const ftcPage = text("ftc", <EventDetailsView eventKey="2026lake" />);
    expect(ftcPage).toContain("Event not found");
    expect(ftcPage).toContain("like 2025-USCALAB");
    const frcPage = text("frc", <EventDetailsView eventKey="2025-USCALAB" />);
    expect(frcPage).toContain("Event not found");
    expect(frcPage).toContain("like 2026arli");
  });
  it("both pages have the same back link, credit panel and not-found card", () => {
    for (const program of ["frc", "ftc"] as const) {
      const html = text(program, <EventDetailsView eventKey="nonsense" />);
      expect(html).toContain("Active Events");
      expect(html).toContain("Data Sources");
      expect(html).toContain("Event not found");
    }
  });
});

describe("status (Session D): an event is never live after it ended, in its own time zone", () => {
  const dates = { dateStart: "2025-12-06", dateEnd: "2025-12-07", timezone: "America/Los_Angeles" };
  const at = (iso: string) => new Date(iso).getTime();
  it("upcoming, running and finished", () => {
    expect(eventBadge(dates, at("2025-12-01T20:00:00Z")).tone).toBe("upcoming");
    expect(eventBadge(dates, at("2025-12-07T18:00:00Z")).tone).toBe("live");
    expect(eventBadge(dates, at("2025-12-08T09:00:00Z"))).toEqual({ label: "Completed", tone: "done" }); // Dec 8, 01:00 in Los Angeles
    expect(eventBadge(dates, at("2026-03-01T00:00:00Z")).tone).toBe("done");
  });
});

describe("the tabs cannot read an event without the program", () => {
  it("no tab calls an event action directly; they go through eventQueries, which always passes the program", () => {
    for (const file of ["teams-tab", "schedule-tab", "rankings-tab"]) {
      const source = readFileSync(`components/events/${file}.tsx`, "utf8");
      expect(source).not.toContain('from "@/lib/events/actions"');
      expect(source).toContain("eventQueries(program");
    }
  });
});

describe("assignments schedule read (found by the Batch 7 audit)", () => {
  it("passes the program to the event action and scopes its cache key", () => {
    const source = readFileSync("lib/assignments.ts", "utf8");
    expect(source).toMatch(/getMatchesForEvent\(eventCode!, "Qualification", season, program\)/);
    expect(source).toMatch(/getMatchesForEvent\(eventCode!, "Playoff", season, program\)/);
    expect(source).toMatch(/getMatchesForEvent\(eventCode!, "Practice", season, program\)/);
    expect(source).toContain("scopedKey(program, `assign:");
  });
});
