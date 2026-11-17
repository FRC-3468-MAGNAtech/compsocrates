import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FormPageView } from "@/components/forms/form-page";
import { SAMPLE_LEAD_FORM } from "@/app/e2e/sample-team-forms";
import type { EventInfo } from "@/lib/events/types";

const text = (html: string) => html.replace(/<!-- -->/g, "").replace(/&#x27;/g, "'");
const EVENT: EventInfo = { code: "EVT1", season: 2025, name: "Qualifier", dateStart: "2025-11-08", dateEnd: "2025-11-08", city: null, stateProv: null, country: null, venue: null, website: null, timezone: null, status: "in-progress" };

const render = (lockout?: { locked: boolean; reason: string }) =>
  text(
    renderToString(
      <FormPageView
        form={SAMPLE_LEAD_FORM}
        title="REEFSCAPE Lead Scout Form"
        subtitle="Fixture"
        events={[EVENT]}
        eventsLoaded
        defaultEventCode="EVT1"
        scoutName="Ada"
        matches={[]}
        teams={[]}
        planEntries={[]}
        renderMatchPicker={() => <span>match picker</span>}
        onSave={async () => "id"}
        lockout={lockout}
        headerExtra={<span data-testid="season-slot">season select</span>}
      />
    )
  );

describe("a form page while the team has closed submissions for its season", () => {
  it("keeps the form on screen, disables Submit and says why", () => {
    const out = render({ locked: true, reason: "Submissions for REEFSCAPE are turned off by your team admin" });
    expect(out).toContain("REEFSCAPE Lead Scout Form");
    expect(out).toContain('data-testid="lockout-banner"');
    expect(out).toContain('data-testid="submit-locked-note"');
    expect(out).toContain("Submissions for REEFSCAPE are turned off by your team admin");
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*data-testid="submit-form"|<button[^>]*data-testid="submit-form"[^>]*disabled=""/);
    // the fields are still there to type into
    expect(out).toContain('data-testid="form-page"');
    expect(out).toContain("match picker");
  });

  it("an open season has no banner, no note and an enabled Submit", () => {
    const out = render({ locked: false, reason: "" });
    expect(out).not.toContain("lockout-banner");
    expect(out).not.toContain("submit-locked-note");
    expect(out).not.toMatch(/<button[^>]*disabled=""[^>]*data-testid="submit-form"/);
  });

  it("shows the controls the page puts beside the title (the season select)", () => {
    expect(render()).toContain('data-testid="season-slot"');
  });
});
