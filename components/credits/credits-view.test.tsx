import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CREDITS } from "@/lib/credits/seed";
import type { CreditSection } from "@/lib/credits/ops";

// The hook is mocked: these tests are about WHAT the one view shows (the saved document, else the built-in list) and that nothing in it needs a
// sign-in, a team or a program. Nothing here needs a provider: if the view read the auth, team or program context it would throw.
const state = vi.hoisted(() => ({ value: { sections: [] as CreditSection[], loaded: true, error: false, retry: () => {} } }));
vi.mock("@/lib/credits/client", () => ({ usePublicCredits: () => state.value }));

import { CreditsContent, CreditsView } from "@/components/credits/credits-view";
import InAppCreditsPage from "@/app/(app)/[program]/credits/page";
import PublicCreditsPage from "@/app/(marketing)/credits/page";

const saved: CreditSection[] = [{ id: "crew", title: "Synthetic crew", description: "People who built it", order: 0, entries: [{ id: "p1", name: "Synthetic Person", description: "Lead", link: "https://example.test/p", imageUrl: null }] }];
const strip = (html: string) => html.replace(/ (aria-controls|id|aria-describedby|data-[a-z-]+)="[^"]*"/g, "");

beforeEach(() => {
  state.value = { sections: saved, loaded: true, error: false, retry: () => {} };
});

describe("the Credits view", () => {
  it("renders the saved document: its sections, descriptions, names and links", () => {
    const html = renderToString(<CreditsView />);
    expect(html).toContain("Synthetic crew");
    expect(html).toContain("People who built it");
    expect(html).toContain("Synthetic Person");
    expect(html).toContain('href="https://example.test/p"');
    expect(html).not.toContain("Claude (Anthropic)"); // the built-in list is replaced, not merged
  });

  it("renders the built-in list unchanged when nothing is saved, so the page is never blank", () => {
    state.value = { ...state.value, sections: DEFAULT_CREDITS };
    const html = renderToString(<CreditsView />);
    for (const s of DEFAULT_CREDITS) {
      expect(html).toContain(s.title);
      for (const e of s.entries) expect(html).toContain(e.name.replace(/&/g, "&amp;"));
    }
  });

  it("a failed read keeps the built-in list on screen and says so, with a retry", () => {
    state.value = { sections: DEFAULT_CREDITS, loaded: true, error: true, retry: () => {} };
    const html = renderToString(<CreditsView />);
    expect(html).toContain("Couldn&#x27;t load the latest credits");
    expect(html).toContain("Try again");
    expect(html).toContain("Claude (Anthropic)");
  });

  it("shows a loading state while the read is in flight", () => {
    const html = renderToString(<CreditsContent sections={DEFAULT_CREDITS} loaded={false} error={false} onRetry={() => {}} />);
    expect(html).toContain('aria-busy="true"');
  });

  it("has no controls for anyone: signed out, signed in, or the owner (the owner edits in the Admin Panel)", () => {
    const html = renderToString(<CreditsView />);
    expect(html).not.toMatch(/aria-label="(Edit|Delete|Rename|Move|Drag)/);
    expect(html).not.toContain("Add section");
  });
});

describe("one component on both routes", () => {
  it("the in-app page and the public page render the same content (signed out or in: neither reads a session, a team or a program)", () => {
    const inApp = renderToString(<InAppCreditsPage />);
    const open = renderToString(<PublicCreditsPage />);
    expect(strip(open)).toContain(strip(inApp));
    expect(strip(inApp)).toContain("Synthetic crew");
  });

  it("the shared sources name no team, account or program", () => {
    const root = process.cwd();
    for (const file of ["components/credits/credits-view.tsx", "lib/credits/client.ts", "app/(app)/[program]/credits/page.tsx", "app/(marketing)/credits/page.tsx"]) {
      const code = readFileSync(path.join(root, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code, file).not.toMatch(/useAuth|useOurTeam|teamId|useProgram|useProgramConfig|profile/);
    }
  });

  it("every program's in-app route and the public route point at the same page component", () => {
    const root = process.cwd();
    const read = (f: string) => readFileSync(path.join(root, f), "utf8");
    expect(read("app/(app)/[program]/credits/page.tsx")).toContain("<CreditsView />");
    expect(read("app/(marketing)/credits/page.tsx")).toContain("<CreditsView />");
  });
});
