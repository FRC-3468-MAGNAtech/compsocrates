import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EntryCard } from "@/components/changelog/entry-card";
import { entriesForProgram, type PlatformEntry } from "@/lib/platform-changelog/model";

// Synthetic fixtures only (invented release, not real notes).
const entry: PlatformEntry = {
  id: "e1",
  title: "Synthetic release",
  version: "Synthetic v9",
  date: "2026-05-01",
  status: "published",
  programs: ["frc", "ftc"],
  items: [
    { category: "new", text: "A shared item" },
    { category: "fixed", text: "An item for one program", programs: ["frc"] },
    { category: "improved", text: "An item for the other", programs: ["ftc"] },
  ],
  legacy: false,
  createdBy: "owner",
  createdAtMs: 1,
  updatedAtMs: 1,
  publishedAtMs: 1,
  rev: 1,
};
const render = (e: PlatformEntry, props: Partial<Parameters<typeof EntryCard>[0]> = {}) => renderToString(<EntryCard entry={e} expanded onToggle={() => {}} {...props} />);

describe("the changelog entry card", () => {
  it("groups the items under the title and version by category, in display order", () => {
    const html = render(entry);
    expect(html).toContain("Synthetic v9");
    expect(html).toContain("Synthetic release");
    expect(html.indexOf("New")).toBeLessThan(html.indexOf("Improved"));
    expect(html.indexOf("Improved")).toBeLessThan(html.indexOf("Fixed"));
  });

  it("the default view (items already narrowed to one program) shows no program badge; Show all programs badges only items not for everyone", () => {
    const forFirst = entriesForProgram([entry], "frc")[0];
    expect(render(forFirst)).not.toContain("program-badge");
    expect(render(forFirst)).not.toContain("An item for the other");
    const all = render(entriesForProgram([entry], null)[0], { showProgramBadges: true });
    expect(all.match(/data-testid="program-badge"/g)?.length).toBe(2); // one on each single-program item, none on the shared one
    expect(all).toContain("An item for the other");
  });

  it("labels a legacy entry and a draft note only where asked", () => {
    expect(render({ ...entry, legacy: true })).toContain("Legacy");
    expect(render(entry)).not.toContain("Legacy");
    expect(render({ ...entry, status: "draft" })).not.toContain("Draft");
    expect(render({ ...entry, status: "draft" }, { showDraftNote: true })).toContain("Draft");
  });

  it("omits the version badge when an entry has none", () => {
    const html = render({ ...entry, version: "" });
    expect(html).toContain("Synthetic release");
    expect(html).not.toContain("font-mono");
  });
});

describe("the Changelog page and its editor use the platform feed only", () => {
  const read = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");

  it("the page needs no team, writes no entry, seeds nothing, and compares no program id", () => {
    const code = read("app/(app)/[program]/changelog/page.tsx").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/teamId|useOurTeam|seed|saveEntry|patchEntry|deleteEntry|isAdmin|usePermissions/);
    expect(code).not.toMatch(/program\s*[!=]==/);
    expect(code).toContain("usePlatformFeed");
  });

  it("the owner editor reorders with buttons and with Alt+Arrow keys, and every control is a shared component", () => {
    const code = read("components/admin/platform-changelog-editor.tsx");
    expect(code).toContain('aria-label={`Move item ${i + 1} up`}');
    expect(code).toContain('aria-label={`Move item ${i + 1} down`}');
    expect(code).toContain("e.altKey");
    expect(code).not.toMatch(/<select\b/);
    expect(code).not.toMatch(/program\s*[!=]==|isFtc|isFrc/);
  });
});
