import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { auditEventAttendance, formatAuditReport, type AuditInput } from "./attendance-audit";
import { assertReadOnlyStore, loadAuditInput, type ReadOnlyStore } from "./attendance-audit-reader";

const members = [
  { uid: "me", name: "Alex Doe" },
  { uid: "p1", name: "Sam Roe" },
  { uid: "p2", name: "Alex Doe" }, // same display name as "me"
  { uid: "p3", name: "Kim Poe" },
  { uid: "p4", name: "Lee Moe" },
];

const base: AuditInput = { uid: "me", personName: "Alex Doe", teamId: "t1", shape: "tba", season: 2026, attendance: [], members, entries: [] };
const entry = (id: string, rawEventKey: string, over: Partial<AuditInput["entries"][number]> = {}) => ({ id, rawEventKey, source: "event" as const, excluded: false, teamId: "t1", ...over });

describe("auditEventAttendance", () => {
  it("reports listed events, outside-season ones, and listed-without-entries (the owner's report)", () => {
    const r = auditEventAttendance({
      ...base,
      attendance: [
        { rawKey: "2026lake", listed: ["me", "p1"] },
        { rawKey: "2026labr", listed: ["me"] }, // alias spelling of the same event
        { rawKey: "2025lake", listed: ["me"] },
        { rawKey: "2026arli", listed: ["p1"] }, // not listed: left out
      ],
      entries: [entry("a", "2026LABR"), entry("b", "2026lake", { source: "practice" }), entry("c", "2026zzzz")],
    });
    expect(r.events.map((e) => e.key)).toEqual(["2025lake", "2026lake"]);
    const bayou = r.events.find((e) => e.key === "2026lake")!;
    expect(bayou.rawKeys.sort()).toEqual(["2026labr", "2026lake"]);
    expect(bayou.entries).toMatchObject({ event: 1, practice: 1 });
    expect(bayou.counted).toBe(1);
    expect(r.outsideSeason).toEqual(["2025lake"]);
    expect(r.listedWithoutEntries).toEqual(["2025lake"]);
    expect(r.entriesWithoutAttendance.map((x) => x.key)).toEqual(["2026zzzz"]);
  });

  it("flags a list by display name when another member shares the name, and a bulk-selected list", () => {
    const r = auditEventAttendance({ ...base, attendance: [{ rawKey: "2026lake", listed: ["Alex Doe", "p1", "p3", "p4"] }] });
    const e = r.events[0];
    expect(e.matchedBy).toEqual(["name"]);
    expect(e.sameNameMembers).toEqual(["p2"]);
    expect(r.hints.join("\n")).toMatch(/display name only/);
    expect(r.hints.join("\n")).toMatch(/bulk selection/);
  });

  it("a person on no list has no events, and says nothing unusual", () => {
    const r = auditEventAttendance({ ...base, attendance: [{ rawKey: "2026lake", listed: ["p1"] }] });
    expect(r.events).toEqual([]);
    expect(formatAuditReport(r)).toContain("Events whose list contains this person: 0");
  });

  it("prints the evidence lines", () => {
    const text = formatAuditReport(auditEventAttendance({ ...base, attendance: [{ rawKey: "2025lake", listed: ["me"] }] }));
    expect(text).toContain("OUTSIDE 2026");
    expect(text).toContain("Listed outside season 2026: 2025lake");
  });
});

describe("loadAuditInput reads only", () => {
  const calls: string[] = [];
  const docs: Record<string, Record<string, unknown>> = {
    "users/me": { displayName: "Alex Doe" },
    "teams/t1": { eventAttendees: { "2026lake": ["me", "p1"], "2025lake": ["Alex Doe"] } },
    "ns/users/me": { name: "Alex Doe" },
  };
  const store: ReadOnlyStore = {
    async getDoc(path) {
      calls.push(`getDoc ${path}`);
      return docs[path] ?? null;
    },
    async getDocs(path, where) {
      calls.push(`getDocs ${path} ${where.map(([f, v]) => `${f}==${v}`).join(",")}`);
      if (path === "users") return [{ id: "me", data: { displayName: "Alex Doe" } }, { id: "p1", data: { displayName: "Sam Roe" } }];
      if (path === "scouting") return [{ id: "e1", data: { eventKey: "2026lake", teamId: "t1" } }, { id: "e2", data: { eventKey: "2026lake", isPracticeScouting: true } }, { id: "e3", data: { eventKey: "2026lake", excludeFromStats: true } }];
      if (path === "ns/users") return [{ id: "me", data: { name: "Alex Doe" } }];
      if (path === "ns/eventAttendance") return [{ id: "t1_2026-ABC", data: { eventCode: "2026-ABC", uids: ["me"] } }];
      if (path === "ns/scoutEntries") return [{ id: "s1", data: { eventCode: "2026-abc", source: "live", teamId: "t1" } }];
      return [];
    },
  };

  it("root layout: the team document's map and the scouting rows, through get calls only", async () => {
    calls.length = 0;
    const input = await loadAuditInput(store, { prefix: "", uid: "me", teamId: "t1", shape: "tba", season: 2026 });
    expect(input.attendance.map((a) => a.rawKey).sort()).toEqual(["2025lake", "2026lake"]);
    expect(input.entries.map((e) => [e.source, e.excluded])).toEqual([["event", false], ["practice", false], ["event", true]]);
    expect(input.personName).toBe("Alex Doe");
    expect(calls.every((c) => c.startsWith("getDoc ") || c.startsWith("getDocs "))).toBe(true);
    const report = auditEventAttendance(input);
    expect(report.events.map((e) => e.key)).toEqual(["2025lake", "2026lake"]);
    expect(report.events.find((e) => e.key === "2025lake")?.matchedBy).toEqual(["name"]);
  });

  it("namespaced layout: attendance documents and the person's entries", async () => {
    const input = await loadAuditInput(store, { prefix: "ns/", uid: "me", teamId: "t1", shape: "season-code", season: 2026 });
    const report = auditEventAttendance(input);
    expect(report.events).toHaveLength(1);
    expect(report.events[0]).toMatchObject({ key: "2026-ABC", counted: 1 });
  });

  it("refuses a store that has any method besides the two reads", () => {
    expect(() => assertReadOnlyStore(store)).not.toThrow();
    expect(() => assertReadOnlyStore({ ...store, set: () => undefined })).toThrow(/only getDoc and getDocs/);
  });

  it("the script takes only AUDIT_ADMIN_* credentials and needs the project named (vite-node loads the repo's env files, so no fallback)", () => {
    const src = readFileSync(join(process.cwd(), "scripts", "audit-event-attendance.ts"), "utf8");
    expect(src).toContain('need("AUDIT_ADMIN_PROJECT_ID")');
    expect(src).toContain("--confirm-project must equal AUDIT_ADMIN_PROJECT_ID");
    expect(src).not.toMatch(/need\("(CS|FIREBASE)_/);
    expect(src).not.toMatch(/process\.env[.[]\s*["']?(CS|FIREBASE)_/);
  });

  it("the script source contains no write call", () => {
    const src = readFileSync(join(process.cwd(), "scripts", "audit-event-attendance.ts"), "utf8");
    const reader = readFileSync(join(process.cwd(), "lib", "events", "attendance-audit-reader.ts"), "utf8");
    for (const text of [src, reader]) expect(text).not.toMatch(/\.(set|update|delete|add|create|commit)\s*\(|\bbatch\s*\(|runTransaction|bulkWriter|writeBatch|setDoc|updateDoc|deleteDoc|addDoc/);
  });
});
