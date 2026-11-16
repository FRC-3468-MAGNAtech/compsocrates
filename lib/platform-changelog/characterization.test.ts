import { describe, expect, it } from "vitest";
import { formatEntryDate } from "@/lib/changelog";
import { hasUnread, latestVisiblePublishedMs, sortEntries, type PlatformEntry } from "@/lib/platform-changelog/model";

// Session 9, Task 1: characterization tests. They pin how ordering and the unread dot behave TODAY (before the date lock and the posted/edited
// times) and must keep passing unchanged. All fixtures are SYNTHETIC.
const e = (over: Partial<PlatformEntry> = {}): PlatformEntry => ({
  id: "e",
  title: "Synthetic",
  version: "",
  date: "2026-05-01",
  status: "published",
  programs: ["frc", "ftc"],
  items: [{ category: "new", text: "x" }],
  legacy: false,
  createdBy: "owner",
  createdAtMs: 1000,
  updatedAtMs: 1000,
  publishedAtMs: 1000,
  rev: 1,
  ...over,
});
const ids = (list: PlatformEntry[]) => sortEntries(list).map((x) => x.id);

describe("ordering today", () => {
  it("current entries sort by date (newest first), then by publish time, then by create time when unpublished", () => {
    expect(ids([e({ id: "old", date: "2026-01-01" }), e({ id: "new", date: "2026-06-01" }), e({ id: "mid", date: "2026-03-01" })])).toEqual(["new", "mid", "old"]);
    expect(ids([e({ id: "a", publishedAtMs: 100 }), e({ id: "b", publishedAtMs: 900 })])).toEqual(["b", "a"]);
    expect(ids([e({ id: "a", publishedAtMs: null, createdAtMs: 100 }), e({ id: "b", publishedAtMs: null, createdAtMs: 900 })])).toEqual(["b", "a"]);
  });
  it("legacy entries are always below current ones, whatever their date, and sort among themselves by date", () => {
    const list = [e({ id: "L-new", legacy: true, date: "2030-01-01" }), e({ id: "cur", date: "2020-01-01" }), e({ id: "L-old", legacy: true, date: "2019-01-01" })];
    expect(ids(list)).toEqual(["cur", "L-new", "L-old"]);
  });
  it("the last-edited time (updatedAt) never affects the order", () => {
    expect(ids([e({ id: "a", updatedAtMs: 1 }), e({ id: "b", updatedAtMs: 999_999, publishedAtMs: 500 })])).toEqual(["a", "b"]);
    expect(ids([e({ id: "a", legacy: true, updatedAtMs: 1 }), e({ id: "b", legacy: true, updatedAtMs: 999_999, publishedAtMs: 500 })])).toEqual(["a", "b"]);
  });
});

describe("the unread dot today", () => {
  it("compares the publish time with the later of the last visit and the account's creation", () => {
    const list = [e({ publishedAtMs: 5000 })];
    expect(hasUnread(list, "frc", 4000, null)).toBe(true);
    expect(hasUnread(list, "frc", 5000, null)).toBe(false);
    expect(hasUnread(list, "frc", null, 6000)).toBe(false);
  });
  it("never reads the update time: a later edit does not relight it", () => {
    expect(hasUnread([e({ publishedAtMs: 1000, updatedAtMs: 9_000_000 })], "frc", 2000, null)).toBe(false);
  });
  it("never lights for legacy entries or drafts, whatever their times", () => {
    expect(hasUnread([e({ legacy: true, publishedAtMs: 9000 })], "frc", 0, null)).toBe(false);
    expect(hasUnread([e({ status: "draft", publishedAtMs: 9000 })], "frc", 0, null)).toBe(false);
    expect(latestVisiblePublishedMs([e({ legacy: true, publishedAtMs: 9000 })], "frc")).toBeNull();
  });
});

describe("tie-break and date display today", () => {
  it("imported entries have publishedAt == createdAt, so their order among equal dates is the same under either rule (newest first)", () => {
    const list = [e({ id: "a", legacy: true, createdAtMs: 100, publishedAtMs: 100 }), e({ id: "b", legacy: true, createdAtMs: 900, publishedAtMs: 900 })];
    expect(ids(list)).toEqual(["b", "a"]);
  });
  it("equal dates, equal times: the version (numeric) and then the id decide", () => {
    expect(ids([e({ id: "a", version: "v2" }), e({ id: "b", version: "v10" })])).toEqual(["b", "a"]);
  });
  it("formatEntryDate shows the stored calendar day in UTC, so it never shifts with the viewer's zone, and passes invalid text through", () => {
    expect(formatEntryDate("2026-11-05")).toBe("Nov 5, 2026");
    expect(formatEntryDate("2026-01-01")).toBe("Jan 1, 2026");
    expect(formatEntryDate("2026-02-30")).toBe("2026-02-30");
    expect(formatEntryDate("")).toBe("");
  });
});
