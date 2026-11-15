import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { addDoc, collection, deleteDoc, deleteField, doc, getDoc, getDocs, limit, query, runTransaction, serverTimestamp, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";
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
import { ftcJoinRequestDoc, ftcNewTeamDocs } from "@/data/ftc/enrollment";
import { ftcApprovedProfileDoc, ftcJoinDecisionFields } from "@/data/ftc/join-request-docs";
import { programPath } from "@/lib/firebase/paths";
import { ftcMatchId, planScheduleImport } from "@/lib/ftc/library";
import { buildManualMatchDoc } from "@/lib/library/schedule";
import { tryClaimDoc } from "@/lib/claim-doc";
import { ftcSessionStub } from "@/lib/ftc/practice";
import type { EventMatch } from "@/lib/events/types";
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

describe("FTC practice sessions and official scores (Batch 3)", () => {
  const ADMIN_B3 = "ftc-admin-b3";
  // a second plain member of team 1 that other tests already seed (a new user here would change the roster other tests count)
  const SCOUT2 = "ftc-lead-1";
  const S = (name: string) => programPath("ftc", name);
  const sessions = (uid: string) => collection(as(uid), S("practiceSessions"));
  const sessionDoc = (uid: string, id: string) => doc(as(uid), S("practiceSessions"), id);
  const ids = (snap: { docs: { id: string }[] }) => snap.docs.map((d) => d.id).sort();
  const anon = () => testEnv.unauthenticatedContext().firestore();
  const stored = (uid: string, teamId: string, extra: Record<string, unknown> = {}) => ({
    teamId, uid, kind: "solo", status: "in-progress", scoutName: "x", seasonId: "biobuzz", mode: "trial", difficulty: null, libraryMatchId: "EVB3_Q1", eventCode: "EVB3", alliance: "red",
    robots: [111, 222], completedRobots: [], entryIds: [], accuracy: null, scoutedTotal: null, penaltyPoints: null, officialScore: null, platform: "pc", flags: [], excluded: false,
    lobbyId: null, pairId: null, startedAt: "2026-02-01T10:00:00.000Z", finishedAt: null, ...extra,
  });

  beforeAll(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, P("users"), ADMIN_B3), { name: "Admin B3", email: "b3@example.org", teamId: T2, primaryRole: "team-coach", secondaryRoles: [], isAdmin: true, isOwner: false });
      await setDoc(doc(db, S("practiceSessions"), "PS-OWN-OPEN"), stored(SCOUT, T1));
      await setDoc(doc(db, S("practiceSessions"), "PS-OWN-PAUSED"), stored(SCOUT, T1, { status: "paused", completedRobots: [111] }));
      await setDoc(doc(db, S("practiceSessions"), "PS-OWN-DONE"), stored(SCOUT, T1, { status: "completed", accuracy: 90, scoutedTotal: 60, officialScore: 66, penaltyPoints: 6, finishedAt: "2026-02-01T10:10:00.000Z" }));
      await setDoc(doc(db, S("practiceSessions"), "PS-MATE-OPEN"), stored(SCOUT2, T1));
      await setDoc(doc(db, S("practiceSessions"), "PS-T2-OPEN"), stored(OTHER, T2));
      // a library: one shared API event and one hand-made event of team 1, each with one match
      const event = (code: string, origin: string, teamId?: string) => ({ eventCode: code, eventName: code, seasonId: "b3season", origin, date: null, sourceUrl: null, defaultVideoUrl: null, createdBy: "seed", ...(teamId ? { teamId } : {}) });
      const lib = (code: string, origin: string, teamId?: string) => ({ seasonId: "b3season", eventCode: code, eventName: code, matchType: "Qualification", matchNumber: 1, alliances: { red: { teams: [111, 222] }, blue: { teams: [333, 444] } }, scheduledTime: null, origin, published: true, createdBy: "seed", updatedAt: "2026-01-01T00:00:00.000Z", ...(teamId ? { teamId } : {}) });
      await setDoc(doc(db, S("libraryEvents"), "SCRAPI"), event("SCRAPI", "api"));
      await setDoc(doc(db, S("libraryMatches"), "SCRAPI_Q1"), lib("SCRAPI", "api"));
      await setDoc(doc(db, S("libraryEvents"), "MAN-SCR-CCCC"), event("MAN-SCR-CCCC", "manual", T1));
      await setDoc(doc(db, S("libraryMatches"), "MAN-SCR-CCCC_Q1"), lib("MAN-SCR-CCCC", "manual", T1));
    });
  });

  it("a plain scout runs every practice query the app makes, for their own team", async () => {
    // the team's sessions, team-wide (never narrowed by event or kind)
    expect(ids(await assertSucceeds(getDocs(query(sessions(SCOUT), where("teamId", "==", T1)))))).toEqual(["PS-MATE-OPEN", "PS-OWN-DONE", "PS-OWN-OPEN", "PS-OWN-PAUSED"]);
    // a scout's own sessions
    expect(ids(await assertSucceeds(getDocs(query(sessions(SCOUT), where("teamId", "==", T1), where("uid", "==", SCOUT)))))).toEqual(["PS-OWN-DONE", "PS-OWN-OPEN", "PS-OWN-PAUSED"]);
    // their paused session
    expect(ids(await assertSucceeds(getDocs(query(sessions(SCOUT), where("teamId", "==", T1), where("uid", "==", SCOUT), where("status", "==", "paused")))))).toEqual(["PS-OWN-PAUSED"]);
    // one session by id, theirs and a teammate's
    await assertSucceeds(getDoc(sessionDoc(SCOUT, "PS-OWN-DONE")));
    await assertSucceeds(getDoc(sessionDoc(SCOUT, "PS-MATE-OPEN")));
    // the completed-attempt check: five equalities, limit 1
    const attempt = await assertSucceeds(
      getDocs(query(sessions(SCOUT), where("teamId", "==", T1), where("uid", "==", SCOUT), where("libraryMatchId", "==", "EVB3_Q1"), where("alliance", "==", "red"), where("status", "==", "completed"), limit(1)))
    );
    expect(ids(attempt)).toEqual(["PS-OWN-DONE"]);
    // the entries of one session (both robots), found by the session id
    await assertSucceeds(getDocs(query(collection(as(SCOUT), S("scoutEntries")), where("teamId", "==", T1), where("sessionId", "==", "PS-OWN-DONE"))));
    // the published library matches a practice flow lists: the shared ones and the team's own, each with published == true
    await assertSucceeds(getDocs(query(collection(as(SCOUT), S("libraryMatches")), where("seasonId", "==", "b3season"), where("published", "==", true), where("origin", "==", "api"))));
    await assertSucceeds(getDocs(query(collection(as(SCOUT), S("libraryMatches")), where("seasonId", "==", "b3season"), where("published", "==", true), where("teamId", "==", T1))));
  });

  it("a team admin runs the same queries", async () => {
    expect((await assertSucceeds(getDocs(query(sessions(ADMIN), where("teamId", "==", T1))))).size).toBe(4);
    await assertSucceeds(getDocs(query(sessions(ADMIN), where("teamId", "==", T1), where("uid", "==", SCOUT), where("status", "==", "paused"))));
    await assertSucceeds(getDoc(sessionDoc(ADMIN, "PS-OWN-OPEN")));
  });

  it("a scout of another team cannot read, list or change this team's sessions, nor the entries of one", async () => {
    await assertFails(getDocs(query(sessions(OTHER), where("teamId", "==", T1))));
    await assertFails(getDocs(query(sessions(OTHER), where("teamId", "==", T1), where("uid", "==", SCOUT), where("status", "==", "paused"))));
    await assertFails(getDocs(sessions(OTHER)));
    await assertFails(getDoc(sessionDoc(OTHER, "PS-OWN-DONE")));
    await assertFails(updateDoc(sessionDoc(OTHER, "PS-OWN-OPEN"), { excluded: true }));
    await assertFails(deleteDoc(sessionDoc(OTHER, "PS-OWN-OPEN")));
    await assertFails(setDoc(sessionDoc(OTHER, "PS-FOR-T1"), stored(OTHER, T1)));
    await assertFails(getDocs(query(collection(as(OTHER), S("scoutEntries")), where("teamId", "==", T1), where("sessionId", "==", "PS-OWN-DONE"))));
    // their own team is theirs
    await assertSucceeds(getDocs(query(sessions(OTHER), where("teamId", "==", T2))));
  });

  it("a signed-out user cannot read or write any session or library match", async () => {
    await assertFails(getDocs(query(collection(anon(), S("practiceSessions")), where("teamId", "==", T1))));
    await assertFails(getDoc(doc(anon(), S("practiceSessions"), "PS-OWN-DONE")));
    await assertFails(setDoc(doc(anon(), S("practiceSessions"), "PS-ANON"), stored(SCOUT, T1)));
    await assertFails(getDocs(query(collection(anon(), S("libraryMatches")), where("published", "==", true), where("origin", "==", "api"))));
  });

  it("a scout writes only their own sessions: create as themselves, change their own while open or paused, never another's", async () => {
    await assertSucceeds(setDoc(sessionDoc(SCOUT, "PS-NEW-MINE"), stored(SCOUT, T1)));
    await assertFails(setDoc(sessionDoc(SCOUT, "PS-NEW-AS-MATE"), stored(SCOUT2, T1))); // uid must be the signer
    await assertFails(setDoc(sessionDoc(SCOUT, "PS-NEW-OTHER-TEAM"), stored(SCOUT, T2))); // and the signer's own team
    await assertSucceeds(updateDoc(sessionDoc(SCOUT, "PS-OWN-OPEN"), { status: "paused", completedRobots: [111] }));
    await assertSucceeds(updateDoc(sessionDoc(SCOUT, "PS-OWN-OPEN"), { status: "in-progress" }));
    await assertSucceeds(updateDoc(sessionDoc(SCOUT, "PS-OWN-OPEN"), { status: "completed", accuracy: 80, scoutedTotal: 50, officialScore: 62, penaltyPoints: 4, finishedAt: "2026-02-01T11:00:00.000Z" }));
    await assertFails(updateDoc(sessionDoc(SCOUT, "PS-OWN-OPEN"), { accuracy: 100 })); // completed: no more edits by the scout
    await assertFails(updateDoc(sessionDoc(SCOUT, "PS-MATE-OPEN"), { status: "paused" })); // a teammate's
  });

  it("an update never moves a session to another team or another scout (the rule fixed in this batch)", async () => {
    await assertFails(updateDoc(sessionDoc(SCOUT, "PS-OWN-PAUSED"), { teamId: T2 }));
    await assertFails(updateDoc(sessionDoc(SCOUT, "PS-OWN-PAUSED"), { uid: SCOUT2 }));
    await assertFails(updateDoc(sessionDoc(ADMIN, "PS-OWN-PAUSED"), { teamId: T2 }));
    await assertFails(updateDoc(sessionDoc(ADMIN, "PS-OWN-PAUSED"), { uid: ADMIN }));
    await assertSucceeds(updateDoc(sessionDoc(SCOUT, "PS-OWN-PAUSED"), { completedRobots: [111] })); // the same document still updates normally
  });

  it("an admin can exclude a completed session and dismiss a flag; a plain scout cannot touch a completed one", async () => {
    await assertSucceeds(updateDoc(sessionDoc(ADMIN, "PS-OWN-DONE"), { excluded: true, flags: [{ type: "zero-entries", title: "Zero Entries", detail: "d", dismissed: true }] }));
    await assertFails(updateDoc(sessionDoc(SCOUT, "PS-OWN-DONE"), { excluded: false }));
    await assertFails(updateDoc(sessionDoc(SCOUT2, "PS-OWN-DONE"), { excluded: false }));
  });

  it("a scout deletes their own open or paused session, never a completed one; an admin deletes a completed one", async () => {
    await assertSucceeds(setDoc(sessionDoc(SCOUT, "PS-TO-DISCARD"), stored(SCOUT, T1)));
    await assertSucceeds(deleteDoc(sessionDoc(SCOUT, "PS-TO-DISCARD")));
    await assertFails(deleteDoc(sessionDoc(SCOUT, "PS-OWN-DONE")));
    await assertFails(deleteDoc(sessionDoc(SCOUT2, "PS-OWN-PAUSED")));
    await assertSucceeds(setDoc(doc(testEnv.authenticatedContext(ADMIN).firestore(), S("practiceSessions"), "PS-ADMIN-DEL"), stored(ADMIN, T1, { status: "completed" })));
    await assertSucceeds(deleteDoc(sessionDoc(ADMIN, "PS-ADMIN-DEL")));
  });

  it("starting a session reserves its id in a transaction that first reads the free id (as the app does)", async () => {
    const claim = (uid: string, id: string) => tryClaimDoc(as(uid) as unknown as Parameters<typeof tryClaimDoc>[0], S("practiceSessions"), id, ftcSessionStub(T1, uid, "solo", serverTimestamp));
    await assertSucceeds(claim(SCOUT, "PS-CLAIM-1"));
    // a second claim of the same id finds it taken (returns false) instead of overwriting it
    expect(await claim(SCOUT, "PS-CLAIM-1")).toBe(false);
    // another team's scout cannot take over a team-1 session id: reading it is refused
    await assertFails(tryClaimDoc(as(OTHER) as unknown as Parameters<typeof tryClaimDoc>[0], S("practiceSessions"), "PS-CLAIM-1", ftcSessionStub(T2, OTHER, "solo", serverTimestamp)));
  });

  describe("official scores on a library match", () => {
    const now = "2026-02-02T10:00:00.000Z";
    const scores = (red: unknown, blue: unknown) => ({ "alliances.red.score": red, "alliances.red.penaltyPoints": 4, "alliances.blue.score": blue, "alliances.blue.penaltyPoints": 0, scoresUpdatedAt: now, updatedAt: now });
    const match = (uid: string, id: string) => doc(as(uid), S("libraryMatches"), id);

    it("an admin sets and clears the official score of a shared API match and of their own team's hand-made match", async () => {
      await assertSucceeds(updateDoc(match(ADMIN, "SCRAPI_Q1"), scores(60, 55)));
      await assertSucceeds(updateDoc(match(ADMIN, "MAN-SCR-CCCC_Q1"), scores(60, 55)));
      const read = await assertSucceeds(getDoc(match(SCOUT, "MAN-SCR-CCCC_Q1")));
      expect(read.data()?.alliances.red).toEqual({ teams: [111, 222], score: 60, penaltyPoints: 4 });
      await assertSucceeds(updateDoc(match(ADMIN, "MAN-SCR-CCCC_Q1"), { "alliances.red.score": deleteField(), "alliances.red.penaltyPoints": deleteField(), "alliances.blue.score": deleteField(), "alliances.blue.penaltyPoints": deleteField(), scoresUpdatedAt: deleteField(), updatedAt: now }));
    });

    it("a plain scout cannot set a score; another team's admin cannot score this team's hand-made match", async () => {
      await assertFails(updateDoc(match(SCOUT, "SCRAPI_Q1"), scores(1, 1)));
      await assertFails(updateDoc(match(SCOUT, "MAN-SCR-CCCC_Q1"), scores(1, 1)));
      await assertFails(updateDoc(match(ADMIN_B3, "MAN-SCR-CCCC_Q1"), scores(1, 1)));
    });

    it("a hand-made match refuses a score that is not a whole number from 0 to 9999", async () => {
      await assertFails(updateDoc(match(ADMIN, "MAN-SCR-CCCC_Q1"), scores(-1, 5)));
      await assertFails(updateDoc(match(ADMIN, "MAN-SCR-CCCC_Q1"), scores("60", 5)));
      await assertFails(updateDoc(match(ADMIN, "MAN-SCR-CCCC_Q1"), scores(10000, 5)));
      await assertFails(updateDoc(match(ADMIN, "MAN-SCR-CCCC_Q1"), scores(12.5, 5)));
    });
  });
});

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

describe("credits", () => {
  const sections = [{ id: "s1", title: "Tools", entries: [{ id: "e1", name: "Firebase", url: "https://firebase.google.com" }] }];
  // the shape lib/credits/store.ts writes: the credits doc and its audit entry in one transaction
  const edit = (uid: string, teamId: string) => {
    const db = as(uid);
    return runTransaction(db, async (tx) => {
      tx.set(doc(db, P("credits"), teamId), { teamId, sections, updatedBy: uid, updatedByName: "n", updatedAt: serverTimestamp() });
      tx.set(doc(collection(db, P("auditLog"))), buildAuditEntry(teamId, uid, "n", "edit-credits", { op: "add" }, null, null));
    });
  };

  it("an admin saves the team's credits and every teammate reads them by id, even before any are saved", async () => {
    await assertSucceeds(getDoc(doc(as(PIT), P("credits"), T1)));
    await assertSucceeds(edit(ADMIN, T1));
    const snap = await assertSucceeds(getDoc(doc(as(PIT), P("credits"), T1)));
    expect(snap.data()?.sections).toHaveLength(1);
  });

  it("a non-admin cannot edit, nobody edits another team's, and another team cannot read", async () => {
    await assertFails(edit(PIT, T1));
    await assertFails(edit(ADMIN, T2));
    await assertFails(getDoc(doc(as(OTHER), P("credits"), T1)));
  });
});

describe("starting or joining a team (enrollment)", () => {
  const NEWBIE = "ftc-newbie-1";
  const newTeam = (uid: string, code: string, over: Partial<{ teamNumber: number; teamName: string }> = {}) =>
    ftcNewTeamDocs(code, { uid, email: `${uid}@example.org`, name: "Sam", teamNumber: 4242, teamName: "Robo Owls", location: "Austin", ...over }, serverTimestamp());
  const createBatch = (uid: string, code: string, mutate?: (docs: ReturnType<typeof newTeam>) => void) => {
    const db = as(uid);
    const docs = newTeam(uid, code);
    mutate?.(docs);
    const batch = writeBatch(db);
    batch.set(doc(db, P("teams"), code), docs.team);
    batch.set(doc(db, P("users"), uid), docs.user);
    return batch.commit();
  };

  it("a signed-in user creates a team and their own profile as its admin and owner", async () => {
    await assertSucceeds(createBatch(NEWBIE, "NEWTEAM2"));
    const db = as(NEWBIE);
    const profile = await assertSucceeds(getDoc(doc(db, P("users"), NEWBIE)));
    expect(profile.data()).toMatchObject({ teamId: "NEWTEAM2", isAdmin: true, isOwner: true });
    const team = await assertSucceeds(getDoc(doc(db, P("teams"), "NEWTEAM2")));
    expect(team.data()).toMatchObject({ ownerUid: NEWBIE, joinCode: "NEWTEAM2", number: 4242 });
  });

  it("refuses a profile on an existing team, so nobody can make themselves admin of someone else's team", async () => {
    const db = as("ftc-intruder-1");
    const docs = newTeam("ftc-intruder-1", T1);
    await assertFails(setDoc(doc(db, P("users"), "ftc-intruder-1"), docs.user));
    // even in one batch with an overwrite of the team doc (an update, owned by someone else)
    const batch = writeBatch(db);
    batch.set(doc(db, P("teams"), T1), docs.team);
    batch.set(doc(db, P("users"), "ftc-intruder-1"), docs.user);
    await assertFails(batch.commit());
  });

  it("refuses a team that names someone else as owner, a team without the caller's profile, and a profile for someone else", async () => {
    await assertFails(createBatch("ftc-c1", "OWNERCHK", (d) => { d.team.ownerUid = "someone-else"; }));
    const db = as("ftc-c2");
    await assertFails(setDoc(doc(db, P("teams"), "LONETEAM"), newTeam("ftc-c2", "LONETEAM").team));
    await assertFails(createBatch("ftc-c3", "FORGEDAD", (d) => { d.user.isOwner = false; d.user.isAdmin = false; d.user.primaryRole = "not-a-role"; }));
    const db4 = as("ftc-c4");
    const docs = newTeam("ftc-c4", "OTHERUSR");
    const batch = writeBatch(db4);
    batch.set(doc(db4, P("teams"), "OTHERUSR"), docs.team);
    batch.set(doc(db4, P("users"), "ftc-victim"), { ...docs.user });
    await assertFails(batch.commit());
  });

  it("refuses a team id that is not a random join code (a team number, a short or lower-case id) or that differs from joinCode", async () => {
    await assertFails(createBatch("ftc-d1", "4242"));
    await assertFails(createBatch("ftc-d2", "abcd2345"));
    await assertFails(createBatch("ftc-d3", "ABCD234"));
    await assertFails(createBatch("ftc-d4", "ABCD2346", (d) => { d.team.joinCode = "ZZZZ9999"; }));
  });

  it("refuses extra fields and bad shapes in the team and the profile", async () => {
    await assertFails(createBatch("ftc-e1", "EXTRAFLD", (d) => { d.team.accountName = "x"; d.team.platformFlag = true; }));
    await assertFails(createBatch("ftc-e2", "EXTRAUSR", (d) => { d.user.isPlatformOwner = true; }));
    await assertFails(createBatch("ftc-e3", "TWOTEAMS", (d) => { d.team.fieldTeams = [...(d.team.fieldTeams as unknown[]), { id: "ft-1", number: 1, name: "" }]; d.team.fieldTeamIdList = ["ft-4242", "ft-1"]; }));
    await assertFails(createBatch("ftc-e4", "NOMEMBER", (d) => { d.user.fieldTeamIds = ["ft-1"]; }));
  });

  it("a person who already has a profile cannot start another team through this path", async () => {
    await assertFails(createBatch(SCOUT, "SECONDTM"));
  });

  it("gains nothing at the root collections: an FTC member cannot change another account's root team or user documents", async () => {
    // The root rules are CS's own and stay as they are (CS-OPEN: any signed-in user may create a root user or team document, see docs/SECURITY-NOTES.md).
    // What matters here is that enrolling in this program grants no write to somebody else's root documents, and that the enrollment writes only touch programs/ftc.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "teams", "ROOTTEAM"), { teamName: "Root Team", teamNumber: "1" });
      await setDoc(doc(ctx.firestore(), "users", "root-victim"), { name: "Victim", teamId: "ROOTTEAM", role: "scout" });
    });
    const db = as(NEWBIE);
    await assertFails(updateDoc(doc(db, "teams", "ROOTTEAM"), { teamName: "Hijacked" }));
    await assertFails(updateDoc(doc(db, "users", "root-victim"), { role: "admin" }));
    await assertFails(deleteDoc(doc(db, "teams", "ROOTTEAM")));
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      expect((await getDoc(doc(ctx.firestore(), "users", NEWBIE))).exists()).toBe(false);
      expect((await getDoc(doc(ctx.firestore(), "teams", "NEWTEAM2"))).exists()).toBe(false);
    });
  });

  it("sends a join request for an existing team, as yourself, pending", async () => {
    const db = as("ftc-j1");
    await assertSucceeds(setDoc(doc(db, P("teams"), T1, "joinRequests", "ftc-j1"), ftcJoinRequestDoc({ uid: "ftc-j1", name: "Joe" }, serverTimestamp())));
    const mine = await assertSucceeds(getDoc(doc(db, P("teams"), T1, "joinRequests", "ftc-j1")));
    expect(mine.data()).toMatchObject({ uid: "ftc-j1", status: "pending" });
    // the team's admin reads it; an ordinary teammate does not
    await assertSucceeds(getDoc(doc(as(ADMIN), P("teams"), T1, "joinRequests", "ftc-j1")));
    await assertFails(getDoc(doc(as(SCOUT), P("teams"), T1, "joinRequests", "ftc-j1")));
    // withdrawing is allowed to the applicant only
    await assertFails(deleteDoc(doc(as(ADMIN), P("teams"), T1, "joinRequests", "ftc-j1")));
    await assertSucceeds(deleteDoc(doc(db, P("teams"), T1, "joinRequests", "ftc-j1")));
  });

  it("refuses join requests for a missing team, for someone else, already approved, from a person with a profile, or with a bad shape", async () => {
    const db = as("ftc-j2");
    await assertFails(setDoc(doc(db, P("teams"), "NOSUCHTM", "joinRequests", "ftc-j2"), ftcJoinRequestDoc({ uid: "ftc-j2", name: "Jo" }, serverTimestamp())));
    await assertFails(setDoc(doc(db, P("teams"), T1, "joinRequests", "ftc-someone"), ftcJoinRequestDoc({ uid: "ftc-someone", name: "Jo" }, serverTimestamp())));
    await assertFails(setDoc(doc(db, P("teams"), T1, "joinRequests", "ftc-j2"), { ...ftcJoinRequestDoc({ uid: "ftc-j2", name: "Jo" }, serverTimestamp()), status: "approved" }));
    await assertFails(setDoc(doc(db, P("teams"), T1, "joinRequests", "ftc-j2"), { ...ftcJoinRequestDoc({ uid: "ftc-j2", name: "Jo" }, serverTimestamp()), isAdmin: true }));
    await assertFails(setDoc(doc(as(SCOUT), P("teams"), T2, "joinRequests", SCOUT), ftcJoinRequestDoc({ uid: SCOUT, name: "Ada" }, serverTimestamp())));
  });
});

describe("approving and denying a join request (team admin of the same team)", () => {
  const ADMIN2 = "ftc-admin-t2";
  const NAME = "Joiner";
  let n = 0;

  /** A pending request (written with the rules off, as the applicant's own create is covered above). */
  async function seedRequest(teamId = T1, over: Record<string, unknown> = {}) {
    const uid = `ftc-applicant-${++n}`;
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), P("teams"), teamId, "joinRequests", uid), { uid, name: NAME, status: "pending", createdAt: new Date(1000), ...over });
    });
    return uid;
  }

  const fieldIds = (teamId: string) => (teamId === T1 ? ["ft-1", "ft-2"] : []);

  /** The batch the data layer sends: the request approved and the applicant's profile, as `actor`. The options bend it for the refusals. */
  function approve(
    actor: string,
    uid: string,
    opts: { teamId?: string; profile?: Record<string, unknown>; skipProfile?: boolean; skipRequest?: boolean; extra?: (b: ReturnType<typeof writeBatch>, db: ReturnType<typeof as>) => void } = {}
  ) {
    const db = as(actor);
    const teamId = opts.teamId ?? T1;
    const batch = writeBatch(db);
    if (!opts.skipRequest) batch.update(doc(db, P("teams"), teamId, "joinRequests", uid), ftcJoinDecisionFields("approved", actor, serverTimestamp()));
    if (!opts.skipProfile) batch.set(doc(db, P("users"), uid), { ...ftcApprovedProfileDoc(teamId, { name: NAME }, fieldIds(teamId), serverTimestamp()), ...opts.profile });
    opts.extra?.(batch, db);
    return batch.commit();
  }

  beforeAll(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), P("users"), ADMIN2), { name: "Admin Two", email: "a2@example.org", teamId: T2, primaryRole: "team-coach", secondaryRoles: [], isAdmin: true, isOwner: false });
    });
  });

  it("the team's admin approves: the applicant gets a plain-member profile on that team and the request reads approved", async () => {
    const uid = await seedRequest();
    await assertSucceeds(approve(ADMIN, uid));
    const mine = await assertSucceeds(getDoc(doc(as(uid), P("users"), uid)));
    expect(mine.data()).toMatchObject({ name: NAME, teamId: T1, primaryRole: "match-scout", secondaryRoles: [], isAdmin: false, isOwner: false, fieldTeamIds: ["ft-1", "ft-2"] });
    const request = await assertSucceeds(getDoc(doc(as(ADMIN), P("teams"), T1, "joinRequests", uid)));
    expect(request.data()).toMatchObject({ status: "approved", decidedBy: ADMIN });
    // the new member is read by the team like anyone else (roster query) and reads the team doc
    const roster = await assertSucceeds(getDocs(query(collection(as(SCOUT), P("users")), where("teamId", "==", T1))));
    expect(roster.docs.map((d) => d.id)).toContain(uid);
    await assertSucceeds(getDoc(doc(as(uid), P("teams"), T1)));
  });

  it("the pending list is one equality query under the team, readable by its admin only", async () => {
    await seedRequest();
    const q = (uid: string) => getDocs(query(collection(as(uid), P("teams"), T1, "joinRequests"), where("status", "==", "pending")));
    const list = await assertSucceeds(q(ADMIN));
    expect(list.docs.length).toBeGreaterThan(0);
    await assertFails(q(SCOUT));
    await assertFails(q(ADMIN2));
  });

  it("refuses approval by a non-admin, by an admin of another team, and of a request for another team", async () => {
    const a = await seedRequest();
    await assertFails(approve(SCOUT, a));
    await assertFails(approve(ADMIN2, a));
    const other = await seedRequest(T2);
    await assertFails(approve(ADMIN, other, { teamId: T2 }));
  });

  it("refuses approving a request that does not exist, and a profile or an approval on its own", async () => {
    await assertFails(approve(ADMIN, "ftc-no-such-request"));
    await assertFails(approve(ADMIN, "ftc-no-such-request", { skipRequest: true }));
    const uid = await seedRequest();
    await assertFails(approve(ADMIN, uid, { skipRequest: true })); // a profile without approving the request
    await assertFails(approve(ADMIN, uid, { skipProfile: true })); // approving without creating the profile
  });

  it("refuses a profile with an admin or owner role, any other role, extra fields, or another team's field teams", async () => {
    for (const bad of [
      { isAdmin: true },
      { isOwner: true },
      { primaryRole: "team-coach" },
      { primaryRole: "lead-scout" },
      { secondaryRoles: ["lead-scout"] },
      { fieldTeamIds: ["other"] },
      { teamId: T2 },
      { name: "Someone Else" },
      { email: "x@example.org" },
      { isPlatformOwner: true },
    ]) {
      const uid = await seedRequest();
      await assertFails(approve(ADMIN, uid, { profile: bad }));
    }
  });

  it("refuses the applicant approving their own request", async () => {
    const uid = await seedRequest();
    await assertFails(approve(uid, uid));
    await assertFails(updateDoc(doc(as(uid), P("teams"), T1, "joinRequests", uid), ftcJoinDecisionFields("approved", uid, serverTimestamp())));
  });

  it("refuses changing anything of another team, or anything but the decision", async () => {
    const uid = await seedRequest();
    await assertFails(approve(ADMIN, uid, { extra: (b, db) => b.update(doc(db, P("teams"), T2), { name: "Hijacked" }) }));
    await assertFails(approve(ADMIN, uid, { extra: (b, db) => b.update(doc(db, P("users"), OTHER), { primaryRole: "lead-scout" }) }));
    const t2 = await seedRequest(T2);
    await assertFails(updateDoc(doc(as(ADMIN), P("teams"), T2, "joinRequests", t2), ftcJoinDecisionFields("denied", ADMIN, serverTimestamp())));
    // only status, decidedBy and decidedAt may change: not the name, not who decided, and not back to pending
    await assertFails(updateDoc(doc(as(ADMIN), P("teams"), T1, "joinRequests", uid), { ...ftcJoinDecisionFields("denied", ADMIN, serverTimestamp()), name: "Renamed" }));
    await assertFails(updateDoc(doc(as(ADMIN), P("teams"), T1, "joinRequests", uid), ftcJoinDecisionFields("denied", "someone-else", serverTimestamp())));
    await assertFails(updateDoc(doc(as(ADMIN), P("teams"), T1, "joinRequests", uid), { status: "pending", decidedBy: ADMIN, decidedAt: serverTimestamp() }));
  });

  it("refuses deciding a request twice, and overwriting an account that already has a profile", async () => {
    const uid = await seedRequest();
    await assertSucceeds(approve(ADMIN, uid));
    await assertFails(approve(ADMIN, uid)); // already approved
    const denied = await seedRequest(T1, { status: "denied" });
    await assertFails(approve(ADMIN, denied));
    // a request from an account that already has a profile (T2's OTHER): the profile would be an overwrite, which is not a create
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), P("teams"), T1, "joinRequests", OTHER), { uid: OTHER, name: "Other", status: "pending", createdAt: new Date(1000) });
    });
    await assertFails(approve(ADMIN, OTHER));
  });

  it("the team's admin denies a request: only the request changes and the applicant gets no profile", async () => {
    const uid = await seedRequest();
    await assertSucceeds(updateDoc(doc(as(ADMIN), P("teams"), T1, "joinRequests", uid), ftcJoinDecisionFields("denied", ADMIN, serverTimestamp())));
    const request = await assertSucceeds(getDoc(doc(as(uid), P("teams"), T1, "joinRequests", uid)));
    expect(request.data()).toMatchObject({ status: "denied", decidedBy: ADMIN });
    const profile = await assertSucceeds(getDoc(doc(as(uid), P("users"), uid)));
    expect(profile.exists()).toBe(false);
  });

  it("refuses a denial by a non-admin, an admin of another team, and the applicant", async () => {
    const uid = await seedRequest();
    const deny = (actor: string) => updateDoc(doc(as(actor), P("teams"), T1, "joinRequests", uid), ftcJoinDecisionFields("denied", actor, serverTimestamp()));
    await assertFails(deny(SCOUT));
    await assertFails(deny(ADMIN2));
    await assertFails(deny(uid));
  });

  it("the applicant reads their own (missing) profile and may send a new request after a denial", async () => {
    const uid = await seedRequest(T1, { status: "denied" });
    const missing = await assertSucceeds(getDoc(doc(as(uid), P("users"), uid)));
    expect(missing.exists()).toBe(false);
    await assertFails(getDoc(doc(as(uid), P("users"), "ftc-someone-else-missing")));
    const db = as(uid);
    await assertSucceeds(deleteDoc(doc(db, P("teams"), T1, "joinRequests", uid)));
    await assertSucceeds(setDoc(doc(db, P("teams"), T1, "joinRequests", uid), ftcJoinRequestDoc({ uid, name: "Again" }, serverTimestamp())));
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Batch 2: the FTC match library and the Admin Panel's data. Exactly the queries and writes of data/ftc/library.ts (whose constraints
// data/ftc/library.test.ts pins): a read is two queries (`origin == 'api'` for the shared API docs, `teamId == <mine>` for the team's own hand-made docs).
// ---------------------------------------------------------------------------------------------------------------------------------------------------
describe("the FTC match library (Batch 2)", () => {
  const ADMIN_B = "ftc-admin-lib-b";
  const EV_API = "USWASEAQ";
  const EV_T1 = "MAN-ONE-AAAA";
  const EV_T2 = "MAN-TWO-BBBB";
  const base = { seasonId: "biobuzz", eventName: "E", alliances: { red: { teams: [1, 2] }, blue: { teams: [3, 4] } }, scheduledTime: null, createdBy: "seed", updatedAt: "2026-01-01T00:00:00.000Z" };
  const match = (eventCode: string, type: string, n: number, extra: Record<string, unknown>) => ({ ...base, eventCode, matchType: type, matchNumber: n, ...extra });
  const L = (name: string) => programPath("ftc", name);
  const col = (uid: string, name: string) => collection(as(uid), L(name));
  const qMatches = (uid: string, ...c: ReturnType<typeof where>[]) => getDocs(query(col(uid, "libraryMatches"), ...c));
  const ids = (snap: { docs: { id: string }[] }) => snap.docs.map((d) => d.id).sort();

  beforeAll(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, P("users"), ADMIN_B), { name: "Admin B", email: "b@example.org", teamId: T2, primaryRole: "team-coach", secondaryRoles: [], isAdmin: true, isOwner: false });
      const ev = (code: string, origin: string, teamId?: string) => ({ eventCode: code, eventName: code, seasonId: "biobuzz", origin, date: null, sourceUrl: null, defaultVideoUrl: null, createdBy: "seed", ...(teamId ? { teamId } : {}) });
      await setDoc(doc(db, L("libraryEvents"), EV_API), ev(EV_API, "api"));
      await setDoc(doc(db, L("libraryEvents"), EV_T1), ev(EV_T1, "manual", T1));
      await setDoc(doc(db, L("libraryEvents"), EV_T2), ev(EV_T2, "manual", T2));
      await setDoc(doc(db, L("libraryMatches"), `${EV_API}_Q1`), match(EV_API, "Qualification", 1, { origin: "api", published: true }));
      await setDoc(doc(db, L("libraryMatches"), `${EV_API}_Q2`), match(EV_API, "Qualification", 2, { origin: "api", published: false }));
      await setDoc(doc(db, L("libraryMatches"), `${EV_T1}_Q1`), match(EV_T1, "Qualification", 1, { origin: "manual", published: true, teamId: T1 }));
      await setDoc(doc(db, L("libraryMatches"), `${EV_T1}_Q2`), match(EV_T1, "Qualification", 2, { origin: "manual", published: false, teamId: T1 }));
      await setDoc(doc(db, L("libraryMatches"), `${EV_T2}_Q1`), match(EV_T2, "Qualification", 1, { origin: "manual", published: true, teamId: T2 }));
    });
  });

  it("a plain member reads only PUBLISHED matches: the shared API ones and their own team's, by the two queries", async () => {
    const api = await assertSucceeds(qMatches(SCOUT, where("eventCode", "==", EV_API), where("published", "==", true), where("origin", "==", "api")));
    expect(ids(api)).toEqual([`${EV_API}_Q1`]);
    const own = await assertSucceeds(qMatches(SCOUT, where("eventCode", "==", EV_T1), where("published", "==", true), where("teamId", "==", T1)));
    expect(ids(own)).toEqual([`${EV_T1}_Q1`]);
    const season = await assertSucceeds(qMatches(SCOUT, where("seasonId", "==", "biobuzz"), where("published", "==", true), where("origin", "==", "api")));
    expect(ids(season)).toEqual([`${EV_API}_Q1`]);
  });

  it("a plain member cannot read drafts, an unfiltered list, or a single unpublished match", async () => {
    await assertFails(qMatches(SCOUT, where("eventCode", "==", EV_API), where("origin", "==", "api")));
    await assertFails(qMatches(SCOUT, where("eventCode", "==", EV_T1), where("teamId", "==", T1)));
    await assertFails(getDocs(col(SCOUT, "libraryMatches")));
    await assertFails(qMatches(SCOUT, where("published", "==", true)));
    await assertFails(getDoc(doc(as(SCOUT), L("libraryMatches"), `${EV_T1}_Q2`)));
    await assertFails(getDoc(doc(as(SCOUT), L("libraryMatches"), `${EV_API}_Q2`)));
    await assertSucceeds(getDoc(doc(as(SCOUT), L("libraryMatches"), `${EV_API}_Q1`)));
  });

  it("an admin reads drafts of the shared and their own team's events", async () => {
    expect(ids(await assertSucceeds(qMatches(ADMIN, where("eventCode", "==", EV_API), where("origin", "==", "api"))))).toEqual([`${EV_API}_Q1`, `${EV_API}_Q2`]);
    expect(ids(await assertSucceeds(qMatches(ADMIN, where("eventCode", "==", EV_T1), where("teamId", "==", T1))))).toEqual([`${EV_T1}_Q1`, `${EV_T1}_Q2`]);
    await assertSucceeds(getDocs(query(col(ADMIN, "libraryEvents"), where("origin", "==", "api"))));
    await assertSucceeds(getDocs(query(col(ADMIN, "libraryEvents"), where("teamId", "==", T1), where("seasonId", "==", "biobuzz"))));
  });

  it("another team's admin cannot read this team's library (drafts or published), only the shared API docs and their own", async () => {
    await assertFails(qMatches(ADMIN_B, where("eventCode", "==", EV_T1), where("teamId", "==", T1)));
    await assertFails(qMatches(ADMIN_B, where("eventCode", "==", EV_T1), where("published", "==", true), where("teamId", "==", T1)));
    await assertFails(getDoc(doc(as(ADMIN_B), L("libraryMatches"), `${EV_T1}_Q1`)));
    await assertFails(getDocs(query(col(ADMIN_B, "libraryEvents"), where("teamId", "==", T1))));
    await assertFails(getDoc(doc(as(ADMIN_B), L("libraryEvents"), EV_T1)));
    expect(ids(await assertSucceeds(qMatches(ADMIN_B, where("eventCode", "==", EV_T2), where("teamId", "==", T2))))).toEqual([`${EV_T2}_Q1`]);
    await assertSucceeds(qMatches(ADMIN_B, where("eventCode", "==", EV_API), where("origin", "==", "api")));
  });

  it("an admin creates a hand-made event and draft matches for their team, edits, publishes and deletes them", async () => {
    const db = as(ADMIN);
    const code = "MAN-NEW-CCCC";
    const event = { eventCode: code, eventName: "New", seasonId: "biobuzz", origin: "manual", date: null, sourceUrl: null, defaultVideoUrl: null, createdBy: ADMIN, createdAt: "t", updatedAt: "t", teamId: T1 };
    await assertSucceeds(setDoc(doc(db, L("libraryEvents"), code), event));
    const ref = { eventCode: code, eventName: "New", seasonId: "biobuzz" };
    const vm = { matchType: "Qualification" as const, matchNumber: 1, red: [111, 222], blue: [333, 444], scheduledTime: "2026-11-15T09:00:00.000Z" };
    const id = ftcMatchId(code, vm.matchType, vm.matchNumber);
    const created = buildManualMatchDoc(vm, ref, null, T1, ADMIN, "2026-11-15T00:00:00.000Z");
    await assertSucceeds(setDoc(doc(db, L("libraryMatches"), id), created));
    expect(created.published).toBe(false);
    await assertSucceeds(setDoc(doc(db, L("libraryMatches"), id), buildManualMatchDoc({ ...vm, red: [111, 999] }, ref, created, T1, ADMIN, "2026-11-15T01:00:00.000Z")));
    await assertSucceeds(updateDoc(doc(db, L("libraryMatches"), id), { published: true, updatedAt: "2026-11-15T02:00:00.000Z" }));
    await assertSucceeds(updateDoc(doc(db, L("libraryMatches"), id), { published: false, updatedAt: "2026-11-15T03:00:00.000Z" }));
    await assertSucceeds(deleteDoc(doc(db, L("libraryMatches"), id)));
    await assertSucceeds(deleteDoc(doc(db, L("libraryEvents"), code)));
  });

  it("refuses hand-made docs that break the shape: another team's id, no teamId, wrong id, three teams, a bad time", async () => {
    const db = as(ADMIN);
    const ref = { eventCode: EV_T1, eventName: "E", seasonId: "biobuzz" };
    const vm = { matchType: "Qualification" as const, matchNumber: 9, red: [1, 2], blue: [3, 4], scheduledTime: null };
    const good = buildManualMatchDoc(vm, ref, null, T1, ADMIN, "t");
    const id = ftcMatchId(EV_T1, "Qualification", 9);
    await assertFails(setDoc(doc(db, L("libraryMatches"), id), { ...good, teamId: T2 }));
    const noTeam = { ...good } as Record<string, unknown>;
    delete noTeam.teamId;
    await assertFails(setDoc(doc(db, L("libraryMatches"), id), noTeam));
    await assertFails(setDoc(doc(db, L("libraryMatches"), `${EV_T1}_Q10`), good));
    await assertFails(setDoc(doc(db, L("libraryMatches"), id), { ...good, alliances: { red: { teams: [1, 2, 3] }, blue: { teams: [3, 4] } } }));
    await assertFails(setDoc(doc(db, L("libraryMatches"), id), { ...good, scheduledTime: 12345 }));
    await assertFails(setDoc(doc(db, L("libraryEvents"), "MAN-BAD-DDDD"), { eventCode: "MAN-BAD-DDDD", eventName: "x", seasonId: "biobuzz", origin: "manual", createdBy: ADMIN, teamId: T2 }));
    await assertFails(setDoc(doc(db, L("libraryEvents"), "MAN-BAD-EEEE"), { eventCode: "MAN-BAD-EEEE", eventName: "x", seasonId: "biobuzz", origin: "manual", createdBy: ADMIN }));
  });

  it("an admin imports a schedule (events and matches, 2-team alliances, no scores) and re-imports it as updates", async () => {
    const event = { eventCode: "USWAIMP1", eventName: "Import", seasonId: "biobuzz" };
    const m = (n: number): EventMatch => ({ id: `Q-${n}`, matchNumber: n, type: "Qualification", description: null, series: null, played: false, redTeams: [1, 2], blueTeams: [3], redScore: null, blueScore: null, redPenaltyPoints: null, bluePenaltyPoints: null, startTime: "2026-12-01T09:00:00" });
    const run = async (existing: Map<string, Record<string, unknown>>, withEvent: boolean) => {
      const plan = planScheduleImport({ event, matches: [m(1), m(2)], existing, uid: ADMIN, now: "2026-11-15T00:00:00.000Z" });
      const adb = as(ADMIN);
      const batch = writeBatch(adb);
      if (withEvent) batch.set(doc(adb, L("libraryEvents"), event.eventCode), { ...event, origin: "api", date: null, sourceUrl: null, defaultVideoUrl: null, createdBy: ADMIN, createdAt: "t", updatedAt: "t" });
      for (const w of plan.writes) batch.set(doc(adb, L("libraryMatches"), w.id), w.data, { merge: w.merge });
      await assertSucceeds(batch.commit());
      return plan;
    };
    const first = await run(new Map(), true);
    expect(first.created).toBe(2);
    const stored = new Map(first.writes.map((w) => [w.id, w.data]));
    const second = await run(stored, false);
    expect(second).toMatchObject({ created: 0, updated: 2 });
    expect(ids(await assertSucceeds(qMatches(ADMIN, where("eventCode", "==", "USWAIMP1"), where("origin", "==", "api"))))).toEqual(["USWAIMP1_Q1", "USWAIMP1_Q2"]);
    // a plain member sees the published import
    expect(ids(await assertSucceeds(qMatches(SCOUT, where("eventCode", "==", "USWAIMP1"), where("published", "==", true), where("origin", "==", "api"))))).toEqual(["USWAIMP1_Q1", "USWAIMP1_Q2"]);
  });

  it("an API doc cannot be turned into a hand-made one or deleted, and an API import cannot land under a hand-made event", async () => {
    const db = as(ADMIN);
    await assertFails(deleteDoc(doc(db, L("libraryMatches"), `${EV_API}_Q1`)));
    await assertFails(deleteDoc(doc(db, L("libraryEvents"), EV_API)));
    await assertFails(updateDoc(doc(db, L("libraryMatches"), `${EV_API}_Q1`), { origin: "manual" }));
    await assertFails(setDoc(doc(db, L("libraryMatches"), `${EV_T1}_Q7`), match(EV_T1, "Qualification", 7, { origin: "api", published: true })));
  });

  it("a plain member cannot write the library at all", async () => {
    const db = as(SCOUT);
    await assertFails(updateDoc(doc(db, L("libraryMatches"), `${EV_T1}_Q1`), { published: false }));
    await assertFails(updateDoc(doc(db, L("libraryMatches"), `${EV_API}_Q1`), { published: false }));
    await assertFails(deleteDoc(doc(db, L("libraryMatches"), `${EV_T1}_Q1`)));
    await assertFails(setDoc(doc(db, L("libraryMatches"), `${EV_T1}_Q8`), match(EV_T1, "Qualification", 8, { origin: "manual", published: false, teamId: T1, createdBy: SCOUT })));
    await assertFails(setDoc(doc(db, L("libraryEvents"), "MAN-MEM-FFFF"), { eventCode: "MAN-MEM-FFFF", eventName: "x", seasonId: "biobuzz", origin: "manual", createdBy: SCOUT, teamId: T1 }));
    await assertFails(deleteDoc(doc(db, L("libraryEvents"), EV_T1)));
  });

  it("another team's admin cannot write, publish or delete this team's hand-made docs, or create docs for it", async () => {
    const db = as(ADMIN_B);
    await assertFails(updateDoc(doc(db, L("libraryMatches"), `${EV_T1}_Q1`), { published: false, updatedAt: "x" }));
    await assertFails(deleteDoc(doc(db, L("libraryMatches"), `${EV_T1}_Q1`)));
    await assertFails(deleteDoc(doc(db, L("libraryEvents"), EV_T1)));
    await assertFails(updateDoc(doc(db, L("libraryEvents"), EV_T1), { eventName: "Hijacked" }));
    await assertFails(setDoc(doc(db, L("libraryMatches"), `${EV_T1}_Q9`), match(EV_T1, "Qualification", 9, { origin: "manual", published: false, teamId: T1, createdBy: ADMIN_B })));
    await assertFails(setDoc(doc(db, L("libraryMatches"), `${EV_T1}_Q9`), match(EV_T1, "Qualification", 9, { origin: "manual", published: false, teamId: T2, createdBy: ADMIN_B })));
  });
});

describe("the Admin Panel's data (Batch 2)", () => {
  const sidebar = (rev: number, uid: string) => ({ version: 1, rev, entries: [{ id: "dashboard", kind: "page", parent: null, order: 0 }], updatedBy: uid, updatedAt: serverTimestamp() });

  it("a plain member cannot read the audit log or write an audit entry for the library", async () => {
    await assertFails(getDocs(query(collection(as(SCOUT), P("auditLog")), where("teamId", "==", T1))));
    await assertFails(addDoc(collection(as(SCOUT), P("auditLog")), buildAuditEntry(T1, SCOUT, "Ada", "edit-match-library", { op: "publish-matches" }, null, null)));
    await assertSucceeds(addDoc(collection(as(ADMIN), P("auditLog")), buildAuditEntry(T1, ADMIN, "Admin", "edit-match-library", { op: "import-event" }, null, null)));
    await assertSucceeds(getDocs(query(collection(as(ADMIN), P("auditLog")), where("teamId", "==", T1))));
  });

  it("a team admin writes the sidebar config and page access under the FTC team path; a member and another team's admin cannot", async () => {
    await assertSucceeds(setDoc(doc(as(ADMIN), P("teams"), T1, "settings", "sidebar"), sidebar(1, ADMIN)));
    await assertSucceeds(setDoc(doc(as(ADMIN), P("teams"), T1, "settings", "sidebar"), sidebar(2, ADMIN)));
    await assertSucceeds(getDoc(doc(as(SCOUT), P("teams"), T1, "settings", "sidebar")));
    await assertFails(setDoc(doc(as(SCOUT), P("teams"), T1, "settings", "sidebar"), sidebar(3, SCOUT)));
    await assertFails(setDoc(doc(as("ftc-admin-lib-b"), P("teams"), T1, "settings", "sidebar"), sidebar(3, "ftc-admin-lib-b")));
    await assertFails(getDoc(doc(as(OTHER), P("teams"), T1, "settings", "sidebar")));
    await assertSucceeds(setDoc(doc(as(ADMIN), P("teams"), T1, "settings", "pageAccess"), { roleGrants: {}, pageRoles: {}, memberOverrides: {}, updatedBy: ADMIN, updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(as(SCOUT), P("teams"), T1, "settings", "pageAccess"), { roleGrants: {}, pageRoles: {}, memberOverrides: {}, updatedBy: SCOUT, updatedAt: serverTimestamp() }));
  });

  it("only a team admin switches form submissions off (the additive team-document field); a member cannot", async () => {
    const settings = { formSubmissionSettings: { enabled: true, seasons: { biobuzz: false } } };
    await assertSucceeds(updateDoc(doc(as(ADMIN), P("teams"), T1), settings));
    await assertFails(updateDoc(doc(as(SCOUT), P("teams"), T1), settings));
    await assertFails(updateDoc(doc(as("ftc-admin-lib-b"), P("teams"), T1), settings));
  });
});
