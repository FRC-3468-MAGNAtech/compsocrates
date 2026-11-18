import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DeletionRow } from "@/components/admin/account-deletions-panel";

const job = { opaqueId: "deleted-0123456789abcdef0123456789abcdef", status: "cooldown" as const, step: "cooldown" as const, startedAt: 1_700_000_000_000, updatedAt: 1_700_000_100_000, notBeforeMs: 1_700_004_200_000, sweepLoops: 0, runs: 1, lastError: null, requestedBy: "self" as const };

describe("an Account deletions row", () => {
  it("shows the opaque id, the status, the step and the cooldown, and nothing that names a person", () => {
    const html = renderToStaticMarkup(<DeletionRow job={job} now={1_700_000_200_000} busy={false} onResume={() => {}} />);
    expect(html).toContain(job.opaqueId);
    expect(html).toContain("Waiting (cooldown)");
    expect(html).toContain("Step: cooldown");
    expect(html).toContain("cooldown ends in about");
    expect(html).toContain("Resume");
  });

  it("shows a stalled job and the sweep count", () => {
    const html = renderToStaticMarkup(<DeletionRow job={{ ...job, status: "stalled", step: "sweep", sweepLoops: 3, notBeforeMs: null, lastError: "sweep found rows in: frc:scouting" }} now={0} busy={false} onResume={() => {}} />);
    expect(html).toContain("Stalled");
    expect(html).toContain("sweeps 3");
    expect(html).toContain("sweep found rows in: frc:scouting");
  });
});
