import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EventOptionRow, NO_GAME_CONFIG_LABEL, nextRowIndex, optionTitle } from "@/components/analytics/event-multiselect";
import { OptionCheck } from "@/components/ui/select";
import type { EventOption } from "@/lib/analytics/data-context";

const option = (over: Partial<EventOption> = {}): EventOption => ({ code: "evt1", name: "Lakeview Regional", event: null, active: true, count: 3, ...over });
const row = (checked: boolean, over: Partial<EventOption> = {}, singleEvent = true) =>
  renderToString(<EventOptionRow option={option(over)} checked={checked} singleEvent={singleEvent} seasonKind="calendar" showStar={false} now={0} onClick={() => {}} />);

describe("Analytics event list: selected state", () => {
  it("a selected row has aria-selected=true and the shared check mark", () => {
    const html = row(true);
    expect(html).toContain('role="option"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("data-option-check");
  });

  it("an unselected row has aria-selected=false and no check", () => {
    const html = row(false);
    expect(html).toContain('aria-selected="false"');
    expect(html).not.toContain("data-option-check");
  });

  it("the multi-select row shows the check inside its box", () => {
    expect(row(true, {}, false)).toContain("data-option-check");
    expect(row(false, {}, false)).not.toContain("data-option-check");
  });

  it("the check is the same component the shared Select uses", () => {
    expect(renderToString(<OptionCheck />)).toContain("data-option-check");
  });

  it("marks an event with no game config", () => {
    expect(row(false, { noGameConfig: true })).toContain(NO_GAME_CONFIG_LABEL);
    expect(row(false)).not.toContain(NO_GAME_CONFIG_LABEL);
  });
});

describe("Analytics event list: names and years", () => {
  it("a key with no season in it gets the year from the event's own season, in the program's wording", () => {
    const o = option({ code: "USLAALQ", name: "Louisiana Qualifier", season: 2025 });
    expect(optionTitle(o, "start-year")).toBe("Louisiana Qualifier 2025-26");
    expect(optionTitle(o, "calendar")).toBe("Louisiana Qualifier 2025");
    expect(row(false, { code: "USLAALQ", name: "Louisiana Qualifier", season: 2025 })).toContain("Louisiana Qualifier 2025");
  });
  it("leaves a name that already states its year, a key that carries one, a bare key and an unknown season alone", () => {
    expect(optionTitle(option({ code: "X1", name: "Bayou 2025-26 Qualifier", season: 2025 }), "start-year")).toBe("Bayou 2025-26 Qualifier");
    expect(optionTitle(option({ code: "2026lake", name: "Lakeview Regional", season: 2026 }), "calendar")).toBe("Lakeview Regional 2026");
    expect(optionTitle(option({ code: "USLAALQ", name: "USLAALQ", season: 2025 }), "start-year")).toBe("USLAALQ");
    expect(optionTitle(option({ code: "USLAALQ", name: "Louisiana Qualifier", season: undefined }), "start-year")).toBe("Louisiana Qualifier");
  });
});

describe("Analytics event list: keyboard", () => {
  it("arrow keys move one row and stop at the ends; Home and End jump", () => {
    expect(nextRowIndex("ArrowDown", 0, 4)).toBe(1);
    expect(nextRowIndex("ArrowDown", 3, 4)).toBe(3);
    expect(nextRowIndex("ArrowUp", 2, 4)).toBe(1);
    expect(nextRowIndex("ArrowUp", 0, 4)).toBe(0);
    expect(nextRowIndex("Home", 2, 4)).toBe(0);
    expect(nextRowIndex("End", 0, 4)).toBe(3);
  });

  it("from nothing focused, ArrowDown lands on the first row; other keys and empty lists do nothing", () => {
    expect(nextRowIndex("ArrowDown", -1, 4)).toBe(0);
    expect(nextRowIndex("a", 0, 4)).toBeNull();
    expect(nextRowIndex("ArrowDown", -1, 0)).toBeNull();
  });
});
