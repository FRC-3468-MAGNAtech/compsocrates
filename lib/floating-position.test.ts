import { describe, expect, it } from "vitest";
import { computePanelPosition } from "@/lib/floating-position";

const viewport = { width: 400, height: 800 };
const anchor = { left: 100, top: 100, width: 120, height: 44 };

describe("computePanelPosition", () => {
  it("opens below, aligned to the anchor start", () => {
    expect(computePanelPosition({ anchor, panel: { width: 200, height: 150 }, viewport })).toEqual({ left: 100, top: 152, side: "bottom" });
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

  it("stays below when above is no better, pinned to the viewport margin", () => {
    const p = computePanelPosition({ anchor: { ...anchor, top: 20 }, panel: { width: 200, height: 900 }, viewport });
    expect(p.side).toBe("bottom");
    expect(p.top).toBe(8);
  });
});
