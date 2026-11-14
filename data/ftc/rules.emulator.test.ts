import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { addDoc, collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { ftcDocsToFormEntries } from "@/data/ftc/form-entries";
import { ftcDocsToFormDocs, ftcDocToFormVersion } from "@/data/ftc/forms";
import { ftcDocsToScoutEntries, ftcScoutEntryDoc } from "@/data/ftc/scouting";
import { ftcTeamToTeamDoc } from "@/data/ftc/teams";
import { ftcUserToMember, ftcUserToProfile } from "@/data/ftc/users";
import { programPath } from "@/lib/firebase/paths";
import type { SaveEntryInput } from "@/lib/scout-entries";

// The FTC data layer against the real firestore.rules (the `programs/ftc` block), in the Firestore emulator: the documents it writes are accepted, and
// every query it makes (the same shapes as data/ftc/read.ts, whose constraints data/ftc/read.test.ts pins) is one the rules allow: only the account's
// own team, and a teammate's data is refused. Needs the emulator: `npm run test:rules` (this file is in vitest.rules.config.ts).
// Paths come from programPath, as in the app.

let testEnv: RulesTestEnvironment;

const T1 = "ftcteam1";
const T2 = "ftcteam2";
const SCOUT = "ftc-scout-1";
const OTHER = "ftc-scout-other";

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
    await setDoc(doc(db, P("users"), OTHER), { name: "Other", email: "o@example.org", teamId: T2, primaryRole: "match-scout", secondaryRoles: [], isAdmin: false, isOwner: false });
    await setDoc(doc(db, P("teams"), T1), {
      joinCode: "J1",
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
    expect(rows.map((m) => m.name).sort()).toEqual(["Ada", "Grace"]);
    await assertFails(getDocs(query(collection(db, P("users")), where("teamId", "==", T2))));
  });

  it("the page-access settings of the account are readable by a member", async () => {
    await assertSucceeds(getDoc(doc(as(SCOUT), P("teams"), T1, "settings", "pageAccess")));
    await assertFails(getDoc(doc(as(OTHER), P("teams"), T1, "settings", "pageAccess")));
  });
});
