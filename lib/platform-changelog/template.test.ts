import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PROGRAMS } from "@/config/programs";
import { PROGRAM_IDS } from "@/config/programs/types";
import { parseEntryInput } from "@/lib/platform-changelog/model";
import { V2_TEMPLATE_ITEMS, v2Template } from "@/lib/platform-changelog/template";

describe("the v2.0.0 template", () => {
  const t = v2Template("2026-11-15");

  it("is titled CompSocrates v2.0.0, tagged for every program by default, and passes the same validation as a saved entry", () => {
    expect(t.title).toBe("CompSocrates v2.0.0");
    expect(t.version).toBe("v2.0.0");
    expect(t.programs).toEqual([...PROGRAM_IDS]);
    expect(parseEntryInput(t).ok).toBe(true);
  });

  it("every item is backed by a file that exists in the repository", () => {
    for (const item of V2_TEMPLATE_ITEMS) expect(existsSync(path.join(process.cwd(), item.proof)), item.proof).toBe(true);
  });

  it("every item's program tags come from the program configs: one program only where only that program has the feature", () => {
    expect(t.items).toHaveLength(V2_TEMPLATE_ITEMS.length);
    V2_TEMPLATE_ITEMS.forEach((item, i) => {
      const want = PROGRAM_IDS.filter((id) => item.applies(PROGRAMS[id], id));
      expect(want.length, item.text).toBeGreaterThan(0);
      expect(t.items[i].programs ?? [...PROGRAM_IDS], item.text).toEqual(want);
    });
    // the several-teams-per-account item is tagged for the one program that has it
    const multi = t.items.find((i) => i.text.startsWith("One account can belong to several teams"))!;
    expect(multi.programs).toEqual(PROGRAM_IDS.filter((id) => PROGRAMS[id].multiTeam));
  });

  it("uses plain wording: no internal tooling, no placeholder text, nothing about work that is not merged", () => {
    for (const item of t.items) expect(item.text).not.toMatch(/script|import tool|migration|TODO|coming soon|will be|guard|emulator|firestore|admin sdk/i);
  });
});
