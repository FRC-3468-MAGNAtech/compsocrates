import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PROGRAM_IDS } from "@/config/programs/types";
import { isChangeType } from "@/lib/changelog";
import { MAX_ITEMS, MAX_TOTAL_TEXT, parseEntryInput } from "@/lib/platform-changelog/model";
import { v2Template } from "@/lib/platform-changelog/template";
import { V2_ITEMS, V2_DEFAULT_PROGRAMS, v2EntryInput } from "@/lib/platform-changelog/v2-entry";
import { MAX_CHANGE_TEXT } from "@/lib/changelog";

const BANNED = /rules|firestore|admin sdk|credentials|api key|token|security|vulnerab/i;

describe("the v2.0.0 entry and its editor template", () => {
  const t = v2Template("2026-11-15");

  it("is titled CompSocrates v2.0.0, labelled v2.0.0, tagged for every program by default, and passes the server's validation", () => {
    expect(t.title).toBe("CompSocrates v2.0.0");
    expect(t.version).toBe("v2.0.0");
    expect(t.programs).toEqual([...PROGRAM_IDS]);
    expect(V2_DEFAULT_PROGRAMS).toEqual([...PROGRAM_IDS]);
    const parsed = parseEntryInput(t);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.items).toHaveLength(V2_ITEMS.length);
  });

  it("the template is the shared data module: same items, in order, with the same tags", () => {
    expect(t).toEqual(v2EntryInput("2026-11-15"));
    expect(t.items.map((i) => i.text)).toEqual(V2_ITEMS.map((i) => i.text));
    expect(t.items.map((i) => i.programs)).toEqual(V2_ITEMS.map((i) => [...i.programs]));
    // nothing from the module's `proof` leaks into what is stored
    for (const i of t.items) expect(Object.keys(i).sort()).toEqual(["category", "programs", "text"]);
  });

  it("every item has a valid category and an explicit program tag", () => {
    for (const i of V2_ITEMS) {
      expect(isChangeType(i.category), i.text).toBe(true);
      expect(i.programs.length, i.text).toBeGreaterThan(0);
      for (const p of i.programs) expect((PROGRAM_IDS as readonly string[]).includes(p), i.text).toBe(true);
    }
  });

  it("FRC-only and FTC-only items are not tagged for both", () => {
    const onlyFrc = V2_ITEMS.filter((i) => i.programs.length === 1 && i.programs[0] === "frc");
    const onlyFtc = V2_ITEMS.filter((i) => i.programs.length === 1 && i.programs[0] === "ftc");
    expect(onlyFrc).toHaveLength(4);
    expect(onlyFtc).toHaveLength(11);
    for (const i of V2_ITEMS) expect(i.programs.length === PROGRAM_IDS.length || i.programs.length === 1, i.text).toBe(true);
    // the four FRC-only items and eleven FTC-only items of the approved text are exactly the program-specific ones
    expect(onlyFrc.map((i) => i.text.split(":")[0])).toEqual(["CHARGED UP", "Match Prediction", "Team Communication", "REBUILT Match Scout Form"]);
    expect(onlyFtc.map((i) => i.text.split(":")[0])).toEqual([
      "BIOBUZZ Scouting", "Hive and Garden Roles", "Scouting Forms", "Practice Scouting", "Scout Accuracy", "Analytics", "Events", "Match Library", "Field Teams", "Join Requests", "Admin Panel",
    ]);
  });

  it("has the approved number of items per section", () => {
    const count = (c: string) => V2_ITEMS.filter((i) => i.category === c).length;
    expect({ new: count("new"), improved: count("improved"), fixed: count("fixed"), removed: count("removed") }).toEqual({ new: 24, improved: 16, fixed: 1, removed: 5 });
    expect(V2_ITEMS).toHaveLength(46);
    expect(V2_ITEMS.length).toBeLessThanOrEqual(MAX_ITEMS);
  });

  it("every item and the whole entry are within the length limits", () => {
    for (const i of V2_ITEMS) expect(i.text.length, i.text).toBeLessThanOrEqual(MAX_CHANGE_TEXT);
    const total = t.title.length + V2_ITEMS.reduce((n, i) => n + i.text.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_TEXT);
  });

  it("is plain text: no markup, no markdown, no control characters, no blank text", () => {
    for (const i of V2_ITEMS) {
      expect(i.text, i.text).toBe(i.text.trim());
      expect(i.text.length, i.text).toBeGreaterThan(0);
      expect(i.text, i.text).not.toMatch(/[<*`]|\]\(|[\u0000-\u001F]/);
    }
  });

  it("names no internal term", () => {
    for (const i of V2_ITEMS) expect(i.text, i.text).not.toMatch(BANNED);
    expect(t.title).not.toMatch(BANNED);
  });

  it("every proof file exists in the repository", () => {
    const proofs = V2_ITEMS.filter((i) => i.proof);
    expect(proofs.length).toBeGreaterThanOrEqual(40);
    for (const i of proofs) expect(existsSync(path.join(process.cwd(), i.proof!)), i.proof).toBe(true);
  });
});
