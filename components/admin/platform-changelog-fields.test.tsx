import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EntryDateField, EntryTimeFields, ItemSelectionBar, ORIGINAL_DATE_LABEL, RecordEditToggle } from "@/components/admin/platform-changelog-fields";
import { EntryCard } from "@/components/changelog/entry-card";
import { EntryTimes } from "@/components/changelog/entry-times";
import type { PlatformEntry } from "@/lib/platform-changelog/model";

// No DOM is available in this project's tests, so these render to markup (what the owner would see on first paint). SYNTHETIC data only.
const noop = () => {};

describe("the date field", () => {
  const field = (over: Partial<Parameters<typeof EntryDateField>[0]> = {}) => renderToStaticMarkup(<EntryDateField value="2024-03-03" onChange={noop} legacy unlocked={false} onUnlock={noop} {...over} />);
  it("a legacy entry's date is locked by default: the 'Original date' label, a disabled input, an 'Unlock to change' control and the UTC help text", () => {
    const html = field();
    expect(html).toContain(ORIGINAL_DATE_LABEL);
    expect(ORIGINAL_DATE_LABEL).toBe("Original date from CompSocrates v1");
    expect(html).toContain('data-locked="true"');
    expect(html).toMatch(/<input[^>]*disabled/);
    expect(html).toContain("Unlock to change");
    expect(html).toContain("UTC day");
    expect(html).toContain('value="2024-03-03"');
  });
  it("unlocked, the input is editable and the unlock control is gone (the dialog is mounted afresh after a save, so it starts locked again)", () => {
    const html = field({ unlocked: true });
    expect(html).not.toContain('data-locked="true"');
    expect(html).not.toMatch(/<input[^>]*disabled/);
    expect(html).not.toContain("Unlock to change");
    expect(html).toContain("locks again after you save");
  });
  it("a current entry keeps the normal Date field: plain label, editable, no lock and no help", () => {
    const html = field({ legacy: false, value: "2026-05-01" });
    expect(html).toContain(">Date<");
    expect(html).not.toContain(ORIGINAL_DATE_LABEL);
    expect(html).not.toContain("Unlock to change");
    expect(html).not.toMatch(/<input[^>]*disabled/);
  });
});

describe("the time fields", () => {
  it("two optional date-time inputs, each with a Clear button and a one-line help; Clear is disabled while empty", () => {
    const empty = renderToStaticMarkup(<EntryTimeFields posted="" edited="" onPosted={noop} onEdited={noop} />);
    expect(empty).toContain("Time posted");
    expect(empty).toContain("Last edited");
    expect(empty.match(/type="datetime-local"/g)).toHaveLength(2);
    expect(empty.match(/aria-label="Clear [^"]*"[^>]*disabled|disabled[^>]*aria-label="Clear /g)?.length).toBe(2);
    const filled = renderToStaticMarkup(<EntryTimeFields posted="2026-03-04T09:30" edited="" onPosted={noop} onEdited={noop} error="Last edited can't be earlier than Time posted." />);
    expect(filled).toContain('value="2026-03-04T09:30"');
    expect(filled).toContain("Last edited can&#x27;t be earlier than Time posted.");
    expect(filled).toContain('role="alert"');
  });
});

describe("Don't record this edit", () => {
  it("renders a checkbox that is checked when asked (legacy default) and unchecked otherwise", () => {
    expect(renderToStaticMarkup(<RecordEditToggle checked onChange={noop} />)).toContain('aria-checked="true"');
    expect(renderToStaticMarkup(<RecordEditToggle checked={false} onChange={noop} />)).toContain('aria-checked="false"');
    expect(renderToStaticMarkup(<RecordEditToggle checked onChange={noop} />)).toContain("record this edit");
  });
});

describe("the selection bar", () => {
  const rows = [
    { key: 1, category: "new" as const },
    { key: 2, category: "fixed" as const },
    { key: 3, category: "improved" as const },
    { key: 4, category: "improved" as const },
  ];
  it("offers 'select all' only for categories that have items, with their counts, and disables the actions while nothing is selected", () => {
    const html = renderToStaticMarkup(<ItemSelectionBar rows={rows} selected={new Set()} undoCount={0} onToggleCategory={vi.fn()} onMove={vi.fn()} onDelete={vi.fn()} onUndo={vi.fn()} />);
    expect(html).toContain("All New (1)");
    expect(html).toContain("All Improved (2)");
    expect(html).toContain("All Fixed (1)");
    expect(html).not.toContain("All Removed");
    expect(html).toContain("0 selected");
    expect(html).toMatch(/Delete selected/);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>)[\s\S])*Delete selected/);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>)[\s\S])*Undo/);
  });
  it("shows the count, the checked/indeterminate group state and an enabled Undo with its depth", () => {
    const html = renderToStaticMarkup(<ItemSelectionBar rows={rows} selected={new Set([3, 4, 1])} undoCount={2} onToggleCategory={vi.fn()} onMove={vi.fn()} onDelete={vi.fn()} onUndo={vi.fn()} />);
    expect(html).toContain("3 selected");
    expect(html).toContain("Undo (2)");
    expect(html).toContain('aria-label="Select all Improved (2)"');
    expect(html).toMatch(/aria-checked="true"[^>]*aria-label="Select all Improved/);
  });
});

describe("posted and edited on the Changelog page", () => {
  const entry: PlatformEntry = { id: "e1", title: "Synthetic release", version: "", date: "2026-05-01", status: "published", programs: ["frc", "ftc"], items: [{ category: "new", text: "x" }], legacy: false, createdBy: "o", createdAtMs: 1, updatedAtMs: 1, publishedAtMs: 1, rev: 1 };
  const posted = Date.UTC(2026, 10, 5, 23, 30);
  const edited = Date.UTC(2026, 10, 6, 1, 15);
  const card = (e: PlatformEntry) => renderToString(<EntryCard entry={e} expanded={false} onToggle={noop} />);

  it("shows 'Posted ... · Edited ...' with <time datetime> and a full-timestamp tooltip, in the given zone (two zones differ)", () => {
    const utc = renderToStaticMarkup(<EntryTimes postedAtMs={posted} editedAtMs={edited} format={{ locale: "en-US", timeZone: "UTC" }} />);
    expect(utc).toContain("Posted");
    expect(utc).toContain("Nov 5, 2026, 11:30 PM");
    expect(utc).toContain("Edited");
    expect(utc).toContain("Nov 6, 2026, 1:15 AM");
    expect(utc).toContain(`dateTime="${new Date(posted).toISOString()}"`);
    expect(utc).toContain('title="Thursday, November 5, 2026');
    const tokyo = renderToStaticMarkup(<EntryTimes postedAtMs={posted} editedAtMs={edited} format={{ locale: "en-US", timeZone: "Asia/Tokyo" }} />);
    expect(tokyo).toContain("Nov 6, 2026, 8:30 AM");
  });
  it("each part only if it exists; nothing at all when neither does (the app never invents a time)", () => {
    expect(renderToStaticMarkup(<EntryTimes postedAtMs={posted} editedAtMs={null} />)).not.toContain("Edited");
    expect(renderToStaticMarkup(<EntryTimes postedAtMs={null} editedAtMs={edited} />)).not.toContain("Posted");
    expect(renderToStaticMarkup(<EntryTimes postedAtMs={null} editedAtMs={null} />)).toBe("");
    expect(renderToStaticMarkup(<EntryTimes />)).toBe("");
  });
  it("an entry without the new fields renders exactly as before (no time line); with them the line sits in the card", () => {
    expect(card(entry)).not.toContain("entry-times");
    expect(card({ ...entry, postedAtMs: null, editedAtMs: null })).toBe(card(entry));
    expect(card({ ...entry, postedAtMs: posted })).toContain("entry-times");
  });
  it("the legacy label and date still show on a legacy entry with times", () => {
    const html = card({ ...entry, legacy: true, postedAtMs: posted });
    expect(html).toContain("Legacy");
    expect(html).toContain("May 1, 2026");
  });
});
