import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SetupCheckView, type SetupCheckItem } from "./setup-check-panel";

const html = (node: React.ReactNode) => renderToString(node).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
const noop = () => {};

const tba: SetupCheckItem = { name: "NEXT_PUBLIC_TBA_API_KEY", group: "cs", purpose: "The Blue Alliance API key", whenMissing: "Event names, schedules, teams." };

describe("SetupCheckView", () => {
  it("shows a loading state before the first answer", () => {
    const out = html(<SetupCheckView data={null} loading error={null} onRetry={noop} />);
    expect(out).toContain("Checking the server setup");
    expect(out).not.toContain("Everything required is configured");
  });

  it("says everything is configured when nothing is missing", () => {
    const out = html(<SetupCheckView data={{ missing: [], optionalOff: [] }} loading={false} error={null} onRetry={noop} />);
    expect(out).toContain("Everything required is configured");
  });

  it("lists each missing variable by name with what breaks", () => {
    const out = html(<SetupCheckView data={{ missing: [tba], optionalOff: [] }} loading={false} error={null} onRetry={noop} />);
    expect(out).toContain("NEXT_PUBLIC_TBA_API_KEY");
    expect(out).toContain("Event names, schedules, teams.");
    expect(out).toContain("CompSocrates setting");
    expect(out).not.toContain("Everything required is configured");
  });

  it("shows the error and a retry, never the all-clear", () => {
    const out = html(<SetupCheckView data={null} loading={false} error="Server sign-in is not configured: set FIREBASE_ADMIN_PROJECT_ID." onRetry={noop} />);
    expect(out).toContain("Could not run the check.");
    expect(out).toContain("FIREBASE_ADMIN_PROJECT_ID");
    expect(out).toContain("Try again");
    expect(out).not.toContain("Everything required is configured");
  });

  it("counts the optional features that are off", () => {
    const optional: SetupCheckItem = { name: "RESEND_API_KEY", group: "optional", purpose: "Email", whenMissing: "No notification emails." };
    const out = html(<SetupCheckView data={{ missing: [], optionalOff: [optional] }} loading={false} error={null} onRetry={noop} />);
    expect(out).toContain("Optional features that are off (1)");
    expect(out).toContain("RESEND_API_KEY");
  });
});
