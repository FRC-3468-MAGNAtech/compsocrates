import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore } from "@/lib/server/test-support/fake-firestore";
import { assertCanFileRequest, cancelMyJoinRequest, listMyJoinRequests, recordJoinRequest } from "@/lib/server/join-pointers";
import { myJoinRequests } from "@/lib/server/join-request-flows";
import { requestToJoinFtcTeam } from "@/lib/ftc/server-join-requests";
import { requestToJoinTeam } from "@/lib/server/join-requests";

vi.mock("@/lib/server/rate-limit", () => ({ consumeRateLimit: async () => ({ allowed: true, count: 1 }) }));

const NOW = 1_700_000_000_000;
let fake: FakeFirestore;
const db = () => fake.asFirestore();
const actor = (uid: string) => ({ uid, name: uid, email: `${uid}@x.org`, isPlatformOwner: false });

beforeEach(() => {
  fake = new FakeFirestore();
  fake.seed("teams/FRCAAA", { teamName: "Alpha", teamNumber: "11" });
  fake.seed("teams/FRCBBB", { teamName: "Beta", teamNumber: "22" });
  fake.seed("programs/ftc/teams/FTCAAAA2", { number: 33, name: "Gamma" });
  fake.seed("programs/ftc/teams/FTCBBBB3", { number: 44, name: "Delta" });
});

describe("my join requests, one shape for both programs", () => {
  it("FRC (requests in one collection): lists the pending ones with a label, a role and a time; an approved one is not listed", async () => {
    await requestToJoinTeam(db(), { uid: "u1", email: "u1@x.org", name: "U" }, { teamCode: "FRCAAA", name: "U" }, NOW);
    await requestToJoinTeam(db(), { uid: "u1", email: "u1@x.org", name: "U" }, { teamCode: "FRCBBB", name: "U" }, NOW + 1);
    const res = await myJoinRequests(db(), actor("u1"), { program: "frc" }, NOW);
    expect(res.status).toBe(200);
    const rows = res.body.requests as { teamId: string; status: string; teamLabel: string }[];
    expect(rows.map((r) => r.teamId).sort()).toEqual(["FRCAAA", "FRCBBB"]);
    expect(rows.every((r) => r.status === "pending")).toBe(true);
    expect(rows.find((r) => r.teamId === "FRCAAA")?.teamLabel).toBeTruthy();
    const id = fake.ids("teamJoinRequests")[0];
    await fake.doc(`teamJoinRequests/${id}`).update({ status: "approved" });
    expect(((await myJoinRequests(db(), actor("u1"), { program: "frc" }, NOW)).body.requests as unknown[]).length).toBe(1);
  });

  it("FTC (requests under each team): the server-written pointer finds them after a reload, and holds ONLY team id, request id and status", async () => {
    await requestToJoinFtcTeam(db(), { uid: "u2", email: null, name: "U2" }, { joinCode: "FTCAAAA2", name: "Una" });
    const pointer = fake.read("programs/ftc/joinRequestPointers/u2");
    expect(pointer?.entries).toEqual([{ teamId: "FTCAAAA2", requestId: "u2", status: "pending" }]);
    expect(JSON.stringify(pointer)).not.toMatch(/Una|@x\.org|FTCAAAA2.*code/);
    const rows = (await myJoinRequests(db(), actor("u2"), { program: "ftc" }, NOW)).body.requests as { teamId: string; status: string; teamLabel: string }[];
    expect(rows).toMatchObject([{ teamId: "FTCAAAA2", status: "pending" }]);
    expect(rows[0].teamLabel).toContain("33");
  });

  it("FTC: a decision made by the older client batches is noticed (the request document is the truth) and the pointer is cleaned", async () => {
    await requestToJoinFtcTeam(db(), { uid: "u3", email: null, name: "U3" }, { joinCode: "FTCAAAA2", name: "Uma" });
    await fake.doc("programs/ftc/teams/FTCAAAA2/joinRequests/u3").update({ status: "approved" });
    expect(await listMyJoinRequests(db(), "ftc", "u3")).toEqual([]);
    expect(fake.read("programs/ftc/joinRequestPointers/u3")).toBeUndefined();
    await requestToJoinFtcTeam(db(), { uid: "u3", email: null, name: "U3" }, { joinCode: "FTCBBBB3", name: "Uma" });
    await fake.doc("programs/ftc/teams/FTCBBBB3/joinRequests/u3").update({ status: "denied" });
    const rows = await listMyJoinRequests(db(), "ftc", "u3");
    expect(rows).toMatchObject([{ teamId: "FTCBBBB3", status: "denied" }]);
  });

  it("a missing or unknown program is a 400 with no read", async () => {
    expect((await myJoinRequests(db(), actor("u1"), {}, NOW)).status).toBe(400);
    expect((await myJoinRequests(db(), actor("u1"), { program: "nope" }, NOW)).status).toBe(400);
  });
});

describe("several pending requests, one per team, at most five", () => {
  it("a second request to the same team is a 409 and a sixth request is a 409, in both programs", async () => {
    for (const program of ["frc", "ftc"] as const) {
      const uid = `cap-${program}`;
      const teams = Array.from({ length: 6 }, (_, i) => (program === "frc" ? `FRC${i}AA` : `FTC${i}AAAA`));
      teams.forEach((t, i) => fake.seed(program === "frc" ? `teams/${t}` : `programs/ftc/teams/${t}`, program === "frc" ? { teamName: `T${i}`, teamNumber: String(i + 1) } : { number: i + 1, name: `T${i}` }));
      for (let i = 0; i < 5; i++) {
        if (program === "frc") await requestToJoinTeam(db(), { uid, email: null, name: uid }, { teamCode: teams[i] }, NOW + i);
        else await requestToJoinFtcTeam(db(), { uid, email: null, name: uid }, { joinCode: teams[i], name: "X" });
      }
      await expect(assertCanFileRequest(db(), program, uid, teams[0])).rejects.toMatchObject({ status: 409, code: "already_pending" });
      await expect(assertCanFileRequest(db(), program, uid, teams[5])).rejects.toMatchObject({ status: 409, code: "too_many_pending" });
      await expect(assertCanFileRequest(db(), program, "someone-else", teams[0])).resolves.toBeUndefined();
    }
  });
});

describe("cancel", () => {
  it("FRC: the person cancels their own pending request; the notice is the last closed one", async () => {
    await requestToJoinTeam(db(), { uid: "c1", email: null, name: "C" }, { teamCode: "FRCAAA" }, NOW);
    const res = await cancelMyJoinRequest(db(), { uid: "c1" }, "frc", "FRCAAA");
    expect(res.status).toBe(200);
    expect(await listMyJoinRequests(db(), "frc", "c1")).toMatchObject([{ teamId: "FRCAAA", status: "canceled" }]);
    expect((await cancelMyJoinRequest(db(), { uid: "c1" }, "frc", "FRCAAA")).status).toBe(404);
    expect((await cancelMyJoinRequest(db(), { uid: "other" }, "frc", "FRCAAA")).status).toBe(404);
  });

  it("FTC: the same, the request document goes and the pointer remembers 'canceled'; nobody can cancel someone else's", async () => {
    await requestToJoinFtcTeam(db(), { uid: "c2", email: null, name: "C2" }, { joinCode: "FTCAAAA2", name: "Cy" });
    expect((await cancelMyJoinRequest(db(), { uid: "mallory" }, "ftc", "FTCAAAA2")).status).toBe(404);
    expect(fake.read("programs/ftc/teams/FTCAAAA2/joinRequests/c2")).toBeDefined();
    expect((await cancelMyJoinRequest(db(), { uid: "c2" }, "ftc", "FTCAAAA2")).status).toBe(200);
    expect(fake.read("programs/ftc/teams/FTCAAAA2/joinRequests/c2")).toBeUndefined();
    expect(await listMyJoinRequests(db(), "ftc", "c2")).toMatchObject([{ teamId: "FTCAAAA2", status: "canceled" }]);
  });

  it("a bad team id is a 400 and a flat program writes no pointer", async () => {
    expect((await cancelMyJoinRequest(db(), { uid: "c3" }, "ftc", "a/b")).status).toBe(400);
    await recordJoinRequest(db(), "frc", "c3", "FRCAAA", "r1");
    expect(fake.read("joinRequestPointers/c3")).toBeUndefined();
  });
});
