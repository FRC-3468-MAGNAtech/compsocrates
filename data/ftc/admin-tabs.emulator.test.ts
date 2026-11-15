import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";
import { buildAuditEntry } from "@/lib/audit-log";
import { programPath } from "@/lib/firebase/paths";

// Batch 5b: the Admin Panel tabs Forms (with its templates), Sessions, Rescore and Backups against the real firestore.rules (the `programs/ftc` block, unchanged by this
// batch), as a team admin, a Lead Scout, a plain member, an admin of ANOTHER team and a signed-out user. Every read and write below is the exact shape the app makes
// (lib/forms/firestore-store.ts, lib/templates/firestore-service.tsx, lib/admin/rescore-sessions.ts, data/ftc/backup.ts). Needs the emulator: `npm run test:rules`.

let testEnv: RulesTestEnvironment;

const T1 = "b5bteam1";
const T2 = "b5bteam2";
const ADMIN = "b5b-admin-1";
const LEAD = "b5b-lead-1"; // a Lead Scout of team 1, not an admin
const MEMBER = "b5b-member-1"; // a plain member of team 1
const OTHER = "b5b-other-1"; // a scout of team 2
const ADMIN_T2 = "b5b-admin-t2"; // an admin of ANOTHER team
const OUTSIDER = "b5b-no-profile"; // signed in, but without a profile in this program

const S = (name: string) => programPath("ftc", name);
const as = (uid: string) => testEnv.authenticatedContext(uid).firestore();
const anon = () => testEnv.unauthenticatedContext().firestore();
const coll = (uid: string, name: string) => collection(as(uid), S(name));
const ids = (snap: { docs: { id: string }[] }) => snap.docs.map((d) => d.id).sort();

const user = (name: string, teamId: string, extra: Record<string, unknown> = {}) => ({ name, email: `${name}@example.org`, teamId, primaryRole: "match-scout", secondaryRoles: [], isAdmin: false, isOwner: false, ...extra });
const formDoc = (teamId: string, formId: string, extra: Record<string, unknown> = {}) => ({ teamId, formId, name: "My form", origin: "custom", publishedVersion: null, draft: { id: formId, name: "My form" }, active: true, archived: false, createdBy: "x", ...extra });
const template = (team: string, extra: Record<string, unknown> = {}) => ({
  ownerTeamId: team, authorName: "Alpha", name: "My template", description: "", tags: [], version: 1, form: { id: "f", name: "F" }, checksum: "abc", fieldCount: 1, sectionCount: 1,
  visibility: "private", official: false, importCount: 0, reportCount: 0, ...extra,
});
const session = (uid: string, teamId: string, extra: Record<string, unknown> = {}) => ({
  teamId, uid, kind: "solo", status: "completed", scoutName: "x", seasonId: "biobuzz", mode: "trial", difficulty: null, libraryMatchId: "EVB5_Q1", eventCode: "EVB5", alliance: "red",
  robots: [111, 222], completedRobots: [111, 222], entryIds: [], accuracy: 90, scoutedTotal: 60, penaltyPoints: 0, officialScore: 66, platform: "pc", flags: [], excluded: false,
  lobbyId: null, pairId: null, startedAt: "2026-03-01T10:00:00.000Z", finishedAt: "2026-03-01T10:10:00.000Z", ...extra,
});
const derived = { accuracy: 80, scoutedTotal: 50, officialScore: 62, penaltyPoints: 2, flags: [{ type: "low", title: "Low", detail: "", dismissed: true }] };
type Action = "rescore-sessions" | "export-backup" | "set-active-form" | "delete-form-template" | "save-form-template" | "hard-reset-scout-data";
const audit = (uid: string, teamId: string, action: Action) => ({ ...buildAuditEntry(teamId, uid, "x", action, { n: 1 }, null, null), createdAt: serverTimestamp() });

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: process.env.GCLOUD_PROJECT || "demo-compsocrates-rebuild",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
  });
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, S("users"), ADMIN), user("Admin", T1, { isAdmin: true, primaryRole: "team-coach" }));
    await setDoc(doc(db, S("users"), LEAD), user("Lead", T1, { primaryRole: "lead-scout" }));
    await setDoc(doc(db, S("users"), MEMBER), user("Member", T1));
    await setDoc(doc(db, S("users"), OTHER), user("Other", T2));
    await setDoc(doc(db, S("users"), ADMIN_T2), user("AdminT2", T2, { isAdmin: true, primaryRole: "team-coach" }));
    await setDoc(doc(db, S("teams"), T1), { joinCode: "J1", number: 1111, name: "Alpha" });
    await setDoc(doc(db, S("teams"), T2), { joinCode: "J2", number: 9999, name: "Other Team" });
    await setDoc(doc(db, S("teams"), T1, "settings", "sidebar"), { version: 1, rev: 1, entries: [] });
    await setDoc(doc(db, S("forms"), `${T1}_biobuzz`), formDoc(T1, "biobuzz", { origin: "built-in-override", publishedVersion: 1, draft: null }));
    await setDoc(doc(db, S("forms"), `${T1}_biobuzz`, "versions", "1"), { teamId: T1, formId: "biobuzz", version: 1, form: { id: "biobuzz", name: "BIOBUZZ" }, createdBy: ADMIN });
    await setDoc(doc(db, S("forms"), `${T2}_b5b-t2`), formDoc(T2, "b5b-t2"));
    await setDoc(doc(db, S("practiceSessions"), "B5B-DONE"), session(MEMBER, T1));
    await setDoc(doc(db, S("practiceSessions"), "B5B-DONE2"), session(MEMBER, T1));
    await setDoc(doc(db, S("practiceSessions"), "B5B-OPEN"), session(MEMBER, T1, { status: "in-progress", accuracy: null }));
    await setDoc(doc(db, S("practiceSessions"), "B5B-T2"), session(OTHER, T2));
    await setDoc(doc(db, S("scoutEntries"), "B5B-E1"), { teamId: T1, uid: MEMBER, source: "practice", mode: "trial", eventCode: "EVB5", matchType: "Qualification", matchNumber: 1, teamNumber: 111, formId: "biobuzz", formVersion: 1, values: { autoTipHive: 1 }, score: { auto: 0, teleop: 0, endgame: 0, total: 5 }, comments: "", submittedAt: "2026-03-01T10:05:00.000Z", excluded: false, autoFlags: [], manualFlags: [], accuracy: null, sessionId: "B5B-DONE", libraryMatchId: "EVB5_Q1" });
    await setDoc(doc(db, S("formTemplates"), "B5B-TPL"), template(T1));
    await setDoc(doc(db, S("formTemplates"), "B5B-TPL-T2"), template(T2));
    await setDoc(doc(db, S("formTemplates"), "B5B-TPL-PUB"), template(T2, { visibility: "public" }));
    await setDoc(doc(db, S("libraryEvents"), "B5BEV"), { origin: "api", eventCode: "B5BEV", eventName: "Shared", seasonId: "biobuzz", createdBy: ADMIN });
    await setDoc(doc(db, S("libraryEvents"), "B5BEV-OWN"), { origin: "manual", teamId: T1, eventCode: "B5BEV-OWN", eventName: "Ours", seasonId: "biobuzz", createdBy: ADMIN });
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

describe("Forms (Batch 5b)", () => {
  it("every teammate reads the team's forms (equality on teamId) and their versions; another team and a signed-out user do not", async () => {
    for (const who of [ADMIN, LEAD, MEMBER]) {
      const snap = await assertSucceeds(getDocs(query(coll(who, "forms"), where("teamId", "==", T1))));
      expect(ids(snap)).toContain(`${T1}_biobuzz`);
      expect(ids(snap)).not.toContain(`${T2}_b5b-t2`);
      await assertSucceeds(getDocs(collection(as(who), S("forms"), `${T1}_biobuzz`, "versions")));
    }
    await assertFails(getDocs(query(coll(ADMIN_T2, "forms"), where("teamId", "==", T1))));
    await assertFails(getDocs(collection(as(ADMIN_T2), S("forms"), `${T1}_biobuzz`, "versions")));
    await assertFails(getDocs(query(collection(anon(), S("forms")), where("teamId", "==", T1))));
  });

  it("an admin creates a custom form draft, publishes it as version 1 in one batch (write-once) and archives it; a Lead Scout, a member, another team's admin and a signed-out user cannot", async () => {
    const id = "b5b-custom";
    const ref = (uid: string) => doc(as(uid), S("forms"), `${T1}_${id}`);
    for (const who of [LEAD, MEMBER, ADMIN_T2]) await assertFails(setDoc(ref(who), formDoc(T1, id)));
    await assertFails(setDoc(doc(anon(), S("forms"), `${T1}_${id}`), formDoc(T1, id)));
    await assertSucceeds(setDoc(ref(ADMIN), formDoc(T1, id)));
    // publish: the version doc and the form doc's version bump in ONE batch (what the store's transaction commits)
    const db = as(ADMIN);
    const publish = writeBatch(db);
    publish.set(doc(db, S("forms"), `${T1}_${id}`, "versions", "1"), { teamId: T1, formId: id, version: 1, form: { id, name: "My form" }, createdBy: ADMIN });
    publish.set(doc(db, S("forms"), `${T1}_${id}`), formDoc(T1, id, { publishedVersion: 1, draft: null }));
    await assertSucceeds(publish.commit());
    // a version is write-once and a published version number never goes down
    await assertFails(updateDoc(doc(db, S("forms"), `${T1}_${id}`, "versions", "1"), { note: "x" }));
    await assertFails(setDoc(doc(db, S("forms"), `${T1}_${id}`), formDoc(T1, id, { publishedVersion: null, draft: null })));
    await assertSucceeds(setDoc(doc(db, S("forms"), `${T1}_${id}`), formDoc(T1, id, { publishedVersion: 1, draft: null, archived: true })));
    // forms are never deleted, by anyone; and a form of another team cannot be created
    await assertFails(deleteDoc(doc(db, S("forms"), `${T1}_${id}`)));
    await assertFails(setDoc(doc(db, S("forms"), `${T2}_x`), formDoc(T2, "x")));
  });

  it("choosing the active form (teams.activeForms.biobuzz, with its audit entry) is an admin write; a Lead Scout, a member and another team's admin cannot, and an unknown season is refused", async () => {
    const team = (uid: string) => doc(as(uid), S("teams"), T1);
    for (const who of [LEAD, MEMBER, ADMIN_T2, OUTSIDER]) await assertFails(updateDoc(team(who), { "activeForms.biobuzz": "b5b-custom" }));
    await assertFails(updateDoc(doc(anon(), S("teams"), T1), { "activeForms.biobuzz": "b5b-custom" }));
    await assertSucceeds(updateDoc(team(ADMIN), { "activeForms.biobuzz": "b5b-custom" }));
    await assertFails(updateDoc(team(ADMIN), { "activeForms.rebuilt": "b5b-custom" }));
    await assertSucceeds(addDoc(collection(as(ADMIN), S("auditLog")), audit(ADMIN, T1, "set-active-form")));
  });
});

describe("Templates (Batch 5b)", () => {
  it("an admin lists the team's own templates (ownerTeamId ==), creates a private one, renames it and deletes it; nobody else's private template is readable", async () => {
    const own = await assertSucceeds(getDocs(query(coll(ADMIN, "formTemplates"), where("ownerTeamId", "==", T1))));
    expect(ids(own)).toContain("B5B-TPL");
    expect(ids(own)).not.toContain("B5B-TPL-T2");
    await assertFails(getDocs(query(coll(ADMIN, "formTemplates"), where("ownerTeamId", "==", T2))));
    await assertFails(getDocs(query(coll(ADMIN_T2, "formTemplates"), where("ownerTeamId", "==", T1))));
    await assertFails(getDocs(query(collection(anon(), S("formTemplates")), where("ownerTeamId", "==", T1))));
    const created = await assertSucceeds(addDoc(coll(ADMIN, "formTemplates"), template(T1)));
    await assertSucceeds(updateDoc(doc(as(ADMIN), S("formTemplates"), created.id), { name: "Renamed", version: 2 }));
    await assertSucceeds(deleteDoc(doc(as(ADMIN), S("formTemplates"), created.id)));
    await assertSucceeds(addDoc(collection(as(ADMIN), S("auditLog")), audit(ADMIN, T1, "save-form-template")));
    await assertSucceeds(addDoc(collection(as(ADMIN), S("auditLog")), audit(ADMIN, T1, "delete-form-template")));
  });

  it("a Lead Scout, a member and another team's admin cannot create, edit or delete the team's templates; `official`, `visibility` and use counts cannot be forged", async () => {
    for (const who of [LEAD, MEMBER]) {
      await assertFails(addDoc(coll(who, "formTemplates"), template(T1)));
      await assertFails(updateDoc(doc(as(who), S("formTemplates"), "B5B-TPL"), { name: "x" }));
      await assertFails(deleteDoc(doc(as(who), S("formTemplates"), "B5B-TPL")));
    }
    await assertFails(addDoc(coll(ADMIN_T2, "formTemplates"), template(T1)));
    await assertFails(deleteDoc(doc(as(ADMIN_T2), S("formTemplates"), "B5B-TPL")));
    await assertFails(addDoc(coll(ADMIN, "formTemplates"), template(T1, { visibility: "public" })));
    await assertFails(addDoc(coll(ADMIN, "formTemplates"), template(T1, { official: true })));
    await assertFails(addDoc(coll(ADMIN, "formTemplates"), template(T1, { importCount: 5 })));
    await assertFails(updateDoc(doc(as(ADMIN), S("formTemplates"), "B5B-TPL"), { visibility: "public" }));
    await assertFails(updateDoc(doc(as(ADMIN), S("formTemplates"), "B5B-TPL"), { importCount: 9 }));
    // and an admin cannot delete another team's template
    await assertFails(deleteDoc(doc(as(ADMIN), S("formTemplates"), "B5B-TPL-T2")));
  });
});

describe("Sessions and Rescore (Batch 5b)", () => {
  it("the admin's list is team-wide (teamId ==, never by event) and holds no other team's sessions; a signed-out user and another team's admin read none", async () => {
    const snap = await assertSucceeds(getDocs(query(coll(ADMIN, "practiceSessions"), where("teamId", "==", T1))));
    expect(ids(snap)).toEqual(expect.arrayContaining(["B5B-DONE", "B5B-DONE2", "B5B-OPEN"]));
    expect(ids(snap)).not.toContain("B5B-T2");
    await assertFails(getDocs(query(coll(ADMIN_T2, "practiceSessions"), where("teamId", "==", T1))));
    await assertFails(getDocs(query(collection(anon(), S("practiceSessions")), where("teamId", "==", T1))));
    // a session looked up by its id (the Sessions tab's search box)
    await assertSucceeds(getDoc(doc(as(ADMIN), S("practiceSessions"), "B5B-DONE")));
    await assertFails(getDoc(doc(as(ADMIN), S("practiceSessions"), "B5B-T2")));
  });

  it("delete is admin-only and only for a COMPLETED session (an in-progress one is its scout's); the admin writes the audit entry", async () => {
    for (const who of [LEAD, MEMBER, ADMIN_T2]) await assertFails(deleteDoc(doc(as(who), S("practiceSessions"), "B5B-DONE2")));
    await assertFails(deleteDoc(doc(as(ADMIN), S("practiceSessions"), "B5B-OPEN"))); // known gap: an admin cannot remove a stuck in-progress session
    await assertSucceeds(deleteDoc(doc(as(ADMIN), S("practiceSessions"), "B5B-DONE2")));
    await assertSucceeds(addDoc(collection(as(ADMIN), S("auditLog")), audit(ADMIN, T1, "hard-reset-scout-data")));
  });

  it("an admin writes the derived fields (session accuracy, totals, flags; entry score and accuracy); a scout, a Lead Scout, another team's admin and a signed-out user cannot, not even the scout on their own completed session", async () => {
    const sessionRef = (uid: string) => doc(as(uid), S("practiceSessions"), "B5B-DONE");
    for (const who of [MEMBER, LEAD, ADMIN_T2]) await assertFails(updateDoc(sessionRef(who), derived));
    await assertFails(updateDoc(doc(anon(), S("practiceSessions"), "B5B-DONE"), derived));
    await assertSucceeds(updateDoc(sessionRef(ADMIN), derived));
    expect((await getDoc(sessionRef(ADMIN))).data()).toMatchObject({ accuracy: 80, scoutedTotal: 50, officialScore: 62, penaltyPoints: 2 });
    // the rescore never moves a session: teamId and uid stay
    await assertFails(updateDoc(sessionRef(ADMIN), { teamId: T2 }));
    await assertFails(updateDoc(sessionRef(ADMIN), { uid: ADMIN }));
    // entries: the derived score and accuracy
    const entryPatch = { score: { auto: 1, teleop: 2, endgame: 0, total: 3 }, accuracy: { status: "complete", value: 0.8, scoutedTotal: 3, penaltyPoints: 0, officialScore: 4 } };
    for (const who of [MEMBER, LEAD, ADMIN_T2]) await assertFails(updateDoc(doc(as(who), S("scoutEntries"), "B5B-E1"), entryPatch));
    await assertSucceeds(updateDoc(doc(as(ADMIN), S("scoutEntries"), "B5B-E1"), entryPatch));
    // the audit entry of a rescore is the admin's
    await assertSucceeds(addDoc(collection(as(ADMIN), S("auditLog")), audit(ADMIN, T1, "rescore-sessions")));
    await assertFails(addDoc(collection(as(LEAD), S("auditLog")), audit(LEAD, T1, "rescore-sessions")));
    await assertFails(addDoc(collection(as(ADMIN_T2), S("auditLog")), audit(ADMIN_T2, T1, "rescore-sessions")));
  });

  it("a batch of 400 session writes from the admin is accepted (the chunk size the app uses)", async () => {
    const db = as(ADMIN);
    const batch = writeBatch(db);
    for (let i = 0; i < 400; i++) batch.update(doc(db, S("practiceSessions"), "B5B-DONE"), { accuracy: i % 100 });
    await assertSucceeds(batch.commit());
  });
});

describe("Backups (Batch 5b)", () => {
  // the reads data/ftc/backup.ts makes, in order
  const backupReads = (uid: string, teamId: string) => [
    ...["scoutEntries", "formEntries", "practiceSessions", "assignments", "eventAttendance", "auditLog", "forms"].map((name) => () => getDocs(query(coll(uid, name), where("teamId", "==", teamId)))),
    () => getDocs(collection(as(uid), S("forms"), `${teamId}_biobuzz`, "versions")),
    () => getDocs(query(coll(uid, "formTemplates"), where("ownerTeamId", "==", teamId))),
    ...["libraryEvents", "libraryMatches"].flatMap((name) => [() => getDocs(query(coll(uid, name), where("origin", "==", "api"))), () => getDocs(query(coll(uid, name), where("teamId", "==", teamId)))]),
    () => getDocs(query(coll(uid, "users"), where("teamId", "==", teamId))),
    () => getDoc(doc(as(uid), S("teams"), teamId)),
    () => getDoc(doc(as(uid), S("teams"), teamId, "settings", "sidebar")),
  ];
  const SHARED_LIBRARY = [9, 11]; // the `origin == "api"` queries: shared reference data every signed-in user reads, not team data

  it("a team admin runs every export read (equality queries only) and gets the team's data, not another team's", async () => {
    for (const read of backupReads(ADMIN, T1)) await assertSucceeds(read() as Promise<unknown>);
    const sessions = await assertSucceeds(getDocs(query(coll(ADMIN, "practiceSessions"), where("teamId", "==", T1))));
    expect(ids(sessions)).not.toContain("B5B-T2");
    const own = await assertSucceeds(getDocs(query(coll(ADMIN, "libraryEvents"), where("teamId", "==", T1))));
    expect(ids(own)).toEqual(["B5BEV-OWN"]);
  });

  it("another team's admin cannot read any of the team's data through the export's queries; a signed-out user reads none of it", async () => {
    const allowed: number[] = [];
    for (const [i, read] of backupReads(ADMIN_T2, T1).entries()) {
      if (SHARED_LIBRARY.includes(i)) continue;
      try {
        await assertFails(read() as Promise<unknown>);
      } catch {
        allowed.push(i);
      }
    }
    expect(allowed).toEqual([]);
    const out = anon();
    for (const name of ["scoutEntries", "formEntries", "practiceSessions", "assignments", "eventAttendance", "auditLog", "forms", "users"]) {
      await assertFails(getDocs(query(collection(out, S(name)), where("teamId", "==", T1))));
    }
    await assertFails(getDocs(query(collection(out, S("formTemplates")), where("ownerTeamId", "==", T1))));
    await assertFails(getDoc(doc(out, S("teams"), T1)));
    // the other team's admin's own team export works for them
    await assertSucceeds(getDocs(query(coll(ADMIN_T2, "practiceSessions"), where("teamId", "==", T2))));
  });

  it("a plain member reads the team's data lists but not the audit log (the tab itself is admin-only), and cannot write an audit entry", async () => {
    await assertSucceeds(getDocs(query(coll(MEMBER, "scoutEntries"), where("teamId", "==", T1))));
    await assertFails(getDocs(query(coll(MEMBER, "auditLog"), where("teamId", "==", T1))));
    await assertSucceeds(addDoc(collection(as(ADMIN), S("auditLog")), audit(ADMIN, T1, "export-backup")));
    await assertFails(addDoc(collection(as(MEMBER), S("auditLog")), audit(MEMBER, T1, "export-backup")));
  });

  it("the export writes nothing, and restore is not ported: a client cannot recreate another team's documents (what restoring a foreign file would need)", async () => {
    const db = as(ADMIN);
    await assertFails(setDoc(doc(db, S("scoutEntries"), "restore-1"), { teamId: T2, uid: ADMIN, source: "event", eventCode: "EV1", matchType: "Qualification", matchNumber: 1, teamNumber: 1, formId: "biobuzz", formVersion: 1, values: {}, score: { total: 0 } }));
    await assertFails(setDoc(doc(db, S("practiceSessions"), "restore-2"), session(OTHER, T2)));
  });
});
