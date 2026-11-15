import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ALL_EVENTS, EventTargetSelect } from "@/components/scout-status/event-target-select";

const events = [
  { eventCode: "E1", eventName: "First Event" },
  { eventCode: "E2", eventName: "Second Event" },
];
const noop = () => undefined;

describe("Scout Status event select", () => {
  it("is the shared Select (a button trigger with a label), not a raw <select> with a hardcoded color", () => {
    const html = renderToStaticMarkup(<EventTargetSelect value={ALL_EVENTS} events={events} onChange={noop} />);
    expect(html).toContain('data-testid="scout-status-event-select"');
    expect(html).toContain("Editing targets for");
    expect(html).toContain('role="combobox"');
    expect(html).not.toContain("#1b1b26");
  });

  it("shows the all-events text, or the chosen event's name", () => {
    expect(renderToStaticMarkup(<EventTargetSelect value={ALL_EVENTS} events={events} onChange={noop} />)).toContain("All selected events");
    expect(renderToStaticMarkup(<EventTargetSelect value="E2" events={events} onChange={noop} />)).toContain("Second Event");
  });
});
