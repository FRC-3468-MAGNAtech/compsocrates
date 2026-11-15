import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, type Firestore } from "firebase/firestore";
import { programPath } from "@/lib/firebase/paths";
import { childrenOf, defaultEntries, parseSidebarConfig } from "@/lib/sidebar/layout";
import { moveEntry, sameLayout } from "@/lib/sidebar/edit";
import { SidebarConflictError, SidebarSyncError, pullSidebarLayout, pushSidebarLayout, saveSidebarConfig } from "@/lib/sidebar/store";

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
      const first = await save(ADMIN, 0, moveEntry(defaultEntries(), "dashboard", null, 0));
      expect(first.rev).toBe(1);
      const second = await save(ADMIN, 1);
      expect(second.rev).toBe(2);
      const stored = parseSidebarConfig((await getDoc(p.ref(as(MEMBER) as Db))).data());
      expect(stored?.rev).toBe(2);
      expect(stored?.entries.length).toBe(defaultEntries().length);
    });

    it("tells the second of two admins who started from the same version that it changed (no silent overwrite)", async () => {
      await save(ADMIN, 0); // both admins loaded "no doc" (rev 0); ADMIN saves first
      await expect(save(ADMIN2, 0, moveEntry(defaultEntries(), "analytics", null, 0))).rejects.toBeInstanceOf(SidebarConflictError);
      const stored = parseSidebarConfig((await getDoc(p.ref(as(ADMIN) as Db))).data());
      expect(stored?.rev).toBe(1); // the first save stands
      // after reloading (rev 1) the same edit lands
      await expect(save(ADMIN, 1, moveEntry(defaultEntries(), "analytics", null, 0))).resolves.toMatchObject({ rev: 2 });
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

// Syncing: the Sidebar tab copies a layout to, or reads one from, the person's own team in the other program (a separate account, found through their profile there).
describe("sidebar sync between the two programs", () => {
  const person = (uid: string) => ({ uid, name: uid });
  const frcDoc = (db: Db, team = T1) => doc(db, "teams", team, "settings", "sidebar");
  const ftcDoc = (db: Db, team = FT1) => doc(db, programPath("ftc", "teams"), team, "settings", "sidebar");
  const arranged = () => moveEntry(defaultEntries(), "dashboard", null, 0);
  const firstOf = (data: unknown) => childrenOf(parseSidebarConfig(data)?.entries ?? [], null)[0]?.id;

  it("an admin sends the layout to their team in the other program, in both directions, and that team's members read it", async () => {
    const toFtc = await pushSidebarLayout(person(ADMIN), arranged(), "frc", "ftc", as(ADMIN) as unknown as Firestore);
    expect(toFtc.rev).toBe(1);
    expect(firstOf((await getDoc(ftcDoc(as(MEMBER) as Db))).data())).toBe("dashboard");
    const toFrc = await pushSidebarLayout(person(ADMIN), moveEntry(defaultEntries(), "people", null, 0), "ftc", "frc", as(ADMIN) as unknown as Firestore);
    expect(toFrc.rev).toBe(1);
    expect(firstOf((await getDoc(frcDoc(as(MEMBER) as Db))).data())).toBe("people");
  });

  it("replaces what the other program has (the next revision, no conflict) and writes an audit entry there", async () => {
    await seedDoc((db) => ftcDoc(db), 4);
    const out = await pushSidebarLayout(person(ADMIN), arranged(), "frc", "ftc", as(ADMIN) as unknown as Firestore);
    expect(out.rev).toBe(5);
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const { getDocs, collection } = await import("firebase/firestore");
      const logs = await getDocs(collection(ctx.firestore() as Db, programPath("ftc", "auditLog")));
      const entry = logs.docs.map((d) => d.data()).find((d) => d.action === "edit-sidebar");
      expect(entry?.teamId).toBe(FT1);
      expect(entry?.target).toMatchObject({ rev: 5, syncedFrom: "frc" });
    });
  });

  it("pulls the other program's layout as an entry list (the default when it has none), without writing", async () => {
    expect(sameLayout(await pullSidebarLayout({ uid: ADMIN }, "ftc", as(ADMIN) as unknown as Firestore), defaultEntries())).toBe(true);
    await pushSidebarLayout(person(ADMIN), arranged(), "frc", "ftc", as(ADMIN) as unknown as Firestore);
    expect(sameLayout(await pullSidebarLayout({ uid: ADMIN }, "ftc", as(ADMIN) as unknown as Firestore), arranged())).toBe(true);
  });

  it("is refused for a member (the rules), and says there is no account for a person without a profile in the other program", async () => {
    await expect(pushSidebarLayout(person(MEMBER), arranged(), "frc", "ftc", as(MEMBER) as unknown as Firestore)).rejects.toThrow();
    await expect(pushSidebarLayout(person("sb-stranger"), arranged(), "frc", "ftc", as("sb-stranger") as unknown as Firestore)).rejects.toBeInstanceOf(SidebarSyncError);
    await expect(pullSidebarLayout({ uid: "sb-stranger" }, "ftc", as("sb-stranger") as unknown as Firestore)).rejects.toBeInstanceOf(SidebarSyncError);
    let exists = true;
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      exists = (await getDoc(ftcDoc(ctx.firestore() as Db))).exists();
    });
    expect(exists).toBe(false);
  });

  it("never writes another team's layout: an admin of a different team in the other program only reaches their own", async () => {
    await pushSidebarLayout(person(OTHER_ADMIN), arranged(), "frc", "ftc", as(OTHER_ADMIN) as unknown as Firestore);
    expect(firstOf((await getDoc(ftcDoc(as(OTHER_MEMBER) as Db, FT2))).data())).toBe("dashboard");
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      expect((await getDoc(ftcDoc(ctx.firestore() as Db, FT1))).exists()).toBe(false);
    });
  });
});
