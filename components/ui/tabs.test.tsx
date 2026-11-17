import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Table2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

// The Analytics Table / Summary toggle is this shared segmented control: the icon sits beside the label on ONE row, the label never wraps, and
// the trigger keeps its 44px touch height. Unit tests have no layout, so this pins the classes that produce that.
describe("segmented control (Tabs)", () => {
  const html = renderToString(
    <Tabs value="table">
      <TabsList aria-label="View">
        <TabsTrigger value="table" data-testid="view-table">
          <Table2 className="h-4 w-4" aria-hidden /> Table
        </TabsTrigger>
      </TabsList>
    </Tabs>,
  );

  it("puts icon and label in one non-wrapping flex row", () => {
    expect(html).toMatch(/<span class="[^"]*\binline-flex\b[^"]*\bitems-center\b[^"]*\bwhitespace-nowrap\b[^"]*"><svg/);
  });

  it("keeps a 44px minimum height on touch screens and a visible focus state through the trigger", () => {
    expect(html).toContain("pointer-coarse:min-h-11");
    expect(html).toContain("min-h-10");
    expect(html).toContain("whitespace-nowrap");
    // `outline-none` would switch off the global focus-visible ring for keyboard users.
    expect(html).not.toContain("outline-none");
  });
});
