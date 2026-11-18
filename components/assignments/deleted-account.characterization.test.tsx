import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScheduleGrid } from "@/components/assignments/schedule-grid";
import { ProgramProvider } from "@/lib/program/context";
import type { ScheduleResult } from "@/lib/scheduler/types";
import type { TeamMember } from "@/lib/team-members";

// Characterization (Build 4): an assignment list after an account deletion. A Deleted Account member shows its name; a uid the roster does not know must not crash the grid.
const OPAQUE = "deleted-0123456789abcdef0123456789abcdef";
const member = (uid: string, name: string): TeamMember => ({ uid, name, email: "", primaryRole: "match-scout", secondaryRoles: [], isAdmin: false, isOwner: false });
const version = (...uids: (string | null)[]): ScheduleResult => ({
  slots: uids.map((scoutUid, i) => ({ matchType: "Qualification" as const, matchNumber: 1 + i, slot: "red1" as const, teamNumber: 100 + i, scoutUid })),
  counts: Object.fromEntries(uids.filter((u): u is string => !!u).map((u) => [u, 1])),
  fair: true,
  warning: null,
});
const render = (v: ScheduleResult, members: TeamMember[]) =>
  renderToStaticMarkup(
    <ProgramProvider program="frc">
      <ScheduleGrid version={v} members={members} />
    </ProgramProvider>,
  );

describe("ScheduleGrid with deleted and unresolved scouts", () => {
  it("shows a Deleted Account member by name, in a cell and in the per-scout totals", () => {
    const html = render(version(OPAQUE, "u1"), [member(OPAQUE, "Deleted Account"), member("u1", "Ada")]);
    expect(html).toContain("Deleted Account");
    expect(html).toContain("Ada");
  });

  it("renders without throwing when a slot's uid is not on the roster", () => {
    expect(() => render(version("not-on-roster", null), [member("u1", "Ada")])).not.toThrow();
  });
});
