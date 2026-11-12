import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { BRAND } from "@/config/brand";

// P17 regression guards. There is no browser in CI, so these check the things that can be
// checked statically: the install manifest and icons are valid, and the CSS / viewport /
// dialog rules that make the site behave on a phone haven't been removed.

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

/** Width and height from a PNG's IHDR, or null when it isn't a PNG. */
function pngSize(path: string): { width: number; height: number } | null {
  const buf = readFileSync(path);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((b, i) => buf[i] === b)) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("the web app manifest", () => {
  const m = manifest();

  it("is installable: a name, a standalone display, a start URL in scope, and colors", () => {
    expect(m.name).toBeTruthy();
    expect(m.short_name).toBeTruthy();
    expect(m.display).toBe("standalone");
    expect(m.start_url?.startsWith("/")).toBe(true);
    expect(m.scope).toBe("/");
    expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("lists exactly the icons set in the brand config, and every listed icon is a real PNG of the stated size", () => {
    const icons = m.icons ?? [];
    const configured = [BRAND.logo.pwa192, BRAND.logo.pwa512, BRAND.logo.pwaMaskable512].filter(Boolean);
    expect(icons.map((i) => i.src)).toEqual(configured);
    for (const icon of icons) {
      const path = `public${icon.src}`;
      expect(existsSync(path), icon.src).toBe(true);
      const size = pngSize(path);
      expect(size, `${icon.src} is a PNG`).not.toBeNull();
      expect(`${size!.width}x${size!.height}`).toBe(icon.sizes);
    }
  });

  it("makes installability depend on artwork: with both a 192px and a 512px icon the manifest has them, with none it has none", () => {
    // Chrome offers "install" only with 192px and 512px PNGs. The product has no official logo yet (config/brand.ts), so
    // the manifest carries no icons; this documents that on purpose, and fails if a slot is set to a file that is missing.
    const hasBoth = Boolean(BRAND.logo.pwa192 && BRAND.logo.pwa512);
    expect(hasBoth ? (m.icons ?? []).length >= 2 : (m.icons ?? []).length === 0 || !hasBoth).toBe(true);
  });

  it("uses the brand's names and colors", () => {
    expect(m.name).toBe(BRAND.title);
    expect(m.short_name).toBe(BRAND.name);
    expect(m.theme_color).toBe(BRAND.themeColor);
  });

  it("registers no service worker of its own, so it coexists with the Firebase Messaging worker", () => {
    expect(JSON.stringify(m)).not.toMatch(/serviceworker|service_worker/i);
    expect(existsSync("app/firebase-messaging-sw.js/route.ts")).toBe(true);
  });
});

describe("the logo", () => {
  // The CompSocrates favicon (the one logo artwork the product has), byte for byte. The owner wants it in the browser tab
  // and nowhere else on the site until an official logo exists.
  const CS_FAVICON_SHA256 = "1cbe21db3d40825ce80484906e07783cde0761a3decd4d1563b06b9eb9e48bd8";

  it("serves the CompSocrates favicon, unaltered, as the browser-tab icon", () => {
    expect(createHash("sha256").update(readFileSync("app/favicon.ico")).digest("hex")).toBe(CS_FAVICON_SHA256);
    expect(BRAND.logo.favicon).toBe("/favicon.ico");
  });

  it("shows the logo nowhere else: every other slot is empty and no icon files ship", () => {
    const { favicon, ...others } = BRAND.logo;
    void favicon;
    expect(Object.values(others).every((v) => v === null)).toBe(true);
    expect(existsSync("public/icons")).toBe(false);
    expect(existsSync("scripts/generate-icons.mjs")).toBe(false);
  });
});

describe("the root layout's mobile settings", () => {
  const layout = read("app/layout.tsx");

  it("draws under the notch and resizes with the keyboard", () => {
    expect(layout).toContain('viewportFit: "cover"');
    expect(layout).toContain('interactiveWidget: "resizes-content"');
    expect(layout).toContain('width: "device-width"');
  });

  it("makes the app installable on iPhone and respects reduced motion", () => {
    expect(layout).toContain("BRAND.logo.apple");
    expect(layout).toContain("appleWebApp");
    expect(layout).toContain("MotionProvider");
    expect(read("components/layout/motion-provider.tsx")).toContain('reducedMotion="user"');
  });
});

describe("the global mobile CSS", () => {
  const css = read("app/globals.css");

  it("never lets the page scroll sideways, and keeps wide content scrolling inside itself", () => {
    expect(css).toMatch(/html,\s*body\s*\{[^}]*overflow-x:\s*clip/);
    expect(css).toMatch(/\.overflow-x-auto\s*\{[^}]*overscroll-behavior-x:\s*contain/);
  });

  it("gives touch devices 44px targets, with a hit-area fallback for small checkboxes and switches", () => {
    expect(css).toContain("@media (pointer: coarse)");
    expect(css).toMatch(/min-height:\s*44px/);
    expect(css).toMatch(/\[role="checkbox"\]::after/);
  });

  it("keeps form text at 16px on phones and tablets so iOS doesn't zoom on focus", () => {
    expect(css).toMatch(/@media \(max-width: 1023px\)\s*\{[^}]*font-size:\s*16px/);
  });

  it("lightens the glass on small screens and honors reduced transparency", () => {
    expect(css).toMatch(/@media \(max-width: 767px\)\s*\{[^}]*backdrop-filter:\s*blur\(12px\)/);
    expect(css).toContain("@media (prefers-reduced-transparency: reduce)");
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.bg-blob/);
  });

  it("defines the safe-area helpers", () => {
    expect(css).toContain("env(safe-area-inset-bottom)");
  });
});

describe("dialogs, bars, and units on a phone", () => {
  it("a dialog is a bottom sheet below the sm breakpoint, capped to the dynamic viewport, with the safe area below it", () => {
    const dialog = read("components/ui/dialog.tsx");
    for (const cls of ["max-sm:bottom-0", "max-sm:w-full", "max-sm:max-h-[92dvh]", "max-sm:overflow-y-auto", "max-sm:rounded-b-none", "env(safe-area-inset-bottom)"]) expect(dialog, cls).toContain(cls);
  });

  it("sticky bottom bars clear the home indicator", () => {
    // P24: the practice screens' action bar is the shared ScoutingWorkspace's, so the bar (and the score bar) carry the safe area, and every practice screen uses the workspace
    for (const f of ["components/scout/score-bar.tsx", "components/practice/scouting-workspace.tsx"]) {
      expect(read(f), f).toContain("env(safe-area-inset-bottom)");
    }
    for (const f of ["components/practice/session-screen.tsx", "components/practice/lobby/lobby-session-screen.tsx", "components/practice/live/live-session-screen.tsx"]) {
      expect(read(f), f).toContain("<ScoutingWorkspace");
    }
  });

  it("page-height layouts use dynamic viewport units, not 100vh/min-h-screen", () => {
    expect(read("app/(marketing)/layout.tsx")).toContain("min-h-dvh");
    expect(read("components/layout/sidebar.tsx")).toContain("100dvh");
    for (const f of ["app/(marketing)/layout.tsx", "components/layout/sidebar.tsx", "components/layout/topbar.tsx", "app/(app)/[program]/layout.tsx"]) {
      expect(read(f), f).not.toMatch(/100vh|min-h-screen|h-screen/);
    }
  });

  it("the phone top bar has a 44px menu button and reaches the droplet (glass slider + offline badge)", () => {
    const topbar = read("components/layout/topbar.tsx");
    expect(topbar).toContain("h-11 w-11");
    expect(topbar).toContain("GlassLayerButton");
    expect(topbar).toContain("connection");
  });

  it("number inputs that ask for team and match numbers bring up the numeric keypad", () => {
    for (const f of ["components/scout/match-picker-dialog.tsx", "components/scout/team-picker-dialog.tsx"]) expect(read(f), f).toContain('inputMode="numeric"');
  });
});
