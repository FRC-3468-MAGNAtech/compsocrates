// A SMALL SYNTHETIC dataset for `npm run dev:emu`: one team per program, 5 accounts, about 40 entries. Fake names, fake emails, nothing from production.
// Refuses to run unless the emulator hosts are set. Accounts (password for all: password1234): owner@dev.test, lead@dev.test, scout1@dev.test, scout2@dev.test, scout3@dev.test.
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { rebuiltDoc } from "@/data/cs/fixtures";
import { BIOBUZZ_ENTRY_DOCS } from "@/data/ftc/fixtures";
import { toStorable } from "@/lib/legacy-cache";

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error("Refusing to seed: the Firestore and Auth emulator hosts are not set.");

const projectId = process.env.GCLOUD_PROJECT ?? "demo-compsocrates-rebuild";
// The launcher passes a throwaway key; with explicit credentials the SDK never goes looking for real ones (no metadata-server lookup).
const { FIREBASE_ADMIN_CLIENT_EMAIL: clientEmail, FIREBASE_ADMIN_PRIVATE_KEY: key } = process.env;
const app = initializeApp(clientEmail && key ? { projectId, credential: cert({ projectId, clientEmail, privateKey: key.split("\\n").join("\n") }) } : { projectId });
/** Fixtures may hold Firestore-style timestamps (objects with toMillis): store them as plain milliseconds. */
const plain = (doc: Record<string, unknown>) => toStorable(doc) as Record<string, unknown>;
const db = getFirestore(app);
const auth = getAuth(app);

const FRC_TEAM = "DEVFRC1";
const FTC_TEAM = "DEVFTC1";
const PEOPLE = [
  { uid: "dev-owner", name: "Olive Owner", email: "owner@dev.test", role: "team-coach", admin: true },
  { uid: "dev-lead", name: "Lee Lead", email: "lead@dev.test", role: "lead-scout", admin: false },
  { uid: "dev-scout1", name: "Sam Scout", email: "scout1@dev.test", role: "match-scout", admin: false },
  { uid: "dev-scout2", name: "Sky Scout", email: "scout2@dev.test", role: "match-scout", admin: false },
  { uid: "dev-scout3", name: "Sol Scout", email: "scout3@dev.test", role: "match-scout", admin: false },
];

for (const p of PEOPLE) {
  await auth.createUser({ uid: p.uid, email: p.email, emailVerified: true, password: "password1234", displayName: p.name }).catch(() => undefined);
}

// ---- FRC (root collections, CS shape) ----
await db.doc(`teams/${FRC_TEAM}`).set({ teamName: "Dev Robotics", teamNumber: "9001", verifiedOwnerId: "dev-owner", selectedEvents: ["2026arli"], joinCode: "DEV901" });
for (const p of PEOPLE) {
  await db.doc(`users/${p.uid}`).set({ uid: p.uid, email: p.email, displayName: p.name, teamId: FRC_TEAM, role: p.role, roles: [p.role], isTeamAdmin: p.admin, profileComplete: true, emailVerificationExempt: true });
}
for (let n = 0; n < 20; n += 1) {
  const who = PEOPLE[2 + (n % 3)];
  await db.doc(`scouting/dev-frc-${n}`).set(plain(rebuiltDoc({ teamId: FRC_TEAM, scoutId: who.uid, scoutName: who.name, matchId: `q${n + 1}`, matchNumber: String(n + 1), teamNumber: String(1000 + (n % 6)), eventKey: "2026arli", submittedAt: 1_776_000_000_000 + n * 60_000 })));
}

// ---- FTC (programs/ftc/..., the sister app's shape) ----
await db.doc(`programs/ftc/teams/${FTC_TEAM}`).set({ number: 9002, name: "Dev FTC", accountName: "Dev FTC", joinCode: "DEV902", ownerUid: "dev-owner" });
for (const p of PEOPLE) {
  await db.doc(`programs/ftc/users/${p.uid}`).set({ name: p.name, email: p.email, teamId: FTC_TEAM, primaryRole: p.role, secondaryRoles: [], isAdmin: p.admin, isOwner: p.uid === "dev-owner" });
}
for (let n = 0; n < 20; n += 1) {
  const who = PEOPLE[2 + (n % 3)];
  const base = BIOBUZZ_ENTRY_DOCS[n % BIOBUZZ_ENTRY_DOCS.length].doc;
  await db.doc(`programs/ftc/scoutEntries/dev-ftc-${n}`).set(plain({ ...base, teamId: FTC_TEAM, uid: who.uid, scoutName: who.name, matchNumber: n + 1 }));
}

console.log(`dev:emu seed: ${PEOPLE.length} accounts, 1 team and 20 entries in each program (FRC team ${FRC_TEAM}, FTC team ${FTC_TEAM}). Password for every account: password1234.`);
