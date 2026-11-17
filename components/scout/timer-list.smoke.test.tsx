import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SliderField } from "@/components/scout/field-inputs";
import { TimerList, formatSeconds } from "@/components/scout/timer-list";
import { RenderedField } from "@/components/scout/scout-form";
import { REBUILT_FORM } from "@/lib/forms/builtin-rebuilt";
import type { FormField } from "@/lib/forms/types";

// React separates adjacent text nodes with comment markers; strip them so the assertions read the visible text.
const text = (html: string) => html.replace(/<!-- -->/g, "");
const noop = () => {};
const field = (key: string): FormField => REBUILT_FORM.sections.flatMap((s) => s.fields).find((f) => f.key === key)!;

describe("TimerList", () => {
  it("an empty list is a big Start button and nothing else", () => {
    const html = text(renderToString(<TimerList label="Auto Cycle Timer" value={[]} onChange={noop} />));
    expect(html).toContain('aria-label="Start Auto Cycle Timer"');
    expect(html).toContain("0.00 s");
    expect(html).toContain("h-14"); // a 56px target
    expect(html).not.toContain("Delete cycle");
  });

  it("lists each cycle with a 44px delete button and the count, total and average", () => {
    const html = text(renderToString(<TimerList label="Shift 1 cycle timer" value={[3.5, 4.25]} onChange={noop} />));
    expect(html).toContain("Cycle 1");
    expect(html).toContain("3.50 s");
    expect(html).toContain('aria-label="Delete cycle 2 (4.25 s)"');
    expect(html).toContain("h-11 w-11");
    expect(html).toContain("2 cycles");
    expect(html).toContain("total 7.75 s");
    expect(html).toContain("average 3.88 s");
  });

  it("at the cycle limit, Start is disabled and says why", () => {
    const html = text(renderToString(<TimerList label="T" value={[1, 2]} maxCycles={2} onChange={noop} />));
    expect(html).toContain("Cycle limit reached");
    expect(html).toMatch(/disabled=""[^>]*aria-label="Start T"|aria-label="Start T"[^>]*disabled=""/);
  });

  it("a locked list can't be changed", () => {
    const html = text(renderToString(<TimerList label="T" value={[1]} disabled onChange={noop} />));
    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(2); // Start and the one Delete
  });

  it("formats to hundredths", () => {
    expect(formatSeconds(3)).toBe("3.00 s");
    expect(formatSeconds(12.345)).toBe("12.35 s");
  });
});

describe("labelled scale", () => {
  it("shows the step's label, not its index, and reads it aloud", () => {
    const html = text(renderToString(<SliderField id="s" label="Balls Per Second" value={2} min={0} max={4} step={1} ticks stepLabels={["0", "1-3", "4-6", "7-9", "10-13"]} onChange={noop} />));
    expect(html).toContain('aria-valuetext="4-6"');
    expect(html).toMatch(/data-testid="slider-value"[^>]*>4-6</);
    for (const l of ["0", "1-3", "7-9", "10-13"]) expect(html).toContain(`>${l}</span>`); // tick labels
  });

  it("without labels it is the plain numeric slider", () => {
    const html = text(renderToString(<SliderField id="s" label="Skill" value={3} min={1} max={5} step={1} onChange={noop} />));
    expect(html).toContain('aria-valuetext="3 of 5"');
  });
});

describe("REBUILT fields render", () => {
  const render = (key: string, value: unknown) => text(renderToString(<RenderedField form={REBUILT_FORM} field={field(key)} value={value as never} locked={false} onChange={noop} />));

  it("a cycle timer field renders its timer with the recorded cycles", () => {
    const html = render("auto_cycleTimes", [4.5, 6]);
    expect(html).toContain('data-field-key="auto_cycleTimes"');
    expect(html).toContain("Auto Cycle Timer");
    expect(html).toContain("2 cycles");
  });

  it("a scale field shows its range label for the stored index", () => {
    expect(render("auto_bpsScale", 4)).toContain("10-13");
    expect(render("auto_carryingScale", 8)).toContain("75+");
  });

  it("a notice renders as a note with its text", () => {
    const html = render("teleop_shift2_counted", "");
    expect(html).toContain('role="note"');
    expect(html).toContain("Shift 2 (Counted)");
  });
});
