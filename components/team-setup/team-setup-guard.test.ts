import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * GUARD: there is ONE team-setup (Join / Apply) screen, and it is `components/team-setup/team-setup-screen.tsx`. This fails when a second one appears: another file
 * rendering the card, a program-specific wrapper, or the old components that this build deleted (the older sign-up form, the FRC enrollment screen, the FTC gate's
 * own setup, "Join another team"). Add a screen's text to the one card, never a copy of it.
 */
const ROOT = path.resolve(__dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && e.name !== ".next") walk(rel, out);
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name)) out.push(rel);
  }
  return out;
}

const files = ["app", "components", "lib"].flatMap((d) => walk(d));
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

describe("one team-setup screen", () => {
  it("only the screen renders the card", () => {
    const users = files.filter((f) => /team-setup-card["']/.test(read(f)) || /<TeamSetupCard\b/.test(read(f)));
    expect(users.sort()).toEqual(["components/team-setup/team-setup-screen.tsx"]);
  });

  it("the words of the Join form live in the card alone", () => {
    const copies = files.filter((f) => f !== "components/auth/team-setup-card.tsx" && read(f).includes("Ask your team admin"));
    expect(copies).toEqual([]);
  });

  it("the components this build removed stay gone", () => {
    const gone = /\b(TeamEnrollmentScreen|TeamEnrollmentFields|useTeamEnrollment|JoinAnotherTeam|PendingJoinCard|TeamSetup)\b(?!Screen|Card|View)/;
    expect(files.filter((f) => gone.test(read(f)))).toEqual([]);
    for (const name of ["components/auth/team-enrollment.tsx", "components/program/team-setup.tsx", "components/team/join-another-team.tsx"]) {
      expect(files).not.toContain(name);
    }
  });

  it("no program-specific team-setup file exists", () => {
    expect(files.filter((f) => /(team-setup|team-enrollment|join-screen|apply-screen)/.test(path.basename(f)) && f !== "components/team-setup/team-setup-screen.tsx" && f !== "components/auth/team-setup-card.tsx" && f !== "lib/team-setup.ts" && f !== "lib/team-setup-client.ts" && f !== "lib/team-enrollment.ts")).toEqual([]);
  });

  it("the shell and the program gate render the one screen inside the one frame", () => {
    expect(read("app/(app)/[program]/layout.tsx")).toMatch(/<ProgramSetupFrame>\s*<TeamSetupScreen/);
    expect(read("components/program/program-gate.tsx")).toContain("<TeamSetupScreen");
  });
});
