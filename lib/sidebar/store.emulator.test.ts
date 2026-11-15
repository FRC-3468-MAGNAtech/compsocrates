import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, type Firestore } from "firebase/firestore";
import { programPath } from "@/lib/firebase/paths";
import { defaultEntries, parseSidebarConfig } from "@/lib/sidebar/layout";
import { moveDown } from "@/lib/sidebar/edit";
import { SidebarConflictError, saveSidebarConfig } from "@/lib/sidebar/store";

// The sidebar config doc against the real firestore.rules (root FRC block and the `programs/ftc` block) and the save transaction (`saveSidebarConfig`):
// a team admin writes, a member does not, another team neither writes nor reads, each save is revision rev + 1, and two admins saving from the same
// starting point cannot silently overwrite each other. Needs the emulator: `npm run test:rules` (this file is in vitest.rules.config.ts).

let testEnv: RulesTestEnvironment;

const T1 = "TEAMONE";
const T2 = "TEAMTWO";
const ADMIN = "sb-admin";
const ADMIN2 = "sb-admin-2";
const MEMBER = "sb-member";
const OTHER_ADMIN = "sb-other-admin";
const OTHER_MEMBER = "sb-other-member";

const FT1 = "ftcteam1";
const FT2 = "ftcteam2";

const as = (uid: string) => testEnv.authenticatedContext(uid).firestore();
type Db = ReturnType<typeof as>;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: process.env.GCLOUD_PROJECT || "demo-compsocrates-rebuild",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const csUser = (over: Record<string, unknown>) => ({ email: "x@example.com", displayName: "Person", teamId: T1, role: "match-scout", isTeamAdmin: false, ...over });
    await setDoc(doc(db, "teams", T1), { teamName: "One", teamNumber: "1111" });
    await setDoc(doc(db, "teams", T2), { teamName: "Two", teamNumber: "2222" });
    await setDoc(doc(db, "users", ADMIN), csUser({ isTeamAdmin: true }));
    await setDoc(doc(db, "users", ADMIN2), csUser({ isTeamAdmin: true }));
    await setDoc(doc(db, "users", MEMBER), csUser({}));
    await setDoc(doc(db, "users", OTHER_ADMIN), csUser({ teamId: T2, isTeamAdmin: true }));
    await setDoc(doc(db, "users", OTHER_MEMBER), csUser({ teamId: T2 }));
    const ftcUser = (over: Record<string, unknown>) => ({ name: "Person", email: "p@example.org", teamId: FT1, primaryRole: "match-scout", secondaryRoles: [], isAdmin: false, isOwner: false, ...over });
    await setDoc(doc(db, programPath("ftc", "teams"), FT1), { joinCode: "J1" });
    await setDoc(doc(db, programPath("ftc", "teams"), FT2), { joinCode: "J2" });
    await setDoc(doc(db, programPath("ftc", "users"), ADMIN), ftcUser({ isAdmin: true }));
    await setDoc(doc(db, programPath("ftc", "users"), ADMIN2), ftcUser({ isAdmin: true }));
    await setDoc(doc(db, programPath("ftc", "users"), MEMBER), ftcUser({}));
    await setDoc(doc(db, programPath("ftc", "users"), OTHER_ADMIN), ftcUser({ teamId: FT2, isAdmin: true }));
    await setDoc(doc(db, programPath("ftc", "users"), OTHER_MEMBER), ftcUser({ teamId: FT2 }));
  });
});

const entriesPlain = () => defaultEntries().map((e) => ({ ...e }));
const body = (uid: string, over: Record<string, unknown> = {}) => ({ version: 1, rev: 1, entries: entriesPlain(), updatedBy: uid, updatedAt: serverTimestamp(), ...over });
const seedDoc = async (ref: (db: Db) => ReturnType<typeof doc>, rev = 1) => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(ref(ctx.firestore() as Db), { version: 1, rev, entries: entriesPlain(), updatedBy: ADMIN, updatedAt: new Date() });
  });
};

// The same suite for both programs: where the doc lives and which team ids / users the program uses.
const programs = [
  { name: "FRC (root)", program: "frc" as const, team: T1, otherTeam: T2, ref: (db: Db, team = T1) => doc(db, "teams", team, "settings", "sidebar") },
  { name: "FTC (programs/ftc)", program: "ftc" as const, team: FT1, otherTeam: FT2, ref: (db: Db, team = FT1) => doc(db, programPath("ftc", "teams"), team, "settings", "sidebar") },
];

for (const p of programs) {
  describe(`sidebar config rules: ${p.name}`, () => {
    const ref = (db: Db, team = p.team) => p.ref(db, team);

    it("lets a team admin create it as revision 1", async () => {
      await assertSucceeds(setDoc(ref(as(ADMIN)), body(ADMIN)));
    });

    it("refuses a member, an admin of another team, and a signed-out user", async () => {
      await assertFails(setDoc(ref(as(MEMBER)), body(MEMBER)));
      await assertFails(setDoc(ref(as(OTHER_ADMIN)), body(OTHER_ADMIN)));
      await assertFails(setDoc(ref(testEnv.unauthenticatedContext().firestore() as Db), body(ADMIN)));
    });

    it("lets every member of the team read it, and nobody from another team", async () => {
      await seedDoc((db) => ref(db));
      await assertSucceeds(getDoc(ref(as(MEMBER))));
      await assertSucceeds(getDoc(ref(as(ADMIN))));
      await assertFails(getDoc(ref(as(OTHER_MEMBER))));
      await assertFails(getDoc(ref(as(OTHER_ADMIN))));
      await assertFails(getDoc(ref(testEnv.unauthenticatedContext().firestore() as Db)));
    });

    it("a team's config is not another team's: an admin cannot write the other team's doc", async () => {
      await assertFails(setDoc(ref(as(ADMIN), p.otherTeam), body(ADMIN)));
    });

    it("checks the shape: extra field, wrong author, bad version, no entries, too many entries, not a first revision", async () => {
      await assertFails(setDoc(ref(as(ADMIN)), body(ADMIN, { extra: 1 })));
      await assertFails(setDoc(ref(as(ADMIN)), body(ADMIN, { updatedBy: MEMBER })));
      await assertFails(setDoc(ref(as(ADMIN)), body(ADMIN, { version: 2 })));
      await assertFails(setDoc(ref(as(ADMIN)), body(ADMIN, { entries: [] })));
      await assertFails(setDoc(ref(as(ADMIN)), body(ADMIN, { entries: Array.from({ length: 121 }, (_, i) => ({ id: `x${i}`, kind: "page", parent: null, order: i })) })));
      await assertFails(setDoc(ref(as(ADMIN)), body(ADMIN, { rev: 2 })));
      await assertFails(setDoc(ref(as(ADMIN)), body(ADMIN, { entries: "nope" })));
    });

    it("only accepts the next revision on update, and never a delete", async () => {
      await seedDoc((db) => ref(db), 3);
      await assertFails(setDoc(ref(as(ADMIN)), body(ADMIN, { rev: 3 }))); // same
      await assertFails(setDoc(ref(as(ADMIN)), body(ADMIN, { rev: 9 }))); // skipped ahead
      await assertFails(setDoc(ref(as(ADMIN)), body(ADMIN, { rev: 1 }))); // went back
      await assertSucceeds(setDoc(ref(as(ADMIN)), body(ADMIN, { rev: 4 })));
      await assertFails(deleteDoc(ref(as(ADMIN))));
    });

    it("does not open any other settings doc to write", async () => {
      await assertFails(setDoc(doc(as(ADMIN), ...(p.program === "frc" ? (["teams", p.team, "settings", "other"] as const) : ([programPath("ftc", "teams"), p.team, "settings", "other"] as const))), { a: 1 }));
    });
  });

  describe(`saveSidebarConfig (the save transaction): ${p.name}`, () => {
    const actor = (uid: string, team = p.team) => ({ teamId: team, uid, name: uid });
    const save = (uid: string, expectedRev: number, entries = defaultEntries(), team = p.team) => saveSidebarConfig(actor(uid, team), entries, expectedRev, p.program, as(uid) as unknown as Firestore);

    it("saves the first layout as rev 1 and the next as rev 2, readable as the same layout", async () => {
      const first = await save(ADMIN, 0, moveDown(defaultEntries(), "dashboard"));
      expect(first.rev).toBe(1);
      const second = await save(ADMIN, 1);
      expect(second.rev).toBe(2);
      const stored = parseSidebarConfig((await getDoc(p.ref(as(MEMBER) as Db))).data());
      expect(stored?.rev).toBe(2);
      expect(stored?.entries.length).toBe(defaultEntries().length);
    });

    it("tells the second of two admins who started from the same version that it changed (no silent overwrite)", async () => {
      await save(ADMIN, 0); // both admins loaded "no doc" (rev 0); ADMIN saves first
      await expect(save(ADMIN2, 0, moveDown(defaultEntries(), "analytics"))).rejects.toBeInstanceOf(SidebarConflictError);
      const stored = parseSidebarConfig((await getDoc(p.ref(as(ADMIN) as Db))).data());
      expect(stored?.rev).toBe(1); // the first save stands
      // after reloading (rev 1) the same edit lands
      await expect(save(ADMIN, 1, moveDown(defaultEntries(), "analytics"))).resolves.toMatchObject({ rev: 2 });
    });

    it("a member's save is refused by the rules, and so is another team's admin", async () => {
      await expect(save(MEMBER, 0)).rejects.toThrow();
      await expect(save(OTHER_ADMIN, 0)).rejects.toThrow();
      let exists = true;
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        exists = (await getDoc(p.ref(ctx.firestore() as Db))).exists();
      });
      expect(exists).toBe(false);
    });
  });
}
