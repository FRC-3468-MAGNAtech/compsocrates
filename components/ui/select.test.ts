import { describe, expect, it } from "vitest";
import { SELECT_CONTENT_CLASS, SELECT_VIEWPORT_CLASS } from "@/components/ui/select";

// Unit tests have no browser layout, so this pins the contract the shared select must keep (the real scroll check is the manual step and the
// sidebar-builder / page-access e2e specs). Every select in the app (the sidebar icon picker, the Page Access member picker, ...) uses these classes.
describe("shared select: long lists stay inside the viewport and scroll inside themselves", () => {
  it("caps the panel to the available height Radix measured", () => {
    expect(SELECT_CONTENT_CLASS).toContain("max-h-[var(--radix-select-content-available-height)]");
    expect(SELECT_CONTENT_CLASS).toContain("flex-col");
  });

  it("scrolls the list inside, contains overscroll and keeps touch scrolling", () => {
    for (const cls of ["overflow-y-auto", "overscroll-contain", "touch-pan-y", "min-h-0"]) expect(SELECT_VIEWPORT_CLASS).toContain(cls);
  });

  it("stays on the shared overlay layer", () => {
    expect(SELECT_CONTENT_CLASS).toContain("z-[var(--z-popover)]");
  });
});
