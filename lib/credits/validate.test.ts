import { describe, expect, it } from "vitest";
import { applyCreditsOp, type CreditSection } from "@/lib/credits/ops";
import { DEFAULT_CREDITS } from "@/lib/credits/seed";
import { parseCreditsInput } from "@/lib/credits/validate";

// Synthetic fixtures only.
const section = (over: Partial<CreditSection> & { entries?: Partial<CreditSection["entries"][number]>[] } = {}) => ({
  id: "s1",
  title: "People",
  order: 0,
  entries: [{ id: "e1", name: "Synthetic Person", description: "Role", link: "https://example.test/p", imageUrl: null }],
  ...over,
});

describe("validating a credits document (the server's write side)", () => {
  it("accepts the built-in list unchanged (reset stores it, so it must always validate)", () => {
    const r = parseCreditsInput(DEFAULT_CREDITS);
    expect(r).toEqual({ ok: true, sections: DEFAULT_CREDITS });
  });

  it("accepts a section description and keeps it; trims text; numbers the sections", () => {
    const r = parseCreditsInput([section({ description: "  Who made it  ", title: "  People " }), section({ id: "s2", entries: [] })]);
    expect(r.ok && r.sections.map((s) => [s.id, s.order, s.title, s.description])).toEqual([["s1", 0, "People", "Who made it"], ["s2", 1, "People", undefined]]);
  });

  it("link validation: https only, no javascript:, data:, http: or scheme-relative links, in links, images and text markup", () => {
    const withLink = (link: unknown, imageUrl: unknown = null) => parseCreditsInput([section({ entries: [{ id: "e1", name: "N", description: "", link: link as string, imageUrl: imageUrl as string }] })]);
    expect(withLink("https://example.test/ok").ok).toBe(true);
    expect(withLink(null).ok).toBe(true);
    expect(withLink("").ok).toBe(true);
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "http://example.test", "//example.test", "data:text/html,x", "ftp://example.test", "example.test", "https://", "https://x.test/" + "a".repeat(600)]) {
      expect(withLink(bad).ok, bad).toBe(false);
    }
    expect(withLink(null, "javascript:alert(1)").ok).toBe(false);
    expect(parseCreditsInput([section({ entries: [{ id: "e1", name: "N", description: "[x](javascript:alert(1))", link: null, imageUrl: null }] })]).ok).toBe(false);
    expect(parseCreditsInput([section({ description: "[x](http://example.test)" })]).ok).toBe(false);
  });

  it("rejects HTML, missing names or titles, repeated ids, over-long text and too many sections or entries", () => {
    const bad: unknown[] = [
      [section({ title: "" })],
      [section({ title: "<b>Hi</b>" })],
      [section({ entries: [{ id: "e1", name: "", description: "", link: null, imageUrl: null }] })],
      [section({ entries: [{ id: "e1", name: "N", description: "x".repeat(301), link: null, imageUrl: null }] })],
      [section({ id: "bad id!" })],
      [section(), section()],
      [section({ entries: [{ id: "e1", name: "A", description: "", link: null, imageUrl: null }, { id: "e1", name: "B", description: "", link: null, imageUrl: null }] })],
      Array.from({ length: 21 }, (_, i) => section({ id: `s${i}`, entries: [] })),
      [section({ entries: Array.from({ length: 61 }, (_, i) => ({ id: `e${i}`, name: "N", description: "", link: null, imageUrl: null })) })],
      "nope",
      [null],
    ];
    for (const b of bad) expect(parseCreditsInput(b).ok, JSON.stringify(b).slice(0, 60)).toBe(false);
  });
});

describe("editing the working copy (what the owner's editor does before Save)", () => {
  const base = (): CreditSection[] => parseCreditsInput([section({ id: "a" }), section({ id: "b", entries: [] }), section({ id: "c", entries: [] })]).ok ? (parseCreditsInput([section({ id: "a" }), section({ id: "b", entries: [] }), section({ id: "c", entries: [] })]) as { sections: CreditSection[] }).sections : [];

  it("reorders sections and entries (the same ops the buttons and the keyboard send), keeping the numbering", () => {
    const moved = applyCreditsOp(base(), { type: "move-section", sectionId: "c", toIndex: 0 });
    expect(moved.map((s) => [s.id, s.order])).toEqual([["c", 0], ["a", 1], ["b", 2]]);
    const entryMoved = applyCreditsOp(moved, { type: "move-entry", fromSectionId: "a", entryId: "e1", toSectionId: "b", toIndex: 0 });
    expect(entryMoved.find((s) => s.id === "b")!.entries.map((e) => e.id)).toEqual(["e1"]);
    expect(entryMoved.find((s) => s.id === "a")!.entries).toEqual([]);
  });

  it("sets and clears a section description without touching its entries", () => {
    const withDesc = applyCreditsOp(base(), { type: "edit-section", sectionId: "a", title: "People", description: "About" });
    expect(withDesc[0]).toMatchObject({ description: "About", entries: base()[0].entries });
    const cleared = applyCreditsOp(withDesc, { type: "edit-section", sectionId: "a", title: "People", description: "  " });
    expect(cleared[0]).not.toHaveProperty("description");
    const renamed = applyCreditsOp(withDesc, { type: "edit-section", sectionId: "a", title: "Crew" });
    expect(renamed[0]).toMatchObject({ title: "Crew", description: "About" }); // a rename that says nothing about the description keeps it
  });
});
