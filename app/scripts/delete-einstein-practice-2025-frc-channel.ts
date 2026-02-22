// Delete Einstein 2025 practiceMatches docs (for re-import with FRC-channel videos).
//
// Usage:
//   npx tsx app/scripts/delete-einstein-practice-2025-frc-channel.ts          (dry run)
//   npx tsx app/scripts/delete-einstein-practice-2025-frc-channel.ts --apply  (delete docs)
//
// Optional:
//   --event=2025cmptx

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

type FirestoreDoc = {
  name: string;
  fields?: Record<string, FirestoreField>;
};

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const eventArg = args.find((arg) => arg.startsWith("--event="));
  const eventKey = eventArg ? eventArg.slice("--event=".length).trim() : "2025cmptx";
  return { apply, eventKey: eventKey || "2025cmptx" };
}

function readString(field: FirestoreField | undefined): string {
  if (!field) return "";
  if (field.stringValue !== undefined) return field.stringValue;
  if (field.integerValue !== undefined) return String(field.integerValue);
  if (field.doubleValue !== undefined) return String(field.doubleValue);
  if (field.booleanValue !== undefined) return field.booleanValue ? "true" : "false";
  return "";
}

function getAccessToken(): string {
  const envToken = process.env.FIREBASE_ACCESS_TOKEN || process.env.GOOGLE_OAUTH_ACCESS_TOKEN || "";
  if (envToken.trim()) return envToken.trim();
  return "";
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
    console.error(`Firebase sign-in failed: ${response.status} ${text}`);
    return "";
  }
  const payload = (await response.json()) as { idToken?: string };
  return payload.idToken || "";
}

async function resolveAuthHeaders(): Promise<Record<string, string>> {
  const token = getAccessToken() || (await getFirebaseIdToken());
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

async function listPracticeDocs(projectId: string, authHeaders: Record<string, string>): Promise<FirestoreDoc[]> {
  const docs: FirestoreDoc[] = [];
  let pageToken = "";
  do {
    const query = new URLSearchParams({ pageSize: "500" });
    if (pageToken) query.set("pageToken", pageToken);
    const response = await fetch(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/practiceMatches?${query.toString()}`,
      { headers: authHeaders }
    );
    if (!response.ok) {
      throw new Error(`Failed listing practiceMatches (${response.status}): ${await response.text()}`);
    }
    const payload = (await response.json()) as { documents?: FirestoreDoc[]; nextPageToken?: string };
    docs.push(...(payload.documents || []));
    pageToken = payload.nextPageToken || "";
  } while (pageToken);
  return docs;
}

async function deleteDoc(docName: string, authHeaders: Record<string, string>) {
  const response = await fetch(`https://firestore.googleapis.com/v1/${docName}`, {
    method: "DELETE",
    headers: authHeaders,
  });
  if (!response.ok) {
    throw new Error(`Failed deleting ${docName} (${response.status}): ${await response.text()}`);
  }
}

async function run() {
  const { apply, eventKey } = parseArgs();
  const projectId = String(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "").trim();
  if (!projectId) throw new Error("Missing NEXT_PUBLIC_FIREBASE_PROJECT_ID in .env.local");

  const authHeaders = await resolveAuthHeaders();
  if (!authHeaders.Authorization) {
    throw new Error("No auth token resolved. Set MIGRATION_EMAIL/MIGRATION_PASSWORD.");
  }

  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`Event key: ${eventKey}`);

  const docs = await listPracticeDocs(projectId, authHeaders);
  const targets = docs.filter((doc) => {
    const eventValue = readString(doc.fields?.eventKey).toLowerCase();
    return eventValue === eventKey.toLowerCase();
  });

  console.log(`Found ${docs.length} practiceMatches docs`);
  console.log(`${apply ? "Deleting" : "Would delete"} ${targets.length} docs for ${eventKey}`);

  for (const doc of targets.slice(0, 20)) {
    const id = doc.name.split("/").pop();
    const matchKey = readString(doc.fields?.matchKey);
    const alliance = readString(doc.fields?.alliance);
    const videoUrl = readString(doc.fields?.videoUrl);
    console.log(`  - ${id} | ${matchKey} | ${alliance} | ${videoUrl}`);
  }
  if (targets.length > 20) console.log(`  ...and ${targets.length - 20} more`);

  if (!apply) return;

  let deleted = 0;
  for (const doc of targets) {
    await deleteDoc(doc.name, authHeaders);
    deleted += 1;
    if (deleted % 25 === 0) console.log(`Deleted ${deleted} docs...`);
  }
  console.log(`Done. Deleted ${deleted} Einstein docs.`);
}

run().catch((error) => {
  console.error("Delete failed:", error);
  process.exit(1);
});

