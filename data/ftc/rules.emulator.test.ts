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
import { ftcAccountTeamsFields as fieldTeamsFields } from "@/data/ftc/teams";
import { FTC_STARTER_ENTRIES } from "@/lib/ftc/changelog-seed";
import { ftcMatchId, planScheduleImport } from "@/lib/ftc/library";
import { buildManualMatchDoc } from "@/lib/library/schedule";
import { tryClaimDoc } from "@/lib/claim-doc";
import { ftcSessionStub } from "@/lib/ftc/practice";
import { lobbyStub } from "@/lib/ftc/lobby";
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

  it("the import's existence check: an admin queries the events by code (shared, then their own team), and a missing event doc cannot be read by id", async () => {
    const db = as(ADMIN);
    // a code nobody has used: both queries are allowed and empty (this is what a first import of a new event does)
    expect((await assertSucceeds(getDocs(query(collection(db, L("libraryEvents")), where("eventCode", "==", "USWANEW1"), where("origin", "==", "api"))))).empty).toBe(true);
    expect((await assertSucceeds(getDocs(query(collection(db, L("libraryEvents")), where("eventCode", "==", "USWANEW1"), where("teamId", "==", T1))))).empty).toBe(true);
    // an existing shared event and the team's own hand-made one are found
    expect((await assertSucceeds(getDocs(query(collection(db, L("libraryEvents")), where("eventCode", "==", EV_API), where("origin", "==", "api"))))).empty).toBe(false);
    expect((await assertSucceeds(getDocs(query(collection(db, L("libraryEvents")), where("eventCode", "==", EV_T1), where("teamId", "==", T1))))).empty).toBe(false);
    // another team's hand-made event is invisible (empty), never an error, so the check does not mistake it for an existing event
    expect((await assertSucceeds(getDocs(query(collection(db, L("libraryEvents")), where("eventCode", "==", EV_T2), where("teamId", "==", T1))))).empty).toBe(true);
    // reading a doc that does not exist by id is refused: the import must not do it
    await assertFails(getDoc(doc(db, L("libraryEvents"), "USWANEW1")));
  });

  it("a brand-new event imports end to end: event doc and matches in one batch, then the import's own reads work", async () => {
    const db = as(ADMIN);
    const event = { eventCode: "USWANEW2", eventName: "New", seasonId: "biobuzz" };
    const plan = planScheduleImport({ event, matches: [{ id: "Q-1", matchNumber: 1, type: "Qualification", description: null, series: null, played: false, redTeams: [1, 2], blueTeams: [3, 4], redScore: null, blueScore: null, redPenaltyPoints: null, bluePenaltyPoints: null, startTime: null }], existing: new Map(), uid: ADMIN, now: "2026-11-15T00:00:00.000Z" });
    const batch = writeBatch(db);
    batch.set(doc(db, L("libraryEvents"), event.eventCode), { ...event, origin: "api", date: null, sourceUrl: null, defaultVideoUrl: null, createdBy: ADMIN, createdAt: "t", updatedAt: "t" });
    for (const w of plan.writes) batch.set(doc(db, L("libraryMatches"), w.id), w.data, { merge: w.merge });
    await assertSucceeds(batch.commit());
    expect(ids(await assertSucceeds(qMatches(ADMIN, where("eventCode", "==", "USWANEW2"), where("origin", "==", "api"))))).toEqual(["USWANEW2_Q1"]);
  });

  it("bulk entry: matches arrive as unpublished drafts that need review, a member cannot see them, publishing clears the flag", async () => {
    const db = as(ADMIN);
    const ref = { eventCode: EV_T1, eventName: "E", seasonId: "biobuzz" };
    const vm = { matchType: "Qualification" as const, matchNumber: 21, red: [1, 2], blue: [3, 4], scheduledTime: null };
    const id = ftcMatchId(EV_T1, "Qualification", 21);
    await assertSucceeds(setDoc(doc(db, L("libraryMatches"), id), buildManualMatchDoc(vm, ref, null, T1, ADMIN, "t", { newPublished: false, newNeedsReview: true })));
    expect((await getDoc(doc(db, L("libraryMatches"), id))).data()).toMatchObject({ published: false, needsReview: true });
    expect(ids(await assertSucceeds(qMatches(SCOUT, where("eventCode", "==", EV_T1), where("published", "==", true), where("teamId", "==", T1))))).not.toContain(id);
    await assertSucceeds(updateDoc(doc(db, L("libraryMatches"), id), { published: true, needsReview: false, updatedAt: "t2" }));
    expect(ids(await assertSucceeds(qMatches(SCOUT, where("eventCode", "==", EV_T1), where("published", "==", true), where("teamId", "==", T1))))).toContain(id);
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

// Batch 4: Scout Accuracy (its reads, its actions), the post-save accuracy write, and the CSV import, as a plain scout, a team admin, a scout of another team and a
// signed-out user. The queries are the ones the page's ports run (team-wide `teamId ==`, never by event); nothing here relies on a loosened rule.
describe("Scout Accuracy, post-save accuracy and CSV import (Batch 4)", () => {
  const LEAD = "ftc-lead-1"; // a Lead Scout of team 1, not an admin (seeded above)
  const ADMIN_T2 = "ftc-admin-b4-t2"; // an admin of ANOTHER team
  const S = (name: string) => programPath("ftc", name);
  const coll = (uid: string, name: string) => collection(as(uid), S(name));
  const anon = () => testEnv.unauthenticatedContext().firestore();
  const ids = (snap: { docs: { id: string }[] }) => snap.docs.map((d) => d.id).sort();
  const session = (uid: string, teamId: string, extra: Record<string, unknown> = {}) => ({
    teamId, uid, kind: "solo", status: "completed", scoutName: "x", seasonId: "biobuzz", mode: "trial", difficulty: null, libraryMatchId: "EVB4_Q1", eventCode: "EVB4", alliance: "red",
    robots: [111, 222], completedRobots: [111, 222], entryIds: [], accuracy: 90, scoutedTotal: 60, penaltyPoints: 0, officialScore: 66, platform: "pc", flags: [{ type: "low", title: "Low", detail: "", dismissed: false }], excluded: false,
    lobbyId: null, pairId: null, startedAt: "2026-03-01T10:00:00.000Z", finishedAt: "2026-03-01T10:10:00.000Z", ...extra,
  });
  const entryDoc = (uid: string, teamId: string, extra: Record<string, unknown> = {}) => ({
    teamId, uid, source: "practice", mode: "trial", eventCode: "EVB4", matchType: "Qualification", matchNumber: 1, teamNumber: 111, formId: "biobuzz", formVersion: 1, values: {}, score: { auto: 0, teleop: 0, endgame: 0, total: 0 },
    comments: "", submittedAt: "2026-03-01T10:05:00.000Z", excluded: false, autoFlags: [], manualFlags: [], accuracy: null, sessionId: "B4-S1", libraryMatchId: "EVB4_Q1", ...extra,
  });
  const importInput = (n: number): SaveEntryInput => ({
    scoutName: "Ada", eventCode: "EVB4", matchType: "Qualification", matchNumber: n, teamNumber: 111, formId: "biobuzz", formVersion: 1, values: { teleTipHive: 1 }, score: { auto: 0, teleop: 20, endgame: 0, total: 20 }, comments: "", importedFrom: "csv",
  });
  const importBatch = (uid: string, teamId: string, from: number, count: number, prefix = "csv_b4") => {
    const db = as(uid);
    const batch = writeBatch(db);
    for (let i = 0; i < count; i++) batch.set(doc(db, S("scoutEntries"), `${prefix}_${from + i}`), ftcScoutEntryDoc(teamId, uid, importInput(from + i), serverTimestamp));
    return batch.commit();
  };

  beforeAll(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, P("users"), ADMIN_T2), { name: "Admin T2", email: "t2admin@example.org", teamId: T2, primaryRole: "team-coach", secondaryRoles: [], isAdmin: true, isOwner: false });
      await setDoc(doc(db, S("practiceSessions"), "B4-S1"), session(SCOUT, T1));
      await setDoc(doc(db, S("practiceSessions"), "B4-S2"), session(LEAD, T1, { accuracy: null }));
      await setDoc(doc(db, S("practiceSessions"), "B4-S3"), session(SCOUT, T1, { excluded: true }));
      await setDoc(doc(db, S("practiceSessions"), "B4-T2"), session(OTHER, T2));
      await setDoc(doc(db, S("scoutEntries"), "B4-E1"), entryDoc(SCOUT, T1));
      await setDoc(doc(db, S("scoutEntries"), "B4-E2"), entryDoc(SCOUT, T1, { sessionId: "B4-S3" }));
      await setDoc(doc(db, S("scoutEntries"), "B4-EV"), entryDoc(SCOUT, T1, { source: "event", mode: null, sessionId: null, libraryMatchId: null, eventCode: "EVB4" }));
      await setDoc(doc(db, S("scoutEntries"), "B4-T2E"), entryDoc(OTHER, T2));
      await setDoc(doc(db, S("eventAttendance"), "B4-ATT"), { teamId: T1, eventCode: "EVB4", uids: [SCOUT, LEAD] });
    });
  });

  // the reads Scout Accuracy makes, as the ports make them
  const accuracyReads = (uid: string, teamId: string) => [
    () => getDocs(query(coll(uid, "users"), where("teamId", "==", teamId))),
    () => getDocs(query(coll(uid, "practiceSessions"), where("teamId", "==", teamId))),
    () => getDocs(query(coll(uid, "scoutEntries"), where("teamId", "==", teamId))),
    () => getDocs(query(coll(uid, "eventAttendance"), where("teamId", "==", teamId))),
    () => getDocs(query(coll(uid, "libraryMatches"), where("published", "==", true), where("origin", "==", "api"))),
    () => getDocs(query(coll(uid, "libraryMatches"), where("published", "==", true), where("teamId", "==", teamId))),
  ];

  it("a plain scout reads the whole team's data the page needs (members, sessions, entries, attendance, library): the page shows the whole team, as in FRC", async () => {
    const [users, sessions, entries, attendance] = await Promise.all(accuracyReads(SCOUT, T1).slice(0, 4).map((read) => assertSucceeds(read())));
    expect(ids(users)).toEqual(expect.arrayContaining([SCOUT, LEAD, ADMIN, PIT]));
    expect(ids(users)).not.toContain(OTHER);
    expect(ids(sessions)).toEqual(expect.arrayContaining(["B4-S1", "B4-S2", "B4-S3"])); // a teammate's session too (team-wide), never the other team's
    expect(ids(sessions)).not.toContain("B4-T2");
    expect(ids(entries)).toEqual(expect.arrayContaining(["B4-E1", "B4-E2", "B4-EV"]));
    expect(ids(entries)).not.toContain("B4-T2E");
    expect(ids(attendance)).toContain("B4-ATT");
    await assertSucceeds(accuracyReads(SCOUT, T1)[4]());
    await assertSucceeds(accuracyReads(SCOUT, T1)[5]());
    // the event read a recompute starts from: two equalities
    await assertSucceeds(getDocs(query(coll(SCOUT, "scoutEntries"), where("teamId", "==", T1), where("eventCode", "==", "EVB4"))));
  });

  it("a team admin runs the same reads", async () => {
    for (const read of accuracyReads(ADMIN, T1)) await assertSucceeds(read());
  });

  it("a scout of another team, and a signed-out user, read none of it", async () => {
    for (const read of accuracyReads(OTHER, T1).slice(0, 4)) await assertFails(read());
    await assertFails(getDocs(query(coll(OTHER, "scoutEntries"), where("teamId", "==", T1), where("eventCode", "==", "EVB4"))));
    for (const name of ["users", "practiceSessions", "scoutEntries", "eventAttendance"]) {
      await assertFails(getDocs(query(collection(anon(), S(name)), where("teamId", "==", T1))));
    }
    // and their own team is theirs
    for (const read of accuracyReads(OTHER, T2).slice(0, 4)) await assertSucceeds(read());
  });

  it("a scout saves an entry (no error), but cannot write accuracy, flags or an exclusion onto one; an admin can (Recalculate Accuracy)", async () => {
    await assertSucceeds(setDoc(doc(as(SCOUT), S("scoutEntries"), "B4-NEW"), ftcScoutEntryDoc(T1, SCOUT, { ...importInput(50), source: "event" }, serverTimestamp)));
    const patch = ftcScoutEntryPatch({ accuracy: { status: "complete", value: 1, scoutedTotal: 50, penaltyPoints: 0, officialScore: 50 }, autoFlags: [{ ruleId: "zero-main-scoring", dismissed: false }] });
    // the recompute a scout's save used to trigger is exactly this write: denied, so the scout pages skip it (nothing is loosened)
    await assertFails(updateDoc(doc(as(SCOUT), S("scoutEntries"), "B4-NEW"), patch));
    await assertFails(updateDoc(doc(as(LEAD), S("scoutEntries"), "B4-EV"), patch)); // a Lead Scout is not an admin either
    await assertFails(updateDoc(doc(as(OTHER), S("scoutEntries"), "B4-EV"), patch));
    await assertFails(updateDoc(doc(anon(), S("scoutEntries"), "B4-EV"), patch));
    await assertSucceeds(updateDoc(doc(as(ADMIN), S("scoutEntries"), "B4-NEW"), patch));
    await assertSucceeds(updateDoc(doc(as(ADMIN), S("scoutEntries"), "B4-EV"), patch));
    await assertFails(updateDoc(doc(as(ADMIN_T2), S("scoutEntries"), "B4-EV"), patch)); // an admin of another team
    expect((await getDoc(doc(as(ADMIN), S("scoutEntries"), "B4-NEW"))).data()).toMatchObject({ accuracy: { status: "complete", value: 1 }, importedFrom: "csv" });
  });

  it("dismiss, exclude and the audit entry are admin-only: a plain scout and another team's admin are refused", async () => {
    const dismissed = [{ type: "low", title: "Low", detail: "", dismissed: true }];
    const audit = (uid: string, teamId: string) => ({ ...buildAuditEntry(teamId, uid, "x", "exclude-session", { sessionId: "B4-S1" }, { excluded: false }, { excluded: true }), createdAt: serverTimestamp() });
    for (const who of [SCOUT, LEAD, OTHER, ADMIN_T2]) {
      await assertFails(updateDoc(doc(as(who), S("practiceSessions"), "B4-S1"), { excluded: true }));
      await assertFails(updateDoc(doc(as(who), S("practiceSessions"), "B4-S1"), { flags: dismissed }));
    }
    await assertFails(addDoc(collection(as(SCOUT), S("auditLog")), audit(SCOUT, T1)));
    await assertFails(addDoc(collection(as(ADMIN_T2), S("auditLog")), audit(ADMIN_T2, T1)));
    await assertFails(addDoc(collection(anon(), S("auditLog")), audit(SCOUT, T1)));
    // the admin: exclude, include, dismiss, and the audit entries (written with their own uid and team)
    await assertSucceeds(updateDoc(doc(as(ADMIN), S("practiceSessions"), "B4-S1"), { excluded: true }));
    await assertSucceeds(updateDoc(doc(as(ADMIN), S("practiceSessions"), "B4-S1"), { excluded: false }));
    await assertSucceeds(updateDoc(doc(as(ADMIN), S("practiceSessions"), "B4-S1"), { flags: dismissed }));
    await assertSucceeds(addDoc(collection(as(ADMIN), S("auditLog")), audit(ADMIN, T1)));
    // moving a session to another team or scout is refused even for an admin (Batch 3)
    await assertFails(updateDoc(doc(as(ADMIN), S("practiceSessions"), "B4-S1"), { teamId: T2 }));
  });

  it("hard reset: an admin deletes the scout's completed sessions and their entries; a plain scout, a lead and another team's admin cannot", async () => {
    for (const who of [SCOUT, LEAD, OTHER, ADMIN_T2]) {
      await assertFails(deleteDoc(doc(as(who), S("practiceSessions"), "B4-S3")));
      await assertFails(deleteDoc(doc(as(who), S("scoutEntries"), "B4-E2")));
    }
    // the entries of one session, found by the session id (equality-only), then deleted one by one, then the session
    const found = await assertSucceeds(getDocs(query(coll(ADMIN, "scoutEntries"), where("teamId", "==", T1), where("sessionId", "==", "B4-S3"))));
    expect(ids(found)).toEqual(["B4-E2"]);
    for (const d of found.docs) await assertSucceeds(deleteDoc(doc(as(ADMIN), S("scoutEntries"), d.id)));
    await assertSucceeds(deleteDoc(doc(as(ADMIN), S("practiceSessions"), "B4-S3")));
    await assertSucceeds(addDoc(collection(as(ADMIN), S("auditLog")), { ...buildAuditEntry(T1, ADMIN, "Admin", "hard-reset-scout-data", { targetUid: SCOUT }, { sessionCount: 1, entryCount: 1 }, { sessionCount: 0, entryCount: 0 }), createdAt: serverTimestamp() }));
  });

  it("CSV import: a batch of 400 stable-id entries writes as a team admin and as a Lead Scout; another team and a signed-out user cannot", async () => {
    await assertSucceeds(importBatch(ADMIN, T1, 1, 400));
    expect((await getDoc(doc(as(ADMIN), S("scoutEntries"), "csv_b4_1"))).data()).toMatchObject({ teamId: T1, uid: ADMIN, importedFrom: "csv", source: "event", accuracy: null });
    await assertSucceeds(importBatch(LEAD, T1, 1001, 400, "csv_lead"));
    // into someone else's team, as someone else's uid, or signed out: refused
    await assertFails(importBatch(OTHER, T1, 2001, 2, "csv_x"));
    const otherDb = as(OTHER);
    const spoof = writeBatch(otherDb);
    spoof.set(doc(otherDb, S("scoutEntries"), "csv_spoof"), ftcScoutEntryDoc(T1, SCOUT, importInput(1), serverTimestamp));
    await assertFails(spoof.commit());
    const anonDb = anon();
    const out = writeBatch(anonDb);
    out.set(doc(anonDb, S("scoutEntries"), "csv_anon"), ftcScoutEntryDoc(T1, SCOUT, importInput(1), serverTimestamp));
    await assertFails(out.commit());
  });

  it("CSV import twice: writing an id again is an update (admin only), which is why the app leaves existing ids out of the second import", async () => {
    await assertFails(importBatch(LEAD, T1, 1001, 2, "csv_lead")); // an update: refused for a Lead Scout
    // the first import wrote exactly what was sent, the marker on all of it (800 imported, plus the scout's own B4-NEW that carries the marker in this test)
    const imported = await assertSucceeds(getDocs(query(coll(ADMIN, "scoutEntries"), where("teamId", "==", T1), where("importedFrom", "==", "csv"))));
    expect(imported.size).toBe(801);
  });
});

describe("Team Settings and the Changelog (Batch 5a)", () => {
  const MEMBER = SCOUT; // a plain member of team 1 (seeded above); never an admin
  const ADMIN_T2 = "ftc-admin-b5-t2"; // an admin of ANOTHER team
  const LEGACY_T = "ftcteam-b5-legacy"; // a team whose doc has no fieldTeams / fieldTeamIdList yet (it predates the list)
  const LEGACY_ADMIN = "ftc-admin-b5-legacy";
  const LEGACY_MEMBER = "ftc-member-b5-legacy";
  const S = (name: string) => programPath("ftc", name);
  const anon = () => testEnv.unauthenticatedContext().firestore();
  const ids = (snap: { docs: { id: string }[] }) => snap.docs.map((d) => d.id).sort();
  const teamRef = (uid: string, teamId = T1) => doc(as(uid), S("teams"), teamId);
  const userRef = (uid: string, target: string) => doc(as(uid), S("users"), target);
  const audit = (teamId: string, uid: string, action: "edit-account-teams" | "edit-member-teams" | "set-active-form" = "edit-account-teams") => buildAuditEntry(teamId, uid, "Someone", action, { change: "x" }, null, null);
  const three = [
    { id: "ft-1", number: 1111, name: "Alpha" },
    { id: "ft-2", number: 2222, name: "Beta" },
    { id: "fteam_b5new", number: 3333, name: "Gamma" },
  ];
  const changelogDoc = (teamId: string, uid: string, extra: Record<string, unknown> = {}) => ({
    teamId, version: "v9.0.0", title: "An entry", date: "2026-11-15", summary: "s", changes: [{ type: "new", text: "x" }], status: "draft", pinned: false, createdBy: uid,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), publishedAt: null, ...extra,
  });

  beforeAll(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, S("users"), ADMIN_T2), { name: "Admin T2", email: "b5t2@example.org", teamId: T2, primaryRole: "team-coach", secondaryRoles: [], isAdmin: true, isOwner: false });
      await setDoc(doc(db, S("teams"), LEGACY_T), { joinCode: "JL", number: 4444, name: "Legacy" });
      await setDoc(doc(db, S("users"), LEGACY_ADMIN), { name: "Legacy Admin", email: "la@example.org", teamId: LEGACY_T, primaryRole: "team-coach", secondaryRoles: [], isAdmin: true, isOwner: false });
      await setDoc(doc(db, S("users"), LEGACY_MEMBER), { name: "Legacy Member", email: "lm@example.org", teamId: LEGACY_T, primaryRole: "match-scout", secondaryRoles: [], isAdmin: false, isOwner: false });
      const published = (teamId: string, status: string) => ({ teamId, version: "v1", title: `${status} entry`, date: "2026-11-01", summary: "", changes: [{ type: "new", text: "x" }], status, pinned: false, createdBy: "seed", createdAt: new Date(), updatedAt: new Date(), publishedAt: status === "published" ? new Date() : null });
      await setDoc(doc(db, S("changelog"), "cl-pub"), published(T1, "published"));
      await setDoc(doc(db, S("changelog"), "cl-draft"), published(T1, "draft"));
      await setDoc(doc(db, S("changelog"), "cl-t2"), published(T2, "published"));
    });
  });

  it("an admin adds a team, assigns a member to it and logs it, in ONE batch (the assignment is checked against the team doc AFTER the batch)", async () => {
    const db = as(ADMIN);
    const batch = writeBatch(db);
    batch.update(doc(db, S("teams"), T1), fieldTeamsFields(three.map((t) => ({ ...t, name: t.name }))));
    batch.update(doc(db, S("users"), MEMBER), { fieldTeamIds: ["ft-1", "fteam_b5new"] });
    batch.set(doc(collection(db, S("auditLog"))), audit(T1, ADMIN));
    await assertSucceeds(batch.commit());
    const team = (await getDoc(doc(as(ADMIN), S("teams"), T1))).data();
    expect(team?.fieldTeamIdList).toEqual(["ft-1", "ft-2", "fteam_b5new"]);
    expect(team?.fieldTeamNumbers).toEqual([1111, 2222, 3333]);
    expect((await getDoc(doc(as(ADMIN), S("users"), MEMBER))).data()?.fieldTeamIds).toEqual(["ft-1", "fteam_b5new"]);
  });

  it("the same batch is refused without the team write when the member is put on a team that does not exist yet", async () => {
    const db = as(ADMIN);
    const batch = writeBatch(db);
    batch.update(doc(db, S("users"), MEMBER), { fieldTeamIds: ["fteam_not_there"] });
    await assertFails(batch.commit());
  });

  it("renaming a team (same ids) is allowed for an admin", async () => {
    const renamed = three.map((t) => (t.id === "ft-2" ? { ...t, name: "Beta Renamed" } : t));
    await assertSucceeds(updateDoc(teamRef(ADMIN), fieldTeamsFields(renamed)));
    expect(((await getDoc(teamRef(ADMIN))).data()?.fieldTeams as { name: string }[])[1].name).toBe("Beta Renamed");
  });

  it("who may change the team list: a plain member, an admin of another team and a signed-out user may not", async () => {
    const fields = fieldTeamsFields(three);
    await assertFails(updateDoc(teamRef(MEMBER), fields));
    await assertFails(updateDoc(teamRef(ADMIN_T2), fields));
    await assertFails(updateDoc(doc(anon(), S("teams"), T1), fields));
    // and the other team's doc is out of reach of team 1's admin
    await assertFails(updateDoc(teamRef(ADMIN, T2), fieldTeamsFields([{ id: "x", number: 1, name: "" }])));
  });

  it("invalid shapes of fieldTeams are refused: no list, more than 10, an id list of another length, an id list that is not a list", async () => {
    const ok = fieldTeamsFields(three);
    await assertFails(updateDoc(teamRef(ADMIN), { ...ok, fieldTeams: [], fieldTeamIdList: [] }));
    const eleven = Array.from({ length: 11 }, (_, i) => ({ id: `t${i}`, number: i + 1, name: "" }));
    await assertFails(updateDoc(teamRef(ADMIN), { fieldTeams: eleven, fieldTeamIdList: eleven.map((t) => t.id) }));
    await assertFails(updateDoc(teamRef(ADMIN), { ...ok, fieldTeamIdList: ["ft-1"] }));
    await assertFails(updateDoc(teamRef(ADMIN), { ...ok, fieldTeamIdList: "ft-1" }));
    await assertFails(updateDoc(teamRef(ADMIN), { fieldTeams: "nope" }));
    // what the rules do NOT check (the editor and the pure validation do): a number's digits and uniqueness inside an entry
    await assertSucceeds(updateDoc(teamRef(ADMIN), fieldTeamsFields(three)));
  });

  it("removing a team that a member still lists is accepted by the rules (the app refuses it first); the member's own stale list then cannot be re-saved with the removed id", async () => {
    const without = three.filter((t) => t.id !== "fteam_b5new");
    await assertSucceeds(updateDoc(teamRef(ADMIN), fieldTeamsFields(without)));
    // unchanged is always fine (a role edit never fails on an old assignment) ...
    await assertSucceeds(updateDoc(userRef(ADMIN, MEMBER), { primaryRole: "match-scout" }));
    // ... but a NEW list may only name teams that exist
    await assertFails(updateDoc(userRef(ADMIN, MEMBER), { fieldTeamIds: ["ft-2", "fteam_b5new"] }));
    await assertSucceeds(updateDoc(userRef(ADMIN, MEMBER), { fieldTeamIds: ["ft-1"] }));
  });

  it("fieldTeamIds: an admin may set them (own row included); the member may not change their own, for any value; another team's admin and a signed-out user may not", async () => {
    await assertSucceeds(updateDoc(userRef(ADMIN, MEMBER), { fieldTeamIds: ["ft-1", "ft-2"] }));
    await assertSucceeds(updateDoc(userRef(ADMIN, ADMIN), { fieldTeamIds: ["ft-2"] }));
    // a member assigning THEMSELVES to a team (even one that exists) is refused; the rules lock fieldTeamIds on the self-update
    await assertFails(updateDoc(userRef(MEMBER, MEMBER), { fieldTeamIds: ["ft-2"] }));
    await assertFails(updateDoc(userRef(MEMBER, MEMBER), { fieldTeamIds: [] }));
    await assertFails(updateDoc(userRef(MEMBER, "ftc-lead-1"), { fieldTeamIds: ["ft-2"] })); // nor a teammate
    await assertFails(updateDoc(userRef(ADMIN_T2, MEMBER), { fieldTeamIds: ["ft-1"] }));
    await assertFails(updateDoc(doc(anon(), S("users"), MEMBER), { fieldTeamIds: ["ft-1"] }));
    // a list of ids that are not on the account, or more than ten
    await assertFails(updateDoc(userRef(ADMIN, MEMBER), { fieldTeamIds: ["ft-1", "nope"] }));
    await assertFails(updateDoc(userRef(ADMIN, MEMBER), { fieldTeamIds: "ft-1" }));
    // the member's other self-edits still work
    await assertSucceeds(updateDoc(userRef(MEMBER, MEMBER), { themeId: "default" }));
  });

  it("an account that predates the list: assigning needs the team doc's id list, so the app writes the team list in the same batch (and that batch is accepted)", async () => {
    const db = as(LEGACY_ADMIN);
    const alone = writeBatch(db);
    alone.update(doc(db, S("users"), LEGACY_MEMBER), { fieldTeamIds: ["ft-4444"] });
    await assertFails(alone.commit());
    const both = writeBatch(db);
    both.update(doc(db, S("teams"), LEGACY_T), fieldTeamsFields([{ id: "ft-4444", number: 4444, name: "Legacy" }]));
    both.update(doc(db, S("users"), LEGACY_MEMBER), { fieldTeamIds: ["ft-4444"] });
    both.set(doc(collection(db, S("auditLog"))), audit(LEGACY_T, LEGACY_ADMIN, "edit-member-teams"));
    await assertSucceeds(both.commit());
  });

  it("activeForms: an admin sets the season's form; any other season key, a non-string or an empty or long id is refused; a member cannot", async () => {
    await assertSucceeds(updateDoc(teamRef(ADMIN), { "activeForms.biobuzz": "my-form" }));
    expect((await getDoc(teamRef(ADMIN))).data()?.activeForms).toEqual({ biobuzz: "my-form" });
    await assertFails(updateDoc(teamRef(ADMIN), { "activeForms.other": "x" }));
    await assertFails(updateDoc(teamRef(ADMIN), { "activeForms.biobuzz": 5 }));
    await assertFails(updateDoc(teamRef(ADMIN), { "activeForms.biobuzz": "" }));
    await assertFails(updateDoc(teamRef(ADMIN), { "activeForms.biobuzz": "x".repeat(41) }));
    await assertFails(updateDoc(teamRef(MEMBER), { "activeForms.biobuzz": "other" }));
    await assertFails(updateDoc(teamRef(ADMIN_T2), { "activeForms.biobuzz": "other" }));
    // with its audit entry in one batch, as the app writes it
    const db = as(ADMIN);
    const batch = writeBatch(db);
    batch.update(doc(db, S("teams"), T1), { "activeForms.biobuzz": "biobuzz" });
    batch.set(doc(collection(db, S("auditLog"))), audit(T1, ADMIN, "set-active-form"));
    await assertSucceeds(batch.commit());
  });

  it("audit log: an admin creates an entry for their own team as themselves; a member, a spoofed uid, another team's admin and a signed-out user cannot; only an admin reads", async () => {
    await assertSucceeds(addDoc(collection(as(ADMIN), S("auditLog")), audit(T1, ADMIN)));
    await assertFails(addDoc(collection(as(MEMBER), S("auditLog")), audit(T1, MEMBER)));
    await assertFails(addDoc(collection(as(ADMIN), S("auditLog")), audit(T1, "someone-else")));
    await assertFails(addDoc(collection(as(ADMIN_T2), S("auditLog")), audit(T1, ADMIN_T2)));
    await assertFails(addDoc(collection(anon(), S("auditLog")), audit(T1, ADMIN)));
    await assertSucceeds(getDocs(query(collection(as(ADMIN), S("auditLog")), where("teamId", "==", T1))));
    await assertFails(getDocs(query(collection(as(MEMBER), S("auditLog")), where("teamId", "==", T1))));
  });

  it("changelog reads: a member's exact query (teamId ==, status == published) sees only published entries; the unfiltered one is refused; an admin sees drafts too; another team and signed-out cannot", async () => {
    const coll = (uid: string) => collection(as(uid), S("changelog"));
    expect(ids(await assertSucceeds(getDocs(query(coll(MEMBER), where("teamId", "==", T1), where("status", "==", "published")))))).toEqual(["cl-pub"]);
    await assertFails(getDocs(query(coll(MEMBER), where("teamId", "==", T1))));
    expect(ids(await assertSucceeds(getDocs(query(coll(ADMIN), where("teamId", "==", T1)))))).toEqual(["cl-draft", "cl-pub"]);
    await assertFails(getDocs(query(coll(ADMIN_T2), where("teamId", "==", T1), where("status", "==", "published"))));
    await assertFails(getDocs(query(collection(anon(), S("changelog")), where("teamId", "==", T1), where("status", "==", "published"))));
    await assertFails(getDoc(doc(as(MEMBER), S("changelog"), "cl-draft")));
    await assertSucceeds(getDoc(doc(as(MEMBER), S("changelog"), "cl-pub")));
  });

  it("changelog writes: an admin creates a draft and a published entry (the app's shape) and edits one; a member, another team's admin and a spoofed createdBy cannot; the old app's `legacy` key is not accepted", async () => {
    const coll = (uid: string) => collection(as(uid), S("changelog"));
    await assertSucceeds(addDoc(coll(ADMIN), changelogDoc(T1, ADMIN)));
    await assertSucceeds(addDoc(coll(ADMIN), changelogDoc(T1, ADMIN, { status: "published", publishedAt: serverTimestamp() })));
    await assertFails(addDoc(coll(MEMBER), changelogDoc(T1, MEMBER)));
    await assertFails(addDoc(coll(ADMIN_T2), changelogDoc(T1, ADMIN_T2)));
    await assertFails(addDoc(coll(ADMIN), changelogDoc(T1, "someone-else")));
    await assertFails(addDoc(collection(anon(), S("changelog")), changelogDoc(T1, ADMIN)));
    await assertFails(addDoc(coll(ADMIN), changelogDoc(T1, ADMIN, { legacy: true })));
    await assertFails(addDoc(coll(ADMIN), changelogDoc(T1, ADMIN, { status: "published", publishedAt: null })));
    await assertSucceeds(updateDoc(doc(as(ADMIN), S("changelog"), "cl-draft"), { title: "Edited", updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(as(MEMBER), S("changelog"), "cl-draft"), { title: "Edited" }));
    await assertFails(deleteDoc(doc(as(MEMBER), S("changelog"), "cl-pub")));
    await assertSucceeds(deleteDoc(doc(as(ADMIN), S("changelog"), "cl-draft")));
  });

  it("the first-visit seed (one transaction: starter drafts, changelogSeeded on the team doc, an audit entry) works for an admin and not for a member", async () => {
    const seed = (uid: string) => {
      const db = as(uid);
      const teamDoc = doc(db, S("teams"), T1);
      return runTransaction(db, async (tx) => {
        const team = await tx.get(teamDoc);
        if (team.data()?.changelogSeeded === true) return false;
        for (const s of FTC_STARTER_ENTRIES) {
          tx.set(doc(db, S("changelog"), `starter-${T1}-${s.key}`), changelogDoc(T1, uid, { version: s.version, title: s.title, date: s.date, summary: s.summary, changes: s.changes }));
        }
        tx.update(teamDoc, { changelogSeeded: true });
        tx.set(doc(collection(db, S("auditLog"))), audit(T1, uid));
        return true;
      });
    };
    await assertFails(seed(MEMBER));
    expect(await assertSucceeds(seed(ADMIN))).toBe(true);
    expect(await assertSucceeds(seed(ADMIN))).toBe(false); // the flag is set: a second visit writes nothing
    const drafts = await getDocs(query(collection(as(ADMIN), S("changelog")), where("teamId", "==", T1)));
    expect(drafts.docs.filter((d) => d.id.startsWith(`starter-${T1}-`)).length).toBe(FTC_STARTER_ENTRIES.length);
  });

  it("lastSeenChangelogAt: a person stamps their own user doc; nobody else's; a signed-out user cannot", async () => {
    await assertSucceeds(updateDoc(userRef(MEMBER, MEMBER), { lastSeenChangelogAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(userRef(ADMIN, ADMIN), { lastSeenChangelogAt: serverTimestamp() }));
    await assertFails(updateDoc(userRef(MEMBER, "ftc-lead-1"), { lastSeenChangelogAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(anon(), S("users"), MEMBER), { lastSeenChangelogAt: serverTimestamp() }));
    expect((await getDoc(userRef(MEMBER, MEMBER))).data()?.lastSeenChangelogAt).toBeTruthy();
  });
});

describe("FTC live practice presence and lobbies (Batch 6): the replacement queries, by path, never a collection group", () => {
  const S = (name: string) => programPath("ftc", name);
  const MATE = "ftc-lead-1"; // another plain member of team 1 that other tests already seed
  const anon = () => testEnv.unauthenticatedContext().firestore();
  const ids = (snap: { docs: { id: string }[] }) => snap.docs.map((d) => d.id).sort();
  const presence = (uid: string, teamId: string) => ({ uid, teamId, name: uid, robot: 111, alliance: "red", sessionId: "LV-B6", lastSeen: serverTimestamp() });
  const scouts = (uid: string, key: string) => collection(as(uid), S("liveMatches"), key, "scouts");
  const players = (uid: string, lobbyId: string) => collection(as(uid), S("lobbies"), lobbyId, "players");
  const lobbyDocData = (teamId: string, hostUid: string, status: string) => ({ teamId, hostUid, hostName: "Host", seasonId: "biobuzz", mode: "trial", status, libraryMatchId: null, settings: { hostScouts: true, hostIsDisplayer: false }, pairing: null, startsAt: null, resolvedAt: null });

  beforeAll(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const stamp = { lastSeen: new Date(1000) };
      await setDoc(doc(db, S("liveMatches"), "EVB6_Q1", "scouts", MATE), { uid: MATE, teamId: T1, name: "Grace", robot: 222, alliance: "red", sessionId: "LV-MATE", ...stamp });
      await setDoc(doc(db, S("liveMatches"), "EVB6_Q1", "scouts", OTHER), { uid: OTHER, teamId: T2, name: "Other", robot: 333, alliance: "blue", sessionId: "LV-OTHER", ...stamp });
      await setDoc(doc(db, S("lobbies"), "LB-B6OPEN"), lobbyDocData(T1, MATE, "waiting"));
      await setDoc(doc(db, S("lobbies"), "LB-B6DONE"), lobbyDocData(T1, MATE, "closed"));
      await setDoc(doc(db, S("lobbies"), "LB-B6OTHER"), lobbyDocData(T2, OTHER, "waiting"));
      await setDoc(doc(db, S("lobbies"), "LB-B6OPEN", "players", MATE), { uid: MATE, teamId: T1, name: "Grace", submitted: false, ...stamp, joinedAt: new Date(1000) });
      await setDoc(doc(db, S("lobbies"), "LB-B6OTHER", "players", OTHER), { uid: OTHER, teamId: T2, name: "Other", submitted: false, ...stamp, joinedAt: new Date(1000) });
    });
  });

  describe("presence: liveMatches/{key}/scouts/{uid}", () => {
    it("a scout marks themselves present on a match, as themselves and for their own team, and takes it back", async () => {
      await assertSucceeds(setDoc(doc(as(SCOUT), S("liveMatches"), "EVB6_Q1", "scouts", SCOUT), presence(SCOUT, T1)));
      await assertSucceeds(deleteDoc(doc(as(SCOUT), S("liveMatches"), "EVB6_Q1", "scouts", SCOUT)));
    });

    it("nobody writes a teammate's presence, or presence for another team, and a signed-out user writes nothing", async () => {
      await assertFails(setDoc(doc(as(SCOUT), S("liveMatches"), "EVB6_Q1", "scouts", MATE), presence(MATE, T1)));
      await assertFails(setDoc(doc(as(SCOUT), S("liveMatches"), "EVB6_Q1", "scouts", SCOUT), presence(SCOUT, T2)));
      await assertFails(setDoc(doc(anon(), S("liveMatches"), "EVB6_Q1", "scouts", SCOUT), presence(SCOUT, T1)));
    });

    it("the derived read: one match's scouts where teamId == mine returns only my team's, and the parent match doc is never readable", async () => {
      expect(ids(await assertSucceeds(getDocs(query(scouts(SCOUT, "EVB6_Q1"), where("teamId", "==", T1)))))).toEqual([MATE]);
      await assertFails(getDoc(doc(as(SCOUT), S("liveMatches"), "EVB6_Q1")));
    });

    it("asking for another team's scouts, for everyone's (no team filter), or signed out is refused", async () => {
      await assertFails(getDocs(query(scouts(SCOUT, "EVB6_Q1"), where("teamId", "==", T2))));
      await assertFails(getDocs(scouts(SCOUT, "EVB6_Q1")));
      await assertFails(getDocs(query(collection(anon(), S("liveMatches"), "EVB6_Q1", "scouts"), where("teamId", "==", T1))));
    });

    it("the team's live sessions (where the match keys come from) are a plain two-equality read", async () => {
      await assertSucceeds(getDocs(query(collection(as(SCOUT), S("practiceSessions")), where("teamId", "==", T1), where("kind", "==", "live"))));
      await assertFails(getDocs(query(collection(as(SCOUT), S("practiceSessions")), where("kind", "==", "live"))));
    });
  });

  describe("lobbies: lobbies/{code} and players/{uid}", () => {
    it("a member reserves a fresh code as the host (the same transaction the app uses) and only the host changes the lobby", async () => {
      const claim = (uid: string, id: string, data: Record<string, unknown>) => tryClaimDoc(as(uid) as unknown as Parameters<typeof tryClaimDoc>[0], S("lobbies"), id, data);
      const stub = lobbyStub({ teamId: T1, hostUid: SCOUT, hostName: "Ada", seasonId: "biobuzz", mode: "trial" }, serverTimestamp);
      expect(await assertSucceeds(claim(SCOUT, "LB-B6NEW1", stub))).toBe(true);
      expect(await assertSucceeds(claim(SCOUT, "LB-B6NEW1", stub))).toBe(false); // taken: the app tries another code
      await assertSucceeds(updateDoc(doc(as(SCOUT), S("lobbies"), "LB-B6NEW1"), { status: "scouting", startsAt: new Date().toISOString() }));
      await assertFails(updateDoc(doc(as(MATE), S("lobbies"), "LB-B6NEW1"), { status: "closed" }));
      await assertFails(claim(SCOUT, "LB-B6NEW2", lobbyStub({ teamId: T1, hostUid: MATE, hostName: "x", seasonId: "biobuzz", mode: "trial" }, serverTimestamp))); // not as someone else
      await assertFails(claim(SCOUT, "LB-B6NEW3", lobbyStub({ teamId: T2, hostUid: SCOUT, hostName: "x", seasonId: "biobuzz", mode: "trial" }, serverTimestamp))); // not for another team
    });

    it("joining by code: a lobby of my team is readable by id, another team's is not, a missing code reads as free (no error)", async () => {
      await assertSucceeds(getDoc(doc(as(SCOUT), S("lobbies"), "LB-B6OPEN")));
      await assertFails(getDoc(doc(as(SCOUT), S("lobbies"), "LB-B6OTHER")));
      expect((await assertSucceeds(getDoc(doc(as(SCOUT), S("lobbies"), "LB-B6NOPE")))).exists()).toBe(false);
    });

    it("the team's lobbies: lobbies where teamId == mine; another team's, or no filter, is refused", async () => {
      const mine = ids(await assertSucceeds(getDocs(query(collection(as(SCOUT), S("lobbies")), where("teamId", "==", T1)))));
      expect(mine).toEqual(expect.arrayContaining(["LB-B6DONE", "LB-B6OPEN"]));
      expect(mine).not.toContain("LB-B6OTHER");
      await assertFails(getDocs(query(collection(as(SCOUT), S("lobbies")), where("teamId", "==", T2))));
      await assertFails(getDocs(collection(as(SCOUT), S("lobbies"))));
    });

    it("a player joins, heartbeats, submits, resets and leaves as themselves, for their own team", async () => {
      const mine = doc(as(SCOUT), S("lobbies"), "LB-B6OPEN", "players", SCOUT);
      await assertSucceeds(setDoc(mine, { uid: SCOUT, teamId: T1, name: "Ada", lastSeen: serverTimestamp(), submitted: false, joinedAt: serverTimestamp() }, { merge: true }));
      await assertSucceeds(updateDoc(mine, { lastSeen: serverTimestamp() }));
      await assertSucceeds(updateDoc(mine, { submitted: true }));
      await assertSucceeds(updateDoc(mine, { submitted: false }));
      await assertSucceeds(deleteDoc(mine));
    });

    it("nobody writes a teammate's player doc, or one for another team, and a signed-out user writes nothing", async () => {
      await assertFails(updateDoc(doc(as(SCOUT), S("lobbies"), "LB-B6OPEN", "players", MATE), { submitted: true }));
      await assertFails(deleteDoc(doc(as(SCOUT), S("lobbies"), "LB-B6OPEN", "players", MATE)));
      await assertFails(setDoc(doc(as(SCOUT), S("lobbies"), "LB-B6OPEN", "players", SCOUT), { uid: SCOUT, teamId: T2, name: "x", submitted: false }));
      await assertFails(setDoc(doc(anon(), S("lobbies"), "LB-B6OPEN", "players", SCOUT), { uid: SCOUT, teamId: T1, name: "x", submitted: false }));
    });

    it("the roster: players where teamId == mine; another team's or no filter is refused", async () => {
      expect(ids(await assertSucceeds(getDocs(query(players(SCOUT, "LB-B6OPEN"), where("teamId", "==", T1)))))).toContain(MATE);
      await assertFails(getDocs(query(players(SCOUT, "LB-B6OPEN"), where("teamId", "==", T2))));
      await assertFails(getDocs(players(SCOUT, "LB-B6OPEN")));
    });

    it('"the lobby I am in": players where teamId == mine and uid == me, by path, in each open lobby (an empty answer is allowed)', async () => {
      const own = doc(as(SCOUT), S("lobbies"), "LB-B6OPEN", "players", SCOUT);
      await assertSucceeds(setDoc(own, { uid: SCOUT, teamId: T1, name: "Ada", lastSeen: serverTimestamp(), submitted: false, joinedAt: serverTimestamp() }));
      const mineQ = (lobbyId: string) => query(players(SCOUT, lobbyId), where("teamId", "==", T1), where("uid", "==", SCOUT));
      expect(ids(await assertSucceeds(getDocs(mineQ("LB-B6OPEN"))))).toEqual([SCOUT]);
      expect(ids(await assertSucceeds(getDocs(mineQ("LB-B6DONE"))))).toEqual([]); // not in that one: empty, not an error
      await assertSucceeds(deleteDoc(own));
    });

    it("why it is a query and not a get: reading a player doc that does not exist is refused, so a get would fail in every lobby I am not in", async () => {
      await assertFails(getDoc(doc(as(SCOUT), S("lobbies"), "LB-B6DONE", "players", SCOUT)));
    });

    it("another team's lobby and roster stay unreadable", async () => {
      await assertFails(getDoc(doc(as(SCOUT), S("lobbies"), "LB-B6OTHER", "players", OTHER)));
      await assertFails(getDocs(query(players(SCOUT, "LB-B6OTHER"), where("teamId", "==", T2))));
    });
  });
});
