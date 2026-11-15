import { describe, expect, it } from "vitest";
import { FTC_BACKUP_LIBRARY_COLLECTIONS, FTC_BACKUP_TEAM_COLLECTIONS, FTC_BACKUP_TEMPLATE_COLLECTION, backupRow, countCollections, dedupeRows, memberForBackup, sanitizeForBackup } from "@/lib/ftc/backup";

describe("what the FTC backup file never contains", () => {
  it("drops credentials and private contact details at any depth, and keeps everything else untouched", () => {
    const doc = {
      name: "Alpha",
      joinCode: "ABCD2345",
      pendingTransfer: { to: "u2", token: "t" },
      nested: { apiKey: "k", keep: 1, list: [{ email: "a@b.c", ok: true }] },
      Email: "x@y.z",
      score: { total: 12 },
      values: { keyCount: 3 },
    };
    expect(sanitizeForBackup(doc)).toEqual({ name: "Alpha", nested: { keep: 1, list: [{ ok: true }] }, score: { total: 12 }, values: { keyCount: 3 } });
    expect(JSON.stringify(sanitizeForBackup(doc))).not.toMatch(/ABCD2345|a@b\.c|x@y\.z|"token"|apiKey/);
  });

  it("passes plain values through, and a field only named like a secret by accident is not mistaken for one", () => {
    expect(sanitizeForBackup(5)).toBe(5);
    expect(sanitizeForBackup(null)).toBeNull();
    expect(sanitizeForBackup([1, "a"])).toEqual([1, "a"]);
    expect(sanitizeForBackup({ tokens: 3, monkey: 1, secretary: "x" })).toEqual({ tokens: 3, monkey: 1, secretary: "x" });
  });

  it("a roster row holds roles and ids, never an email, avatar or legacy role", () => {
    const row = memberForBackup({ uid: "u1", name: "Sam", primaryRole: "pit-scout", secondaryRoles: ["drive-team"], isAdmin: true, isOwner: false, assignedTeamIds: ["a"], ...({ email: "sam@x.org", avatar: { type: "initials" }, legacyRole: "coach" } as object) });
    expect(row).toEqual({ id: "u1", name: "Sam", primaryRole: "pit-scout", secondaryRoles: ["drive-team"], isAdmin: true, isOwner: false, assignedTeamIds: ["a"] });
    expect(JSON.stringify(row)).not.toContain("sam@x.org");
  });

  it("a row is the doc id plus its clean fields", () => {
    expect(backupRow("T1", { name: "A", joinCode: "ZZZZ2222" })).toEqual({ id: "T1", name: "A" });
    expect(backupRow("x", null)).toEqual({ id: "x" });
  });
});

describe("the file's collections", () => {
  it("are team-scoped lists the FTC rules let an admin read with an equality query", () => {
    expect([...FTC_BACKUP_TEAM_COLLECTIONS]).toEqual(["scoutEntries", "formEntries", "practiceSessions", "assignments", "eventAttendance", "auditLog", "forms"]);
    expect(FTC_BACKUP_TEMPLATE_COLLECTION).toBe("formTemplates");
    expect([...FTC_BACKUP_LIBRARY_COLLECTIONS]).toEqual(["libraryEvents", "libraryMatches"]);
  });

  it("a library doc matched by both library queries is listed once, and the counts match the rows", () => {
    const rows = dedupeRows([{ id: "a" }, { id: "b" }, { id: "a" }]);
    expect(rows).toEqual([{ id: "a" }, { id: "b" }]);
    expect(countCollections({ forms: rows, members: [] })).toEqual([{ collection: "forms", count: 2 }, { collection: "members", count: 0 }]);
  });
});
