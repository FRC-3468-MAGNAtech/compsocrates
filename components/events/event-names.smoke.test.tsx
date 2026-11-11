import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionError, ActionResult, EventInfo } from "@/lib/events/types";

// Event names with the data API MOCKED (never a real request). `getEvents` is the one season-wide call the name store makes;
// `getEvent` (the old per-event call) is mocked as failing too, so a regression back to it would also show up here.
const api = vi.hoisted(() => ({
  getEvents: vi.fn(),
  getEvent: vi.fn(),
}));
vi.mock("@/lib/events/actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/actions")>()),
  getEvents: api.getEvents,
  getEvent: api.getEvent,
}));

import { EventName, EventNameText } from "@/components/events/event-name";
import { EventNamesNotice } from "@/components/events/event-names-notice";
import { SelectedEventsPanel } from "@/components/event/selected-events-panel";
import { HeaderStrip } from "@/components/dashboard/header-strip";
import { placeholderEventForKey } from "@/data/cs/teams";
import { DashboardContext, type DashboardData } from "@/lib/dashboard/data";
import { eventNameStore } from "@/lib/events/event-names";

const fail = (code: ActionError["code"], message: string): ActionResult<never> => ({ ok: false, error: { code, message } });
const NOT_SIGNED_IN = fail("server_not_configured", "Server sign-in is not configured: set FIREBASE_ADMIN_PROJECT_ID.");
const NO_KEY = fail("missing_credentials", "TBA key is not configured: set NEXT_PUBLIC_TBA_API_KEY.");

function apiDown(error: ActionResult<never> = NOT_SIGNED_IN) {
  api.getEvents.mockResolvedValue(error);
  api.getEvent.mockResolvedValue(error);
}

/** Server HTML with React's text-node separators and entity escapes normalized, so assertions read like the screen. */
const clean = (html: string) => html.replace(/<!-- -->/g, "").replace(/&amp;/g, "&").replace(/&#x27;/g, "'");

beforeEach(() => {
  api.getEvents.mockReset();
  api.getEvent.mockReset();
  eventNameStore.reset();
});
afterEach(() => eventNameStore.reset());

describe("<EventName>", () => {
  it("API down: shows the static name for a mapped key, with the reason in the tooltip", async () => {
    apiDown();
    await eventNameStore.ensureSeason(2026);
    const html = clean(renderToString(<EventName eventKey="2026lake" />));
    expect(html).toContain("Bayou Regional");
    expect(html).toContain('data-event-name-source="static"');
    expect(html).toContain("Server sign-in is not configured");
    expect(clean(renderToString(<EventName eventKey="2026arli" />))).toContain("Arkansas Regional");
  });

  it("API down: shows the raw key, the documented last resort, for a key that is not in the map", async () => {
    apiDown(NO_KEY);
    await eventNameStore.ensureSeason(2026);
    const html = clean(renderToString(<EventName eventKey="2026zzzz" />));
    expect(html).toContain(">2026zzzz<");
    expect(html).toContain('data-event-name-source="key"');
    expect(html).toContain("NEXT_PUBLIC_TBA_API_KEY");
  });

  it("while loading: the best known name at once, a no-layout-shift shimmer only when nothing but the key is known", () => {
    const known = clean(renderToString(<EventName eventKey="2026lake" />));
    expect(known).toContain("Bayou Regional");
    expect(known).not.toContain("shimmer");
    const unknown = clean(renderToString(<EventName eventKey="2026zzzz" />));
    expect(unknown).toContain("shimmer");
    expect(unknown).toContain('aria-busy="true"');
    expect(unknown).not.toContain(">2026zzzz<");
  });

  it("API up: the API's name wins over the static one, with no tooltip", async () => {
    api.getEvents.mockResolvedValue({ ok: true, data: [{ ...placeholderEventForKey("2026lake"), name: "Bayou Regional presented by FIRST", dateStart: "2026-04-01", dateEnd: "2026-04-04" } satisfies EventInfo] });
    await eventNameStore.ensureSeason(2026);
    const html = clean(renderToString(<EventName eventKey="2026lake" />));
    expect(html).toContain("Bayou Regional presented by FIRST");
    expect(html).toContain('data-event-name-source="api"');
    expect(html).not.toContain("title=");
    expect(api.getEvents).toHaveBeenCalledTimes(1);
    expect(api.getEvent).not.toHaveBeenCalled();
  });

  it("a caller-held name counts as a stored name; a name equal to the key is ignored", async () => {
    apiDown();
    await eventNameStore.ensureSeason(2026);
    expect(clean(renderToString(<EventName eventKey="2026zzzz" name="Zed Regional" />))).toContain("Zed Regional");
    expect(clean(renderToString(<EventName eventKey="2026lake" name="2026lake" />))).toContain("Bayou Regional");
  });

  it("EventNameText renders a state it is given", () => {
    const html = renderToString(<EventNameText state={{ key: "k", name: "Named", source: "stored", status: "ready" }} />);
    expect(html).toContain("Named");
  });
});

describe("Event Select: the selected events list", () => {
  const events = [placeholderEventForKey("2026lake"), placeholderEventForKey("2026arli"), placeholderEventForKey("2026zzzz")];

  it("API down: lists the static names, and the raw key only for an unmapped event", async () => {
    apiDown();
    await eventNameStore.ensureSeason(2026);
    const html = clean(renderToString(<SelectedEventsPanel events={events} primaryCode="2026lake" canEdit={false} onRemove={() => {}} onMove={() => {}} />));
    expect(html).toContain("Bayou Regional");
    expect(html).toContain("Arkansas Regional");
    expect(html).toContain("Details for Bayou Regional");
    expect(html).toContain("Details for Arkansas Regional");
    // the unmapped event falls back to its key
    expect(html).toContain("Details for 2026zzzz");
  });

  it("is already named before the API has answered", () => {
    const html = clean(renderToString(<SelectedEventsPanel events={events} primaryCode="2026lake" canEdit onRemove={() => {}} onMove={() => {}} />));
    expect(html).toContain("Remove Bayou Regional");
    expect(html).toContain("Remove Arkansas Regional");
  });
});

describe("Dashboard header strip", () => {
  const dashboard = (keys: string[], pickedKey: string): DashboardData => {
    const events = keys.map(placeholderEventForKey);
    return {
      events,
      event: events.find((e) => e.code === pickedKey) ?? null,
      eventStatus: "upcoming",
      setEventCode: () => {},
      timeZone: null,
      first: { loading: false, error: null },
      ourNumber: 3468,
      ourMatches: [],
      nextMatch: null,
      ourRanking: null,
      record: null,
      fieldSize: 0,
    } as unknown as DashboardData;
  };
  const render = (data: DashboardData) => clean(renderToString(<DashboardContext.Provider value={data}><HeaderStrip /></DashboardContext.Provider>));

  it("API down: the one active event shows its static name", async () => {
    apiDown();
    await eventNameStore.ensureSeason(2026);
    const html = render(dashboard(["2026lake"], "2026lake"));
    expect(html).toContain("Bayou Regional");
    expect(html).toContain("2026lake"); // the code stays beside the name
  });

  it("API down: the event switcher shows the picked event's static name", async () => {
    apiDown(NO_KEY);
    await eventNameStore.ensureSeason(2026);
    const html = render(dashboard(["2026arli", "2026lake"], "2026arli"));
    expect(html).toContain("Arkansas Regional");
  });

  it("API down and not in the map: the raw key is the documented last resort", async () => {
    apiDown();
    await eventNameStore.ensureSeason(2026);
    const html = render(dashboard(["2026zzzz"], "2026zzzz"));
    expect(html).toContain(">2026zzzz<");
  });
});

describe("<EventNamesNotice> (Event Select, admins)", () => {
  it("shows an admin-fixable failure with its message", async () => {
    apiDown(NO_KEY);
    await eventNameStore.ensureSeason(2026);
    const html = clean(renderToString(<EventNamesNotice />));
    expect(html).toContain("Event names could not be loaded: TBA key is not configured: set NEXT_PUBLIC_TBA_API_KEY.");
    expect(html).toContain('aria-label="Dismiss"');
  });

  it("names the Firebase Admin variables when server sign-in is not configured", async () => {
    apiDown();
    await eventNameStore.ensureSeason(2026);
    expect(clean(renderToString(<EventNamesNotice />))).toContain("Server sign-in is not configured: set FIREBASE_ADMIN_PROJECT_ID.");
  });

  it("stays quiet for a failure an admin cannot fix, and when nothing failed", async () => {
    expect(renderToString(<EventNamesNotice />)).toBe("");
    apiDown(fail("unauthorized", "Sign in to view event data."));
    await eventNameStore.ensureSeason(2026);
    expect(renderToString(<EventNamesNotice />)).toBe("");
  });
});
