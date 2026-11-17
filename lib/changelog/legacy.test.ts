import { describe, expect, it } from "vitest";
import { MAX_CHANGE_TEXT, MAX_CHANGES, entryFromData, hasUnread, latestPublishedMs, sortEntries, type ChangelogEntry } from "@/lib/changelog";
import { convertCsReleaseNote, isoDateOfMs, legacyDocId, markerType, planLegacyImport } from "@/lib/changelog/legacy";

// FIXTURES ARE SYNTHETIC. The old app's release notes live only in its production Firestore (`teams/{id}.versionReleases`); no export
// is in this repository, so these notes copy the stored SHAPE ({ id, title, body, createdAt, updatedAt }), not real wording.
const note = (over: Record<string, unknown> = {}) => ({
  id: "n1",
  title: "Pit form update",
  body: "Added the drive train question.\nFixed the photo upload.",
  createdAt: Date.UTC(2025, 2, 20, 15, 30),
  updatedAt: Date.UTC(2025, 2, 21, 9, 0),
  ...over,
});

describe("convertCsReleaseNote", () => {
  it("keeps the title and the lines as written, with the date from the creation time", () => {
    const r = convertCsReleaseNote("T1", note());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entry).toMatchObject({ title: "Pit form update", date: "2025-03-20", version: "2025-03-20", summary: "" });
    expect(r.entry.changes).toEqual([
      { type: "new", text: "Added the drive train question." },
      { type: "fixed", text: "Fixed the photo upload." },
    ]);
    expect(r.entry.warnings).toEqual([]);
    expect(r.entry.updatedAtMs).toBe(Date.UTC(2025, 2, 21, 9, 0));
  });

  it("uses a version label from the title when it starts with one", () => {
    const r = convertCsReleaseNote("T1", note({ title: "v2.1.0 - Match list" }));
    expect(r.ok && r.entry.version).toBe("v2.1.0");
    expect(r.ok && r.entry.title).toBe("v2.1.0 - Match list");
  });

  it("maps the marker words to the new categories, and files unmarked lines as improved with a warning", () => {
    expect(markerType("Added x")).toBe("new");
    expect(markerType("New: x")).toBe("new");
    expect(markerType("[Fix] x")).toBe("fixed");
    expect(markerType("Bug fixes for x")).toBe("fixed");
    expect(markerType("Removed x")).toBe("removed");
    expect(markerType("Changed x")).toBe("improved");
    expect(markerType("Updated x")).toBe("improved");
    expect(markerType("The form looks different")).toBeNull();
    const r = convertCsReleaseNote("T1", note({ body: "- Added a thing\n- The form looks different" }));
    expect(r.ok && r.entry.changes).toEqual([
      { type: "new", text: "Added a thing" }, // only the bullet glyph is dropped
      { type: "improved", text: "The form looks different" },
    ]);
    expect(r.ok && r.entry.warnings[0]).toMatch(/1 line\(s\) had no marker word/);
  });

  it("splits an over-long line at a space and loses no text", () => {
    const long = Array.from({ length: 120 }, (_, i) => `word${i}`).join(" ");
    const r = convertCsReleaseNote("T1", note({ body: `Added ${long}` }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entry.changes.length).toBeGreaterThan(1);
    expect(r.entry.changes.every((c) => c.text.length <= MAX_CHANGE_TEXT && c.type === "new")).toBe(true);
    expect(r.entry.changes.map((c) => c.text).join(" ")).toBe(`Added ${long}`);
  });

  it("joins the last lines when a note has more lines than an entry holds, and says so", () => {
    const body = Array.from({ length: MAX_CHANGES + 5 }, (_, i) => `Fixed item ${i}`).join("\n");
    const r = convertCsReleaseNote("T1", note({ body }));
    expect(r.ok && r.entry.changes).toHaveLength(MAX_CHANGES);
    expect(r.ok && r.entry.warnings.join(" ")).toMatch(/lines were joined/);
  });

  it("does not import a note it cannot store: no id, title, body or creation date", () => {
    expect(convertCsReleaseNote("T1", note({ id: "" })).ok).toBe(false);
    expect(convertCsReleaseNote("T1", note({ title: "  " })).ok).toBe(false);
    expect(convertCsReleaseNote("T1", note({ body: "\n \n" })).ok).toBe(false);
    const undated = convertCsReleaseNote("T1", note({ createdAt: 0 }));
    expect(undated).toMatchObject({ ok: false });
    expect(!undated.ok && undated.reason).toMatch(/no creation date/);
  });

  it("takes the date in UTC, so it does not depend on the machine", () => {
    expect(isoDateOfMs(Date.UTC(2025, 3, 1, 0, 30))).toBe("2025-04-01");
    expect(isoDateOfMs(Date.UTC(2025, 2, 31, 23, 59))).toBe("2025-03-31");
  });
});

describe("stable ids", () => {
  it("the same old note always gets the same doc id, per team, so a second run cannot duplicate it", () => {
    const a = planLegacyImport({ T1: [note()] });
    const b = planLegacyImport({ T1: [note()] });
    expect(a.entries[0].id).toBe(b.entries[0].id);
    expect(a.entries[0].id).toBe(legacyDocId("T1", "n1"));
    expect(planLegacyImport({ T2: [note()] }).entries[0].id).not.toBe(a.entries[0].id);
    expect(a.entries[0].id.startsWith("starter-")).toBe(false); // never collides with the starter drafts
  });

  it("plans entries oldest first, reports what was skipped, and tolerates a bad team value", () => {
    const plan = planLegacyImport({
      T1: [note({ id: "late", createdAt: Date.UTC(2025, 5, 1) }), note({ id: "early", createdAt: Date.UTC(2025, 1, 1) }), note({ id: "x", title: "" })],
      T2: "nope",
    });
    expect(plan.entries.map((e) => e.id)).toEqual([legacyDocId("T1", "early"), legacyDocId("T1", "late")]);
    expect(plan.skipped.map((s) => s.id)).toEqual(["x", "(whole team)"]);
  });
});

describe("ordering and the unread dot", () => {
  const entry = (over: Partial<ChangelogEntry>): ChangelogEntry => ({
    id: "e",
    teamId: "T1",
    version: "v1",
    title: "t",
    date: "2026-10-19",
    summary: "",
    changes: [],
    status: "published",
    pinned: false,
    createdBy: "u",
    createdAtMs: 1,
    updatedAtMs: 1,
    publishedAtMs: 1,
    ...over,
  });

  it("old entries list below the current ones, newest first among themselves, even when dated later", () => {
    const current = entry({ id: "cur-a", date: "2026-10-19" });
    const current2 = entry({ id: "cur-b", date: "2026-10-26" });
    const old1 = entry({ id: "old-1", date: "2025-03-20", legacy: true });
    const old2 = entry({ id: "old-2", date: "2026-11-01", legacy: true }); // dated after every current entry
    const old3 = entry({ id: "old-3", date: "2025-01-05", legacy: true });
    expect(sortEntries([old1, current, old3, old2, current2]).map((e) => e.id)).toEqual(["cur-b", "cur-a", "old-2", "old-1", "old-3"]);
  });

  it("a pinned entry still comes first", () => {
    expect(sortEntries([entry({ id: "old", legacy: true }), entry({ id: "pin", pinned: true, date: "2020-01-01" })])[0].id).toBe("pin");
  });

  it("an old entry never lights the unread dot, for someone who never opened the changelog or for anyone else", () => {
    const old = entry({ legacy: true, publishedAtMs: 5_000 });
    expect(hasUnread([old], null)).toBe(false);
    expect(hasUnread([old], 1)).toBe(false);
    expect(latestPublishedMs([old])).toBeNull();
    // a current entry still does, so old entries do not hide real news
    expect(hasUnread([old, entry({ publishedAtMs: 5_000 })], null)).toBe(true);
    expect(latestPublishedMs([old, entry({ publishedAtMs: 7_000 })])).toBe(7_000);
  });

  it("the legacy flag survives reading a stored doc, and is absent on ordinary entries", () => {
    expect(entryFromData("a", { legacy: true, changes: [] }).legacy).toBe(true);
    expect(entryFromData("b", { changes: [] }).legacy).toBeUndefined();
    expect(entryFromData("c", { legacy: "yes", changes: [] }).legacy).toBeUndefined();
  });
});
