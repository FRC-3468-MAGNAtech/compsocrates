import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ state: { user: null as unknown, loading: false } }));
vi.mock("@/lib/auth", () => ({ useAuth: () => auth.state }));
// The last-used program: the second one the platform lists (any id works; the test does not name a program).
vi.mock("@/lib/program/context", async () => {
  const { PROGRAM_IDS } = await import("@/config/programs");
  return { useProgram: () => PROGRAM_IDS[1] };
});
vi.mock("@/components/program/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import { PROGRAM_IDS } from "@/config/programs";
import { HeaderAuthActions, HeroAuthActions, SignedOutOnly } from "@/components/marketing/auth-actions";

const html = (node: React.ReactElement) => renderToString(node);

describe("marketing account buttons", () => {
  beforeEach(() => {
    auth.state = { user: null, loading: false };
  });

  it("signed out: Log in and Sign up, unchanged", () => {
    const out = html(<HeaderAuthActions />);
    expect(out).toContain("Log in");
    expect(out).toContain("Sign up");
    expect(out).not.toContain("Open dashboard");
    const hero = html(<HeroAuthActions />);
    expect(hero).toContain("Get started");
    expect(hero).toContain("Log in");
  });

  it("auth loading: a neutral placeholder, never the logged-out buttons", () => {
    auth.state = { user: null, loading: true };
    for (const node of [<HeaderAuthActions key="h" />, <HeroAuthActions key="r" />]) {
      const out = html(node);
      expect(out).toContain("auth-actions-placeholder");
      expect(out).not.toContain("Log in");
      expect(out).not.toContain("Sign up");
      expect(out).not.toContain("Get started");
    }
  });

  it("signed in: Open dashboard to the last-used program, no Log in or Sign up", () => {
    auth.state = { user: { uid: "u1" }, loading: false };
    for (const node of [<HeaderAuthActions key="h" />, <HeroAuthActions key="r" />]) {
      const out = html(node);
      expect(out).toContain("Open dashboard");
      expect(out).toContain(`href="/${PROGRAM_IDS[1]}/dashboard"`);
      expect(out).not.toContain("Log in");
      expect(out).not.toContain("Sign up");
      expect(out).not.toContain("Get started");
    }
  });

  it("SignedOutOnly shows its children only when signed out and loaded", () => {
    const child = <SignedOutOnly>Sign up here</SignedOutOnly>;
    expect(html(child)).toContain("Sign up here");
    auth.state = { user: null, loading: true };
    expect(html(child)).not.toContain("Sign up here");
    auth.state = { user: { uid: "u1" }, loading: false };
    expect(html(child)).not.toContain("Sign up here");
  });
});
