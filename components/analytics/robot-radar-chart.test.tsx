import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RobotRadarChart, radarLabelPad } from "@/components/analytics/robot-radar-chart";
import { climbBasisNote } from "@/components/analytics/climb-box-plot";
import type { RadarRow } from "@/lib/analytics/robot-radar";

const row = (key: string, label: string): RadarRow => ({ key, label, full: label, a: 5, b: null, overlap: null, highlight: false });
const axes = (rows: RadarRow[]) => rows.map((r) => ({ key: r.key, full: r.full, help: "" }));

describe("Robot Radar labels are never clipped", () => {
  // The radar draws the first label at the top and the rest clockwise; with 5 axes the second one sits on the right edge ("Hub Volume").
  const rows = [row("a", "Auto"), row("b", "Hub Volume"), row("c", "A Very Long Axis Label Indeed"), row("d", "Tower"), row("e", "Agility")];
  const html = renderToString(<RobotRadarChart rows={rows} axes={axes(rows)} teamA={254} teamB={null} />);
  const viewBox = /viewBox="([^"]+)"/.exec(html)![1].split(" ").map(Number);

  it("pads the view box on both sides beyond the 320 plot, and lets the SVG overflow", () => {
    expect(viewBox[0]).toBeLessThan(0);
    expect(viewBox[2]).toBeGreaterThan(320);
    expect(viewBox[0] + viewBox[2]).toBeGreaterThan(320); // right padding as well
    expect(html).toContain("overflow-visible");
  });

  it("the padding grows with the longest label and is capped", () => {
    expect(radarLabelPad(["Hub Volume"])).toBeGreaterThan(radarLabelPad(["Auto"]));
    expect(radarLabelPad(["x".repeat(200)])).toBeLessThanOrEqual(120);
    expect(radarLabelPad([])).toBeGreaterThanOrEqual(24);
  });

  it('the right-hand "Hub Volume" label fits inside the padded view box', () => {
    // Measured the way the chart places it: anchor "start" at x = 160 + 123.8 * cos(angle of axis 1), 12px text at about 0.62em per character.
    const n = rows.length;
    const angle = -Math.PI / 2 + (1 / n) * Math.PI * 2;
    const x = 160 + (11.9 / 10) * 104 * Math.cos(angle);
    const textEnd = x + "Hub Volume".length * 12 * 0.62;
    expect(textEnd).toBeLessThanOrEqual(viewBox[0] + viewBox[2]);
  });

  it("keeps the accessible table with every full label", () => {
    for (const r of rows) expect(html).toContain(r.full);
    expect(html).toContain("sr-only");
  });
});

describe("Climb Reliability basis line", () => {
  it("states how many entries the plot rests on", () => {
    expect(climbBasisNote(3, 10)).toContain("3 entries");
    expect(climbBasisNote(3, 10)).toContain("out of 10");
    expect(climbBasisNote(1, 1)).toContain("1 entry");
  });
  it("says so when nothing has the answer yet or there are no entries", () => {
    expect(climbBasisNote(0, 7)).toContain("None of the 7 entries");
    expect(climbBasisNote(0, 0)).toBe("No scouting entries for these teams.");
  });
});
