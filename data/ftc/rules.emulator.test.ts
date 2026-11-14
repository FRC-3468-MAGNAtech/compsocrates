import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";
import { ftcDocToPickList, ftcPickListDoc, ftcPickListId } from "@/data/ftc/pick-list";
import { applySlotSwap, ftcAssignmentDocId, ftcAssignmentsDoc, ftcDocsToTeamAssignments, ftcTeamAssignmentDocId, ftcTeamAssignmentsDoc, pickMatchAssignments, readAssignmentVersion } from "@/data/ftc/assignments";
import { applyPickOp, sanitizePicks, type PickOp } from "@/lib/pick-list/ops";
import { buildAuditEntry } from "@/lib/audit-log";
import { diffEntryValues, formEntryDoc, type NewFormEntry } from "@/lib/form-entries-model";
import { ftcDocsToFormEntries } from "@/data/ftc/form-entries";
import { ftcDocsToFormDocs, ftcDocToFormVersion } from "@/data/ftc/forms";
import { ftcDocsToScoutEntries, ftcScoutEntryDoc, ftcScoutEntryPatch } from "@/data/ftc/scouting";
import { ftcAttendanceDoc, ftcAttendanceDocId, ftcDocsToAttendance } from "@/data/ftc/attendance";
import { ftcActiveEventsFields, ftcTeamToTeamDoc, readStoredEvent } from "@/data/ftc/teams";
import { ftcProfilePatch, ftcUserToMember, ftcUserToProfile } from "@/data/ftc/users";
import { programPath } from "@/lib/firebase/paths";
import type { SaveEntryInput, ScoutEntry } from "@/lib/scout-entries";

// The FTC data layer against the real firestore.rules (the `programs/ftc` block), in the Firestore emulator: the documents it writes are accepted, and
// every query it makes (the same shapes as data/ftc/read.ts, whose constraints data/ftc/read.test.ts pins) is one the rules allow: only the account's
// own team, and a teammate's data is refused. Needs the emulator: `npm run test:rules` (this file is in vitest.rules.config.ts).
// Paths come from programPath, as in the app.

let testEnv: RulesTestEnvironment;

const T1 = "ftcteam1";
const T2 = "ftcteam2";
const SCOUT = "ftc-scout-1";
const OTHER = "ftc-scout-other";
const ADMIN = "ftc-admin-1";
const PIT = "ftc-pit-1";

const P = (name: string) => programPath("ftc", name);

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: process.env.GCLOUD_PROJECT || "demo-compsocrates-rebuild",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
  });
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, P("users"), SCOUT), { name: "Ada", email: "ada@example.org", teamId: T1, primaryRole: "match-scout", secondaryRoles: [], isAdmin: false, isOwner: false });
    await setDoc(doc(db, P("users"), "ftc-lead-1"), { name: "Grace", email: "grace@example.org", teamId: T1, primaryRole: "lead-scout", secondaryRoles: [], isAdmin: false, isOwner: false, fieldTeamIds: ["ft-1"] });
    await setDoc(doc(db, P("users"), ADMIN), { name: "Admin", email: "admin@example.org", teamId: T1, primaryRole: "team-coach", secondaryRoles: [], isAdmin: true, isOwner: false });
    await setDoc(doc(db, P("users"), PIT), { name: "Pia", email: "pia@example.org", teamId: T1, primaryRole: "pit-scout", secondaryRoles: [], isAdmin: false, isOwner: false });
    for (const id of ["edit-1", "edit-2", "edit-3"]) {
      await setDoc(doc(db, P("scoutEntries"), id), { teamId: T1, uid: SCOUT, source: "event", eventCode: "EV1", matchType: "Qualification", matchNumber: 9, teamNumber: 300, formId: "biobuzz", formVersion: 1, values: {}, score: { auto: 0, teleop: 0, endgame: 0, total: 0 }, comments: "", submittedAt: "2026-01-10T10:00:00.000Z", excluded: false, autoFlags: [], manualFlags: [], accuracy: null });
    }
    await setDoc(doc(db, P("users"), OTHER), { name: "Other", email: "o@example.org", teamId: T2, primaryRole: "match-scout", secondaryRoles: [], isAdmin: false, isOwner: false });
    await setDoc(doc(db, P("teams"), T1), {
      joinCode: "J1",
      fieldTeamIdList: ["ft-1", "ft-2"],
      fieldTeams: [
        { id: "ft-1", number: 1111, name: "Alpha" },
        { id: "ft-2", number: 2222, name: "Beta" },
      ],
      activeEventCode: "EV1",
      activeEvents: [{ code: "EV1", season: 2025, name: "Event One", dateStart: "2026-01-10", dateEnd: "2026-01-11", city: null, stateProv: null, country: null, venue: null, website: null, timezone: null, status: "upcoming" }],
    });
    await setDoc(doc(db, P("teams"), T2), { joinCode: "J2", number: 9999, name: "Other Team" });
    await setDoc(doc(db, P("scoutEntries"), "seed-1"), { teamId: T1, uid: SCOUT, source: "event", eventCode: "EV1", matchType: "Qualification", matchNumber: 1, teamNumber: 100, formId: "biobuzz", formVersion: 1, values: { autoLeave: true }, score: { auto: 3, teleop: 0, endgame: 0, total: 3 }, comments: "", submittedAt: "2026-01-10T10:00:00.000Z", excluded: false, autoFlags: [], manualFlags: [], accuracy: null, sessionId: null, libraryMatchId: null });
    await setDoc(doc(db, P("scoutEntries"), "seed-2"), { teamId: T2, uid: OTHER, source: "event", eventCode: "EV1", matchType: "Qualification", matchNumber: 1, teamNumber: 200, formId: "biobuzz", formVersion: 1, values: {}, score: { auto: 0, teleop: 0, endgame: 0, total: 0 } });
    await setDoc(doc(db, P("formEntries"), "fe-1"), { teamId: T1, uid: SCOUT, scoutName: "Ada", formId: "pit-scout", formVersion: 1, formType: "pit-scout", eventCode: "EV1", teamNumber: 100, values: {}, stickyNotes: [], flags: [], excluded: false, createdAt: new Date(2000), updatedAt: new Date(2000) });
    await setDoc(doc(db, P("forms"), `${T1}_biobuzz`), { teamId: T1, formId: "biobuzz", name: "BIOBUZZ", origin: "built-in-override", publishedVersion: 2, draft: null, active: true, archived: false, createdBy: "ftc-lead-1" });
    await setDoc(doc(db, P("forms"), `${T1}_biobuzz`, "versions", "2"), { teamId: T1, formId: "biobuzz", version: 2, form: { id: "biobuzz", name: "BIOBUZZ" }, createdBy: "ftc-lead-1" });
    await setDoc(doc(db, P("teams"), T1, "settings", "pageAccess"), { pageRoles: {} });
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

const as = (uid: string) => testEnv.authenticatedContext(uid).firestore();

const input: SaveEntryInput = {
  scoutName: "Ada",
  eventCode: "EV1",
  matchType: "Qualification",
  matchNumber: 7,
  teamNumber: 4242,
  formId: "biobuzz",
  formVersion: 1,
  values: { autoLeave: true, teleTipHive: 2 },
  score: { auto: 3, teleop: 40, endgame: 0, total: 43 },
  comments: "fast",
  stickyNotes: [{ id: "n1", text: "fast", color: "yellow", createdAt: 1 }],
};

describe("saving a Match Scout entry", () => {
  it("is accepted for the scout's own team, as themselves, and reads back as the entry saved", async () => {
    const db = as(SCOUT);
    const ref = await assertSucceeds(addDoc(collection(db, P("scoutEntries")), ftcScoutEntryDoc(T1, SCOUT, input, serverTimestamp)));
    const snap = await assertSucceeds(getDoc(doc(db, P("scoutEntries"), ref.id)));
    const [entry] = ftcDocsToScoutEntries([{ id: snap.id, data: snap.data() }]);
    expect(entry).toMatchObject({ id: ref.id, teamId: T1, uid: SCOUT, source: "event", formId: "biobuzz", teamNumber: 4242, values: { autoLeave: true, teleTipHive: 2 }, score: { total: 43 }, comments: "fast", excluded: false, accuracy: null });
    expect(entry.stickyNotes).toHaveLength(1);
  });

  it("is refused for another team, or as someone else", async () => {
    const db = as(SCOUT);
    await assertFails(addDoc(collection(db, P("scoutEntries")), ftcScoutEntryDoc(T2, SCOUT, input, serverTimestamp)));
    await assertFails(addDoc(collection(db, P("scoutEntries")), ftcScoutEntryDoc(T1, OTHER, input, serverTimestamp)));
  });
});

describe("editing and deleting a Match Scout entry (admins only)", () => {
  const edit: Partial<ScoutEntry> = { excluded: true, manualFlags: [{ id: "mf-1", reason: "Duplicate entry", note: "twice", addedAt: "2026-01-10T16:00:00.000Z" }], autoFlags: [{ ruleId: "r", dismissed: true }], accuracy: null };

  it("an admin's edit is accepted, and reads back with the flags and exclusion", async () => {
    const db = as(ADMIN);
    await assertSucceeds(updateDoc(doc(db, P("scoutEntries"), "edit-1"), ftcScoutEntryPatch(edit)));
    const snap = await assertSucceeds(getDoc(doc(db, P("scoutEntries"), "edit-1")));
    const [entry] = ftcDocsToScoutEntries([{ id: snap.id, data: snap.data() }]);
    expect(entry).toMatchObject({ excluded: true, manualFlags: [{ id: "mf-1", reason: "Duplicate entry", note: "twice" }], autoFlags: [{ ruleId: "r", dismissed: true }], teamId: T1, uid: SCOUT });
  });

  it("a scout's edit or delete of their own entry is refused", async () => {
    const db = as(SCOUT);
    await assertFails(updateDoc(doc(db, P("scoutEntries"), "edit-2"), ftcScoutEntryPatch(edit)));
    await assertFails(deleteDoc(doc(db, P("scoutEntries"), "edit-2")));
  });

  it("an admin of another team cannot touch it, and an admin can delete their own team's entry", async () => {
    await assertFails(deleteDoc(doc(as(OTHER), P("scoutEntries"), "edit-3")));
    await assertSucceeds(deleteDoc(doc(as(ADMIN), P("scoutEntries"), "edit-3")));
    // (the rules refuse a `get` of a missing doc, so check the team's list instead)
    const left = await assertSucceeds(getDocs(query(collection(as(ADMIN), P("scoutEntries")), where("teamId", "==", T1))));
    expect(left.docs.some((d) => d.id === "edit-3")).toBe(false);
  });
});

describe("reading the account's own data", () => {
  it("scout entries: the team's whole list, and one event's, never another team's", async () => {
    const db = as(SCOUT);
    const all = await assertSucceeds(getDocs(query(collection(db, P("scoutEntries")), where("teamId", "==", T1))));
    expect(ftcDocsToScoutEntries(all.docs.map((d) => ({ id: d.id, data: d.data() }))).every((e) => e.teamId === T1)).toBe(true);
    expect(all.docs.some((d) => d.id === "seed-1")).toBe(true);
    expect(all.docs.some((d) => d.id === "seed-2")).toBe(false);
    await assertSucceeds(getDocs(query(collection(db, P("scoutEntries")), where("teamId", "==", T1), where("eventCode", "==", "EV1"))));
    await assertSucceeds(getDocs(query(collection(db, P("scoutEntries")), where("teamId", "==", T1), where("eventCode", "==", "EV1"), where("matchType", "==", "Qualification"), where("matchNumber", "==", 1))));
    await assertSucceeds(getDocs(query(collection(db, P("scoutEntries")), where("teamId", "==", T1), where("sessionId", "==", "s1"))));
  });

  it("another team's entries are refused, and so is an unfiltered list", async () => {
    const db = as(SCOUT);
    await assertFails(getDocs(query(collection(db, P("scoutEntries")), where("teamId", "==", T2))));
    await assertFails(getDocs(collection(db, P("scoutEntries"))));
  });

  it("form entries: filtered by form type and event", async () => {
    const db = as(SCOUT);
    const snap = await assertSucceeds(getDocs(query(collection(db, P("formEntries")), where("teamId", "==", T1), where("formType", "==", "pit-scout"), where("eventCode", "==", "EV1"))));
    expect(ftcDocsToFormEntries(snap.docs.map((d) => ({ id: d.id, data: d.data() }))).map((e) => e.id)).toEqual(["fe-1"]);
    await assertFails(getDocs(query(collection(db, P("formEntries")), where("teamId", "==", T2))));
  });

  it("forms: the account's docs, and a published version by its path", async () => {
    const db = as(SCOUT);
    const docs = ftcDocsToFormDocs((await assertSucceeds(getDocs(query(collection(db, P("forms")), where("teamId", "==", T1))))).docs.map((d) => ({ id: d.id, data: d.data() })));
    expect(docs.get("biobuzz")).toMatchObject({ publishedVersion: 2, active: true });
    const v = await assertSucceeds(getDoc(doc(db, P("forms"), `${T1}_biobuzz`, "versions", "2")));
    expect(ftcDocToFormVersion(`${T1}_biobuzz`, v.data() ?? {})?.version).toBe(2);
    await assertFails(getDocs(query(collection(db, P("forms")), where("teamId", "==", T2))));
  });

  it("the team doc is read by id (and lists as several teams); teams cannot be listed", async () => {
    const db = as(SCOUT);
    const snap = await assertSucceeds(getDoc(doc(db, P("teams"), T1)));
    const team = ftcTeamToTeamDoc(snap.id, snap.data() ?? {});
    expect(team).toMatchObject({ number: 1111, name: "Alpha", joinCode: "J1", activeEventCode: "EV1" });
    expect(team.accountTeams?.map((t) => t.number)).toEqual([1111, 2222]);
    expect(team.activeEvent?.name).toBe("Event One");
    await assertFails(getDoc(doc(db, P("teams"), T2)));
    await assertFails(getDocs(collection(db, P("teams"))));
  });

  it("the profile and the roster: own profile by id, the team's members by team", async () => {
    const db = as(SCOUT);
    const me = await assertSucceeds(getDoc(doc(db, P("users"), SCOUT)));
    expect(ftcUserToProfile(me.id, me.data() ?? {})).toMatchObject({ name: "Ada", teamId: T1, primaryRole: "match-scout", isAdmin: false });
    const members = await assertSucceeds(getDocs(query(collection(db, P("users")), where("teamId", "==", T1))));
    const rows = members.docs.map((d) => ftcUserToMember(d.id, d.data()));
    expect(rows.map((m) => m.name).sort()).toEqual(["Ada", "Admin", "Grace", "Pia"]);
    await assertFails(getDocs(query(collection(db, P("users")), where("teamId", "==", T2))));
  });

  it("the page-access settings of the account are readable by a member", async () => {
    await assertSucceeds(getDoc(doc(as(SCOUT), P("teams"), T1, "settings", "pageAccess")));
    await assertFails(getDoc(doc(as(OTHER), P("teams"), T1, "settings", "pageAccess")));
  });
});

// Last: these change the shared team doc that the reads above check.
describe("setting the active events", () => {
  const ev = (code: string, season: number) => readStoredEvent({ code, season, name: code, dateStart: "2026-01-10", dateEnd: "2026-01-11", city: null, stateProv: null, country: null, venue: null, website: null, timezone: null, status: "upcoming" })!;
  const selection = { events: [ev("EVA", 2026), ev("EVB", 2026)], primaryCode: "EVB" };

  it("an admin's selection is accepted and reads back, primary first, as the scout page and the event page read it", async () => {
    await assertSucceeds(updateDoc(doc(as(ADMIN), P("teams"), T1), ftcActiveEventsFields(selection)));
    const snap = await assertSucceeds(getDoc(doc(as(SCOUT), P("teams"), T1)));
    const team = ftcTeamToTeamDoc(snap.id, snap.data() ?? {});
    expect(team.activeEventCode).toBe("EVB");
    expect(team.activeEventCodes).toEqual(["EVB", "EVA"]);
    expect(team.activeEvents?.map((e) => e.code)).toEqual(["EVB", "EVA"]);
    expect(team.activeSeasonId).toBe(2026);
    // the account's teams are untouched by it
    expect(team.accountTeams?.map((t) => t.number)).toEqual([1111, 2222]);
  });

  it("clearing the selection is accepted", async () => {
    await assertSucceeds(updateDoc(doc(as(ADMIN), P("teams"), T1), ftcActiveEventsFields({ events: [], primaryCode: null })));
  });

  it("a scout's change is refused, and so is a selection whose primary is not first", async () => {
    await assertFails(updateDoc(doc(as(SCOUT), P("teams"), T1), ftcActiveEventsFields(selection)));
    const fields = ftcActiveEventsFields(selection);
    await assertFails(updateDoc(doc(as(ADMIN), P("teams"), T1), { ...fields, activeEventCodes: ["EVA", "EVB"] }));
  });

  it("another team's admin cannot change it", async () => {
    await assertFails(updateDoc(doc(as(OTHER), P("teams"), T1), ftcActiveEventsFields(selection)));
  });
});

// Last: these add form entries that the reads above would otherwise count.
describe("form entries: saving, editing your own, admin edit and delete", () => {
  const pit: NewFormEntry = { scoutName: "Pia", formId: "pit-scout-v1", formVersion: 1, formType: "pit-scout", eventCode: "EV1", teamNumber: 4242, values: { drivetrain: "mecanum" }, stickyNotes: [] };
  const save = (uid: string, teamId: string, input: NewFormEntry) => addDoc(collection(as(uid), P("formEntries")), formEntryDoc(teamId, uid, input, serverTimestamp));

  it("a pit scout's pit entry is accepted and reads back as the entry that was saved", async () => {
    const ref = await assertSucceeds(save(PIT, T1, pit));
    const snap = await assertSucceeds(getDoc(doc(as(SCOUT), P("formEntries"), ref.id)));
    const [entry] = ftcDocsToFormEntries([{ id: snap.id, data: snap.data() }]);
    expect(entry).toMatchObject({ teamId: T1, uid: PIT, formId: "pit-scout-v1", formType: "pit-scout", teamNumber: 4242, values: { drivetrain: "mecanum" }, excluded: false });
    expect(entry.createdAtMs).toBeGreaterThan(0);
  });

  it("the page defaults gate the form types by role: a match scout cannot save a pit entry, but can save a custom form's", async () => {
    await assertFails(save(SCOUT, T1, pit));
    await assertSucceeds(save(SCOUT, T1, { ...pit, formId: "my-form", formType: "custom" }));
  });

  it("an entry is refused for another team, or as someone else", async () => {
    await assertFails(save(PIT, T2, pit));
    await assertFails(addDoc(collection(as(PIT), P("formEntries")), formEntryDoc(T1, SCOUT, pit, serverTimestamp)));
  });

  it("the writer edits their own entry (values and notes) and the audit entry is accepted in the same batch; changing anything else is refused", async () => {
    const db = as(PIT);
    const ref = await assertSucceeds(save(PIT, T1, pit));
    const entry = { id: ref.id, formId: pit.formId, eventCode: pit.eventCode, teamNumber: 4242, values: pit.values, stickyNotes: [] };
    const next = { values: { drivetrain: "swerve" }, stickyNotes: [{ id: "n1", text: "tidy", color: "green", createdAt: 1 }] };
    const batch = writeBatch(db);
    batch.update(doc(db, P("formEntries"), ref.id), { ...next, updatedAt: serverTimestamp() });
    batch.set(doc(collection(db, P("auditLog"))), buildAuditEntry(T1, PIT, "Pia", "edit-form-entry", { entryId: ref.id }, { values: entry.values }, { values: next.values, changedKeys: diffEntryValues(entry.values, next.values) }));
    await assertSucceeds(batch.commit());
    const snap = await assertSucceeds(getDoc(doc(db, P("formEntries"), ref.id)));
    expect(snap.data()?.values).toEqual({ drivetrain: "swerve" });
    await assertFails(updateDoc(doc(db, P("formEntries"), ref.id), { excluded: true, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(as(SCOUT), P("formEntries"), ref.id), { ...next, updatedAt: serverTimestamp() }));
  });

  it("an admin excludes, flags and fixes an entry, and deletes it; a scout cannot delete", async () => {
    const ref = await assertSucceeds(save(PIT, T1, pit));
    await assertSucceeds(updateDoc(doc(as(ADMIN), P("formEntries"), ref.id), { excluded: true, flags: [{ id: "f1", reason: "Other", addedAt: "t" }], updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(doc(as(PIT), P("formEntries"), ref.id)));
    await assertSucceeds(deleteDoc(doc(as(ADMIN), P("formEntries"), ref.id)));
  });
});

describe("the team's people: roles and attendance", () => {
  const LEAD = "ftc-lead-1";
  const changes = { primaryRole: "lead-scout", secondaryRoles: ["pit-scout"], isAdmin: false };
  const roleBatch = (uid: string, target: string, patch: Record<string, unknown>) => {
    const db = as(uid);
    const batch = writeBatch(db);
    batch.update(doc(db, P("users"), target), patch);
    batch.set(doc(collection(db, P("auditLog"))), buildAuditEntry(T1, uid, "n", "edit-member-roles", { targetUid: target }, {}, patch));
    return batch.commit();
  };

  it("an admin changes a member's roles with the audit entry in the same batch, and it reads back as that member", async () => {
    await assertSucceeds(roleBatch(ADMIN, SCOUT, changes));
    const snap = await assertSucceeds(getDoc(doc(as(ADMIN), P("users"), SCOUT)));
    expect(ftcUserToMember(snap.id, snap.data() ?? {})).toMatchObject({ uid: SCOUT, primaryRole: "lead-scout", secondaryRoles: ["pit-scout"], isAdmin: false });
  });

  it("a member cannot change roles, an admin of another team cannot, and nobody removes their own admin flag", async () => {
    await assertFails(roleBatch(PIT, PIT, { primaryRole: "lead-scout", secondaryRoles: [], isAdmin: true }));
    await assertFails(roleBatch(OTHER, SCOUT, changes));
    await assertFails(roleBatch(ADMIN, ADMIN, { isAdmin: false }));
  });

  it("a lead scout records attendance (the Assignments page's default) and it reads back; a match scout cannot", async () => {
    const id = ftcAttendanceDocId(T1, "EV1");
    await assertSucceeds(setDoc(doc(as(LEAD), P("eventAttendance"), id), ftcAttendanceDoc(T1, "EV1", [SCOUT, PIT, SCOUT], serverTimestamp)));
    const snap = await assertSucceeds(getDocs(query(collection(as(PIT), P("eventAttendance")), where("teamId", "==", T1))));
    expect(ftcDocsToAttendance(snap.docs.map((d) => ({ id: d.id, data: d.data() })))).toMatchObject([{ id, teamId: T1, eventCode: "EV1", uids: [SCOUT, PIT] }]);
    await assertFails(setDoc(doc(as(PIT), P("eventAttendance"), ftcAttendanceDocId(T1, "EV2")), ftcAttendanceDoc(T1, "EV2", [PIT], serverTimestamp)));
    await assertFails(getDocs(query(collection(as(PIT), P("eventAttendance")), where("teamId", "==", T2))));
  });
});

describe("the shared pick list", () => {
  const LEAD = "ftc-lead-1";
  const ctx = { teamId: T1, eventCode: "EV1", uid: LEAD, name: "Grace" };
  const id = ftcPickListId(T1, "EV1");
  // the same transaction as the app's editPickList (data/ftc/write.ts), run as a given person
  const edit = (uid: string, teamId: string, op: PickOp) => {
    const db = as(uid);
    return runTransaction(db, async (tx) => {
      const ref = doc(db, P("pickLists"), ftcPickListId(teamId, "EV1"));
      const snap = await tx.get(ref);
      const after = applyPickOp(sanitizePicks(snap.exists() ? snap.data().picked : []), op);
      tx.set(ref, ftcPickListDoc({ ...ctx, teamId, uid }, after, serverTimestamp));
      tx.set(doc(collection(db, P("auditLog"))), buildAuditEntry(teamId, uid, "n", "edit-pick-list", { eventCode: "EV1", op: op.type }, {}, { picked: after }));
    });
  };

  it("a lead scout (an editor role) builds the list, with its audit entry, and any teammate reads it back", async () => {
    await assertSucceeds(edit(LEAD, T1, { type: "place", team: 254, before: null }));
    await assertSucceeds(edit(LEAD, T1, { type: "place", team: 1678, before: 254 }));
    const snap = await assertSucceeds(getDoc(doc(as(PIT), P("pickLists"), id)));
    expect(ftcDocToPickList(snap.data() ?? {})).toMatchObject({ teamId: T1, eventCode: "EV1", picked: [1678, 254], updatedBy: LEAD, updatedByName: "Grace" });
  });

  it("a member without an editor role cannot edit, and nobody reads or writes another team's list", async () => {
    await assertFails(edit(PIT, T1, { type: "place", team: 971, before: null }));
    await assertFails(getDoc(doc(as(OTHER), P("pickLists"), id)));
    await assertFails(edit(LEAD, T2, { type: "place", team: 971, before: null }));
  });

  it("an admin edits too", async () => {
    await assertSucceeds(edit(ADMIN, T1, { type: "remove", team: 254 }));
  });
});

describe("your own profile", () => {
  it("changing your name, theme and avatar is accepted and reads back as that profile; roles, team and admin are not yours to change", async () => {
    const db = as(PIT);
    await assertSucceeds(updateDoc(doc(db, P("users"), PIT), ftcProfilePatch({ name: "Pia R.", themeId: "team", colorMode: "dark", gradientIntensity: "subtle", avatar: { type: "preset", value: "owl" } })));
    const snap = await assertSucceeds(getDoc(doc(db, P("users"), PIT)));
    expect(ftcUserToProfile(snap.id, snap.data() ?? {})).toMatchObject({ name: "Pia R.", themeId: "team", colorMode: "dark", gradientIntensity: "subtle", primaryRole: "pit-scout", isAdmin: false });
    await assertFails(updateDoc(doc(db, P("users"), PIT), { primaryRole: "lead-scout" }));
    await assertFails(updateDoc(doc(db, P("users"), PIT), { isAdmin: true }));
    await assertFails(updateDoc(doc(as(SCOUT), P("users"), PIT), { name: "Not Pia" }));
  });

  it("saving the profile page writes the profile doc and mirrors the avatar in one batch; nobody writes another member's profile", async () => {
    const db = as(PIT);
    const batch = writeBatch(db);
    batch.set(doc(db, P("profiles"), PIT), { teamId: T1, displayName: "Pia", bio: "Pit crew", pronouns: "", avatar: { type: "initials", value: "" }, visibility: "public", updatedAt: serverTimestamp() });
    batch.update(doc(db, P("users"), PIT), { avatar: { type: "initials", value: "" } });
    await assertSucceeds(batch.commit());
    await assertFails(setDoc(doc(as(SCOUT), P("profiles"), PIT), { teamId: T1, displayName: "x", bio: "", pronouns: "", avatar: { type: "initials", value: "" }, visibility: "public", updatedAt: serverTimestamp() }));
  });
});

describe("assignments (match scouting, pit scouting and team strategy)", () => {
  const LEAD = "ftc-lead-1";
  const stored = {
    generatedBy: LEAD,
    generatedAt: "2026-01-10T10:00:00.000Z",
    settings: { matchSource: "event", scoutUids: [PIT], seed: 1 },
    slots: [
      { matchType: "Qualification", matchNumber: 1, slot: "red1", teamNumber: 100, scoutUid: PIT },
      { matchType: "Qualification", matchNumber: 1, slot: "red2", teamNumber: 200, scoutUid: null },
    ],
    counts: { [PIT]: 1 },
    fair: true,
    warning: null,
  };
  const version = readAssignmentVersion(stored)!;
  const matchId = ftcAssignmentDocId(T1, "EV1");
  const rows = (snap: { docs: { id: string; data: () => unknown }[] }) => snap.docs.map((d) => ({ id: d.id, data: d.data() }));
  const teamQuery = (uid: string, teamId: string) => getDocs(query(collection(as(uid), P("assignments")), where("teamId", "==", teamId), where("eventCode", "==", "EV1")));

  it("a lead scout (the Assignments page default) publishes the event schedule, and a teammate reads it back by a team and event query", async () => {
    await assertSucceeds(setDoc(doc(as(LEAD), P("assignments"), matchId), ftcAssignmentsDoc(T1, "EV1", version, null, serverTimestamp)));
    const snap = await assertSucceeds(teamQuery(PIT, T1));
    const found = pickMatchAssignments(T1, "EV1", rows(snap));
    expect(found?.current?.slots).toHaveLength(2);
    expect(found?.current?.slots[0]).toMatchObject({ slot: "red1", teamNumber: 100, scoutUid: PIT });
  });

  it("a slot edit is accepted for a lead scout and reads back recounted", async () => {
    const swapped = applySlotSwap(version, "Qualification", 1, "red2", PIT)!;
    await assertSucceeds(updateDoc(doc(as(LEAD), P("assignments"), matchId), { current: swapped, previous: version, updatedAt: serverTimestamp() }));
    const found = pickMatchAssignments(T1, "EV1", rows(await assertSucceeds(teamQuery(LEAD, T1))));
    expect(found?.current?.counts).toEqual({ [PIT]: 2 });
    expect(found?.previous?.counts).toEqual({ [PIT]: 1 });
  });

  it("a pit doc is accepted under its own id, refused under another, and listed by the team query", async () => {
    const pit = { generatedBy: LEAD, generatedAt: "t", settings: {}, teams: [{ teamNumber: 55, scoutUids: [PIT], locked: false }], counts: { [PIT]: 1 }, uneven: false, warning: null };
    const id = ftcTeamAssignmentDocId(T1, "EV1", "pit");
    await assertSucceeds(setDoc(doc(as(LEAD), P("assignments"), id), ftcTeamAssignmentsDoc(T1, "EV1", "pit", pit as never, null, serverTimestamp)));
    await assertFails(setDoc(doc(as(LEAD), P("assignments"), `${id}_x`), ftcTeamAssignmentsDoc(T1, "EV1", "pit", pit as never, null, serverTimestamp)));
    const snap = await assertSucceeds(getDocs(query(collection(as(PIT), P("assignments")), where("teamId", "==", T1))));
    expect(ftcDocsToTeamAssignments(rows(snap)).map((d) => [d.id, d.kind])).toEqual([[id, "pit"]]);
  });

  it("a pit scout (no Assignments page) cannot publish, and another team cannot read", async () => {
    await assertFails(setDoc(doc(as(PIT), P("assignments"), matchId), ftcAssignmentsDoc(T1, "EV1", version, null, serverTimestamp)));
    await assertFails(teamQuery(OTHER, T1));
  });
});
