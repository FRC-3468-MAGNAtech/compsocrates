import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ID_ROW_CAP, IdRow, IdToolShell } from "./id-tool-shell";

const html = (node: React.ReactNode) => renderToString(node).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

const shell = (over: Partial<React.ComponentProps<typeof IdToolShell>> = {}) => (
  <IdToolShell
    title="Match Scout IDs"
    description="Search them."
    searchLabel="Search match scout IDs"
    placeholder="Search by ID"
    search=""
    onSearch={() => {}}
    loading={false}
    refreshing={false}
    error={null}
    onRefresh={() => {}}
    total={2}
    shown={2}
    noun="entries"
    {...over}
  >
    <li>row</li>
  </IdToolShell>
);

describe("IdToolShell", () => {
  it("labels the search box and shows the count and Refresh", () => {
    const out = html(shell());
    expect(out).toContain("Search match scout IDs");
    expect(out).toContain("2 entries");
    expect(out).toContain("Refresh");
    expect(out).toContain("row");
  });

  it("is a skeleton while loading", () => {
    const out = html(shell({ loading: true }));
    expect(out).toContain('aria-busy="true"');
    expect(out).not.toContain(">row<");
  });

  it("says so when nothing matches the search, and when there is nothing at all", () => {
    expect(html(shell({ shown: 0, search: "zzz" }))).toContain("No entries match “zzz”.");
    expect(html(shell({ shown: 0, total: 0 }))).toContain("No entries found.");
  });

  it("shows the failure with Try again, not an empty list", () => {
    const out = html(shell({ shown: 0, total: 0, error: { context: "x", code: "permission-denied", message: "no", path: null, at: "" } }));
    expect(out).toContain("Couldn't load the entries.");
    expect(out).toContain("Try again");
    expect(out).not.toContain("No entries found");
  });

  it("notes when the list is capped", () => {
    expect(html(shell({ total: 500, shown: 500 }))).toContain(`showing the first ${ID_ROW_CAP}`);
  });
});

describe("IdRow", () => {
  it("shows the ID with a labelled Copy button and the fields", () => {
    const out = html(
      <ul>
        <IdRow id="AbC123" notes="Great climb" fields={[{ label: "Team", value: "254" }, { label: "Score / accuracy", value: 40, sub: "88%" }]} />
      </ul>
    );
    expect(out).toContain("AbC123");
    expect(out).toContain('aria-label="Copy ID AbC123"');
    expect(out).toContain("Team");
    expect(out).toContain("88%");
    expect(out).toContain("Great climb");
  });
});
