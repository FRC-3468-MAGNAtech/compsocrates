import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore } from "@/lib/server/test-support/fake-firestore";
import { resetMembershipsEnabledCache } from "@/lib/server/team-settings";
import { BUILTIN_FORMS } from "@/lib/forms/builtin";
import { calculateScore } from "@/lib/forms/scoring";
import { defaultValues } from "@/lib/forms/values";
import { GAME_DEFINITIONS, GAME_ID_LIST } from "@/config/games";
import { FTC_BUILTIN_FORMS } from "@/lib/ftc/games";
import { entryPayloadFor } from "@/lib/scout-entries";
import { copiedId, sharePractice } from "@/lib/server/practice-sharing";

vi.mock("@/lib/server/rate-limit", () => ({ consumeRateLimit: async () => ({ allowed: true, count: 1 }) }));

const NOW = 1_700_000_000_000;
let fake: FakeFirestore;
const db = () => fake.asFirestore();
const actor = { uid: "u1", name: "Ada", email: "a@x.org", isPlatformOwner: false };

const PROGRAMS = {
  frc: { users: "users", personal: "personalPractice/u1", teamSessions: "practiceSessions", teamEntries: "scouting", form: BUILTIN_FORMS[GAME_DEFINITIONS[GAME_ID_LIST[0]].formId] },
  ftc: { users: "programs/ftc/users", personal: "programs/ftc/personalPractice/u1", teamSessions: "programs/ftc/practiceSessions", teamEntries: "programs/ftc/scoutEntries", form: FTC_BUILTIN_FORMS.biobuzz },
} as const;

function payload(program: "frc" | "ftc") {
  const form = PROGRAMS[program].form;
  const values = defaultValues(form);
  return entryPayloadFor(form, values, calculateScore(form, values));
}

function seedPractice(program: "frc" | "ftc", sessions = 2) {
  const c = PROGRAMS[program];
  for (let i = 0; i < sessions; i++) {
    const sid = `PS-AAAA${i}${i}`;
    fake.seed(`${c.personal}/sessions/${sid}`, { uid: "u1", kind: "solo", status: "completed", scoutName: "Ada", seasonId: "s", mode: "trial", difficulty: null, libraryMatchId: `M${i}`, eventCode: "2026x", alliance: "red", robots: [1, 2], completedRobots: [1, 2], accuracy: 0.9, scoutedTotal: 10, penaltyPoints: 0, officialScore: 11, platform: "pc", flags: [], excluded: false, startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:10:00.000Z", entryIds: [] });
    for (const robot of [1, 2]) fake.seed(`${c.personal}/entries/E-${i}-${robot}`, { uid: "u1", scoutName: "Ada", eventCode: "2026x", matchType: "Qualification", matchNumber: i + 1, teamNumber: robot, ...payload(program), source: "practice", mode: "trial", sessionId: sid, libraryMatchId: `M${i}`, submittedAt: "2026-01-01T00:05:00.000Z" });
  }
  fake.seed(`${c.personal}/sessions/PS-PAUSED`, { uid: "u1", kind: "solo", status: "paused", scoutName: "Ada" });
}

beforeEach(() => {
  fake = new FakeFirestore();
  fake.seed("appSettings/global", { membershipsEnabled: true });
  resetMembershipsEnabledCache();
});

describe.each(["frc", "ftc"] as const)("share on join (%s)", (program) => {
  const c = PROGRAMS[program];

  it("copies completed sessions and their entries as TEAM documents with the team id, the person's uid and scout name, and leaves the private copy", async () => {
    fake.seed(`${c.users}/u1`, { teamId: "TEAM01", name: "Ada" });
    seedPractice(program);
    const res = await sharePractice(db(), actor, { program }, NOW);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, done: true, copiedSessions: 2, copiedEntries: 4, remaining: 0 });
    const sessions = fake.ids(c.teamSessions);
    const entries = fake.ids(c.teamEntries);
    expect(sessions).toHaveLength(2);
    expect(entries).toHaveLength(4);
    for (const id of sessions) expect(fake.read(`${c.teamSessions}/${id}`)).toMatchObject({ teamId: "TEAM01", uid: "u1", scoutName: "Ada", kind: "solo", status: "completed", accuracy: 0.9 });
    for (const id of entries) expect(fake.read(`${c.teamEntries}/${id}`)).toMatchObject({ teamId: "TEAM01" });
    // The session points at its copied entries, and the unfinished session was not copied.
    const first = fake.read(`${c.teamSessions}/${copiedId("PS-AAAA00", "u1")}`);
    expect(first?.entryIds).toEqual([copiedId("E-0-1", "u1"), copiedId("E-0-2", "u1")]);
    expect(fake.read(`${c.teamSessions}/${copiedId("PS-PAUSED", "u1")}`)).toBeUndefined();
    // Private data untouched; marker says shared.
    expect(fake.ids(`${c.personal}/sessions`)).toHaveLength(3);
    expect(fake.read(`${c.personal}/state/share`)).toMatchObject({ sharedTo: "TEAM01", sharedSessions: 2, sharedEntries: 4 });
  });

  it("is idempotent: a second run writes the same documents again, never a second set", async () => {
    fake.seed(`${c.users}/u1`, { teamId: "TEAM01" });
    seedPractice(program);
    await sharePractice(db(), actor, { program }, NOW);
    const again = await sharePractice(db(), actor, { program }, NOW + 1);
    expect(again.body).toMatchObject({ done: true, writes: 0 });
    expect(fake.ids(c.teamSessions)).toHaveLength(2);
    expect(fake.ids(c.teamEntries)).toHaveLength(4);
  });

  it("has a write budget per run and resumes: the next call continues from where the marker says", async () => {
    fake.seed(`${c.users}/u1`, { teamId: "TEAM01" });
    seedPractice(program, 3); // 3 sessions + 6 entries = 9 writes
    const first = await sharePractice(db(), actor, { program }, NOW, { budget: 4, batch: 2 });
    expect(first.body).toMatchObject({ done: false, writes: 4 });
    expect(fake.ids(c.teamEntries)).toHaveLength(4);
    expect(fake.ids(c.teamSessions)).toHaveLength(0); // entries go first, so a session never exists before its entries
    const second = await sharePractice(db(), actor, { program }, NOW, { budget: 4, batch: 2 });
    expect(second.body).toMatchObject({ done: false, writes: 4 });
    const third = await sharePractice(db(), actor, { program }, NOW, { budget: 4, batch: 2 });
    expect(third.body).toMatchObject({ done: true, writes: 1, remaining: 0 });
    expect(fake.ids(c.teamSessions)).toHaveLength(3);
    expect(fake.ids(c.teamEntries)).toHaveLength(6);
  });

  it("the team is the one on the person's OWN user document: no team is a 409, and the body cannot name another", async () => {
    seedPractice(program);
    expect((await sharePractice(db(), actor, { program }, NOW)).body).toMatchObject({ code: "no_team" });
    fake.seed(`${c.users}/u1`, { teamId: "" });
    expect((await sharePractice(db(), actor, { program }, NOW)).status).toBe(409);
    expect(fake.ids(c.teamSessions)).toEqual([]);
  });

  it("a person who shared with one team cannot copy again into another", async () => {
    fake.seed(`${c.users}/u1`, { teamId: "TEAM01" });
    seedPractice(program);
    await sharePractice(db(), actor, { program }, NOW);
    fake.seed(`${c.users}/u1`, { teamId: "TEAM02" });
    expect((await sharePractice(db(), actor, { program }, NOW)).body).toMatchObject({ code: "already_shared" });
  });
});

describe("share on join: gating", () => {
  it("is a 404 while the memberships switch is OFF, and a missing program is a 400; nothing is read or written", async () => {
    fake.seed("appSettings/global", { membershipsEnabled: false });
    resetMembershipsEnabledCache();
    expect((await sharePractice(db(), actor, { program: "frc" }, NOW)).status).toBe(404);
    fake.seed("appSettings/global", { membershipsEnabled: true });
    resetMembershipsEnabledCache();
    expect((await sharePractice(db(), actor, {}, NOW)).status).toBe(400);
  });

  it("another person's private practice is never touched: only the caller's own path is read", async () => {
    fake.seed("users/u1", { teamId: "TEAM01" });
    fake.seed("personalPractice/u2/sessions/PS-OTHER", { uid: "u2", status: "completed", scoutName: "Bo" });
    const res = await sharePractice(db(), actor, { program: "frc" }, NOW);
    expect(res.body).toMatchObject({ done: true, copiedSessions: 0 });
    expect(fake.ids("practiceSessions")).toEqual([]);
  });
});
