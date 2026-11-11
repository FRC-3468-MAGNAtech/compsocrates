import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import {
  addDoc,
  arrayUnion,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";

// Rules tests for the rebuild's firestore.rules (CS production rules + the additions; see the header of that file).
// Needs the Firebase Emulator Suite: `npm run test:rules` (firebase emulators:exec). Fixtures are CS-shaped:
// users have `role` / `roles` / `secondaryRoles` / `isTeamAdmin` / `teamId`, teams are `teams/{TEAMCODE}`.
//
// Layout: 1. CS production behavior (must not change without the owner's approval), 2. additions for collections CS's
// rules lack, 3. CompEpicurus-only collections on CS user fields, 4. server-only collections and the catch-all.

let testEnv: RulesTestEnvironment;

const TEAM1 = "TEAMONE";
const TEAM2 = "TEAMTWO";
/** The one uid CS's production rules hardcode as owner (see ownerUid() in firestore.rules). */
const CS_OWNER = "veKYze7lFOOjZj8Vwnp9erZGTjs2";

const ADMIN = "admin-1"; // isTeamAdmin == true, the team's verifiedOwnerId
const ADMIN2 = "admin-2"; // a second admin
const COACH = "coach-1"; // role == "coach" (legacy admin value)
const LEAD = "lead-1"; // role "lead-scout" (canonical)
const LEGACY_LEAD = "lead-legacy-1"; // role "lead_scout" (legacy CS spelling)
const LEAD_VIA_ROLES = "lead-roles-1"; // roles: ["lead-scout"]
const STRATEGIST = "strat-1"; // secondaryRoles: ["lead-strategist"]
const SCOUT = "scout-1"; // role "match-scout"
const SCOUT2 = "scout-2";
const OTHER_ADMIN = "other-admin-1"; // team 2 admin
const OTHER_SCOUT = "other-scout-1"; // team 2 member
const NO_TEAM = "noteam-1"; // user doc with teamId ""
const NO_DOC = "nodoc-1"; // signed in, no users/{uid} doc

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: process.env.GCLOUD_PROJECT || "demo-compsocrates-rebuild",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

const as = (uid: string, claims?: Record<string, unknown>) => testEnv.authenticatedContext(uid, claims).firestore();
const anon = () => testEnv.unauthenticatedContext().firestore();
type Db = ReturnType<typeof as>;

/** Writes with the rules off (fixtures). */
async function seed(fn: (db: Db) => Promise<void>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => fn(ctx.firestore() as Db));
}

const user = (over: Record<string, unknown>) => ({ email: "x@example.com", displayName: "Person", teamId: TEAM1, role: "match-scout", isTeamAdmin: false, ...over });

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seed(async (db) => {
    await setDoc(doc(db, "teams", TEAM1), { teamName: "Team One", teamNumber: "1111", verifiedOwnerId: ADMIN, selectedEvents: ["2026arli"] });
    await setDoc(doc(db, "teams", TEAM2), { teamName: "Team Two", teamNumber: "2222", verifiedOwnerId: OTHER_ADMIN, selectedEvents: [] });
    await setDoc(doc(db, "users", CS_OWNER), user({ displayName: "The Owner" }));
    await setDoc(doc(db, "users", ADMIN), user({ displayName: "Admin", role: "lead-scout", isTeamAdmin: true }));
    await setDoc(doc(db, "users", ADMIN2), user({ displayName: "Admin Two", role: "match-scout", isTeamAdmin: true }));
    await setDoc(doc(db, "users", COACH), user({ displayName: "Coach", role: "coach" }));
    await setDoc(doc(db, "users", LEAD), user({ displayName: "Lead", role: "lead-scout" }));
    await setDoc(doc(db, "users", LEGACY_LEAD), user({ displayName: "Legacy Lead", role: "lead_scout" }));
    await setDoc(doc(db, "users", LEAD_VIA_ROLES), user({ displayName: "Lead Roles", role: "match-scout", roles: ["lead-scout"] }));
    await setDoc(doc(db, "users", STRATEGIST), user({ displayName: "Strategist", role: "match-scout", secondaryRoles: ["lead-strategist"] }));
    await setDoc(doc(db, "users", SCOUT), user({ displayName: "Scout" }));
    await setDoc(doc(db, "users", SCOUT2), user({ displayName: "Scout Two" }));
    await setDoc(doc(db, "users", OTHER_ADMIN), user({ displayName: "Other Admin", teamId: TEAM2, isTeamAdmin: true }));
    await setDoc(doc(db, "users", OTHER_SCOUT), user({ displayName: "Other Scout", teamId: TEAM2 }));
    await setDoc(doc(db, "users", NO_TEAM), user({ displayName: "Drifter", teamId: "" }));
  });
});

// =====================================================================================================================
// 1. CS PRODUCTION BEHAVIOR
// =====================================================================================================================

describe("CS: users/{uid}", () => {
  it("lets a signed-in user create only their own doc", async () => {
    await assertSucceeds(setDoc(doc(as(NO_DOC), "users", NO_DOC), { displayName: "New", email: "n@example.com" }));
    await assertFails(setDoc(doc(as(NO_DOC), "users", "someone-else"), { displayName: "Spoof" }));
    await assertFails(setDoc(doc(anon(), "users", "anon-1"), { displayName: "Anon" }));
  });

  it("reads: yourself, teammates, anyone for the owner; never another team, a team-less user's peers, or anonymous", async () => {
    await assertSucceeds(getDoc(doc(as(SCOUT), "users", SCOUT)));
    await assertSucceeds(getDoc(doc(as(SCOUT), "users", ADMIN)));
    await assertFails(getDoc(doc(as(SCOUT), "users", OTHER_SCOUT)));
    await assertSucceeds(getDoc(doc(as(CS_OWNER), "users", OTHER_SCOUT)));
    await assertFails(getDoc(doc(as(NO_TEAM), "users", SCOUT)));
    await assertFails(getDoc(doc(as(NO_DOC), "users", SCOUT)));
    await assertFails(getDoc(doc(anon(), "users", SCOUT)));
  });

  it("serves the team roster query (users where teamId == mine) and refuses another team's", async () => {
    await assertSucceeds(getDocs(query(collection(as(SCOUT), "users"), where("teamId", "==", TEAM1))));
    await assertFails(getDocs(query(collection(as(SCOUT), "users"), where("teamId", "==", TEAM2))));
  });

  it("CS-OPEN (kept): a member may write any field of their own doc, including isTeamAdmin and role", async () => {
    await assertSucceeds(updateDoc(doc(as(SCOUT), "users", SCOUT), { isTeamAdmin: true }));
    await assertSucceeds(updateDoc(doc(as(SCOUT2), "users", SCOUT2), { role: "coach" }));
  });

  it("lets a teammate NOT edit someone else's doc", async () => {
    await assertFails(updateDoc(doc(as(SCOUT), "users", SCOUT2), { role: "pit-scout" }));
  });

  it("lets a team admin or a coach edit a teammate (Team Management), merge-writes included", async () => {
    await assertSucceeds(setDoc(doc(as(ADMIN), "users", SCOUT), { role: "pit-scout", roles: ["pit-scout"], secondaryRoles: [] }, { merge: true }));
    await assertSucceeds(updateDoc(doc(as(COACH), "users", SCOUT), { isTeamAdmin: true }));
  });

  it("does not let another team's admin edit this team's members", async () => {
    await assertFails(updateDoc(doc(as(OTHER_ADMIN), "users", SCOUT), { role: "pit-scout" }));
  });

  it("lets a team admin adopt a user who has no team, but not poach one from another team", async () => {
    await assertSucceeds(updateDoc(doc(as(ADMIN), "users", NO_TEAM), { teamId: TEAM1 }));
    await assertFails(updateDoc(doc(as(ADMIN), "users", OTHER_SCOUT), { teamId: TEAM1 }));
  });

  it("lets the owner update any user", async () => {
    await assertSucceeds(updateDoc(doc(as(CS_OWNER), "users", OTHER_SCOUT), { role: "coach" }));
  });

  it("never deletes a user doc, whoever asks", async () => {
    await assertFails(deleteDoc(doc(as(SCOUT), "users", SCOUT)));
    await assertFails(deleteDoc(doc(as(ADMIN), "users", SCOUT)));
    await assertFails(deleteDoc(doc(as(CS_OWNER), "users", SCOUT)));
  });

  it("accepts the additive CE fields the client writes on the user's own doc", async () => {
    const own = doc(as(SCOUT), "users", SCOUT);
    await assertSucceeds(updateDoc(own, { glassLayerLevel: 3 }));
    await assertSucceeds(updateDoc(own, { lastSeenChangelogAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(own, { fcmTokens: arrayUnion("token-1") }));
    await assertSucceeds(updateDoc(own, { workspaceFormWidth: 60, workspacePhoneSplit: 50 }));
    await assertSucceeds(updateDoc(own, { avatar: { type: "initials", value: "SC" } }));
    await assertSucceeds(updateDoc(own, { themeId: "compsocrates", colorMode: "dark", gradientIntensity: "vivid" }));
  });
});

describe("CS: teams/{teamId}", () => {
  it("is readable only by a member of that team", async () => {
    await assertSucceeds(getDoc(doc(as(SCOUT), "teams", TEAM1)));
    await assertFails(getDoc(doc(as(SCOUT), "teams", TEAM2)));
    await assertFails(getDoc(doc(as(NO_TEAM), "teams", TEAM1)));
    await assertFails(getDoc(doc(as(NO_DOC), "teams", TEAM1)));
    await assertFails(getDoc(doc(anon(), "teams", TEAM1)));
    await assertFails(getDoc(doc(as(CS_OWNER), "teams", TEAM2))); // the owner reads as a member, like everyone
  });

  it("can be created by any signed-in user (CS-OPEN, kept), not by anonymous", async () => {
    await assertSucceeds(setDoc(doc(as(NO_DOC), "teams", "BRANDNEW"), { teamName: "New", teamNumber: "3333" }));
    await assertFails(setDoc(doc(anon(), "teams", "ANON"), { teamName: "x" }));
  });

  it("is updated by a team admin, a coach or the owner, never by a member or another team's admin", async () => {
    const patch = { selectedEvents: ["2026arli", "2026okok"] };
    await assertSucceeds(updateDoc(doc(as(ADMIN), "teams", TEAM1), patch));
    await assertSucceeds(updateDoc(doc(as(COACH), "teams", TEAM1), patch));
    await assertSucceeds(updateDoc(doc(as(CS_OWNER), "teams", TEAM1), patch));
    await assertFails(updateDoc(doc(as(SCOUT), "teams", TEAM1), patch));
    await assertFails(updateDoc(doc(as(OTHER_ADMIN), "teams", TEAM1), patch));
    await assertFails(updateDoc(doc(as(NO_DOC), "teams", TEAM1), patch));
  });

  it("is deleted by a team admin or the owner only", async () => {
    await assertFails(deleteDoc(doc(as(SCOUT), "teams", TEAM1)));
    await assertFails(deleteDoc(doc(as(OTHER_ADMIN), "teams", TEAM1)));
    await assertSucceeds(deleteDoc(doc(as(ADMIN), "teams", TEAM1)));
    await assertSucceeds(deleteDoc(doc(as(CS_OWNER), "teams", TEAM2)));
  });

  it("lets a team admin write the additive CE fields (activeForms, flags, judge book cards) and rename the team", async () => {
    const ref = doc(as(ADMIN), "teams", TEAM1);
    await assertSucceeds(updateDoc(ref, { "activeForms.rebuilt": "my-form" }));
    await assertSucceeds(updateDoc(ref, { usePlaceholderVideo: true, libraryBackfilled: true, changelogSeeded: true }));
    await assertSucceeds(updateDoc(ref, { teamName: "Renamed", teamNumber: "1111" }));
    await assertSucceeds(setDoc(ref, { judgeBookCards: [{ id: "c1" }], judgeBookUpdatedAt: Date.now() }, { merge: true }));
    await assertFails(updateDoc(doc(as(SCOUT), "teams", TEAM1), { usePlaceholderVideo: true }));
  });
});

describe("CS: teamJoinRequests/{requestId}", () => {
  const req = (over: Record<string, unknown> = {}) => ({ userId: NO_TEAM, teamId: TEAM1, status: "pending", ...over });

  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "teamJoinRequests", "r1"), req());
    });
  });

  it("is created by the requesting user for a real team id only", async () => {
    await assertSucceeds(addDoc(collection(as(NO_TEAM), "teamJoinRequests"), req()));
    await assertFails(addDoc(collection(as(NO_TEAM), "teamJoinRequests"), req({ userId: SCOUT })));
    await assertFails(addDoc(collection(as(NO_TEAM), "teamJoinRequests"), req({ teamId: "" })));
    await assertFails(addDoc(collection(anon(), "teamJoinRequests"), req()));
  });

  it("is read by the requester, the target team's admin and the owner only", async () => {
    await assertSucceeds(getDoc(doc(as(NO_TEAM), "teamJoinRequests", "r1")));
    await assertSucceeds(getDoc(doc(as(ADMIN), "teamJoinRequests", "r1")));
    await assertSucceeds(getDoc(doc(as(COACH), "teamJoinRequests", "r1")));
    await assertSucceeds(getDoc(doc(as(CS_OWNER), "teamJoinRequests", "r1")));
    await assertFails(getDoc(doc(as(SCOUT), "teamJoinRequests", "r1")));
    await assertFails(getDoc(doc(as(OTHER_ADMIN), "teamJoinRequests", "r1")));
  });

  it("is updated and deleted by the requester or the target team's admin, not by others", async () => {
    await assertSucceeds(updateDoc(doc(as(NO_TEAM), "teamJoinRequests", "r1"), { status: "canceled" }));
    await assertSucceeds(updateDoc(doc(as(ADMIN), "teamJoinRequests", "r1"), { status: "approved" }));
    await assertFails(updateDoc(doc(as(OTHER_ADMIN), "teamJoinRequests", "r1"), { status: "approved" }));
    await assertFails(updateDoc(doc(as(SCOUT), "teamJoinRequests", "r1"), { status: "approved" }));
    await assertFails(deleteDoc(doc(as(SCOUT), "teamJoinRequests", "r1")));
    await assertSucceeds(deleteDoc(doc(as(NO_TEAM), "teamJoinRequests", "r1")));
  });
});

describe("CS: practiceMatches/{docId} (read by everyone signed in, written only by the owner's migration import)", () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "practiceMatches", "m1"), { eventKey: "2026arli", matchKey: "q1" });
      await setDoc(doc(db, "practiceMatches", "m2"), { eventKey: "2024other", matchKey: "q1" });
    });
  });

  it("is readable by any signed-in user and not by anonymous", async () => {
    await assertSucceeds(getDoc(doc(as(NO_DOC), "practiceMatches", "m1")));
    await assertSucceeds(getDocs(collection(as(SCOUT), "practiceMatches")));
    await assertFails(getDoc(doc(anon(), "practiceMatches", "m1")));
  });

  it("refuses writes from admins and members", async () => {
    await assertFails(setDoc(doc(as(ADMIN), "practiceMatches", "n1"), { eventKey: "2026arli" }));
    await assertFails(setDoc(doc(as(SCOUT), "practiceMatches", "n1"), { eventKey: "2026arli" }));
  });

  it.each(["week0", "2026week0", "2025cmptx", "2023mslr", "2023lake", "2026tuis", "2026okok", "2026cosp", "2026arli"])(
    "lets the owner import event key %s",
    async (eventKey) => {
      await assertSucceeds(setDoc(doc(as(CS_OWNER), "practiceMatches", `imp-${eventKey}`), { eventKey, matchKey: "q1" }));
    }
  );

  it("refuses the owner's write for an event key that is not on the import list (create)", async () => {
    await assertFails(setDoc(doc(as(CS_OWNER), "practiceMatches", "n1"), { eventKey: "2030zzzz" }));
    await assertFails(setDoc(doc(as(CS_OWNER), "practiceMatches", "n2"), { matchKey: "q1" }));
  });

  it("lets the owner update or delete a doc whose stored key is an import key, and refuses others", async () => {
    await assertSucceeds(updateDoc(doc(as(CS_OWNER), "practiceMatches", "m1"), { eventKey: "2026arli", videoUrl: "https://youtu.be/x" }));
    await assertSucceeds(deleteDoc(doc(as(CS_OWNER), "practiceMatches", "m1")));
    await assertFails(deleteDoc(doc(as(CS_OWNER), "practiceMatches", "m2")));
  });
});

describe("CS: collections open to any signed-in user (CS-OPEN, kept as is)", () => {
  const OPEN = [
    "scouting",
    "leadScouting",
    "practiceSessions",
    "pitScouting",
    "matchAssignments",
    "pitAssignments",
    "practiceAssignments",
    "strategyScouting",
    "matchStrategyPlans",
    "driveScouting",
    "helperReports",
  ];

  describe.each(OPEN)("%s", (name) => {
    beforeEach(async () => {
      await seed(async (db) => {
        await setDoc(doc(db, name, "d1"), { teamId: TEAM2, scoutId: OTHER_SCOUT, eventKey: "2026arli" });
      });
    });

    it("lets any signed-in user read, create, update and delete, even another team's doc (no team scoping)", async () => {
      const db = as(SCOUT);
      await assertSucceeds(getDoc(doc(db, name, "d1")));
      await assertSucceeds(getDocs(query(collection(db, name), where("teamId", "==", TEAM2))));
      await assertSucceeds(addDoc(collection(db, name), { teamId: TEAM1, scoutId: SCOUT }));
      await assertSucceeds(setDoc(doc(db, name, "d1"), { notes: "edited" }, { merge: true }));
      await assertSucceeds(deleteDoc(doc(db, name, "d1")));
    });

    it("works for a signed-in user with no users doc and refuses anonymous", async () => {
      await assertSucceeds(addDoc(collection(as(NO_DOC), name), { teamId: TEAM1 }));
      await assertFails(getDoc(doc(anon(), name, "d1")));
      await assertFails(addDoc(collection(anon(), name), { teamId: TEAM1 }));
      await assertFails(deleteDoc(doc(anon(), name, "d1")));
    });
  });
});

describe("CS: formPresets/{docId}", () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "formPresets", "p1"), { teamId: TEAM1, name: "Pit", formType: "pit" });
      await setDoc(doc(db, "formPresets", "p2"), { teamId: TEAM2, name: "Other", formType: "pit" });
    });
  });

  it("is created only with your own team id, and only by a user who has a users doc", async () => {
    await assertSucceeds(addDoc(collection(as(SCOUT), "formPresets"), { teamId: TEAM1, name: "New" }));
    await assertFails(addDoc(collection(as(SCOUT), "formPresets"), { teamId: TEAM2, name: "New" }));
    await assertFails(addDoc(collection(as(NO_DOC), "formPresets"), { teamId: TEAM1, name: "New" }));
    await assertFails(addDoc(collection(anon(), "formPresets"), { teamId: TEAM1, name: "New" }));
  });

  it("is read, updated and deleted only inside the team", async () => {
    await assertSucceeds(getDoc(doc(as(SCOUT), "formPresets", "p1")));
    await assertSucceeds(getDocs(query(collection(as(SCOUT), "formPresets"), where("teamId", "==", TEAM1))));
    await assertFails(getDoc(doc(as(SCOUT), "formPresets", "p2")));
    await assertFails(getDocs(query(collection(as(SCOUT), "formPresets"), where("teamId", "==", TEAM2))));
    await assertSucceeds(updateDoc(doc(as(SCOUT), "formPresets", "p1"), { name: "Renamed" }));
    await assertFails(updateDoc(doc(as(SCOUT), "formPresets", "p2"), { name: "Hijack" }));
    await assertFails(deleteDoc(doc(as(SCOUT), "formPresets", "p2")));
    await assertSucceeds(deleteDoc(doc(as(SCOUT), "formPresets", "p1")));
  });
});

describe("CS: accuracyRescouts/{docId}", () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "accuracyRescouts", "a1"), { teamId: TEAM1, status: "pending", teamNumber: 254 });
      await setDoc(doc(db, "accuracyRescouts", "a2"), { teamId: TEAM2, status: "pending", teamNumber: 971 });
    });
  });

  it("is read only inside the team (the client's team-filtered query works, another team's does not)", async () => {
    await assertSucceeds(getDoc(doc(as(SCOUT), "accuracyRescouts", "a1")));
    await assertSucceeds(getDocs(query(collection(as(SCOUT), "accuracyRescouts"), where("teamId", "==", TEAM1))));
    await assertFails(getDoc(doc(as(SCOUT), "accuracyRescouts", "a2")));
    await assertFails(getDocs(query(collection(as(SCOUT), "accuracyRescouts"), where("teamId", "==", TEAM2))));
    await assertFails(getDoc(doc(as(NO_DOC), "accuracyRescouts", "a1")));
  });

  it("is created and updated only when the written doc carries your team id", async () => {
    await assertSucceeds(addDoc(collection(as(SCOUT), "accuracyRescouts"), { teamId: TEAM1, status: "pending" }));
    await assertFails(addDoc(collection(as(SCOUT), "accuracyRescouts"), { teamId: TEAM2, status: "pending" }));
    await assertSucceeds(updateDoc(doc(as(SCOUT), "accuracyRescouts", "a1"), { accuracy: 90 }));
    await assertFails(updateDoc(doc(as(SCOUT), "accuracyRescouts", "a2"), { accuracy: 90 }));
  });

  it("refuses a real delete for everyone (CS behavior: request.resource is null on delete), so the client's soft delete is the working path", async () => {
    await assertFails(deleteDoc(doc(as(SCOUT), "accuracyRescouts", "a1")));
    await assertFails(deleteDoc(doc(as(ADMIN), "accuracyRescouts", "a1")));
    await assertSucceeds(updateDoc(doc(as(SCOUT), "accuracyRescouts", "a1"), { status: "deleted", deletedAt: Date.now() }));
  });

  it("CS-OPEN (kept): a member can take over another team's doc by writing their own team id into it", async () => {
    await assertSucceeds(updateDoc(doc(as(SCOUT), "accuracyRescouts", "a2"), { teamId: TEAM1 }));
  });
});

describe("CS: the catch-all deny", () => {
  it("refuses unknown collections to everyone, owner included", async () => {
    for (const uid of [SCOUT, ADMIN, CS_OWNER]) {
      await assertFails(getDoc(doc(as(uid), "somethingElse", "x")));
      await assertFails(setDoc(doc(as(uid), "somethingElse", "x"), { a: 1 }));
    }
  });

  it("refuses the legacy CE collection scoutEntries and the server-only ones to clients", async () => {
    await assertFails(getDoc(doc(as(ADMIN), "scoutEntries", "x")));
    await assertFails(addDoc(collection(as(ADMIN), "scoutEntries"), { teamId: TEAM1, uid: ADMIN }));
    await assertFails(getDoc(doc(as(CS_OWNER), "imports", "x")));
  });
});

// =====================================================================================================================
// 2. ADDITIONS FOR COLLECTIONS CS'S RULES LACK
// =====================================================================================================================

/** teams/{team}/settings/pageAccess as the rules read it (seeded with the rules off). */
async function seedPageAccess(over: Record<string, unknown> = {}) {
  await seed(async (db) => {
    await setDoc(doc(db, "teams", TEAM1, "settings", "pageAccess"), { roleGrants: {}, pageRoles: {}, memberOverrides: {}, updatedBy: ADMIN, updatedAt: new Date(), ...over });
  });
}

describe("scoutingFlagStates/{entityType:entityId}", () => {
  const ID = "scoutingEntry:abc123";
  const flag = (over: Record<string, unknown> = {}) => ({ teamId: TEAM1, entityType: "scoutingEntry", entityId: "abc123", dismissed: true, ...over });

  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "scoutingFlagStates", ID), flag());
    });
  });

  it("is read by the team (single doc and team query), not by another team or anonymous", async () => {
    await assertSucceeds(getDoc(doc(as(SCOUT), "scoutingFlagStates", ID)));
    await assertSucceeds(getDocs(query(collection(as(SCOUT), "scoutingFlagStates"), where("teamId", "==", TEAM1))));
    await assertFails(getDoc(doc(as(OTHER_SCOUT), "scoutingFlagStates", ID)));
    await assertFails(getDocs(query(collection(as(OTHER_SCOUT), "scoutingFlagStates"), where("teamId", "==", TEAM1))));
    await assertFails(getDoc(doc(anon(), "scoutingFlagStates", ID)));
  });

  it("answers a read of a flag state that does not exist yet (the entry editor reads before writing)", async () => {
    await assertSucceeds(getDoc(doc(as(SCOUT), "scoutingFlagStates", "scoutingEntry:none")));
    await assertFails(getDoc(doc(anon(), "scoutingFlagStates", "scoutingEntry:none")));
  });

  it("is written by admins and, by default, lead scouts (Scout Accuracy access), not by plain members", async () => {
    await assertSucceeds(setDoc(doc(as(ADMIN), "scoutingFlagStates", "scoutingEntry:new"), flag({ entityId: "new" }), { merge: true }));
    await assertSucceeds(setDoc(doc(as(LEAD), "scoutingFlagStates", "scoutingEntry:n2"), flag({ entityId: "n2" })));
    await assertSucceeds(setDoc(doc(as(LEGACY_LEAD), "scoutingFlagStates", "scoutingEntry:n3"), flag({ entityId: "n3" })));
    await assertSucceeds(updateDoc(doc(as(COACH), "scoutingFlagStates", ID), { manualFlagged: true, manualReason: "odd" }));
    await assertFails(setDoc(doc(as(SCOUT), "scoutingFlagStates", "scoutingEntry:n4"), flag({ entityId: "n4" })));
    await assertFails(updateDoc(doc(as(SCOUT), "scoutingFlagStates", ID), { dismissed: false }));
  });

  it("is team-scoped on write: another team's admin cannot touch it, and teamId cannot be moved or forged", async () => {
    await assertFails(updateDoc(doc(as(OTHER_ADMIN), "scoutingFlagStates", ID), { dismissed: false }));
    await assertFails(setDoc(doc(as(ADMIN), "scoutingFlagStates", "scoutingEntry:x"), flag({ teamId: TEAM2 })));
    await assertFails(updateDoc(doc(as(ADMIN), "scoutingFlagStates", ID), { teamId: TEAM2 }));
    await assertFails(deleteDoc(doc(as(OTHER_ADMIN), "scoutingFlagStates", ID)));
  });

  it("is deleted by the same people who write it", async () => {
    await assertFails(deleteDoc(doc(as(SCOUT), "scoutingFlagStates", ID)));
    await assertSucceeds(deleteDoc(doc(as(ADMIN), "scoutingFlagStates", ID)));
  });

  it("follows the Page Access config for scout-accuracy (a grant opens it, a deny closes it)", async () => {
    await seedPageAccess({ memberOverrides: { [SCOUT]: { grant: ["scout-accuracy"], deny: [] }, [LEAD]: { grant: [], deny: ["scout-accuracy"] } } });
    await assertSucceeds(updateDoc(doc(as(SCOUT), "scoutingFlagStates", ID), { dismissed: false }));
    await assertFails(updateDoc(doc(as(LEAD), "scoutingFlagStates", ID), { dismissed: false }));
  });
});

describe("teamAnnouncements/{id}", () => {
  const post = (over: Record<string, unknown> = {}) => ({ teamId: TEAM1, authorId: SCOUT, authorName: "Scout", body: "Meet at 9", type: "info", createdAt: Date.now(), ...over });

  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "teamAnnouncements", "n1"), post());
    });
  });

  it("is read by the team only", async () => {
    await assertSucceeds(getDocs(query(collection(as(SCOUT2), "teamAnnouncements"), where("teamId", "==", TEAM1))));
    await assertSucceeds(getDoc(doc(as(SCOUT2), "teamAnnouncements", "n1")));
    await assertFails(getDoc(doc(as(OTHER_SCOUT), "teamAnnouncements", "n1")));
    await assertFails(getDocs(query(collection(as(OTHER_SCOUT), "teamAnnouncements"), where("teamId", "==", TEAM1))));
    await assertFails(getDoc(doc(anon(), "teamAnnouncements", "n1")));
  });

  it("is posted by a teammate as themselves, in their own team", async () => {
    await assertSucceeds(addDoc(collection(as(SCOUT2), "teamAnnouncements"), post({ authorId: SCOUT2 })));
    await assertFails(addDoc(collection(as(SCOUT2), "teamAnnouncements"), post({ authorId: SCOUT })));
    await assertFails(addDoc(collection(as(SCOUT2), "teamAnnouncements"), post({ teamId: TEAM2, authorId: SCOUT2 })));
    await assertFails(addDoc(collection(as(NO_TEAM), "teamAnnouncements"), post({ authorId: NO_TEAM })));
  });

  it("is deleted by a team admin only, and never edited", async () => {
    await assertFails(deleteDoc(doc(as(SCOUT), "teamAnnouncements", "n1")));
    await assertFails(deleteDoc(doc(as(OTHER_ADMIN), "teamAnnouncements", "n1")));
    await assertFails(updateDoc(doc(as(ADMIN), "teamAnnouncements", "n1"), { body: "edited" }));
    await assertSucceeds(deleteDoc(doc(as(ADMIN), "teamAnnouncements", "n1")));
  });
});

describe("subInRequests/{id} (D7)", () => {
  const open = (over: Record<string, unknown> = {}) => ({
    teamId: TEAM1,
    eventKey: "2026arli",
    matchKey: "Q12",
    matchLabel: "Qualification 12",
    teamNumber: 254,
    requestedById: SCOUT,
    requestedByName: "Scout",
    requestedAt: Date.now(),
    status: "open",
    claimedById: null,
    claimedByName: null,
    claimedAt: null,
    expiresAt: Date.now() + 6 * 3600_000,
    ...over,
  });
  const claim = (uid: string) => ({ status: "claimed", claimedById: uid, claimedByName: "Taker", claimedAt: Date.now() });

  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "subInRequests", "s1"), open());
      await setDoc(doc(db, "subInRequests", "claimed"), open({ ...claim(SCOUT2) }));
    });
  });

  it("is created by a member for themselves, open, in their team", async () => {
    await assertSucceeds(addDoc(collection(as(SCOUT2), "subInRequests"), open({ requestedById: SCOUT2 })));
    await assertFails(addDoc(collection(as(SCOUT2), "subInRequests"), open({ requestedById: SCOUT })));
    await assertFails(addDoc(collection(as(SCOUT2), "subInRequests"), open({ requestedById: SCOUT2, status: "claimed" })));
    await assertFails(addDoc(collection(as(OTHER_SCOUT), "subInRequests"), open({ requestedById: OTHER_SCOUT })));
    await assertFails(addDoc(collection(anon(), "subInRequests"), open()));
  });

  it("is read by the team through the team query, not by another team", async () => {
    await assertSucceeds(getDocs(query(collection(as(SCOUT2), "subInRequests"), where("teamId", "==", TEAM1))));
    await assertFails(getDocs(query(collection(as(OTHER_SCOUT), "subInRequests"), where("teamId", "==", TEAM1))));
    await assertFails(getDoc(doc(as(OTHER_SCOUT), "subInRequests", "s1")));
  });

  it("lets another teammate claim an open request, changing only the claim fields", async () => {
    await assertSucceeds(updateDoc(doc(as(SCOUT2), "subInRequests", "s1"), claim(SCOUT2)));
  });

  it("refuses a claim by the requester, a claim in someone else's name, a claim that edits other fields, or by another team", async () => {
    await assertFails(updateDoc(doc(as(SCOUT), "subInRequests", "s1"), claim(SCOUT)));
    await assertFails(updateDoc(doc(as(SCOUT2), "subInRequests", "s1"), claim(LEAD)));
    await assertFails(updateDoc(doc(as(SCOUT2), "subInRequests", "s1"), { ...claim(SCOUT2), teamNumber: 971 }));
    await assertFails(updateDoc(doc(as(SCOUT2), "subInRequests", "s1"), { ...claim(SCOUT2), requestedById: SCOUT2 }));
    await assertFails(updateDoc(doc(as(OTHER_SCOUT), "subInRequests", "s1"), claim(OTHER_SCOUT)));
  });

  it("does not let a second person take an already claimed request", async () => {
    await assertFails(updateDoc(doc(as(LEAD), "subInRequests", "claimed"), claim(LEAD)));
  });

  it("lets the requester cancel their own open request (status only), nobody else", async () => {
    await assertFails(updateDoc(doc(as(SCOUT2), "subInRequests", "s1"), { status: "cancelled" }));
    await assertFails(updateDoc(doc(as(SCOUT), "subInRequests", "s1"), { status: "cancelled", teamNumber: 1 }));
    await assertSucceeds(updateDoc(doc(as(SCOUT), "subInRequests", "s1"), { status: "cancelled" }));
    await assertFails(updateDoc(doc(as(SCOUT2), "subInRequests", "claimed"), { status: "cancelled" })); // a claimed one is final
  });

  it("is deleted by a team admin of that team only", async () => {
    await assertFails(deleteDoc(doc(as(SCOUT), "subInRequests", "s1")));
    await assertFails(deleteDoc(doc(as(OTHER_ADMIN), "subInRequests", "s1")));
    await assertSucceeds(deleteDoc(doc(as(ADMIN), "subInRequests", "s1")));
    await assertSucceeds(deleteDoc(doc(as(COACH), "subInRequests", "claimed")));
  });
});

describe("judgeBookCards/{id} (legacy) and versionReleases/{id} (legacy)", () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "judgeBookCards", "c1"), { teamId: TEAM1, title: "Card" });
      await setDoc(doc(db, "versionReleases", "v1"), { version: "1.0", notes: "x" });
    });
  });

  it("judgeBookCards: read by the card's team (best effort), updated or deleted by its team admin, never created", async () => {
    await assertSucceeds(getDocs(query(collection(as(SCOUT), "judgeBookCards"), where("teamId", "==", TEAM1))));
    await assertFails(getDocs(query(collection(as(OTHER_SCOUT), "judgeBookCards"), where("teamId", "==", TEAM1))));
    await assertFails(addDoc(collection(as(ADMIN), "judgeBookCards"), { teamId: TEAM1 }));
    await assertFails(updateDoc(doc(as(SCOUT), "judgeBookCards", "c1"), { title: "x" }));
    await assertFails(updateDoc(doc(as(OTHER_ADMIN), "judgeBookCards", "c1"), { title: "x" }));
    await assertSucceeds(updateDoc(doc(as(ADMIN), "judgeBookCards", "c1"), { title: "x" }));
    await assertSucceeds(deleteDoc(doc(as(ADMIN), "judgeBookCards", "c1")));
  });

  it("versionReleases: readable by any signed-in user, written by the owner only", async () => {
    await assertSucceeds(getDocs(collection(as(SCOUT), "versionReleases")));
    await assertFails(getDocs(collection(anon(), "versionReleases")));
    await assertFails(addDoc(collection(as(ADMIN), "versionReleases"), { version: "2" }));
    await assertSucceeds(addDoc(collection(as(CS_OWNER), "versionReleases"), { version: "2" }));
  });
});

// =====================================================================================================================
// 3. COMPEPICURUS-ONLY COLLECTIONS, ON CS USER FIELDS
// =====================================================================================================================

describe("page access: settings/pageAccess, requests, and roles read from CS fields", () => {
  const accessDoc = (uid: string, over: Record<string, unknown> = {}) => ({
    roleGrants: {},
    pageRoles: {},
    memberOverrides: {},
    updatedBy: uid,
    updatedAt: serverTimestamp(),
    ...over,
  });
  const ref = (db: Db) => doc(db, "teams", TEAM1, "settings", "pageAccess");

  it("is read by the team and written (valid shape, as themselves) only by an admin of the team", async () => {
    await assertSucceeds(setDoc(ref(as(ADMIN)), accessDoc(ADMIN)));
    await assertSucceeds(setDoc(ref(as(COACH)), accessDoc(COACH))); // role "coach" is an admin (D6)
    await assertFails(setDoc(ref(as(SCOUT)), accessDoc(SCOUT)));
    await assertFails(setDoc(ref(as(OTHER_ADMIN)), accessDoc(OTHER_ADMIN)));
    await assertFails(setDoc(ref(as(ADMIN)), accessDoc(ADMIN, { updatedBy: SCOUT })));
    await assertFails(setDoc(ref(as(ADMIN)), accessDoc(ADMIN, { extra: 1 })));
    await assertFails(setDoc(doc(as(ADMIN), "teams", TEAM1, "settings", "other"), { a: 1 }));
    await seedPageAccess();
    await assertSucceeds(getDoc(ref(as(SCOUT))));
    await assertFails(getDoc(ref(as(OTHER_SCOUT))));
    await assertFails(deleteDoc(ref(as(ADMIN))));
  });

  describe("pageAccessRequests", () => {
    const requests = (db: Db) => collection(db, "teams", TEAM1, "pageAccessRequests");
    const reqDoc = (uid: string, pageId = "assignments", over: Record<string, unknown> = {}) => ({
      teamId: TEAM1,
      uid,
      name: "Scout",
      pageId,
      pageTitle: "Assignments",
      status: "pending",
      createdAt: serverTimestamp(),
      ...over,
    });

    it("lets a member create their own pending request (id {uid}_{pageId}) and nobody else's", async () => {
      await assertSucceeds(setDoc(doc(requests(as(SCOUT)), `${SCOUT}_assignments`), reqDoc(SCOUT)));
      await assertFails(setDoc(doc(requests(as(SCOUT)), `${SCOUT2}_assignments`), reqDoc(SCOUT2)));
      await assertFails(setDoc(doc(requests(as(SCOUT)), "wrong-id"), reqDoc(SCOUT)));
      await assertFails(setDoc(doc(requests(as(SCOUT)), `${SCOUT}_admin-panel`), reqDoc(SCOUT, "admin-panel")));
      await assertFails(setDoc(doc(requests(as(OTHER_SCOUT)), `${OTHER_SCOUT}_assignments`), reqDoc(OTHER_SCOUT)));
    });

    it("lets an admin decide it (status only) and lets the person see theirs, not others'", async () => {
      await seed(async (db) => {
        await setDoc(doc(db, "teams", TEAM1, "pageAccessRequests", `${SCOUT}_assignments`), { ...reqDoc(SCOUT), createdAt: new Date() });
      });
      const id = `${SCOUT}_assignments`;
      await assertSucceeds(getDoc(doc(requests(as(SCOUT)), id)));
      await assertFails(getDoc(doc(requests(as(SCOUT2)), id)));
      await assertSucceeds(getDoc(doc(requests(as(ADMIN)), id)));
      await assertFails(updateDoc(doc(requests(as(SCOUT)), id), { status: "approved" }));
      await assertSucceeds(updateDoc(doc(requests(as(ADMIN)), id), { status: "approved", decidedBy: ADMIN, decidedAt: serverTimestamp() }));
      await assertFails(deleteDoc(doc(requests(as(ADMIN)), id)));
    });
  });

  describe("pageAccessAllowed() with CS role fields, via assignments/{teamId}_{event}", () => {
    const slot = (db: Db, id = `${TEAM1}_2026arli`) => setDoc(doc(db, "assignments", id), { teamId: TEAM1, eventCode: "2026arli", current: { slots: [] }, previous: null });

    it("defaults to lead scouts, read from role, roles[] and the legacy spelling; admins and coaches always", async () => {
      await assertSucceeds(slot(as(LEAD)));
      await assertSucceeds(slot(as(LEGACY_LEAD)));
      await assertSucceeds(slot(as(LEAD_VIA_ROLES)));
      await assertSucceeds(slot(as(ADMIN)));
      await assertSucceeds(slot(as(COACH)));
      await assertFails(slot(as(SCOUT)));
      await assertFails(slot(as(STRATEGIST)));
      await assertFails(slot(as(NO_TEAM)));
      await assertFails(slot(as(NO_DOC)));
    });

    it("follows the team's pageRoles mirror, secondary roles, and per-member grant and deny", async () => {
      await seedPageAccess({
        pageRoles: { assignments: ["lead-strategist"] },
        memberOverrides: { [SCOUT]: { grant: ["assignments"], deny: [] }, [ADMIN2]: { grant: [], deny: ["assignments"] } },
      });
      await assertSucceeds(slot(as(STRATEGIST))); // secondaryRoles
      await assertFails(slot(as(LEAD))); // no longer a default role once the team changed the list
      await assertSucceeds(slot(as(SCOUT))); // granted
      await assertSucceeds(slot(as(ADMIN2))); // an admin always can, a deny does not apply to admins
    });

    it("denies a member whose role was removed by a deny entry", async () => {
      await seedPageAccess({ memberOverrides: { [LEAD]: { grant: [], deny: ["assignments"] } } });
      await assertFails(slot(as(LEAD)));
      await assertSucceeds(slot(as(LEGACY_LEAD)));
    });

    it("never lets another team's lead write this team's docs", async () => {
      await seed(async (db) => {
        await setDoc(doc(db, "users", "other-lead"), user({ teamId: TEAM2, role: "lead-scout" }));
      });
      await assertFails(slot(as("other-lead")));
    });
  });
});

describe("profiles/{uid}", () => {
  const profile = (over: Record<string, unknown> = {}) => ({
    teamId: TEAM1,
    displayName: "Scout",
    bio: "hi",
    pronouns: "",
    avatar: { type: "initials", value: "SC" },
    visibility: "public",
    updatedAt: serverTimestamp(),
    ...over,
  });
  const seeded = (over: Record<string, unknown> = {}) => ({ ...profile(over), updatedAt: new Date() });

  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "profiles", SCOUT), seeded({ bio: "scout bio", pronouns: "they/them" }));
      await setDoc(doc(db, "profiles", SCOUT2), seeded({ visibility: "private", bio: "secret", pronouns: "x" }));
      await setDoc(doc(db, "profiles", ADMIN), seeded({ visibility: "private", bio: "owner bio", pronouns: "x" }));
    });
  });

  it("is created by the member for themselves in their team (admins must stay public)", async () => {
    await assertSucceeds(setDoc(doc(as(LEAD), "profiles", LEAD), profile({ displayName: "Lead" })));
    await assertFails(setDoc(doc(as(LEAD), "profiles", SCOUT), profile()));
    await assertFails(setDoc(doc(as(LEAD), "profiles", LEAD), profile({ teamId: TEAM2 })));
    await assertFails(setDoc(doc(as(LEAD), "profiles", LEAD), profile({ visibility: "everyone" })));
    await assertFails(setDoc(doc(as(COACH), "profiles", COACH), profile({ visibility: "private" })));
    await assertSucceeds(setDoc(doc(as(COACH), "profiles", COACH), profile()));
  });

  it("is readable per visibility: public to the team, private only to the member and admins, an admin's always", async () => {
    await assertSucceeds(getDoc(doc(as(SCOUT2), "profiles", SCOUT)));
    await assertFails(getDoc(doc(as(SCOUT), "profiles", SCOUT2))); // private
    await assertSucceeds(getDoc(doc(as(SCOUT2), "profiles", SCOUT2))); // own
    await assertSucceeds(getDoc(doc(as(COACH), "profiles", SCOUT2))); // a viewing admin
    await assertSucceeds(getDoc(doc(as(SCOUT), "profiles", ADMIN))); // the target is an admin: treated as public
    await assertFails(getDoc(doc(as(OTHER_SCOUT), "profiles", SCOUT))); // another team
    await assertSucceeds(getDoc(doc(as(SCOUT), "profiles", LEAD))); // no profile yet: not an error for a teammate
    await assertFails(getDoc(doc(as(OTHER_SCOUT), "profiles", LEAD)));
    await assertFails(getDoc(doc(anon(), "profiles", SCOUT)));
  });

  it("is updated by the member; an admin may only clear a teammate's bio and pronouns, never the team owner's", async () => {
    await assertSucceeds(updateDoc(doc(as(SCOUT), "profiles", SCOUT), { bio: "new", updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(as(SCOUT), "profiles", SCOUT), { teamId: TEAM2, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(as(SCOUT2), "profiles", SCOUT), { bio: "vandal", updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(as(ADMIN2), "profiles", SCOUT), { bio: "", pronouns: "", updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(as(ADMIN2), "profiles", SCOUT2), { bio: "rewritten", pronouns: "", updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(as(ADMIN2), "profiles", ADMIN), { bio: "", pronouns: "", updatedAt: serverTimestamp() })); // verifiedOwnerId
    await assertFails(updateDoc(doc(as(OTHER_ADMIN), "profiles", SCOUT), { bio: "", pronouns: "", updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(doc(as(SCOUT), "profiles", SCOUT)));
  });

  it("saves together with the avatar mirror on the user doc, in one batch (lib/profile/service.ts)", async () => {
    const db = as(SCOUT);
    const batch = writeBatch(db);
    batch.set(doc(db, "profiles", SCOUT), profile());
    batch.update(doc(db, "users", SCOUT), { avatar: { type: "initials", value: "SC" } });
    await assertSucceeds(batch.commit());
  });
});

describe("formEntries/{id} (custom forms only)", () => {
  const entry = (uid: string, over: Record<string, unknown> = {}) => ({
    teamId: TEAM1,
    uid,
    scoutName: "Scout",
    formId: "my-form",
    formVersion: 1,
    formType: "custom",
    eventCode: "2026arli",
    values: { q1: "yes" },
    stickyNotes: [],
    flags: [],
    excluded: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...over,
  });
  const stored = (uid: string) => ({ ...entry(uid), createdAt: new Date(), updatedAt: new Date() });

  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "formEntries", "e1"), stored(SCOUT));
    });
  });

  it("is created as yourself in your team, for a custom form", async () => {
    await assertSucceeds(addDoc(collection(as(SCOUT2), "formEntries"), entry(SCOUT2)));
    await assertFails(addDoc(collection(as(SCOUT2), "formEntries"), entry(SCOUT)));
    await assertFails(addDoc(collection(as(SCOUT2), "formEntries"), entry(SCOUT2, { teamId: TEAM2 })));
    await assertFails(addDoc(collection(as(SCOUT2), "formEntries"), entry(SCOUT2, { formType: "lead-scout" }))); // built-ins store in CS's collections
    await assertFails(addDoc(collection(as(SCOUT2), "formEntries"), entry(SCOUT2, { excluded: true })));
    await assertFails(addDoc(collection(anon(), "formEntries"), entry(SCOUT2)));
  });

  it("is read inside the team only", async () => {
    await assertSucceeds(getDoc(doc(as(SCOUT2), "formEntries", "e1")));
    await assertSucceeds(getDocs(query(collection(as(SCOUT2), "formEntries"), where("teamId", "==", TEAM1), where("formId", "==", "my-form"))));
    await assertFails(getDoc(doc(as(OTHER_SCOUT), "formEntries", "e1")));
    await assertFails(getDocs(query(collection(as(OTHER_SCOUT), "formEntries"), where("teamId", "==", TEAM1))));
  });

  it("lets the author change only values, stickyNotes and updatedAt; an admin more, but not who/where/what form", async () => {
    await assertSucceeds(updateDoc(doc(as(SCOUT), "formEntries", "e1"), { values: { q1: "no" }, updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(as(SCOUT), "formEntries", "e1"), { "values.photos": arrayUnion({ url: "https://x" }), updatedAt: Date.now() }));
    await assertFails(updateDoc(doc(as(SCOUT), "formEntries", "e1"), { excluded: true }));
    await assertFails(updateDoc(doc(as(SCOUT2), "formEntries", "e1"), { values: { q1: "no" } }));
    await assertSucceeds(updateDoc(doc(as(ADMIN), "formEntries", "e1"), { excluded: true, flags: ["x"] }));
    await assertFails(updateDoc(doc(as(ADMIN), "formEntries", "e1"), { uid: ADMIN }));
    await assertFails(updateDoc(doc(as(ADMIN), "formEntries", "e1"), { formId: "other-form" }));
    await assertFails(updateDoc(doc(as(OTHER_ADMIN), "formEntries", "e1"), { excluded: true }));
  });

  it("is deleted by an admin of the team only", async () => {
    await assertFails(deleteDoc(doc(as(SCOUT), "formEntries", "e1")));
    await assertFails(deleteDoc(doc(as(OTHER_ADMIN), "formEntries", "e1")));
    await assertSucceeds(deleteDoc(doc(as(COACH), "formEntries", "e1")));
  });
});

describe("forms/{teamId}_{formId} and forms/.../versions/{n}", () => {
  const FORM_ID = `${TEAM1}_my-form`;
  const formDoc = (over: Record<string, unknown> = {}) => ({ teamId: TEAM1, formId: "my-form", name: "My form", origin: "custom", publishedVersion: null, draft: { id: "my-form" }, active: true, archived: false, ...over });

  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "forms", FORM_ID), formDoc());
    });
  });

  it("is read by the team (also a form that does not exist yet), not by another team", async () => {
    await assertSucceeds(getDoc(doc(as(SCOUT), "forms", FORM_ID)));
    await assertSucceeds(getDoc(doc(as(SCOUT), "forms", `${TEAM1}_not-yet`)));
    await assertSucceeds(getDocs(query(collection(as(SCOUT), "forms"), where("teamId", "==", TEAM1))));
    await assertFails(getDoc(doc(as(OTHER_SCOUT), "forms", FORM_ID)));
    await assertFails(getDocs(query(collection(as(OTHER_SCOUT), "forms"), where("teamId", "==", TEAM1))));
  });

  it("is created and edited by admins only, with the id its fields give, never deleted", async () => {
    await assertSucceeds(setDoc(doc(as(ADMIN), "forms", `${TEAM1}_second`), formDoc({ formId: "second" })));
    await assertFails(setDoc(doc(as(SCOUT), "forms", `${TEAM1}_third`), formDoc({ formId: "third" })));
    await assertFails(setDoc(doc(as(ADMIN), "forms", `${TEAM1}_mismatch`), formDoc({ formId: "other" })));
    await assertFails(setDoc(doc(as(OTHER_ADMIN), "forms", `${TEAM1}_fromOther`), formDoc({ formId: "fromOther" })));
    await assertSucceeds(updateDoc(doc(as(ADMIN), "forms", FORM_ID), { name: "Renamed" }));
    await assertFails(updateDoc(doc(as(SCOUT), "forms", FORM_ID), { name: "Hijack" }));
    await assertFails(updateDoc(doc(as(ADMIN), "forms", FORM_ID), { teamId: TEAM2 }));
    await assertFails(deleteDoc(doc(as(ADMIN), "forms", FORM_ID)));
  });

  it("publishes a version with the form's publishedVersion in one batch, immutable afterwards, and never lets it go back", async () => {
    const db = as(ADMIN);
    const batch = writeBatch(db);
    batch.update(doc(db, "forms", FORM_ID), { publishedVersion: 1 });
    batch.set(doc(db, "forms", FORM_ID, "versions", "1"), { teamId: TEAM1, formId: "my-form", version: 1, form: { id: "my-form" } });
    await assertSucceeds(batch.commit());
    await assertSucceeds(getDoc(doc(as(SCOUT), "forms", FORM_ID, "versions", "1")));
    await assertFails(getDoc(doc(as(OTHER_SCOUT), "forms", FORM_ID, "versions", "1")));
    await assertFails(updateDoc(doc(db, "forms", FORM_ID, "versions", "1"), { form: { id: "my-form", x: 1 } }));
    await assertFails(deleteDoc(doc(db, "forms", FORM_ID, "versions", "1")));
    await assertFails(updateDoc(doc(db, "forms", FORM_ID), { publishedVersion: null }));
    // a version without the matching bump is refused, and so is one by a non-admin
    await assertFails(setDoc(doc(db, "forms", FORM_ID, "versions", "2"), { teamId: TEAM1, formId: "my-form", version: 2, form: { id: "my-form" } }));
    const scoutDb = as(SCOUT);
    const scoutBatch = writeBatch(scoutDb);
    scoutBatch.update(doc(scoutDb, "forms", FORM_ID), { publishedVersion: 2 });
    scoutBatch.set(doc(scoutDb, "forms", FORM_ID, "versions", "2"), { teamId: TEAM1, formId: "my-form", version: 2, form: { id: "my-form" } });
    await assertFails(scoutBatch.commit());
  });
});

describe("formTemplates/{id}", () => {
  const tpl = (over: Record<string, unknown> = {}) => ({
    ownerTeamId: TEAM1,
    authorName: "Admin",
    name: "Pit form",
    description: "d",
    tags: [],
    version: 1,
    form: { id: "pit" },
    checksum: "abc",
    fieldCount: 3,
    sectionCount: 1,
    visibility: "private",
    official: false,
    importCount: 0,
    reportCount: 0,
    ...over,
  });

  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "formTemplates", "private1"), tpl());
      await setDoc(doc(db, "formTemplates", "public1"), tpl({ visibility: "public", ownerTeamId: TEAM2 }));
      await setDoc(doc(db, "formTemplates", "pending1"), tpl({ visibility: "public-pending", ownerTeamId: TEAM2 }));
      await setDoc(doc(db, "formTemplates", "pending1", "reports", TEAM1), { reason: "x" });
    });
  });

  it("is created private by an admin of the owning team, not by members or other teams, and not pre-published", async () => {
    await assertSucceeds(addDoc(collection(as(ADMIN), "formTemplates"), tpl()));
    await assertFails(addDoc(collection(as(SCOUT), "formTemplates"), tpl()));
    await assertFails(addDoc(collection(as(OTHER_ADMIN), "formTemplates"), tpl()));
    await assertFails(addDoc(collection(as(ADMIN), "formTemplates"), tpl({ visibility: "public" })));
    await assertFails(addDoc(collection(as(ADMIN), "formTemplates"), tpl({ official: true })));
  });

  it("is read by anyone signed in when public, by its own team always, by the platform owner when pending, never else", async () => {
    await assertSucceeds(getDocs(query(collection(as(SCOUT), "formTemplates"), where("visibility", "==", "public"))));
    await assertSucceeds(getDocs(query(collection(as(SCOUT), "formTemplates"), where("ownerTeamId", "==", TEAM1))));
    await assertFails(getDoc(doc(as(OTHER_SCOUT), "formTemplates", "private1")));
    await assertFails(getDoc(doc(as(SCOUT), "formTemplates", "pending1")));
    await assertSucceeds(getDoc(doc(as(NO_DOC, { platformOwner: true }), "formTemplates", "pending1")));
    await assertSucceeds(getDoc(doc(as(CS_OWNER), "formTemplates", "pending1")));
    await assertFails(getDoc(doc(as(NO_DOC, { platformOwner: true }), "formTemplates", "private1"))); // not even the platform owner reads a private one of another team
    await assertFails(getDoc(doc(as(NO_DOC), "formTemplates", "private1")));
    await assertFails(getDoc(doc(anon(), "formTemplates", "public1")));
  });

  it("is edited and deleted by the owning team's admin only while private, and cannot be published from a browser", async () => {
    await assertSucceeds(updateDoc(doc(as(ADMIN), "formTemplates", "private1"), { name: "Renamed" }));
    await assertFails(updateDoc(doc(as(ADMIN), "formTemplates", "private1"), { visibility: "public" }));
    await assertFails(updateDoc(doc(as(ADMIN), "formTemplates", "private1"), { official: true }));
    await assertFails(updateDoc(doc(as(SCOUT), "formTemplates", "private1"), { name: "x" }));
    await assertFails(updateDoc(doc(as(OTHER_ADMIN), "formTemplates", "private1"), { name: "x" }));
    await assertFails(deleteDoc(doc(as(OTHER_ADMIN), "formTemplates", "private1")));
    await assertSucceeds(deleteDoc(doc(as(ADMIN), "formTemplates", "private1")));
  });

  it("keeps reports server-written and platform-owner-read", async () => {
    await assertSucceeds(getDocs(collection(as(NO_DOC, { platformOwner: true }), "formTemplates", "pending1", "reports")));
    await assertFails(getDocs(collection(as(ADMIN), "formTemplates", "pending1", "reports")));
    await assertFails(setDoc(doc(as(CS_OWNER), "formTemplates", "pending1", "reports", TEAM2), { reason: "y" }));
  });
});

describe("pickLists/{teamId}_{eventCode}", () => {
  const ID = `${TEAM1}_2026arli`;
  const list = (uid: string, over: Record<string, unknown> = {}) => ({ teamId: TEAM1, eventCode: "2026arli", picked: [254, 971], updatedBy: uid, updatedByName: "Someone", ...over });

  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "pickLists", ID), list(ADMIN));
    });
  });

  it("is read by the team, including a list that does not exist yet, and not by another team", async () => {
    await assertSucceeds(getDoc(doc(as(SCOUT), "pickLists", ID)));
    await assertSucceeds(getDoc(doc(as(SCOUT), "pickLists", `${TEAM1}_2026okok`)));
    await assertFails(getDoc(doc(as(OTHER_SCOUT), "pickLists", ID)));
    await assertFails(getDoc(doc(anon(), "pickLists", ID)));
  });

  it("is written by pick-list editors (admins, coaches, lead strategists incl. a secondary role, lead scouts), not by plain members", async () => {
    for (const uid of [ADMIN, COACH, LEAD, LEGACY_LEAD, STRATEGIST]) {
      await assertSucceeds(setDoc(doc(as(uid), "pickLists", ID), list(uid)));
    }
    await assertFails(setDoc(doc(as(SCOUT), "pickLists", ID), list(SCOUT)));
    await assertFails(setDoc(doc(as(OTHER_ADMIN), "pickLists", ID), list(OTHER_ADMIN)));
  });

  it("is written only as yourself, to the id the team and event give, never deleted", async () => {
    await assertFails(setDoc(doc(as(LEAD), "pickLists", ID), list(ADMIN)));
    await assertFails(setDoc(doc(as(LEAD), "pickLists", `${TEAM1}_other`), list(LEAD)));
    await assertFails(setDoc(doc(as(LEAD), "pickLists", ID), list(LEAD, { teamId: TEAM2 })));
    await assertFails(deleteDoc(doc(as(ADMIN), "pickLists", ID)));
  });
});

describe("changelog/{id}", () => {
  const entry = (uid: string, over: Record<string, unknown> = {}) => ({
    teamId: TEAM1,
    version: "1.0",
    title: "First",
    date: "2026-11-01",
    summary: "s",
    changes: ["a"],
    status: "published",
    pinned: false,
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    publishedAt: serverTimestamp(),
    ...over,
  });
  const stored = (over: Record<string, unknown> = {}) => ({ ...entry(ADMIN, over), createdAt: new Date(), updatedAt: new Date(), publishedAt: over.status === "draft" ? null : new Date() });

  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "changelog", "pub"), stored());
      await setDoc(doc(db, "changelog", "draft"), stored({ status: "draft", title: "Draft" }));
    });
  });

  it("shows members published entries through a published-filtered query only; admins see drafts", async () => {
    await assertSucceeds(getDocs(query(collection(as(SCOUT), "changelog"), where("teamId", "==", TEAM1), where("status", "==", "published"))));
    await assertFails(getDocs(query(collection(as(SCOUT), "changelog"), where("teamId", "==", TEAM1))));
    await assertFails(getDoc(doc(as(SCOUT), "changelog", "draft")));
    await assertSucceeds(getDocs(query(collection(as(ADMIN), "changelog"), where("teamId", "==", TEAM1))));
    await assertFails(getDocs(query(collection(as(OTHER_SCOUT), "changelog"), where("teamId", "==", TEAM1), where("status", "==", "published"))));
  });

  it("is created, edited and deleted by admins of the team only", async () => {
    await assertSucceeds(addDoc(collection(as(ADMIN), "changelog"), entry(ADMIN)));
    await assertSucceeds(addDoc(collection(as(COACH), "changelog"), entry(COACH, { status: "draft", publishedAt: null })));
    await assertFails(addDoc(collection(as(SCOUT), "changelog"), entry(SCOUT)));
    await assertFails(addDoc(collection(as(OTHER_ADMIN), "changelog"), entry(OTHER_ADMIN)));
    await assertFails(addDoc(collection(as(ADMIN), "changelog"), entry(COACH))); // createdBy must be you
    await assertSucceeds(updateDoc(doc(as(ADMIN), "changelog", "draft"), { title: "Renamed", updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(as(SCOUT), "changelog", "draft"), { title: "x" }));
    await assertFails(deleteDoc(doc(as(SCOUT), "changelog", "pub")));
    await assertFails(deleteDoc(doc(as(OTHER_ADMIN), "changelog", "pub")));
    await assertSucceeds(deleteDoc(doc(as(ADMIN), "changelog", "pub")));
  });
});

describe("credits/{teamId}", () => {
  const credits = (uid: string, over: Record<string, unknown> = {}) => ({ teamId: TEAM1, sections: [], updatedBy: uid, updatedByName: "Admin", updatedAt: serverTimestamp(), ...over });

  it("is read by the team (also before it was ever saved), written by admins of the team as themselves", async () => {
    await assertSucceeds(getDoc(doc(as(SCOUT), "credits", TEAM1)));
    await assertFails(getDoc(doc(as(OTHER_SCOUT), "credits", TEAM1)));
    await assertSucceeds(setDoc(doc(as(ADMIN), "credits", TEAM1), credits(ADMIN)));
    await assertSucceeds(setDoc(doc(as(COACH), "credits", TEAM1), credits(COACH)));
    await assertFails(setDoc(doc(as(SCOUT), "credits", TEAM1), credits(SCOUT)));
    await assertFails(setDoc(doc(as(OTHER_ADMIN), "credits", TEAM1), credits(OTHER_ADMIN, { teamId: TEAM1 })));
    await assertFails(setDoc(doc(as(ADMIN), "credits", TEAM1), credits(COACH)));
    await assertFails(deleteDoc(doc(as(ADMIN), "credits", TEAM1)));
  });
});

describe("scoutTargets/{teamId}_{eventCode}", () => {
  const ID = `${TEAM1}_2026arli`;
  const targets = (uid: string, over: Record<string, unknown> = {}) => ({
    teamId: TEAM1,
    eventCode: "2026arli",
    ranges: {},
    maxOverrides: {},
    individual: {},
    extraScouts: [],
    updatedBy: uid,
    updatedAt: serverTimestamp(),
    ...over,
  });

  it("is written by admins and, by default, lead scouts and team coaches; read by the team, also before it exists", async () => {
    await assertSucceeds(getDoc(doc(as(SCOUT), "scoutTargets", ID)));
    await assertSucceeds(getDocs(query(collection(as(SCOUT), "scoutTargets"), where("teamId", "==", TEAM1))));
    await assertFails(getDoc(doc(as(OTHER_SCOUT), "scoutTargets", ID)));
    await assertSucceeds(setDoc(doc(as(LEAD), "scoutTargets", ID), targets(LEAD)));
    await assertSucceeds(setDoc(doc(as(ADMIN), "scoutTargets", ID), targets(ADMIN)));
    await assertFails(setDoc(doc(as(SCOUT), "scoutTargets", ID), targets(SCOUT)));
    await assertFails(setDoc(doc(as(STRATEGIST), "scoutTargets", ID), targets(STRATEGIST)));
  });

  it("must carry its own id, team and the writer's uid; never deleted", async () => {
    await assertFails(setDoc(doc(as(LEAD), "scoutTargets", `${TEAM1}_other`), targets(LEAD)));
    await assertFails(setDoc(doc(as(LEAD), "scoutTargets", ID), targets(ADMIN)));
    await assertFails(setDoc(doc(as(ADMIN), "scoutTargets", `${TEAM2}_2026arli`), targets(ADMIN, { teamId: TEAM2 })));
    await seed(async (db) => {
      await setDoc(doc(db, "scoutTargets", ID), { ...targets(ADMIN), updatedAt: new Date() });
    });
    await assertFails(deleteDoc(doc(as(ADMIN), "scoutTargets", ID)));
  });
});

describe("eventAttendance/{teamId}_{eventCode}", () => {
  const ID = `${TEAM1}_2026arli`;

  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "eventAttendance", ID), { teamId: TEAM1, eventCode: "2026arli", uids: [SCOUT] });
    });
  });

  it("is read by the team, written by whoever has the Assignments access, never deleted", async () => {
    await assertSucceeds(getDoc(doc(as(SCOUT), "eventAttendance", ID)));
    await assertSucceeds(getDoc(doc(as(SCOUT), "eventAttendance", `${TEAM1}_missing`)));
    await assertSucceeds(getDocs(query(collection(as(SCOUT), "eventAttendance"), where("teamId", "==", TEAM1))));
    await assertFails(getDoc(doc(as(OTHER_SCOUT), "eventAttendance", ID)));
    await assertSucceeds(setDoc(doc(as(LEAD), "eventAttendance", ID), { teamId: TEAM1, eventCode: "2026arli", uids: [SCOUT, SCOUT2] }));
    await assertFails(setDoc(doc(as(SCOUT), "eventAttendance", ID), { teamId: TEAM1, eventCode: "2026arli", uids: [SCOUT2] }));
    await assertFails(setDoc(doc(as(OTHER_ADMIN), "eventAttendance", ID), { teamId: TEAM1, eventCode: "2026arli", uids: [] }));
    await assertFails(deleteDoc(doc(as(ADMIN), "eventAttendance", ID)));
  });
});

describe("assignments/{teamId}_{eventCode}[_pit|_teamStrategy] (CE schedule doc)", () => {
  const sched = (over: Record<string, unknown> = {}) => ({ teamId: TEAM1, eventCode: "2026arli", current: { slots: [] }, previous: null, ...over });

  it("is read by the team and written by Assignments-access holders only", async () => {
    await assertSucceeds(setDoc(doc(as(LEAD), "assignments", `${TEAM1}_2026arli`), sched()));
    await assertSucceeds(getDoc(doc(as(SCOUT), "assignments", `${TEAM1}_2026arli`)));
    await assertSucceeds(getDoc(doc(as(SCOUT), "assignments", `${TEAM1}_2026okok`)));
    await assertSucceeds(getDocs(query(collection(as(SCOUT), "assignments"), where("teamId", "==", TEAM1))));
    await assertFails(getDoc(doc(as(OTHER_SCOUT), "assignments", `${TEAM1}_2026arli`)));
    await assertFails(setDoc(doc(as(SCOUT), "assignments", `${TEAM1}_2026arli`), sched()));
    await assertFails(setDoc(doc(as(LEAD), "assignments", `${TEAM1}_2026arli`), sched({ teamId: TEAM2 })));
    await assertFails(deleteDoc(doc(as(ADMIN), "assignments", `${TEAM1}_2026arli`)));
  });

  it("requires a doc with a kind to be pit or teamStrategy with the matching id", async () => {
    await assertSucceeds(setDoc(doc(as(LEAD), "assignments", `${TEAM1}_2026arli_pit`), sched({ kind: "pit" })));
    await assertSucceeds(setDoc(doc(as(LEAD), "assignments", `${TEAM1}_2026arli_teamStrategy`), sched({ kind: "teamStrategy" })));
    await assertFails(setDoc(doc(as(LEAD), "assignments", `${TEAM1}_2026arli`), sched({ kind: "pit" })));
    await assertFails(setDoc(doc(as(LEAD), "assignments", `${TEAM1}_2026arli_x`), sched({ kind: "x" })));
  });
});

describe("auditLog/{id}", () => {
  const log = (uid: string, action: string, over: Record<string, unknown> = {}) => ({ teamId: TEAM1, uid, actorName: "Someone", action, createdAt: serverTimestamp(), ...over });

  it("is created as yourself in your team: admins any action, pick-list editors edit-pick-list, anyone edit-form-entry", async () => {
    await assertSucceeds(addDoc(collection(as(ADMIN), "auditLog"), log(ADMIN, "export-backup")));
    await assertSucceeds(addDoc(collection(as(STRATEGIST), "auditLog"), log(STRATEGIST, "edit-pick-list")));
    await assertSucceeds(addDoc(collection(as(SCOUT), "auditLog"), log(SCOUT, "edit-form-entry")));
    await assertFails(addDoc(collection(as(SCOUT), "auditLog"), log(SCOUT, "export-backup")));
    await assertFails(addDoc(collection(as(SCOUT), "auditLog"), log(SCOUT, "edit-pick-list")));
    await assertFails(addDoc(collection(as(ADMIN), "auditLog"), log(COACH, "export-backup")));
    await assertFails(addDoc(collection(as(ADMIN), "auditLog"), log(ADMIN, "export-backup", { teamId: TEAM2 })));
    await assertFails(addDoc(collection(as(OTHER_ADMIN), "auditLog"), log(OTHER_ADMIN, "export-backup", { teamId: TEAM1 })));
  });

  it("is read by admins of the team only, and is write-once", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "auditLog", "l1"), { ...log(ADMIN, "export-backup"), createdAt: new Date() });
    });
    await assertSucceeds(getDocs(query(collection(as(ADMIN), "auditLog"), where("teamId", "==", TEAM1), where("action", "==", "export-backup"))));
    await assertSucceeds(getDoc(doc(as(COACH), "auditLog", "l1")));
    await assertFails(getDoc(doc(as(SCOUT), "auditLog", "l1")));
    await assertFails(getDoc(doc(as(OTHER_ADMIN), "auditLog", "l1")));
    await assertFails(getDocs(query(collection(as(OTHER_ADMIN), "auditLog"), where("teamId", "==", TEAM1))));
    await assertFails(updateDoc(doc(as(ADMIN), "auditLog", "l1"), { action: "x" }));
    await assertFails(deleteDoc(doc(as(ADMIN), "auditLog", "l1")));
  });
});

describe("libraryMatches and libraryEvents (shared practice library)", () => {
  const MANUAL_EVENT = "MAN-SCRIM";
  const API_EVENT = "2026arli";
  const alliance = (score: number, penaltyPoints = 0) => ({ teams: [254, 971, 1678], score, penaltyPoints, difficulty: score <= 40 ? "easy" : score <= 79 ? "medium" : "hard" });
  const manualMatch = (n: number, over: Record<string, unknown> = {}) => ({
    seasonId: "rebuilt",
    eventCode: MANUAL_EVENT,
    eventName: "Scrimmage",
    matchType: "Qualification",
    matchNumber: n,
    alliances: { red: alliance(100, 6), blue: alliance(60) },
    video: null,
    notes: "",
    origin: "manual",
    published: true,
    needsReview: false,
    createdBy: ADMIN,
    updatedAt: "2026-11-05T00:00:00.000Z",
    ...over,
  });
  const apiMatch = (n: number, over: Record<string, unknown> = {}) => ({
    seasonId: "rebuilt",
    eventCode: API_EVENT,
    eventName: "Arlington",
    matchType: "Qualification",
    matchNumber: n,
    alliances: { red: alliance(90), blue: alliance(50) },
    video: null,
    origin: "api",
    published: true,
    ...over,
  });
  const event = (code: string, origin: "api" | "manual", over: Record<string, unknown> = {}) => ({ eventCode: code, eventName: "Event", seasonId: "rebuilt", origin, date: null, sourceUrl: null, defaultVideoUrl: null, createdBy: ADMIN, ...over });
  const match = (db: Db, id: string) => doc(db, "libraryMatches", id);

  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "libraryEvents", MANUAL_EVENT), event(MANUAL_EVENT, "manual"));
      await setDoc(doc(db, "libraryEvents", API_EVENT), event(API_EVENT, "api"));
      await setDoc(match(db, `${MANUAL_EVENT}_Q1`), manualMatch(1));
      await setDoc(match(db, `${MANUAL_EVENT}_Q2`), manualMatch(2, { published: false }));
      await setDoc(match(db, `${API_EVENT}_Q1`), apiMatch(1));
    });
  });

  it("shows members published matches (filtered query) and admins everything", async () => {
    await assertSucceeds(getDoc(match(as(SCOUT), `${MANUAL_EVENT}_Q1`)));
    await assertFails(getDoc(match(as(SCOUT), `${MANUAL_EVENT}_Q2`)));
    await assertSucceeds(getDocs(query(collection(as(SCOUT), "libraryMatches"), where("published", "==", true))));
    await assertFails(getDocs(collection(as(SCOUT), "libraryMatches")));
    await assertSucceeds(getDocs(collection(as(ADMIN), "libraryMatches")));
    await assertSucceeds(getDoc(match(as(COACH), `${MANUAL_EVENT}_Q2`)));
    await assertFails(getDoc(match(anon(), `${MANUAL_EVENT}_Q1`)));
  });

  it("lets admins import API matches (not under a manual event) and hand-enter manual ones under a manual event", async () => {
    await assertSucceeds(setDoc(match(as(ADMIN), `${API_EVENT}_Q9`), apiMatch(9)));
    await assertFails(setDoc(match(as(ADMIN), `${MANUAL_EVENT}_Q9`), apiMatch(9, { eventCode: MANUAL_EVENT })));
    await assertSucceeds(setDoc(match(as(COACH), `${MANUAL_EVENT}_Q9`), manualMatch(9)));
    await assertFails(setDoc(match(as(ADMIN), `${MANUAL_EVENT}_Q8`), manualMatch(9))); // id does not match the fields
    await assertFails(setDoc(match(as(ADMIN), `${API_EVENT}_Q7`), manualMatch(7, { eventCode: API_EVENT }))); // manual under an API event
    await assertFails(setDoc(match(as(SCOUT), `${API_EVENT}_Q9`), apiMatch(9)));
  });

  it("never changes a match's origin, and only manual matches can be deleted (by admins)", async () => {
    await assertFails(updateDoc(match(as(ADMIN), `${API_EVENT}_Q1`), { origin: "manual" }));
    await assertSucceeds(updateDoc(match(as(ADMIN), `${API_EVENT}_Q1`), { video: "https://youtu.be/x" }));
    await assertFails(updateDoc(match(as(SCOUT), `${API_EVENT}_Q1`), { video: "https://youtu.be/x" }));
    await assertFails(deleteDoc(match(as(ADMIN), `${API_EVENT}_Q1`)));
    await assertFails(deleteDoc(match(as(SCOUT), `${MANUAL_EVENT}_Q1`)));
    await assertSucceeds(deleteDoc(match(as(ADMIN), `${MANUAL_EVENT}_Q1`)));
  });

  it("libraryEvents: read by anyone signed in, created and edited by admins, only manual ones deleted", async () => {
    await assertSucceeds(getDocs(collection(as(SCOUT), "libraryEvents")));
    await assertFails(getDocs(collection(anon(), "libraryEvents")));
    await assertSucceeds(setDoc(doc(as(ADMIN), "libraryEvents", "NEW-EVENT"), event("NEW-EVENT", "manual")));
    await assertFails(setDoc(doc(as(ADMIN), "libraryEvents", "bad"), event("bad", "manual"))); // manual codes are upper-case
    await assertFails(setDoc(doc(as(SCOUT), "libraryEvents", "NEW-EVENT2"), event("NEW-EVENT2", "manual")));
    await assertFails(updateDoc(doc(as(ADMIN), "libraryEvents", API_EVENT), { origin: "manual" }));
    await assertSucceeds(updateDoc(doc(as(ADMIN), "libraryEvents", API_EVENT), { eventName: "Renamed" }));
    await assertFails(deleteDoc(doc(as(ADMIN), "libraryEvents", API_EVENT)));
    await assertSucceeds(deleteDoc(doc(as(ADMIN), "libraryEvents", MANUAL_EVENT)));
  });
});

describe("live practice: liveMatches/.../scouts, lobbies, players, collection-group queries, notifications", () => {
  const presence = (uid: string, over: Record<string, unknown> = {}) => ({ uid, teamId: TEAM1, name: "Scout", ...over });
  const lobby = (host: string, over: Record<string, unknown> = {}) => ({ teamId: TEAM1, hostUid: host, status: "waiting", ...over });

  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "liveMatches", "2026arli_Q1", "scouts", SCOUT), presence(SCOUT));
      await setDoc(doc(db, "lobbies", "ABCD"), lobby(SCOUT));
      await setDoc(doc(db, "lobbies", "ABCD", "players", SCOUT), presence(SCOUT));
      await setDoc(doc(db, "notifications", "n1"), { teamId: TEAM1, uid: SCOUT, kind: "scores" });
    });
  });

  it("liveMatches scouts: a member writes their own presence, the team reads it, the parent doc is closed", async () => {
    await assertSucceeds(setDoc(doc(as(SCOUT2), "liveMatches", "2026arli_Q1", "scouts", SCOUT2), presence(SCOUT2)));
    await assertFails(setDoc(doc(as(SCOUT2), "liveMatches", "2026arli_Q1", "scouts", SCOUT), presence(SCOUT)));
    await assertFails(setDoc(doc(as(SCOUT2), "liveMatches", "2026arli_Q1", "scouts", SCOUT2), presence(SCOUT2, { teamId: TEAM2 })));
    await assertSucceeds(getDocs(query(collection(as(SCOUT2), "liveMatches", "2026arli_Q1", "scouts"), where("teamId", "==", TEAM1))));
    await assertFails(getDocs(query(collection(as(OTHER_SCOUT), "liveMatches", "2026arli_Q1", "scouts"), where("teamId", "==", TEAM1))));
    await assertFails(getDoc(doc(as(SCOUT), "liveMatches", "2026arli_Q1")));
    await assertFails(deleteDoc(doc(as(SCOUT2), "liveMatches", "2026arli_Q1", "scouts", SCOUT)));
    await assertSucceeds(deleteDoc(doc(as(SCOUT), "liveMatches", "2026arli_Q1", "scouts", SCOUT)));
  });

  it("collection-group queries on scouts and players work for the team (and your own players), not across teams", async () => {
    await assertSucceeds(getDocs(query(collectionGroup(as(SCOUT2), "scouts"), where("teamId", "==", TEAM1))));
    await assertFails(getDocs(query(collectionGroup(as(OTHER_SCOUT), "scouts"), where("teamId", "==", TEAM1))));
    await assertSucceeds(getDocs(query(collectionGroup(as(SCOUT), "players"), where("uid", "==", SCOUT))));
    await assertFails(getDocs(query(collectionGroup(as(OTHER_SCOUT), "players"), where("uid", "==", SCOUT2))));
  });

  it("lobbies: created by the host for their team, claimed by reading a missing id first, host-only updates, never deleted", async () => {
    await assertSucceeds(getDoc(doc(as(SCOUT2), "lobbies", "FREE")));
    await assertFails(getDoc(doc(anon(), "lobbies", "FREE")));
    await assertSucceeds(setDoc(doc(as(SCOUT2), "lobbies", "FREE"), lobby(SCOUT2)));
    await assertFails(setDoc(doc(as(SCOUT2), "lobbies", "FREE2"), lobby(SCOUT)));
    await assertFails(setDoc(doc(as(SCOUT2), "lobbies", "FREE3"), lobby(SCOUT2, { teamId: TEAM2 })));
    await assertSucceeds(getDoc(doc(as(SCOUT2), "lobbies", "ABCD")));
    await assertFails(getDoc(doc(as(OTHER_SCOUT), "lobbies", "ABCD")));
    await assertSucceeds(updateDoc(doc(as(SCOUT), "lobbies", "ABCD"), { status: "live" }));
    await assertFails(updateDoc(doc(as(SCOUT2), "lobbies", "ABCD"), { status: "live" }));
    await assertFails(deleteDoc(doc(as(SCOUT), "lobbies", "ABCD")));
  });

  it("lobby players: each person writes only their own doc, the team reads the roster", async () => {
    await assertSucceeds(setDoc(doc(as(SCOUT2), "lobbies", "ABCD", "players", SCOUT2), presence(SCOUT2)));
    await assertFails(setDoc(doc(as(SCOUT2), "lobbies", "ABCD", "players", SCOUT), presence(SCOUT)));
    await assertSucceeds(getDocs(query(collection(as(SCOUT2), "lobbies", "ABCD", "players"), where("teamId", "==", TEAM1))));
    await assertFails(getDocs(query(collection(as(OTHER_SCOUT), "lobbies", "ABCD", "players"), where("teamId", "==", TEAM1))));
    await assertFails(deleteDoc(doc(as(SCOUT2), "lobbies", "ABCD", "players", SCOUT)));
    await assertSucceeds(deleteDoc(doc(as(SCOUT), "lobbies", "ABCD", "players", SCOUT)));
  });

  it("notifications: a user reads only their own, nobody writes", async () => {
    await assertSucceeds(getDoc(doc(as(SCOUT), "notifications", "n1")));
    await assertFails(getDoc(doc(as(SCOUT2), "notifications", "n1")));
    await assertFails(getDoc(doc(as(ADMIN), "notifications", "n1")));
    await assertFails(setDoc(doc(as(SCOUT), "notifications", "n2"), { teamId: TEAM1, uid: SCOUT }));
  });
});

// =====================================================================================================================
// 4. SERVER-ONLY COLLECTIONS
// =====================================================================================================================

describe("server-only collections and team applications", () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, "appSettings", "global"), { teamCreationEnabled: true });
      await setDoc(doc(db, "rateLimits", "k_1"), { count: 1 });
      await setDoc(doc(db, "teamTransfers", "t1"), { teamId: TEAM1 });
      await setDoc(doc(db, "teamApplications", "app1"), { applicantUid: SCOUT, status: "pending" });
      await setDoc(doc(db, "teamApplications", "app2"), { applicantUid: SCOUT2, status: "pending" });
      await setDoc(doc(db, "applicationPrivate", "app1"), { notes: "private" });
      await setDoc(doc(db, "applicationBlocks", "b1"), { reason: "spam" });
      await setDoc(doc(db, "platformAuditLog", "p1"), { action: "approve" });
    });
  });

  it("denies appSettings, rateLimits and teamTransfers to every client, owner and platform owner included", async () => {
    for (const db of [as(SCOUT), as(ADMIN), as(CS_OWNER), as(NO_DOC, { platformOwner: true })]) {
      await assertFails(getDoc(doc(db, "appSettings", "global")));
      await assertFails(setDoc(doc(db, "appSettings", "global"), { teamCreationEnabled: false }));
      await assertFails(getDoc(doc(db, "rateLimits", "k_1")));
      await assertFails(getDoc(doc(db, "teamTransfers", "t1")));
    }
  });

  it("lets an applicant read only their own application (filtered query), the platform owner all, and nobody write", async () => {
    await assertSucceeds(getDoc(doc(as(SCOUT), "teamApplications", "app1")));
    await assertSucceeds(getDocs(query(collection(as(SCOUT), "teamApplications"), where("applicantUid", "==", SCOUT))));
    await assertFails(getDoc(doc(as(SCOUT), "teamApplications", "app2")));
    await assertFails(getDocs(collection(as(SCOUT), "teamApplications")));
    await assertSucceeds(getDocs(collection(as(NO_DOC, { platformOwner: true }), "teamApplications")));
    await assertSucceeds(getDocs(collection(as(CS_OWNER), "teamApplications")));
    await assertFails(getDoc(doc(as(ADMIN), "teamApplications", "app2"))); // a team admin is not the platform owner
    await assertFails(updateDoc(doc(as(CS_OWNER), "teamApplications", "app1"), { status: "approved" }));
    await assertFails(setDoc(doc(as(SCOUT), "teamApplications", "mine"), { applicantUid: SCOUT }));
  });

  it("opens applicationPrivate, applicationBlocks and platformAuditLog to the platform owner for reading only", async () => {
    for (const name of ["applicationPrivate", "applicationBlocks", "platformAuditLog"]) {
      const id = name === "applicationPrivate" ? "app1" : name === "applicationBlocks" ? "b1" : "p1";
      await assertSucceeds(getDoc(doc(as(NO_DOC, { platformOwner: true }), name, id)));
      await assertSucceeds(getDoc(doc(as(CS_OWNER), name, id)));
      await assertFails(getDoc(doc(as(ADMIN), name, id)));
      await assertFails(getDoc(doc(as(SCOUT), name, id)));
      await assertFails(setDoc(doc(as(CS_OWNER), name, id), { x: 1 }));
    }
  });
});

describe("the rules file itself", () => {
  it("keeps the CS owner uid as the one explicit constant and invents no other hardcoded uid", () => {
    const rules = readFileSync("firestore.rules", "utf8");
    const uids = rules.match(/"[A-Za-z0-9]{28}"/g) ?? [];
    expect(new Set(uids)).toEqual(new Set([`"${CS_OWNER}"`]));
    expect(uids).toHaveLength(1);
  });
});
