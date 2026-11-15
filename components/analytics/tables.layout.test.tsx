import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SessionIdCell, SESSION_ID_VISIBLE_CHARS } from "@/components/analytics/session-id-cell";
import { columnCanGrow, middleTruncate } from "@/lib/analytics/table-text";
import { withPracticeColumns } from "@/lib/analytics/game-schema";
import { GAMES, DEFAULT_GAME_ID } from "@/lib/analytics/game-schema";

// Unit tests have no layout engine, so these pin what produces the layout: the text rules, the cell markup, and the classes. The visual check
// (360px width, 2 and 3 team data) is the manual step in docs/SESSION2_RESULTS.md.
const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

describe("middleTruncate (long ids)", () => {
  const id = "practice-session-2026-03-14T18:22:41.123Z-9f3a7c1e";
  it("keeps the start and the end and fits the limit", () => {
    const out = middleTruncate(id, SESSION_ID_VISIBLE_CHARS);
    expect(out.length).toBeLessThanOrEqual(SESSION_ID_VISIBLE_CHARS);
    expect(out.startsWith(id.slice(0, 4))).toBe(true);
    expect(out.endsWith(id.slice(-4))).toBe(true);
    expect(out).toContain("…");
  });
  it("leaves short text alone and survives tiny limits", () => {
    expect(middleTruncate("abc123", 14)).toBe("abc123");
    expect(middleTruncate("abcdefghij", 1).length).toBeLessThanOrEqual(3);
    expect(middleTruncate("", 5)).toBe("");
  });
});

describe("Session ID cell", () => {
  const id = "practice-session-2026-03-14T18:22:41.123Z-9f3a7c1e";
  const html = renderToString(<SessionIdCell value={id} />);
  it("shows the cut id, the full id in the tooltip, and a copy control with an accessible name", () => {
    expect(html).toContain(`title="${id}"`);
    expect(html).toContain("…");
    expect(html).toContain('aria-label="Copy Session ID"');
    expect(html).toContain("<button");
  });
  it("keeps the 44px touch size on coarse pointers and truncates inside its column", () => {
    expect(html).toContain("pointer-coarse:h-11");
    expect(html).toContain("pointer-coarse:w-11");
    expect(html).toContain("truncate");
    expect(html).toContain("min-w-0");
  });
  it("uses the app font: no monospace", () => {
    expect(html).not.toContain("font-mono");
  });
  it("shows a dash, no copy button, for a missing id", () => {
    const empty = renderToString(<SessionIdCell value={"—"} />);
    expect(empty).not.toContain("<button");
  });
});

describe("Session ID and Source columns", () => {
  const schema = withPracticeColumns(GAMES[DEFAULT_GAME_ID]);
  const i = schema.columns.findIndex((c) => c.key === "sessionId");
  it("the id column is a fixed-width id column, directly followed by the Source badge", () => {
    expect(schema.columns[i].type).toBe("id");
    expect(schema.columns[i + 1].key).toBe("practiceSource");
    expect(columnCanGrow(schema.columns[i].type, schema.columns[i].sticky)).toBe(false);
  });
});

describe("table surfaces", () => {
  const tables = ["components/analytics/data-table.tsx", "components/analytics/team-table.tsx"];
  it("no table, header or pinned cell uses backdrop blur (glass classes)", () => {
    for (const f of tables) {
      const src = read(f);
      expect(src, f).not.toMatch(/glass-(overlay|panel|strong|pill)/);
      // `glass-card` may only remain on the one-off "no rows" message, never on a scroller, header or cell.
      for (const line of src.split("\n").filter((l) => l.includes("glass-card"))) expect(line, f).toContain("text-center");
    }
  });
  it("the pinned header and pinned cells take the solid, token-based classes", () => {
    const css = read("app/globals.css");
    for (const cls of [".table-head-cell", ".table-pinned-cell", ".table-shell"]) {
      const block = css.slice(css.indexOf(cls + " {"), css.indexOf("}", css.indexOf(cls + " {")));
      expect(block, cls).toBeTruthy();
      expect(block, cls).not.toContain("backdrop-filter");
    }
    expect(css).toContain("--table-head-bg: color-mix(in srgb, var(--background)");
    for (const f of tables) {
      expect(read(f), f).toContain("table-head-cell");
      expect(read(f), f).toContain("table-pinned-cell");
    }
  });
  it("cells inherit the app font: no monospace in any Analytics component", () => {
    for (const f of [...tables, "components/analytics/form-summaries-rebuilt-view.tsx", "components/analytics/match-row.tsx", "app/(app)/[program]/analytics/teams/[teamNumber]/page.tsx"]) expect(read(f), f).not.toContain("font-mono");
  });
  it("cells stay inside their column and the table scrolls inside its own box", () => {
    for (const f of tables) {
      const src = read(f);
      expect(src).toContain("overflow-hidden");
      expect(src).toContain("[overflow-wrap:anywhere]");
      expect(src).toContain("overflow-auto");
      expect(src).toContain("table-shell");
    }
  });
});

describe("column growth", () => {
  it("free-text columns may grow into spare room; numbers, ids, badges and pinned columns keep their width", () => {
    expect(columnCanGrow("comments", false)).toBe(true);
    expect(columnCanGrow("notes", false)).toBe(true);
    expect(columnCanGrow("score", false)).toBe(false);
    expect(columnCanGrow("id", false)).toBe(false);
    expect(columnCanGrow("badge", false)).toBe(false);
    expect(columnCanGrow("comments", true)).toBe(false);
  });
});
