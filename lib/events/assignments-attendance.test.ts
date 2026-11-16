import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A source-contract test (the repo does this for screens that cannot render in a unit test): the Assignments page must hand the program to the
// attendance write, or a namespaced program's list is written to the FRC path, and the archived switch must use the shared Switch and its wording.
const page = readFileSync(join(process.cwd(), "app", "(app)", "[program]", "assignments", "page.tsx"), "utf8");

describe("Assignments attendance checklist", () => {
  it("saves through the program's own write path", () => {
    const call = /setEventAttendance\(([^)]*)\)/.exec(page);
    expect(call?.[1]).toMatch(/,\s*program\s*$/);
  });

  it("offers 'Show archived events' with the shared Switch, off by default", () => {
    expect(page).toContain('import { Switch } from "@/components/ui/switch"');
    expect(page).toContain("Show archived events");
    expect(page).toMatch(/useState\(false\)/);
    expect(page).toMatch(/\[showArchived, setShowArchived\] = useState\(false\)/);
  });
});
