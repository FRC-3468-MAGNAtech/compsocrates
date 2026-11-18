import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScheduleGrid } from "@/components/assignments/schedule-grid";
import { ProgramProvider } from "@/lib/program/context";
import type { ScheduleResult } from "@/lib/scheduler/types";

const OPAQUE = "deleted-0123456789abcdef0123456789abcdef";
const RAW = "raw-uid-of-someone-gone";
const version: ScheduleResult = {
  slots: [
    { matchType: "Qualification", matchNumber: 1, slot: "red1", teamNumber: 100, scoutUid: OPAQUE },
    { matchType: "Qualification", matchNumber: 2, slot: "red1", teamNumber: 101, scoutUid: RAW },
  ],
  counts: { [OPAQUE]: 1, [RAW]: 1 },
  fair: true,
  warning: null,
};

describe("ScheduleGrid never prints a uid", () => {
  it("shows Deleted Account for an opaque id (not on the roster) and Former member for any other unknown uid", () => {
    const html = renderToStaticMarkup(
      <ProgramProvider program="frc">
        <ScheduleGrid version={version} members={[]} />
      </ProgramProvider>,
    );
    expect(html).toContain("Deleted Account");
    expect(html).toContain("Former member");
    expect(html).not.toContain(OPAQUE);
    expect(html).not.toContain(RAW);
  });
});
