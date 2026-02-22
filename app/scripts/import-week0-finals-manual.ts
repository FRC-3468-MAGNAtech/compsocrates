import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

type FirestoreField = {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  nullValue?: null;
  mapValue?: { fields?: Record<string, FirestoreField> };
  arrayValue?: { values?: FirestoreField[] };
};

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const eventKeyArg = args.find((arg) => arg.startsWith("--event="));
  const eventNameArg = args.find((arg) => arg.startsWith("--event-name="));
  return {
    apply,
    eventKey: (eventKeyArg?.slice("--event=".length).trim() || "week0").toLowerCase(),
    eventName: eventNameArg?.slice("--event-name=".length).trim() || "Week 0",
  };
}

function toFirestoreField(value: unknown): FirestoreField {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number") {
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  if (typeof value === "boolean") return { booleanValue: value };
  if (value === null) return { nullValue: null };
  if (Array.isArray(value)) return { arrayValue: { values: value.map((entry) => toFirestoreField(entry)) } };
  if (value && typeof value === "object") {
    const fields: Record<string, FirestoreField> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      fields[key] = toFirestoreField(inner);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: "" };
}

function toFirestoreFields(data: Record<string, unknown>): Record<string, FirestoreField> {
  const fields: Record<string, FirestoreField> = {};
  for (const [key, value] of Object.entries(data)) fields[key] = toFirestoreField(value);
  return fields;
}

async function getFirebaseIdToken(): Promise<string> {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || "";
  const email = process.env.MIGRATION_EMAIL || process.env.FIREBASE_MIGRATION_EMAIL || "";
  const password = process.env.MIGRATION_PASSWORD || process.env.FIREBASE_MIGRATION_PASSWORD || "";
  if (!apiKey || !email || !password) return "";

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Firebase sign-in failed (${response.status}): ${text}`);
  }
  const payload = (await response.json()) as { idToken?: string };
  return payload.idToken || "";
}

async function createPracticeDoc(
  projectId: string,
  data: Record<string, unknown>,
  authHeaders: Record<string, string>
) {
  const body = { fields: toFirestoreFields(data) };
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/practiceMatches`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify(body),
    }
  );
  if (!response.ok) throw new Error(`Failed writing practice match (${response.status}): ${await response.text()}`);
}

async function run() {
  const { apply, eventKey, eventName } = parseArgs();
  const projectId = String(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "").trim();
  if (!projectId) throw new Error("Missing NEXT_PUBLIC_FIREBASE_PROJECT_ID in .env.local");

  const idToken = await getFirebaseIdToken();
  if (!idToken) throw new Error("No Firebase ID token resolved. Check MIGRATION_EMAIL/MIGRATION_PASSWORD.");
  const authHeaders = { Authorization: `Bearer ${idToken}` };

  const videos = [
    { matchNumber: 1, url: "https://youtu.be/JPk0U_NXfmo" },
    { matchNumber: 2, url: "https://youtu.be/tdLupXNtBD4" },
    { matchNumber: 3, url: "https://youtu.be/8r3-hp36KUc" },
  ];

  const docs: Array<Record<string, unknown>> = [];
  const now = Date.now();
  for (const video of videos) {
    for (const alliance of ["red", "blue"] as const) {
      docs.push({
        matchKey: `${eventKey}_f1m${video.matchNumber}`,
        eventName,
        eventKey,
        matchNumber: video.matchNumber,
        matchType: "playoff",
        compLevel: "f",
        setNumber: 1,
        videoUrl: video.url,
        difficulty: "easy",
        alliance,
        allianceScore: 0,
        allianceTeams: [],
        actualScore: 0,
        officialScore: 0,
        penaltyPoints: 0,
        officialData: {
          score: 0,
          penaltyPoints: 0,
          breakdown: {},
        },
        migrationVersion: "week0-finals-manual-v1",
        migratedAt: now,
        createdAt: now,
      });
    }
  }

  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`Event key: ${eventKey}`);
  console.log(`Event name: ${eventName}`);
  console.log(`Docs to create: ${docs.length}`);
  for (const doc of docs) {
    console.log(`  - ${doc.matchKey} | ${doc.alliance} | ${doc.videoUrl}`);
  }

  if (!apply) return;

  for (const doc of docs) {
    await createPracticeDoc(projectId, doc, authHeaders);
  }
  console.log(`Created: ${docs.length}`);
}

run().catch((error) => {
  console.error("Import failed:", error);
  process.exit(1);
});

