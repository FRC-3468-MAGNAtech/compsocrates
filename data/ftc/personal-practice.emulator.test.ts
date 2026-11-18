import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";
import { programPath } from "@/lib/firebase/paths";

// Membership build 3, decision 9: the PROOF that a no-team account (no FTC profile document at all) can read the shared official library in the
// exact rule forms, before personal practice is built on it. The FTC library read is
//   `resource.data.origin == 'api' && (resource.data.published == true || ftc_isAdmin())`
// and `ftc_isAdmin()` does a get() on a profile this account does not have: the question is whether that error is swallowed by the `||` when the
// left side is true. Needs the emulator (`npm run test:rules`).

let testEnv: RulesTestEnvironment;
const NOTEAM = "personal-noteam-1";
const L = (name: string) => programPath("ftc", name);

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: process.env.GCLOUD_PROJECT || "demo-compsocrates-rebuild",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
  });
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const base = { eventCode: "EVX", seasonId: "s1", matchType: "Qualification", matchNumber: 1 };
    await setDoc(doc(db, L("libraryMatches"), "EVX_Q1"), { ...base, origin: "api", published: true });
    await setDoc(doc(db, L("libraryMatches"), "EVX_Q2"), { ...base, matchNumber: 2, origin: "api", published: false });
    await setDoc(doc(db, L("libraryMatches"), "MAN_Q1"), { ...base, eventCode: "MAN-X", origin: "manual", published: true, teamId: "someteam" });
    await setDoc(doc(db, L("libraryEvents"), "EVX"), { origin: "api", eventCode: "EVX", eventName: "Event X", seasonId: "s1" });
    await setDoc(doc(db, "practiceMatches", "pm1"), { eventCode: "2026x", matchNumber: 1 });
    await setDoc(doc(db, "libraryMatches", "RM1"), { ...base, published: true });
    await setDoc(doc(db, "libraryMatches", "RM2"), { ...base, matchNumber: 2, published: false });
    // A root account with no team: the user doc exists (sign-up) with teamId "".
    await setDoc(doc(db, "users", NOTEAM), { uid: NOTEAM, email: "x@example.org", teamId: "", role: "match-scout" });
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

const as = (uid: string) => testEnv.authenticatedContext(uid).firestore();

describe("a no-team account reading the shared official library (no FTC profile document exists)", () => {
  it("has no FTC profile (the precondition of the proof)", async () => {
    const { getDoc } = await import("firebase/firestore");
    const snap = await assertSucceeds(getDoc(doc(as(NOTEAM), L("users"), NOTEAM)));
    if (snap.exists()) throw new Error("the test account must have no FTC profile");
  });

  it("FTC: published origin == api matches by season are readable through the OR short-circuit", async () => {
    await assertSucceeds(getDocs(query(collection(as(NOTEAM), L("libraryMatches")), where("seasonId", "==", "s1"), where("published", "==", true), where("origin", "==", "api"))));
  });

  it("FTC: published origin == api matches by event are readable", async () => {
    await assertSucceeds(getDocs(query(collection(as(NOTEAM), L("libraryMatches")), where("eventCode", "==", "EVX"), where("published", "==", true), where("origin", "==", "api"))));
  });

  it("FTC: a single published api match is readable by get, an unpublished one is not", async () => {
    const { getDoc } = await import("firebase/firestore");
    await assertSucceeds(getDoc(doc(as(NOTEAM), L("libraryMatches"), "EVX_Q1")));
    await assertFails(getDoc(doc(as(NOTEAM), L("libraryMatches"), "EVX_Q2")));
  });

  it("FTC: the unpublished matches and a team's hand-made matches stay closed (no loosening)", async () => {
    await assertFails(getDocs(query(collection(as(NOTEAM), L("libraryMatches")), where("origin", "==", "api"))));
    await assertFails(getDocs(query(collection(as(NOTEAM), L("libraryMatches")), where("teamId", "==", "someteam"))));
  });

  it("FTC: the api library events are readable", async () => {
    await assertSucceeds(getDocs(query(collection(as(NOTEAM), L("libraryEvents")), where("origin", "==", "api"))));
  });

  it("FRC (root): practiceMatches and published libraryMatches are readable with teamId empty, unpublished are not", async () => {
    await assertSucceeds(getDocs(collection(as(NOTEAM), "practiceMatches")));
    await assertSucceeds(getDocs(query(collection(as(NOTEAM), "libraryMatches"), where("seasonId", "==", "s1"), where("published", "==", true))));
    await assertFails(getDocs(collection(as(NOTEAM), "libraryMatches")));
  });
});

// --- the private practice paths (additive rules) -----------------------------------------------------------------------------------------------------

const MATE = "personal-mate-1";
const ADMIN = "personal-admin-1";
const SESSION = { uid: NOTEAM, kind: "solo", status: "in-progress", scoutName: "Ada", startedAt: "2026-01-01T00:00:00.000Z" };
const ENTRY = { uid: NOTEAM, scoutName: "Ada", teamNumber: 254, sessionId: "PS-1", source: "practice" };

async function seedTeamMembers() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    await setDoc(doc(d, L("users"), MATE), { name: "Mate", teamId: "T1", primaryRole: "match-scout", secondaryRoles: [], isAdmin: false, isOwner: false });
    await setDoc(doc(d, L("users"), ADMIN), { name: "Admin", teamId: "T1", primaryRole: "team-coach", secondaryRoles: [], isAdmin: true, isOwner: true });
    await setDoc(doc(d, "users", MATE), { uid: MATE, teamId: "ROOT1", role: "match-scout" });
    await setDoc(doc(d, "users", ADMIN), { uid: ADMIN, teamId: "ROOT1", role: "coach", isTeamAdmin: true });
  });
}

describe.each([
  ["root (FRC)", (u: string) => `personalPractice/${u}`],
  ["FTC", (u: string) => `programs/ftc/personalPractice/${u}`],
] as const)("private practice, %s", (_name, root) => {
  beforeAll(seedTeamMembers);
  const sessionRef = (ctxDb: ReturnType<typeof as>, owner: string, id = "PS-1") => doc(ctxDb, `${root(owner)}/sessions`, id);

  it("an account with NO team (and no FTC profile) creates, reads, updates and deletes its own sessions and entries", async () => {
    const d = as(NOTEAM);
    await assertSucceeds(setDoc(sessionRef(d, NOTEAM), SESSION));
    await assertSucceeds(setDoc(doc(d, `${root(NOTEAM)}/entries`, "E1"), ENTRY));
    await assertSucceeds(getDoc(sessionRef(d, NOTEAM)));
    await assertSucceeds(getDocs(query(collection(d, `${root(NOTEAM)}/sessions`), where("status", "==", "paused"))));
    await assertSucceeds(getDocs(query(collection(d, `${root(NOTEAM)}/entries`), where("sessionId", "==", "PS-1"))));
    await assertSucceeds(updateDoc(sessionRef(d, NOTEAM), { status: "completed", accuracy: 0.9 }));
    await assertSucceeds(setDoc(doc(d, `${root(NOTEAM)}/state`, "share"), { dismissed: true }, { merge: true }));
    await assertSucceeds(deleteDoc(doc(d, `${root(NOTEAM)}/entries`, "E1")));
    await assertSucceeds(deleteDoc(sessionRef(d, NOTEAM)));
  });

  it("a document that carries a teamId key is refused, on create and on update, for a session and for an entry (the old empty-teamId bug cannot recur)", async () => {
    const d = as(NOTEAM);
    await assertFails(setDoc(sessionRef(d, NOTEAM, "PS-T"), { ...SESSION, teamId: "" }));
    await assertFails(setDoc(sessionRef(d, NOTEAM, "PS-T"), { ...SESSION, teamId: "T1" }));
    await assertFails(setDoc(doc(d, `${root(NOTEAM)}/entries`, "ET"), { ...ENTRY, teamId: "" }));
    await assertSucceeds(setDoc(sessionRef(d, NOTEAM, "PS-OK"), SESSION));
    await assertFails(updateDoc(sessionRef(d, NOTEAM, "PS-OK"), { teamId: "T1" }));
    await assertFails(setDoc(doc(d, `${root(NOTEAM)}/state`, "share"), { teamId: "T1" }));
  });

  it("the document must be the caller's own (its uid) and is size-bounded", async () => {
    const d = as(NOTEAM);
    await assertFails(setDoc(sessionRef(d, NOTEAM, "PS-U"), { ...SESSION, uid: "someone-else" }));
    const huge = Object.fromEntries(Array.from({ length: 45 }, (_, i) => [`k${i}`, i]));
    await assertFails(setDoc(sessionRef(d, NOTEAM, "PS-H"), { ...SESSION, ...huge }));
    await assertFails(setDoc(sessionRef(d, NOTEAM, "PS-N"), { ...SESSION, scoutName: "x".repeat(121) }));
  });

  it("nobody else reads or writes it: another account, a teammate, a team admin and a signed-out visitor are all refused", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(sessionRef(ctx.firestore() as never, NOTEAM, "PS-PRIV"), SESSION);
    });
    for (const who of [MATE, ADMIN, "stranger-1"]) {
      const d = as(who);
      await assertFails(getDoc(sessionRef(d, NOTEAM, "PS-PRIV")));
      await assertFails(getDocs(collection(d, `${root(NOTEAM)}/sessions`)));
      await assertFails(setDoc(sessionRef(d, NOTEAM, "PS-X"), SESSION));
      await assertFails(setDoc(sessionRef(d, NOTEAM, "PS-X"), { ...SESSION, uid: who }));
      await assertFails(updateDoc(sessionRef(d, NOTEAM, "PS-PRIV"), { status: "completed" }));
      await assertFails(deleteDoc(sessionRef(d, NOTEAM, "PS-PRIV")));
    }
    await assertFails(getDoc(sessionRef(testEnv.unauthenticatedContext().firestore() as never, NOTEAM, "PS-PRIV")));
  });
});

describe("the join-request pointer is server-only (no client can read or write it)", () => {
  it("every client, the owner of the pointer included, is refused", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), L("joinRequestPointers"), NOTEAM), { entries: [{ teamId: "T1", requestId: NOTEAM, status: "pending" }] });
    });
    for (const who of [NOTEAM, MATE, ADMIN]) {
      const d = as(who);
      await assertFails(getDoc(doc(d, L("joinRequestPointers"), NOTEAM)));
      await assertFails(setDoc(doc(d, L("joinRequestPointers"), who), { entries: [] }));
      await assertFails(getDocs(collection(d, L("joinRequestPointers"))));
    }
  });
});
