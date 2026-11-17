import { describe, expect, it } from "vitest";
import { ftcDocsToFormEntries, ftcDocToFormEntry, type FtcFormEntryDoc } from "@/data/ftc/form-entries";

const stored = (over: FtcFormEntryDoc = {}): FtcFormEntryDoc => ({
  teamId: "team-1",
  uid: "uid-ada",
  scoutName: "Ada",
  formId: "pit-scout",
  formVersion: 2,
  formType: "pit-scout",
  eventCode: "USTXAUS1",
  matchKey: "Q12",
  alliance: "blue",
  teamNumber: 4242,
  values: { drivetrain: "mecanum" },
  stickyNotes: [{ id: "n1", text: "tidy wiring", color: "green", createdAt: 1 }],
  linkedEntryId: "plan-1",
  planDifferences: 1,
  flags: [{ id: "f1", reason: "Other", note: "check", addedAt: "2026-01-10T16:00:00.000Z" }],
  excluded: false,
  createdAt: { toMillis: () => 2000 },
  updatedAt: { toMillis: () => 3000 },
  ...over,
});

describe("ftcDocToFormEntry", () => {
  it("maps a stored entry", () => {
    const entry = ftcDocToFormEntry("fe1", stored());
    expect(entry).toMatchObject({
      id: "fe1",
      teamId: "team-1",
      uid: "uid-ada",
      scoutName: "Ada",
      formId: "pit-scout",
      formVersion: 2,
      formType: "pit-scout",
      eventCode: "USTXAUS1",
      matchKey: "Q12",
      alliance: "blue",
      teamNumber: 4242,
      values: { drivetrain: "mecanum" },
      linkedEntryId: "plan-1",
      planDifferences: 1,
      flags: [{ id: "f1", reason: "Other", note: "check", addedAt: "2026-01-10T16:00:00.000Z" }],
      excluded: false,
      createdAtMs: 2000,
      updatedAtMs: 3000,
    });
    expect(entry.stickyNotes).toHaveLength(1);
  });

  it("a sparse doc does not throw and gets neutral values", () => {
    const entry = ftcDocToFormEntry("fe2", {});
    expect(entry).toEqual({
      id: "fe2",
      teamId: "",
      uid: "",
      scoutName: "",
      formId: "",
      formVersion: 0,
      formType: "custom",
      eventCode: "",
      matchKey: null,
      alliance: null,
      teamNumber: null,
      values: {},
      stickyNotes: [],
      linkedEntryId: null,
      flags: [],
      excluded: false,
      createdAtMs: 0,
      updatedAtMs: 0,
    });
  });

  it("an unknown form type, and match-scout (which lives in scoutEntries), read as custom", () => {
    expect(ftcDocToFormEntry("a", stored({ formType: "bogus" })).formType).toBe("custom");
    expect(ftcDocToFormEntry("b", stored({ formType: "match-scout" })).formType).toBe("custom");
    for (const type of ["lead-scout", "pit-scout", "team-strategy", "match-strategy", "drive-reflection", "helper", "custom"]) {
      expect(ftcDocToFormEntry("c", stored({ formType: type })).formType).toBe(type);
    }
  });

  it("only a positive team number counts; plain numbers for times work too", () => {
    expect(ftcDocToFormEntry("a", stored({ teamNumber: 0 })).teamNumber).toBeNull();
    expect(ftcDocToFormEntry("a", stored({ teamNumber: "42" })).teamNumber).toBeNull();
    expect(ftcDocToFormEntry("a", stored({ createdAt: 1234 })).createdAtMs).toBe(1234);
  });

  it("drops malformed flags and a bad alliance", () => {
    const entry = ftcDocToFormEntry("a", stored({ flags: [{ id: "x" }, null, { id: "y", reason: "Other" }], alliance: "purple", planDifferences: "1" }));
    expect(entry.flags).toEqual([{ id: "y", reason: "Other", addedAt: "" }]);
    expect(entry.alliance).toBeNull();
    expect(entry).not.toHaveProperty("planDifferences");
  });
});

describe("ftcDocsToFormEntries", () => {
  it("returns the entries newest first and skips bodies that are not maps", () => {
    const entries = ftcDocsToFormEntries([
      { id: "old", data: stored({ createdAt: 1000 }) },
      { id: "bad", data: "nope" },
      { id: "new", data: stored({ createdAt: 9000 }) },
      { id: "mid", data: stored({ createdAt: 5000 }) },
    ]);
    expect(entries.map((e) => e.id)).toEqual(["new", "mid", "old"]);
  });
});
