import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountState } from "@/lib/account-state";
import type { OurTeam } from "@/lib/our-team";

// CHARACTERIZATION of the membership `TeamSwitcher` as it was BEFORE the one-switcher change (memberships build 2): what its trigger shows in each state.
// It documents today's behavior, including the fallback that put an internal id in the label ("Team " + the team id); the replacement tests live next to
// the new component and assert that an id never appears.
let accountState: AccountState;
let ours: OurTeam;
vi.mock("@/lib/account-state", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/account-state")>()), useAccountState: () => accountState }));
vi.mock("@/lib/our-team", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/our-team")>()), useOurTeam: () => ours }));
vi.mock("@/lib/memberships/switching", () => ({ useTeamSwitch: () => ({ target: null, error: null, switchTo: async () => {}, clearError: () => {} }) }));
vi.mock("@/lib/program/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {} }), usePathname: () => "/dashboard" }));

import { TeamSwitcher } from "@/components/team/team-switcher";
import { resetMembershipsEnabled } from "@/lib/memberships/client";
import { EMPTY_ROLES } from "@/lib/memberships/model";

const membership = (teamId: string, teamLabel?: string) => ({
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
  ...(teamLabel ? { teamLabel } : {}),
});
const state = (activeTeamId: string | null, memberships: ReturnType<typeof membership>[], status: AccountState["status"] = "team"): AccountState => ({ status, activeTeamId, memberships, program: "frc" });
const html = () => renderToStaticMarkup(<TeamSwitcher />).replace(/<!-- -->/g, "");

beforeEach(() => {
  resetMembershipsEnabled(true);
  ours = { number: null, name: null, loaded: false };
});

describe("TeamSwitcher (before the one-switcher change)", () => {
  it("draws nothing while the memberships are loading, or when there is no row", () => {
    accountState = state(null, [], "loading");
    expect(html()).toBe("");
    accountState = state(null, [], "no-team");
    expect(html()).toBe("");
  });

  it("names the active team from the loaded team document", () => {
    accountState = state("T1", [membership("T1", "Team 1 · Stored")]);
    ours = { number: 3468, name: "MAGNAtech", loaded: true };
    expect(html()).toContain("Team 3468 · MAGNAtech");
    expect(html()).toContain('data-testid="membership-team-switcher"');
  });

  it("falls back to the stored label while the team document is not known yet", () => {
    accountState = state("T1", [membership("T1", "Team 1 · Stored")]);
    expect(html()).toContain("Team 1 · Stored");
  });

  it("used the team id as the label when there was neither (the bug the new switcher removes)", () => {
    accountState = state("W0065V", [membership("W0065V")]);
    expect(html()).toContain("Team W0065V");
  });

  it("adds a row for an active pointer with no membership of its own, and is one dropdown", () => {
    accountState = state("T1", []);
    ours = { number: 7, name: null, loaded: true };
    const out = html();
    expect(out).toContain("Team 7");
    expect((out.match(/role="combobox"/g) ?? []).length).toBe(1);
  });
});
