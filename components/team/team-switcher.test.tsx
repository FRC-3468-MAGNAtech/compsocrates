import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountState, ProgramMemberships } from "@/lib/account-state";
import type { OurTeam } from "@/lib/our-team";

// The ONE team switcher (replaces the membership TeamSwitcher and the FieldTeamSwitcher; their characterization is in git history, commit 7e7d296 and before).
// Every state is rendered with a KNOWN id and an UNKNOWN name, and the id must never appear.
let accountState: AccountState;
let ours: OurTeam;
vi.mock("@/lib/auth", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth")>()), useAuth: () => ({ user: { uid: "u1" }, profile: { teamId: "W0065V" }, loading: false }) }));
vi.mock("@/lib/account-state", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/account-state")>()), useAccountState: () => accountState }));
vi.mock("@/lib/our-team", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/our-team")>()), useOurTeam: () => ours }));
vi.mock("@/lib/memberships/switching", () => ({ useTeamSwitch: () => ({ target: null, error: null, switchTo: async () => {}, clearError: () => {} }) }));
vi.mock("@/lib/program/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {} }), usePathname: () => "/dashboard" }));

import { TeamSwitcher, TeamSwitcherPanelBody } from "@/components/team/team-switcher";
import { buildSwitcherModel, type ModelInput } from "@/components/team/team-switcher-model";
import { resetMembershipsEnabled } from "@/lib/memberships/client";
import { EMPTY_ROLES, type MembershipDoc, type ProgramId } from "@/lib/memberships/model";
import { AccountTeamContext, type AccountTeamChoice } from "@/lib/our-team";
import { ProgramProvider } from "@/lib/program/context";

const ID = "W0065V";
const FTC_ID = "K7Xq9ZpLm2Rt4VbN8cYw";
const membership = (teamId: string, over: Partial<MembershipDoc> = {}) => ({
  ...EMPTY_ROLES,
  uid: "u1",
  teamId,
  name: "Pat",
  status: "active" as const,
  origin: "verified" as const,
  joinedAt: 1,
  leftAt: null,
  endedBy: null,
  updatedAt: 1,
  implicit: false,
  ...over,
});
const state = (activeTeamId: string | null, memberships: ReturnType<typeof membership>[], status: AccountState["status"] = "team"): AccountState => ({ status, activeTeamId, memberships, program: "frc" });
const text = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function html(node: ReactNode, program: ProgramId = "frc"): string {
  return renderToStaticMarkup(<ProgramProvider program={program}>{node}</ProgramProvider>).replace(/<!-- -->/g, "");
}
const choice = (teams: AccountTeamChoice["teams"], selectedId: string | null): AccountTeamChoice => ({ teams, selectedId, select: () => {} });

beforeEach(() => {
  resetMembershipsEnabled(true);
  ours = { number: null, name: null, loaded: false };
});

describe("TeamSwitcher, memberships ON", () => {
  it("draws nothing while the memberships are loading", () => {
    accountState = state(null, [], "loading");
    expect(html(<TeamSwitcher />)).toBe("");
  });

  it("shows the active context from the loaded team: program badge, number in bold, name beneath; one control", () => {
    accountState = state(ID, [membership(ID, { teamNumber: "1", teamName: "Stale snapshot" })]);
    ours = { number: 3468, name: "MAGNAtech", loaded: true };
    const out = html(<TeamSwitcher />);
    expect(out).toContain('data-testid="membership-team-switcher"');
    expect(out).toMatch(/data-testid="team-switcher-badge"[^>]*>FRC</);
    expect(out).toMatch(/data-testid="team-label-number"[^>]*>3468</);
    expect(out).toMatch(/data-testid="team-label-name"[^>]*>MAGNAtech</);
    expect((out.match(/aria-haspopup/g) ?? []).length).toBe(1);
    expect(out).not.toContain("role=\"combobox\"");
  });

  it("first paint, before the team document: the membership's snapshot, then its older label, never the id", () => {
    accountState = state(ID, [membership(ID, { teamNumber: "3468", teamName: "MAGNAtech" })]);
    expect(text(html(<TeamSwitcher />))).toContain("3468 MAGNAtech");
    accountState = state(ID, [membership(ID, { teamLabel: "Team 254 · Cheesy" })]);
    expect(text(html(<TeamSwitcher />))).toContain("254 Cheesy");
  });

  it("an OLD membership with no snapshot, label or cache is a skeleton: the id never appears (FRC join code and FTC random id)", () => {
    for (const id of [ID, FTC_ID]) {
      accountState = state(id, [membership(id)]);
      const out = html(<TeamSwitcher />);
      expect(out).toContain('data-testid="team-label-pending"');
      expect(out).not.toContain(id);
      expect(out).not.toContain(id.toLowerCase());
    }
  });

  it("a stored piece that IS the id is dropped (a bad snapshot cannot leak it)", () => {
    accountState = state(ID, [membership(ID, { teamNumber: ID, teamName: ID })]);
    const out = html(<TeamSwitcher />);
    expect(out).not.toContain(ID);
    expect(out).toContain('data-testid="team-label-pending"');
  });

  it("a pointer the memberships do not list yet still draws one trigger from the live team", () => {
    accountState = state(ID, []);
    ours = { number: 7, name: null, loaded: true };
    expect(text(html(<TeamSwitcher />))).toContain("7");
  });
});

describe("TeamSwitcher, memberships OFF: only the robot-team choice", () => {
  const teams = [
    { id: "r1", number: 35792, name: "MAGNAtech Rebels A" },
    { id: "r2", number: 35794, name: "MAGNAtech Rebels B" },
  ];
  const render = (program: ProgramId, c: AccountTeamChoice) =>
    html(
      <AccountTeamContext.Provider value={c}>
        <TeamSwitcher />
      </AccountTeamContext.Provider>,
      program
    );
  beforeEach(() => {
    resetMembershipsEnabled(false);
    ours = { number: 35792, name: "MAGNAtech Rebels A", loaded: true };
  });

  it("shows the selected robot team in the same style with two or more", () => {
    const out = render("ftc", choice(teams, "r1"));
    expect(out).toContain('data-testid="team-switcher"');
    expect(out).toMatch(/data-testid="team-label-number"[^>]*>35792</);
    expect(out).toMatch(/data-testid="team-label-name"[^>]*>MAGNAtech Rebels A</);
    expect((out.match(/aria-haspopup/g) ?? []).length).toBe(1);
  });

  it("renders nothing with one robot team, none, or in a program with one team per account", () => {
    expect(render("ftc", choice([teams[0]], "r1"))).toBe("");
    expect(render("ftc", choice([], null))).toBe("");
    expect(render("frc", choice(teams, "r1"))).toBe("");
  });
});

describe("the view model", () => {
  const none: Record<ProgramId, ProgramMemberships> = { frc: { status: "idle", memberships: [] }, ftc: { status: "idle", memberships: [] } };
  const input = (over: Partial<ModelInput> = {}): ModelInput => ({
    membershipsOn: true,
    program: "ftc",
    activeTeamId: FTC_ID,
    current: [membership(FTC_ID, { teamNumber: "35792 + 35794", teamName: "MAGNAtech" })],
    others: none,
    ours: { number: 35792, name: "MAGNAtech Rebels A", loaded: true, teamLevel: { number: "35792 + 35794", name: "MAGNAtech" } },
    robots: { teams: [{ id: "r1", number: 35792, name: "Rebels A" }, { id: "r2", number: 35794, name: "Rebels B" }], selectedId: "r1" },
    badgeOf: (p) => p.toUpperCase(),
    recall: () => null,
    remembered: () => [],
    ...over,
  });

  it("lists every program's teams: the other program's from the device cache until it is read, then from its memberships", () => {
    const cached = input({ remembered: (p) => (p === "frc" ? [{ teamId: ID, parts: { number: "3468", name: "MAGNAtech" } }] : []) });
    const before = buildSwitcherModel(cached);
    const frc = before.groups.find((g) => g.program === "frc")!;
    expect(frc.status).toBe("idle");
    expect(frc.rows.map((r) => r.label.text)).toEqual(["Team 3468 · MAGNAtech"]);
    const read = buildSwitcherModel(input({ others: { ...none, frc: { status: "ready", memberships: [membership(ID, { teamNumber: "254", teamName: "Cheesy" }), membership("OLD111")] } } }));
    const rows = read.groups.find((g) => g.program === "frc")!.rows;
    expect(rows.map((r) => r.label.text)).toEqual(["Team 254 · Cheesy", "Team (loading)"]);
  });

  it("the active FTC row is the TEAM (organization name, numbers joined), the trigger is the selected robot team", () => {
    const model = buildSwitcherModel(input());
    const ftc = model.groups.find((g) => g.program === "ftc")!;
    expect(ftc.rows[0]).toMatchObject({ active: true, label: { number: "35792 + 35794", name: "MAGNAtech" } });
    expect(model.trigger.label).toMatchObject({ number: "35792", name: "MAGNAtech Rebels A" });
    expect(model.trigger.badge).toBe("FTC");
  });

  it("robot teams only with two or more; with the switch OFF there are no groups", () => {
    expect(buildSwitcherModel(input({ robots: { teams: [{ id: "r1", number: 1, name: null }], selectedId: "r1" } })).robots).toEqual([]);
    const off = buildSwitcherModel(input({ membershipsOn: false }));
    expect(off.groups).toEqual([]);
    expect(off.worthShowing).toBe(true);
    expect(buildSwitcherModel(input({ membershipsOn: false, robots: { teams: [], selectedId: null } })).worthShowing).toBe(false);
  });

  it("no state of the model contains an id (first paint, other programs, old memberships, a failed read)", () => {
    const states: ModelInput[] = [
      input({ ours: { number: null, name: null, loaded: false }, current: [membership(FTC_ID)] }),
      input({ current: [membership(FTC_ID, { teamNumber: FTC_ID, teamName: FTC_ID })], ours: { number: null, name: null, loaded: false } }),
      input({ others: { ...none, frc: { status: "ready", memberships: [membership(ID), membership("PLAIN1", { teamLabel: "Team PLAIN1" })] } } }),
      input({ others: { ...none, frc: { status: "ready", memberships: [] } } }), // a failed read: an empty list
      input({ others: { ...none, frc: { status: "loading", memberships: [] } }, remembered: () => [{ teamId: ID, parts: { number: ID, name: ID } }] }),
    ];
    for (const s of states) {
      const json = JSON.stringify(buildSwitcherModel(s));
      for (const id of [ID, FTC_ID, "PLAIN1"]) {
        // the id may appear only as the internal `teamId`/`key` of a row (used to switch), never inside a label
        expect(json.replace(new RegExp(`"(teamId|key)":"[^"]*${id}[^"]*"`, "g"), "")).not.toContain(id);
      }
    }
  });
});

describe("the panel", () => {
  const model = buildSwitcherModel({
    membershipsOn: true,
    program: "ftc",
    activeTeamId: FTC_ID,
    current: [membership(FTC_ID, { teamNumber: "35792 + 35794", teamName: "MAGNAtech" })],
    others: { frc: { status: "ready", memberships: [membership(ID, { teamNumber: "3468", teamName: "MAGNAtech" })] }, ftc: { status: "idle", memberships: [] } },
    ours: { number: 35792, name: "Rebels A", loaded: true },
    robots: { teams: [{ id: "r1", number: 35792, name: "Rebels A" }, { id: "r2", number: 35794, name: "Rebels B" }], selectedId: "r2" },
    badgeOf: (p) => p.toUpperCase(),
    recall: () => null,
    remembered: () => [],
  });
  const render = (error: string | null = null) => html(<TeamSwitcherPanelBody model={model} error={error} onPickTeam={() => {}} onPickRobot={() => {}} onJoin={() => {}} />, "ftc");

  it("groups by program, checks the active team, lists its robot teams under it ('View as') and ends with the Join link", () => {
    const out = render();
    expect(out.indexOf("team-switcher-group-frc")).toBeLessThan(out.indexOf("team-switcher-group-ftc"));
    expect(out).toContain('aria-current="true"');
    expect(out).toContain('data-testid="team-switcher-robots"');
    expect(out).toContain("View as");
    expect(out.indexOf("team-switcher-robots")).toBeGreaterThan(out.indexOf(`team-switcher-row-ftc|${FTC_ID}`));
    expect(out).toMatch(/data-testid="team-switcher-join"/);
    expect(out).toContain("/ftc/apply-to-team");
    // two rows, the robots, never two dropdowns
    expect(out).not.toContain("combobox");
    expect(text(out)).toContain("3468 MAGNAtech");
    expect(text(out)).toContain("35792 + 35794 MAGNAtech");
  });

  it("shows an inline notice for a refused switch", () => {
    expect(render("This team's profile isn't set up yet. Ask a team admin.")).toContain('data-testid="team-switcher-error"');
    expect(render()).not.toContain('data-testid="team-switcher-error"');
  });

  it("with the switch OFF the body is the robot list alone (no groups, no Join link)", () => {
    const off = buildSwitcherModel({ ...({} as ModelInput), membershipsOn: false, program: "ftc", activeTeamId: FTC_ID, current: null, others: { frc: { status: "idle", memberships: [] }, ftc: { status: "idle", memberships: [] } }, ours: { number: 1, name: null, loaded: true }, robots: { teams: [{ id: "r1", number: 1, name: "A" }, { id: "r2", number: 2, name: "B" }], selectedId: "r1" }, badgeOf: (p) => p, recall: () => null, remembered: () => [] });
    const out = html(<TeamSwitcherPanelBody model={off} error={null} onPickTeam={() => {}} onPickRobot={() => {}} onJoin={() => {}} />, "ftc");
    expect(out).toContain("team-switcher-robots");
    expect(out).not.toContain("team-switcher-group");
    expect(out).not.toContain("team-switcher-join");
  });
});
