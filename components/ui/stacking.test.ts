import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SELECT_CONTENT_CLASS } from "@/components/ui/select";

// Stacking contract (Session B, re-checked in Session 2): every dropdown, including the Analytics event select, sits on the popover layer, which is
// the top of the z-index scale (above the sheets, dialogs and the table's own sticky header layers). Unit tests have no layout, so this pins the
// tokens and the portal that produce it.
const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

function zScale(): Record<string, number> {
  const css = read("app/globals.css");
  const scale: Record<string, number> = {};
  for (const m of css.matchAll(/--z-([a-z]+):\s*(\d+);/g)) scale[m[1]] = Number(m[2]);
  return scale;
}

describe("overlay stacking", () => {
  it("the popover layer is the highest layer of the scale", () => {
    const scale = zScale();
    expect(scale.popover).toBeDefined();
    for (const [name, z] of Object.entries(scale)) if (name !== "popover") expect(scale.popover, `popover above ${name}`).toBeGreaterThan(z);
  });

  it("sheets and dialogs sit above in-page sticky bits, below popovers", () => {
    const { sheet, dialog, popover, topbar } = zScale();
    expect(sheet).toBeGreaterThan(topbar);
    expect(dialog).toBeGreaterThan(sheet);
    expect(popover).toBeGreaterThan(dialog);
  });

  it("the shared floating panel and the shared select both take the popover token and portal out of the page", () => {
    expect(read("components/ui/floating-panel.tsx")).toContain("z-[var(--z-popover)]");
    expect(read("components/ui/floating-panel.tsx")).toContain("createPortal");
    expect(SELECT_CONTENT_CLASS).toContain("z-[var(--z-popover)]");
  });

  it("the Analytics event select is built on the shared floating panel, with no layer number of its own", () => {
    const src = read("components/analytics/event-multiselect.tsx");
    expect(src).toContain("<FloatingPanel");
    expect(src).not.toMatch(/\bz-\d+\b|z-\[\d+\]|zIndex/);
  });

  it("the table's sticky layers (20 to 40) stay below the popover layer", () => {
    const { popover } = zScale();
    for (const file of ["components/analytics/data-table.tsx", "components/analytics/team-table.tsx"]) {
      for (const m of read(file).matchAll(/\bz-(\d+)\b|zIndex:[^0-9]*(\d+)/g)) expect(Number(m[1] ?? m[2])).toBeLessThan(popover);
    }
  });
});
