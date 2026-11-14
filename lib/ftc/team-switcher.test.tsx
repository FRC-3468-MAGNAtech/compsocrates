import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TeamSwitcher } from "@/components/program/team-switcher";
import type { ProgramId } from "@/config/programs/types";
import { AccountTeamContext, OurTeamContext, ourTeamFrom, type AccountTeamChoice } from "@/lib/our-team";
import { ProgramProvider } from "@/lib/program/context";

const TEAMS = [
  { id: "t1", number: 111, name: "Alpha" },
  { id: "t2", number: 222, name: "Beta" },
];

function render(program: ProgramId, choice: AccountTeamChoice): string {
  const tree: ReactNode = createElement(
    ProgramProvider,
    { program },
    createElement(OurTeamContext.Provider, { value: ourTeamFrom({ number: 111, name: "Alpha" }) }, createElement(AccountTeamContext.Provider, { value: choice }, createElement(TeamSwitcher)))
  );
  return renderToStaticMarkup(tree);
}

const choice = (teams = TEAMS, selectedId: string | null = "t1"): AccountTeamChoice => ({ teams, selectedId, select: () => {} });

describe("TeamSwitcher", () => {
  it("shows the selected team in a program that allows several teams per account", () => {
    const html = render("ftc", choice());
    expect(html).toContain('data-testid="team-switcher"');
    expect(html).toContain("Team 111");
  });

  it("shows the second team when it is the selected one", () => {
    expect(render("ftc", choice(TEAMS, "t2"))).toContain("Team 222");
  });

  it("renders nothing with one team, or none: there is nothing to switch", () => {
    expect(render("ftc", choice([TEAMS[0]]))).toBe("");
    expect(render("ftc", choice([], null))).toBe("");
  });

  it("renders nothing in a program with one team per account, whatever the context holds", () => {
    expect(render("frc", choice())).toBe("");
  });
});
