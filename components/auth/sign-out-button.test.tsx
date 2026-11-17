import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const logout = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ logout }) }));
vi.mock("@/components/program/program-switcher", () => ({ ProgramSwitcher: () => <div data-testid="switcher" /> }));

import { SignOutButton } from "@/components/auth/sign-out-button";
import { ProgramSetupFrame } from "@/components/program/setup-frame";

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("Sign out on team setup and gate screens", () => {
  it("the shared button renders the Sign out control", () => {
    const html = renderToString(<SignOutButton />);
    expect(html).toContain("Sign out");
    expect(html).toContain('data-testid="sign-out"');
  });

  it("ProgramSetupFrame (one component for every program) renders it under the screen", () => {
    const html = renderToString(
      <ProgramSetupFrame>
        <p>screen</p>
      </ProgramSetupFrame>,
    );
    expect(html).toContain("screen");
    expect(html.indexOf("screen")).toBeLessThan(html.indexOf("Sign out"));
  });

  // Each screen a signed-in person can be stuck on reaches the control through the frame or the standalone enrollment shell.
  it("the gate and setup screens are all inside the frame or the enrollment shell", () => {
    // ProgramGate (no team yet, connecting notice, request sent via TeamSetup) is wrapped in the frame.
    expect(read("components/program/program-gate.tsx")).toMatch(/<ProgramSetupFrame>[\s\S]*<TeamSetup \/>[\s\S]*<\/ProgramSetupFrame>/);
    // The shell's own setup route: the enrollment screen sits inside the frame.
    expect(read("app/(app)/[program]/layout.tsx")).toMatch(/<ProgramSetupFrame>\s*<TeamEnrollmentScreen/);
    // The standalone enrollment screen (signup page, signed in with no team): create/join form, "Request sent" and application states all go through shell().
    const enrollment = read("components/auth/team-enrollment.tsx");
    expect(enrollment).toContain("<SignOutButton />");
    expect(enrollment.match(/return shell\(/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it("TeamSetupCard no longer carries its own copy of the control (no duplicates inside the frame)", () => {
    const card = read("components/auth/team-setup-card.tsx");
    expect(card).not.toContain("logout");
    expect(card).not.toContain("Log out");
  });
});
