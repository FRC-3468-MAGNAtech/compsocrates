import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { programPath } from "@/lib/firebase/paths";
import { normalizeFtcJoinCode, requestToJoinFtcTeam } from "@/lib/ftc/server-join-requests";

// The server side of "ask to join an FTC team" against the Firestore emulator (Admin SDK, so the rules are not involved: they are covered in
// rules.emulator.test.ts). Needs the emulator: `npm run test:rules`.

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
const PROJECT_ID = process.env.GCLOUD_PROJECT || "demo-compsocrates-rebuild";

let app: App;
let db: Firestore;
const P = (name: string) => programPath("ftc", name);
const caller = (uid: string) => ({ uid, email: `${uid}@example.org`, name: null });
const requestDoc = async (teamId: string, uid: string) => (await db.collection(P("teams")).doc(teamId).collection("joinRequests").doc(uid).get()).data();

beforeAll(async () => {
  app = initializeApp({ projectId: PROJECT_ID }, "ftc-server-join-test");
  db = getFirestore(app);
  await db.collection(P("teams")).doc("ABCD2345").set({ joinCode: "ABCD2345", name: "Created here" });
  // a team brought over from the old site: its document id is not its join code
  await db.collection(P("teams")).doc("legacyDocId").set({ joinCode: "KEEP42", name: "Brought over" });
  await db.collection(P("users")).doc("already-member").set({ name: "Mem", teamId: "ABCD2345" });
});

afterAll(async () => {
  await deleteApp(app);
});

describe("normalizeFtcJoinCode", () => {
  it("trims and uppercases, and refuses anything that cannot be a code", () => {
    expect(normalizeFtcJoinCode("  abcd2345 ")).toBe("ABCD2345");
    for (const bad of ["", "ab", "has space", "a/b", "x".repeat(25), 42, null]) expect(normalizeFtcJoinCode(bad)).toBeNull();
  });
});

describe("requestToJoinFtcTeam", () => {
  it("files a pending request for a team whose id is the code", async () => {
    const res = await requestToJoinFtcTeam(db, caller("j-id"), { joinCode: "abcd2345", name: " Joe " });
    expect(res).toEqual({ status: 200, body: { ok: true, alreadyPending: false, teamId: "ABCD2345" } });
    expect(await requestDoc("ABCD2345", "j-id")).toMatchObject({ uid: "j-id", name: "Joe", status: "pending" });
  });

  it("finds a team by its joinCode field when the code is not the document id, and files the request under the document id", async () => {
    const res = await requestToJoinFtcTeam(db, caller("j-legacy"), { joinCode: "keep42", name: "Kim" });
    expect(res.body).toMatchObject({ ok: true, teamId: "legacyDocId" });
    expect(await requestDoc("legacyDocId", "j-legacy")).toMatchObject({ uid: "j-legacy", status: "pending" });
  });

  it("answers 404 for a code that matches no team, and files nothing", async () => {
    const res = await requestToJoinFtcTeam(db, caller("j-none"), { joinCode: "NOSUCH99", name: "Nia" });
    expect(res).toMatchObject({ status: 404, body: { ok: false, code: "team-not-found" } });
  });

  it("answers 400 for a bad code or name, and 409 for an account that already has a team here", async () => {
    expect(await requestToJoinFtcTeam(db, caller("j-bad"), { joinCode: "a/b", name: "X" })).toMatchObject({ status: 400, body: { code: "bad-code" } });
    expect(await requestToJoinFtcTeam(db, { uid: "j-noname", email: null, name: null }, { joinCode: "ABCD2345", name: "" })).toMatchObject({ status: 400, body: { code: "bad-name" } });
    expect(await requestToJoinFtcTeam(db, caller("already-member"), { joinCode: "ABCD2345", name: "Mem" })).toMatchObject({ status: 409, body: { code: "already-member" } });
    expect(await requestDoc("ABCD2345", "already-member")).toBeUndefined();
  });

  it("a repeat while pending changes nothing, and a new request replaces a denied one", async () => {
    await requestToJoinFtcTeam(db, caller("j-again"), { joinCode: "ABCD2345", name: "Al" });
    const repeat = await requestToJoinFtcTeam(db, caller("j-again"), { joinCode: "ABCD2345", name: "Al" });
    expect(repeat.body).toMatchObject({ ok: true, alreadyPending: true });
    await db.collection(P("teams")).doc("ABCD2345").collection("joinRequests").doc("j-again").update({ status: "denied", decidedBy: "admin" });
    const again = await requestToJoinFtcTeam(db, caller("j-again"), { joinCode: "ABCD2345", name: "Al" });
    expect(again.body).toMatchObject({ ok: true, alreadyPending: false });
    const stored = await requestDoc("ABCD2345", "j-again");
    expect(stored).toMatchObject({ status: "pending" });
    expect(stored).not.toHaveProperty("decidedBy");
  });
});
