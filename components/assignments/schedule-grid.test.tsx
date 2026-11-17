import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScheduleGrid, slotColumns } from "@/components/assignments/schedule-grid";
import { ProgramProvider } from "@/lib/program/context";
import type { ScheduleResult, SlotId } from "@/lib/scheduler/types";

const schedule = (size: number): ScheduleResult => ({
  slots: (["red", "blue"] as const).flatMap((color) =>
    Array.from({ length: size }, (_, i) => ({ matchType: "Qualification" as const, matchNumber: 1, slot: `${color}${i + 1}` as SlotId, teamNumber: 100 + i, scoutUid: null })),
  ),
  counts: {},
  fair: true,
  warning: null,
});

const headers = (html: string) => (html.match(/<th[ >]/g) ?? []).length;
const render = (program: "frc" | "ftc", version: ScheduleResult) =>
  renderToStaticMarkup(
    <ProgramProvider program={program}>
      <ScheduleGrid version={version} members={[]} />
    </ProgramProvider>,
  );

describe("ScheduleGrid renders any alliance size", () => {
  it("a 3-slot schedule (FRC): Match + Red 1-3 + Blue 1-3", () => {
    const html = render("frc", schedule(3));
    expect(headers(html)).toBe(7);
    expect(html).toContain("Red 3");
  });

  it("a 2-slot schedule (FTC): Match + Red 1-2 + Blue 1-2, no third column", () => {
    const html = render("ftc", schedule(2));
    expect(headers(html)).toBe(5);
    expect(html).not.toContain("Red 3");
    expect(html).not.toContain("Blue 3");
  });

  it("before any slot exists the columns follow the program's alliance size (2 for FTC, 3 for FRC), not a fixed 3", () => {
    expect(headers(render("ftc", schedule(0)))).toBe(5);
    expect(headers(render("frc", schedule(0)))).toBe(7);
    expect(slotColumns([], 2)).toEqual(["red1", "red2", "blue1", "blue2"]);
  });

  it("a stored schedule keeps its own width whatever the program says", () => {
    expect(headers(render("ftc", schedule(3)))).toBe(7);
  });
});
