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

  // (Which screens sit inside the frame is asserted by rendering them: components/team-setup/team-setup-parity.test.tsx, for every state of the one Join / Apply screen.)

  it("TeamSetupCard no longer carries its own copy of the control (no duplicates inside the frame)", () => {
    const card = read("components/auth/team-setup-card.tsx");
    expect(card).not.toContain("logout");
    expect(card).not.toContain("Log out");
  });
});
