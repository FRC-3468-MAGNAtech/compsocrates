import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PLATFORM } from "@/config/platform";
import { SiteFooter } from "@/components/layout/site-footer";

const root = process.cwd();

describe("SiteFooter", () => {
  const html = renderToString(<SiteFooter />);

  it("shows the copyright year, the holder as a safe new-tab link, and the team list from the platform config", () => {
    expect(html).toContain(`${new Date().getFullYear()}`);
    expect(html).toContain(`href="${PLATFORM.footer.holderHref}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain(PLATFORM.footer.holder);
    expect(html).toContain(PLATFORM.footer.teams.replace(/&/g, "&amp;")); // renderToString escapes the ampersand
  });

  it("the platform config carries the agreed text and URL", () => {
    expect(PLATFORM.footer.holder).toBe("CompSocrates");
    expect(PLATFORM.footer.holderHref).toBe("https://www.magnatech3468.com/");
    expect(PLATFORM.footer.teams).toMatch(/3468/);
    expect(PLATFORM.footer.teams).toMatch(/35792/);
    expect(PLATFORM.footer.teams).toMatch(/35794/);
    expect(PLATFORM.footer.teams).toMatch(/ & .* \+ /);
  });

  it("has two links only: the holder, and a Credits link to the public /credits page (no donation link)", () => {
    expect(html.match(/<a /g)?.length).toBe(2);
    expect(html).toContain("href=\"/credits\"");
    expect(html).toContain(">Credits<");
    expect(html.toLowerCase()).not.toMatch(/donat|changelog|privacy|terms/);
  });

  it("is plain end-of-page content: never fixed or sticky, safe-area padding on phones", () => {
    expect(html).not.toMatch(/\b(fixed|sticky)\b/);
    expect(html).toContain("env(safe-area-inset-bottom)");
  });

  it("does not hard-code the text, team list or URL in the component", () => {
    const src = readFileSync(join(root, "components/layout/site-footer.tsx"), "utf8");
    expect(src).not.toContain("magnatech3468");
    expect(src).not.toMatch(/\b3\d{4}\b/);
    expect(src).toContain("PLATFORM.footer");
  });
});

describe("one footer, used on the app shell and the public pages", () => {
  it("the app layout and the marketing layout (landing, login, signup, legal) render SiteFooter", () => {
    expect(readFileSync(join(root, "app/(app)/[program]/layout.tsx"), "utf8")).toContain("<SiteFooter");
    expect(readFileSync(join(root, "app/(marketing)/layout.tsx"), "utf8")).toContain("<SiteFooter");
  });

  it("no other component defines its own footer", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          if (name !== "node_modules" && name !== ".next" && name !== "e2e") walk(full); // app/e2e holds test fixtures, not pages
        } else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) && !full.endsWith(join("layout", "site-footer.tsx"))) {
          if (/<footer[\s>]/.test(readFileSync(full, "utf8"))) offenders.push(full.slice(root.length + 1));
        }
      }
    };
    walk(join(root, "app"));
    walk(join(root, "components"));
    expect(offenders).toEqual([]);
  });
});
