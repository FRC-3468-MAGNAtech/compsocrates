import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/program/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {} }), usePathname: () => "/account" }));

import { buildMyTeamsRows } from "@/components/team/my-teams-model";
import { MyTeamsRows } from "@/components/team/my-teams-section";
import { EMPTY_ROLES, type MembershipDoc, type ProgramId } from "@/lib/memberships/model";
import type { ProgramMemberships } from "@/lib/account-state";
import { ProgramProvider } from "@/lib/program/context";

const ID = "W0065V";
const FTC_ID = "K7Xq9ZpLm2Rt4VbN8cYw";
const m = (teamId: string, over: Partial<MembershipDoc> = {}) => ({ ...EMPTY_ROLES, uid: "u1", teamId, name: "Pat", status: "active" as const, origin: "verified" as const, joinedAt: 1, leftAt: null, endedBy: null, updatedAt: 1, implicit: false, ...over });
const ready = (memberships: MembershipDoc[]): ProgramMemberships => ({ status: "ready", memberships });
const html = (node: ReactNode, program: ProgramId = "frc") => renderToStaticMarkup(<ProgramProvider program={program}>{node}</ProgramProvider>).replace(/<!-- -->/g, "");

const base = {
  program: "frc" as ProgramId,
  activeTeamId: ID,
  current: [m(ID, { teamNumber: "3468", teamName: "MAGNAtech", role: "coach", isOwner: true })],
  others: { frc: ready([]), ftc: ready([m(FTC_ID, { teamNumber: "35792 + 35794", teamName: "MAGNAtech", role: "match-scout" })]) },
  ours: { number: 3468, name: "MAGNAtech", loaded: true, teamLevel: { number: "3468", name: "MAGNAtech" } },
  badgeOf: (p: ProgramId) => p.toUpperCase(),
  recall: () => null,
};

describe("My teams lists every team across both programs", () => {
  it("one row per active membership of each program, with the program badge, Owner and Active only where they apply", () => {
    const { rows, loading } = buildMyTeamsRows(base);
    expect(loading).toBe(false);
    expect(rows.map((r) => [r.badge, r.label.text, r.active, r.isOwner])).toEqual([
      ["FRC", "Team 3468 · MAGNAtech", true, true],
      ["FTC", "Team 35792 + 35794 · MAGNAtech", false, false],
    ]);
  });

  it("past memberships are not listed, and the other program is 'loading' until it is read", () => {
    const { rows, loading } = buildMyTeamsRows({ ...base, others: { frc: ready([]), ftc: { status: "loading", memberships: [] } }, current: [...base.current, m("OLD", { status: "past" })] });
    expect(rows).toHaveLength(1);
    expect(loading).toBe(true);
  });

  it("renders the two-line label, role and Leave per row, robot teams under the active row with a Team Settings link, and never an id", () => {
    const { rows } = buildMyTeamsRows({ ...base, others: { frc: ready([]), ftc: ready([m(FTC_ID), m("PLAIN1", { teamLabel: "Team PLAIN1" })]) } });
    const out = html(<MyTeamsRows rows={rows} loading={false} robots={[{ id: "r1", number: 35792, name: "Rebels A" }, { id: "r2", number: 35794, name: "Rebels B" }]} />);
    expect(out).toContain('data-testid="my-team-W0065V"'); // the row's test id may carry the team id; its words may not
    expect(out).toMatch(/data-testid="team-label-number"[^>]*>3468</);
    expect(out).toContain("Leave");
    expect(out).toContain('data-testid="my-team-robots"');
    expect(out).toContain("/frc/team-settings");
    const words = out.replace(/data-testid="[^"]*"/g, "");
    expect(words).not.toContain(FTC_ID);
    expect(words).not.toContain("PLAIN1");
    expect(out).toContain('data-testid="team-label-pending"');
  });

  it("says so when there is no team, and shows a skeleton while loading", () => {
    expect(html(<MyTeamsRows rows={[]} loading={false} />)).toContain("not on a team");
    expect(html(<MyTeamsRows rows={[]} loading />)).toContain("animate-pulse");
  });
});
