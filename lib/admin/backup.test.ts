import { beforeEach, describe, expect, it, vi } from "vitest";

// Admin Panel > Backups, the export: the default program reads CS's root collections exactly as before (and its file has no `program` marker); a program with its
// own port reads only through it, names itself in the file and in the audit entry, and touches no root collection. Firestore, the download and the audit log are mocked.
const h = vi.hoisted(() => ({ reads: [] as string[], downloads: [] as { name: string; text: string }[], audits: [] as unknown[][], port: null as null | { read: (teamId: string) => Promise<Record<string, Record<string, unknown>[]>> } }));

vi.mock("@/lib/firebase/client", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, name: string) => ({ name }),
  where: () => ({}),
  query: (ref: { name: string }) => ref,
  doc: (_db: unknown, name: string) => ({ name }),
  getDocs: async (ref: { name: string }) => {
    h.reads.push(ref.name);
    return { docs: [{ id: `${ref.name}-1`, data: () => ({ teamId: "T1", eventCode: "EV1" }) }] };
  },
  getDoc: async (ref: { name: string }) => {
    h.reads.push(ref.name);
    return { exists: () => true, id: "T1", data: () => ({ name: "Alpha" }) };
  },
}));
vi.mock("@/lib/download", () => ({ downloadTextFile: (name: string, text: string) => h.downloads.push({ name, text }) }));
vi.mock("@/lib/audit-log", () => ({ logAuditEvent: async (...args: unknown[]) => void h.audits.push(args) }));
vi.mock("@/lib/program/data", () => ({ programData: (program: string) => (program === "frc" ? null : h.port ? { backup: h.port } : null) }));

import { exportAllDataJson } from "@/lib/admin/backup";

beforeEach(() => {
  h.reads.length = 0;
  h.downloads.length = 0;
  h.audits.length = 0;
  h.port = null;
});

describe("exportAllDataJson", () => {
  it("default program: the same root collections and the same file shape as before", async () => {
    const summary = await exportAllDataJson("T1", "u1", "Admin");
    expect(h.reads).toEqual(["users", "scouting", "practiceSessions", "matchAssignments", "pitAssignments", "teamAssignments", "practiceAssignments", "auditLog", "libraryMatches", "libraryEvents", "teams"]);
    expect(summary.map((s) => s.collection)).toEqual(h.reads);
    const file = JSON.parse(h.downloads[0].text);
    expect(Object.keys(file)).toEqual(["exportedAt", "teamId", "eventNames", "collections"]);
    expect(h.audits[0][7]).toBe("frc");
  });

  it("another program: reads through its port only, marks the file with the program, shows the counts, and audits under that program", async () => {
    h.port = { read: async (teamId) => ({ scoutEntries: [{ id: "a", teamId, eventCode: "EV1" }, { id: "b", teamId }], members: [{ id: "u1", name: "Sam" }], teams: [{ id: teamId, name: "Alpha" }] }) };
    const summary = await exportAllDataJson("T1", "u1", "Admin", "ftc");
    expect(h.reads).toEqual([]); // no root collection was touched
    expect(summary).toEqual([{ collection: "scoutEntries", count: 2 }, { collection: "members", count: 1 }, { collection: "teams", count: 1 }]);
    const file = JSON.parse(h.downloads[0].text);
    expect(file).toMatchObject({ program: "ftc", teamId: "T1" });
    expect(Object.keys(file.collections)).toEqual(["scoutEntries", "members", "teams"]);
    expect(h.audits[0][7]).toBe("ftc");
  });

  it("a port that fails stops the export: no file is written and no audit entry is made", async () => {
    h.port = { read: async () => { throw new Error("Couldn't read scoutEntries: not allowed"); } };
    await expect(exportAllDataJson("T1", "u1", "Admin", "ftc")).rejects.toThrow("Couldn't read scoutEntries");
    expect(h.downloads).toEqual([]);
    expect(h.audits).toEqual([]);
  });
});
