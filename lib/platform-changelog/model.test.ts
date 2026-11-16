import { describe, expect, it } from "vitest";
import {
  choiceFromTags,
  entriesForProgram,
  entryFromDoc,
  groupItems,
  hasUnread,
  itemTags,
  latestVisiblePublishedMs,
  moveItem,
  normalizeTags,
  parseEntryInput,
  sortEntries,
  tagsFromChoice,
  taggedForAll,
  type PlatformEntry,
} from "@/lib/platform-changelog/model";

// All fixtures here are SYNTHETIC (invented titles and times), not real release notes.
const base = (over: Partial<PlatformEntry> = {}): PlatformEntry => ({
  id: "e1",
  title: "Synthetic release",
  version: "v1",
  date: "2026-05-01",
  status: "published",
  programs: ["frc", "ftc"],
  items: [{ category: "new", text: "both" }],
  legacy: false,
  createdBy: "owner",
  createdAtMs: 1000,
  updatedAtMs: 1000,
  publishedAtMs: 1000,
  rev: 1,
  ...over,
});

describe("tags", () => {
  it("normalizes to known ids, no duplicates, registry order; rejects empty and unknown", () => {
    expect(normalizeTags(["ftc", "frc", "frc"])).toEqual(["frc", "ftc"]);
    expect(normalizeTags([])).toBeNull();
    expect(normalizeTags(["frc", "x"])).toBeNull();
    expect(normalizeTags("frc")).toBeNull();
  });
  it("an item follows its entry unless it has its own tags; the editor's three choices round trip", () => {
    const e = base({ programs: ["frc"] });
    expect(itemTags(e, { category: "new", text: "a" })).toEqual(["frc"]);
    expect(itemTags(e, { category: "new", text: "a", programs: ["ftc"] })).toEqual(["ftc"]);
    expect(tagsFromChoice("all")).toEqual(["frc", "ftc"]);
    expect(tagsFromChoice("ftc")).toEqual(["ftc"]);
    expect(tagsFromChoice("nope")).toBeNull();
    expect(choiceFromTags(["frc", "ftc"])).toBe("all");
    expect(choiceFromTags(["frc"])).toBe("frc");
    expect(taggedForAll(["frc", "ftc"])).toBe(true);
    expect(taggedForAll(["ftc"])).toBe(false);
  });
});

describe("the default view and Show all programs", () => {
  const e = base({
    items: [
      { category: "new", text: "both" },
      { category: "fixed", text: "frc only", programs: ["frc"] },
      { category: "improved", text: "ftc only", programs: ["ftc"] },
    ],
  });
  it("a program sees its own and both-tagged items; the views differ only by tagged items; all shows everything", () => {
    expect(entriesForProgram([e], "frc")[0].items.map((i) => i.text)).toEqual(["both", "frc only"]);
    expect(entriesForProgram([e], "ftc")[0].items.map((i) => i.text)).toEqual(["both", "ftc only"]);
    expect(entriesForProgram([e], null)[0].items).toHaveLength(3);
  });
  it("an entry with no visible item is hidden for that program (and shown under all)", () => {
    const ftcOnly = base({ programs: ["ftc"] });
    expect(entriesForProgram([ftcOnly], "frc")).toEqual([]);
    expect(entriesForProgram([ftcOnly], "ftc")).toHaveLength(1);
    expect(entriesForProgram([ftcOnly], null)).toHaveLength(1);
  });
  it("groups items by category in display order, skipping empty groups", () => {
    expect(groupItems(e.items).map((g) => g.category)).toEqual(["new", "improved", "fixed"]);
  });
});

describe("ordering", () => {
  it("legacy entries sit below current ones whatever their date; current newest first", () => {
    const sorted = sortEntries([
      base({ id: "old-legacy", legacy: true, date: "2030-01-01" }),
      base({ id: "newer", date: "2026-06-01" }),
      base({ id: "older", date: "2026-01-01" }),
    ]);
    expect(sorted.map((x) => x.id)).toEqual(["newer", "older", "old-legacy"]);
  });
});

describe("the unread dot", () => {
  const e = base({ publishedAtMs: 5000 });
  it("lights for a published, current entry newer than the last visit with an item for the program", () => {
    expect(hasUnread([e], "frc", 4000, null)).toBe(true);
    expect(hasUnread([e], "frc", 5000, null)).toBe(false);
    expect(hasUnread([e], "frc", null, null)).toBe(true);
  });
  it("never lights for drafts or legacy entries", () => {
    expect(hasUnread([base({ status: "draft", publishedAtMs: null })], "frc", 0, null)).toBe(false);
    expect(hasUnread([base({ legacy: true, publishedAtMs: 9999 })], "frc", 0, null)).toBe(false);
  });
  it("needs at least one item visible to the current program", () => {
    const ftcOnly = base({ publishedAtMs: 5000, programs: ["ftc"] });
    expect(hasUnread([ftcOnly], "frc", 0, null)).toBe(false);
    expect(hasUnread([ftcOnly], "ftc", 0, null)).toBe(true);
    const mixed = base({ publishedAtMs: 5000, programs: ["ftc"], items: [{ category: "new", text: "x", programs: ["frc"] }] });
    expect(hasUnread([mixed], "frc", 0, null)).toBe(true);
  });
  it("entries older than the account itself count as seen (no pile for a new account)", () => {
    expect(hasUnread([e], "frc", null, 6000)).toBe(false);
    expect(hasUnread([e], "frc", null, 4000)).toBe(true);
    expect(hasUnread([e], "frc", 7000, 4000)).toBe(false);
  });
  it("the stamp time follows the newest visible current entry", () => {
    const ftc = base({ id: "a", publishedAtMs: 9000, programs: ["ftc"] });
    const both = base({ id: "b", publishedAtMs: 6000 });
    const legacy = base({ id: "c", publishedAtMs: 99999, legacy: true });
    expect(latestVisiblePublishedMs([ftc, both, legacy], "frc")).toBe(6000);
    expect(latestVisiblePublishedMs([ftc, both, legacy], "ftc")).toBe(9000);
    expect(latestVisiblePublishedMs([legacy], "frc")).toBeNull();
  });
});

describe("reading a stored document and parsing input", () => {
  it("reads defensively: bad items dropped, unknown tags fall back to all programs, Timestamps accepted", () => {
    const e = entryFromDoc("x", {
      title: "T",
      status: "published",
      programs: ["zzz"],
      items: [{ category: "new", text: "ok" }, { category: "bogus", text: "no" }, null, { category: "fixed", text: "tagged", programs: ["ftc"] }],
      createdAt: { toMillis: () => 123 },
      rev: 3,
    });
    expect(e.programs).toEqual(["frc", "ftc"]);
    expect(e.items).toEqual([{ category: "new", text: "ok" }, { category: "fixed", text: "tagged", programs: ["ftc"] }]);
    expect(e.createdAtMs).toBe(123);
    expect(e.rev).toBe(3);
    expect(e.legacy).toBe(false);
  });
  it("parseEntryInput trims, drops empty rows, keeps only known keys", () => {
    const r = parseEntryInput({ title: "  T ", version: " v1 ", date: "2026-02-03", programs: ["ftc"], items: [{ category: "new", text: " a ", junk: 1 }, { category: "new", text: "   " }] });
    expect(r).toEqual({ ok: true, value: { title: "T", version: "v1", date: "2026-02-03", programs: ["ftc"], items: [{ category: "new", text: "a" }] } });
  });
  it("moveItem swaps neighbours and never mutates", () => {
    const list = ["a", "b", "c"];
    expect(moveItem(list, 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveItem(list, 0, -1)).toEqual(["a", "b", "c"]);
    expect(moveItem(list, 2, 1)).toEqual(["a", "b", "c"]);
    expect(list).toEqual(["a", "b", "c"]);
  });
});
