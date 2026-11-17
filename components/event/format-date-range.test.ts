import { describe, expect, it } from "vitest";
import { formatDateRange } from "@/components/event/selected-events-panel";

// An event's dates are calendar dates at the venue. Reading "2027-03-10" as an instant (UTC midnight) and printing it in a viewer's zone showed Mar 9 to
// anyone west of UTC, a day early on every event. The result must be the same whatever zone the viewer is in (run this file with TZ set to check).
describe("formatDateRange", () => {
  it("prints the dates as written, not shifted by the viewer's zone", () => {
    expect(formatDateRange("2027-03-10", "2027-03-13", "en-US")).toBe("Mar 10 – Mar 13");
    expect(formatDateRange("2025-04-02", "2025-04-05", "en-US")).toBe("Apr 2 – Apr 5");
  });

  it("a one-day event is one date", () => {
    expect(formatDateRange("2025-11-08", "2025-11-08", "en-US")).toBe("Nov 8");
  });

  it("crosses months and years without drifting", () => {
    expect(formatDateRange("2026-12-30", "2027-01-02", "en-US")).toBe("Dec 30 – Jan 2");
  });

  it("reads a full timestamp's date part the same way", () => {
    expect(formatDateRange("2027-03-10T00:00:00", "2027-03-13T00:00:00", "en-US")).toBe("Mar 10 – Mar 13");
  });
});
