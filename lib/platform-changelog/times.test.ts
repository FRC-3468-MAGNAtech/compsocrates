import { describe, expect, it } from "vitest";
import { entryFromDoc, hasUnread, sortEntries, type PlatformEntry } from "@/lib/platform-changelog/model";
import { MAX_FUTURE_SKEW_MS, checkTimes, entryTimeParts, fillFromImport, formatDateTime, formatDateTimeFull, localInputToMs, msToLocalInput, parseTimePatch, timePatchFromInputs } from "@/lib/platform-changelog/times";

// SYNTHETIC values only.
const NOW = Date.UTC(2026, 5, 15, 12, 0, 0);
const MIN = 60_000;

describe("parseTimePatch", () => {
  it("absent or null means no change; a key left out is left alone; null clears; a number sets", () => {
    expect(parseTimePatch(undefined)).toEqual({ ok: true, value: {} });
    expect(parseTimePatch(null)).toEqual({ ok: true, value: {} });
    expect(parseTimePatch({ postedAt: null })).toEqual({ ok: true, value: { postedAt: null } });
    expect(parseTimePatch({ editedAt: 1_700_000_000_000 })).toEqual({ ok: true, value: { editedAt: 1_700_000_000_000 } });
  });
  it("refuses anything that is not a valid epoch number, with a clear message", () => {
    for (const bad of ["2026-01-01", 0, -5, 1.5, NaN, Infinity, true, [], {}]) {
      const r = parseTimePatch({ postedAt: bad });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe("Time posted isn't a valid date and time.");
    }
    expect(parseTimePatch({ editedAt: "x" })).toEqual({ ok: false, error: "Last edited isn't a valid date and time." });
    expect(parseTimePatch("nope").ok).toBe(false);
  });
});

describe("checkTimes", () => {
  it("accepts up to 5 minutes ahead of the server clock and refuses more", () => {
    expect(checkTimes({ postedAt: NOW + MAX_FUTURE_SKEW_MS, editedAt: null }, NOW)).toBeNull();
    expect(checkTimes({ postedAt: NOW + MAX_FUTURE_SKEW_MS + 1, editedAt: null }, NOW)).toBe("Time posted can't be in the future.");
    expect(checkTimes({ postedAt: null, editedAt: NOW + 10 * MIN }, NOW)).toBe("Last edited can't be in the future.");
  });
  it("last edited cannot be earlier than posted when both exist; either alone is fine", () => {
    expect(checkTimes({ postedAt: NOW - MIN, editedAt: NOW - 2 * MIN }, NOW)).toBe("Last edited can't be earlier than Time posted.");
    expect(checkTimes({ postedAt: NOW - MIN, editedAt: NOW - MIN }, NOW)).toBeNull();
    expect(checkTimes({ postedAt: null, editedAt: NOW - 2 * MIN }, NOW)).toBeNull();
    expect(checkTimes({ postedAt: null, editedAt: null }, NOW)).toBeNull();
  });
});

describe("the owner's date-time inputs", () => {
  it("round trip through the local zone; empty is null; junk is invalid", () => {
    const ms = new Date(2026, 2, 4, 9, 30).getTime(); // local 2026-03-04 09:30
    expect(msToLocalInput(ms)).toBe("2026-03-04T09:30");
    expect(localInputToMs("2026-03-04T09:30")).toBe(ms);
    expect(localInputToMs("")).toBeNull();
    expect(localInputToMs("  ")).toBeNull();
    for (const bad of ["2026-03-04", "2026-13-40T10:00", "tomorrow", "2026-03-04T25:00"]) expect(localInputToMs(bad)).toBe("invalid");
    expect(msToLocalInput(null)).toBe("");
    expect(msToLocalInput(undefined)).toBe("");
  });
  it("only a field the owner changed goes in the patch; Clear is null; unchanged fields are never sent", () => {
    const opened = { posted: "2026-03-04T09:30", edited: "" };
    const stored = { postedAt: localInputToMs("2026-03-04T09:30") as number, editedAt: null };
    expect(timePatchFromInputs(opened, { ...opened }, NOW, stored)).toEqual({ ok: true, patch: {} });
    expect(timePatchFromInputs(opened, { posted: "", edited: "" }, NOW, stored)).toEqual({ ok: true, patch: { postedAt: null } });
    const set = timePatchFromInputs(opened, { posted: opened.posted, edited: "2026-03-05T10:00" }, NOW, stored);
    expect(set).toEqual({ ok: true, patch: { editedAt: new Date(2026, 2, 5, 10, 0).getTime() } });
  });
  it("explains a bad or impossible combination before sending", () => {
    const opened = { posted: "", edited: "" };
    const none = { postedAt: null, editedAt: null };
    expect(timePatchFromInputs(opened, { posted: "junk", edited: "" }, NOW, none)).toEqual({ ok: false, error: "Time posted isn't a valid date and time." });
    expect(timePatchFromInputs(opened, { posted: msToLocalInput(NOW + 60 * MIN), edited: "" }, NOW, none)).toEqual({ ok: false, error: "Time posted can't be in the future." });
    expect(timePatchFromInputs(opened, { posted: msToLocalInput(NOW - MIN), edited: msToLocalInput(NOW - 60 * MIN) }, NOW, none)).toEqual({ ok: false, error: "Last edited can't be earlier than Time posted." });
  });
});

describe("display in the viewer's zone", () => {
  const ms = Date.UTC(2026, 10, 5, 23, 30); // 2026-11-05 23:30 UTC
  it("the same instant reads as different local days and times in two zones, in the viewer's locale", () => {
    expect(formatDateTime(ms, { locale: "en-US", timeZone: "UTC" })).toBe("Nov 5, 2026, 11:30 PM");
    expect(formatDateTime(ms, { locale: "en-US", timeZone: "Asia/Tokyo" })).toBe("Nov 6, 2026, 8:30 AM");
    expect(formatDateTime(ms, { locale: "en-US", timeZone: "America/Los_Angeles" })).toBe("Nov 5, 2026, 3:30 PM");
    expect(formatDateTime(ms, { locale: "de-DE", timeZone: "UTC" })).toContain("5.11.2026");
  });
  it("the tooltip has the full date, seconds and the zone", () => {
    const full = formatDateTimeFull(ms, { locale: "en-US", timeZone: "America/Los_Angeles" });
    expect(full).toContain("Thursday, November 5, 2026");
    expect(full).toMatch(/3:30:00 PM/);
    expect(full).toMatch(/PST|Pacific/);
  });
  it("the line has only the times that exist, posted first; none for an old document", () => {
    expect(entryTimeParts({})).toEqual([]);
    expect(entryTimeParts({ postedAtMs: null, editedAtMs: null })).toEqual([]);
    expect(entryTimeParts({ editedAtMs: 5 })).toEqual([{ label: "Edited", ms: 5 }]);
    expect(entryTimeParts({ postedAtMs: 4, editedAtMs: 5 })).toEqual([{ label: "Posted", ms: 4 }, { label: "Edited", ms: 5 }]);
  });
});

describe("Fill from import", () => {
  const legacy = { legacy: true, rev: 1, publishedAtMs: 1000, createdAtMs: 1000, updatedAtMs: 5000 };
  it("fills posted from publishedAt and edited from updatedAt only when updatedAt is later than createdAt", () => {
    expect(fillFromImport(legacy)).toEqual({ postedAt: 1000, editedAt: 5000 });
    expect(fillFromImport({ ...legacy, updatedAtMs: 1000 })).toEqual({ postedAt: 1000, editedAt: null });
    expect(fillFromImport({ ...legacy, updatedAtMs: 400 })).toEqual({ postedAt: 1000, editedAt: null });
  });
  it("does not apply once the entry was saved (rev above 1) or when it is not legacy", () => {
    expect(fillFromImport({ ...legacy, rev: 2 })).toBeNull();
    expect(fillFromImport({ ...legacy, legacy: false })).toBeNull();
  });
});

describe("the new fields change nothing else", () => {
  const base = (over: Partial<PlatformEntry> = {}): PlatformEntry => ({ id: "e", title: "S", version: "", date: "2026-05-01", status: "published", programs: ["frc", "ftc"], items: [{ category: "new", text: "x" }], legacy: false, createdBy: "o", createdAtMs: 1000, updatedAtMs: 1000, publishedAtMs: 1000, rev: 1, ...over });
  it("a document without the fields reads with nulls, and with them reads their values", () => {
    const old = entryFromDoc("a", { title: "T", date: "2026-01-01", status: "published", programs: ["frc"], items: [], rev: 1, publishedAt: 5 });
    expect(old).toMatchObject({ postedAtMs: null, editedAtMs: null, editedBy: "" });
    const fresh = entryFromDoc("a", { title: "T", date: "2026-01-01", status: "published", programs: ["frc"], items: [], rev: 2, publishedAt: 5, postedAt: 5, editedAt: 9, editedBy: "uid1" });
    expect(fresh).toMatchObject({ postedAtMs: 5, editedAtMs: 9, editedBy: "uid1" });
  });
  it("posted and edited times never move an entry or relight the dot (publishedAt alone drives both)", () => {
    const a = base({ id: "a", publishedAtMs: 100 });
    const b = base({ id: "b", publishedAtMs: 900 });
    expect(sortEntries([a, b]).map((x) => x.id)).toEqual(["b", "a"]);
    expect(sortEntries([{ ...a, postedAtMs: 99_999, editedAtMs: 99_999 }, b]).map((x) => x.id)).toEqual(["b", "a"]);
    expect(hasUnread([base({ publishedAtMs: 1000, postedAtMs: 9_000_000, editedAtMs: 9_000_000 })], "frc", 2000, null)).toBe(false);
    expect(hasUnread([base({ publishedAtMs: 3000, postedAtMs: 1, editedAtMs: 1 })], "frc", 2000, null)).toBe(true);
  });
  it("a legacy entry is ordered by creation time among equal dates, so a new publish time does not move it; a current one still uses publish time", () => {
    const l1 = base({ id: "l1", legacy: true, createdAtMs: 100, publishedAtMs: 100 });
    const l2 = base({ id: "l2", legacy: true, createdAtMs: 900, publishedAtMs: 900 });
    expect(sortEntries([l1, l2]).map((x) => x.id)).toEqual(["l2", "l1"]);
    expect(sortEntries([{ ...l1, publishedAtMs: 5_000_000 }, l2]).map((x) => x.id)).toEqual(["l2", "l1"]);
    expect(sortEntries([{ ...l1, publishedAtMs: null }, l2]).map((x) => x.id)).toEqual(["l2", "l1"]);
    const c1 = base({ id: "c1", createdAtMs: 100, publishedAtMs: 100 });
    const c2 = base({ id: "c2", createdAtMs: 900, publishedAtMs: 900 });
    expect(sortEntries([{ ...c1, publishedAtMs: 5_000_000 }, c2]).map((x) => x.id)).toEqual(["c1", "c2"]);
  });
});
