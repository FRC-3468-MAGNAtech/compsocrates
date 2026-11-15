import { describe, expect, it } from "vitest";
import { computePanelPosition } from "@/lib/floating-position";

const viewport = { width: 400, height: 800 };
const anchor = { left: 100, top: 100, width: 120, height: 44 };

describe("computePanelPosition", () => {
  it("opens below, aligned to the anchor start", () => {
    expect(computePanelPosition({ anchor, panel: { width: 200, height: 150 }, viewport })).toEqual({ left: 100, top: 152, side: "bottom", maxHeight: 640 });
  });

  it("aligns to the end and centre edges", () => {
    expect(computePanelPosition({ anchor, panel: { width: 200, height: 150 }, viewport, align: "end" }).left).toBe(20);
    expect(computePanelPosition({ anchor, panel: { width: 200, height: 150 }, viewport, align: "center" }).left).toBe(60);
  });

  it("clamps horizontally inside the viewport", () => {
    expect(computePanelPosition({ anchor: { ...anchor, left: 350 }, panel: { width: 200, height: 100 }, viewport }).left).toBe(192);
    expect(computePanelPosition({ anchor: { ...anchor, left: -50 }, panel: { width: 200, height: 100 }, viewport }).left).toBe(8);
  });

  it("flips above when it does not fit below and there is more room above", () => {
    const p = computePanelPosition({ anchor: { ...anchor, top: 700 }, panel: { width: 200, height: 300 }, viewport });
    expect(p.side).toBe("top");
    expect(p.top).toBe(392);
  });

  it("stays below when above is no better, and is capped to the room below instead of running off the screen", () => {
    const p = computePanelPosition({ anchor: { ...anchor, top: 20 }, panel: { width: 200, height: 900 }, viewport });
    expect(p.side).toBe("bottom");
    expect(p.top).toBe(72);
    expect(p.maxHeight).toBe(720);
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(viewport.height - 8);
  });
});

// A list of 200 rows (36px each, 7200px tall) must stay inside the screen and scroll inside itself: a short window, and a phone width.
describe("computePanelPosition: a 200-item list", () => {
  const rows = 200 * 36;

  it.each([
    ["a short desktop window", { width: 1200, height: 360 }, { left: 300, top: 60, width: 220, height: 44 }],
    ["a 360px phone, short viewport", { width: 360, height: 640 }, { left: 20, top: 300, width: 320, height: 44 }],
    ["a phone with the keyboard up", { width: 360, height: 300 }, { left: 20, top: 120, width: 320, height: 44 }],
  ])("%s: capped to the viewport, never outside it", (_name, vp, a) => {
    const panel = { width: Math.min(280, vp.width), height: rows };
    const p = computePanelPosition({ anchor: a, panel, viewport: vp });
    expect(p.maxHeight).toBeGreaterThan(0);
    expect(p.maxHeight).toBeLessThanOrEqual(vp.height - 16);
    expect(p.top).toBeGreaterThanOrEqual(8);
    expect(p.top + Math.min(rows, p.maxHeight)).toBeLessThanOrEqual(vp.height - 8);
    expect(p.left).toBeGreaterThanOrEqual(8);
    expect(p.left + panel.width).toBeLessThanOrEqual(vp.width - 8);
  });

  it("opens on the side with more room", () => {
    const p = computePanelPosition({ anchor: { left: 20, top: 560, width: 320, height: 44 }, panel: { width: 280, height: rows }, viewport: { width: 360, height: 640 } });
    expect(p.side).toBe("top");
    expect(p.maxHeight).toBe(560 - 8 - 8);
  });
});
