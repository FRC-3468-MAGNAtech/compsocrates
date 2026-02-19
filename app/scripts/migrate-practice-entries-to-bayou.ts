// One-time migration to retag legacy PRACTICE scouting entries to Bayou.
// Safety guard: this only targets practice-scouting rows and only applies
// when exactly 3 candidate docs are found.
//
// Usage:
//   npx tsx app/scripts/migrate-practice-entries-to-bayou.ts          (dry run)
//   npx tsx app/scripts/migrate-practice-entries-to-bayou.ts --apply  (write updates)

import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "";
const apply = process.argv.includes("--apply");
const migrateAll = process.argv.includes("--all");
const TARGET_EVENT_KEY = "2025lake";
const TARGET_EVENT_NAME = "Bayou Regional";
const TARGET_GAME = "REEFSCAPE";
const fromEventArg = process.argv.find((arg) => arg.startsWith("--from-event="));
const fromEvent = fromEventArg ? fromEventArg.split("=")[1]?.trim() || "" : "";

if (!projectId) {
  console.error("Missing NEXT_PUBLIC_FIREBASE_PROJECT_ID in .env.local");
  process.exit(1);
}

function getAccessToken(): string {
  const envToken = process.env.FIREBASE_ACCESS_TOKEN || process.env.GOOGLE_OAUTH_ACCESS_TOKEN || "";
  if (envToken.trim()) return envToken.trim();
  // Keep this deterministic in local scripts: no gcloud probing.
  return "";
}

async function getFirebaseIdToken(): Promise<string> {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || "";
  const email = process.env.MIGRATION_EMAIL || process.env.FIREBASE_MIGRATION_EMAIL || "";
  const password = process.env.MIGRATION_PASSWORD || process.env.FIREBASE_MIGRATION_PASSWORD || "";
  if (!apiKey || !email || !password) {
    console.error("Missing migration auth env vars:");
    if (!apiKey) console.error("  - NEXT_PUBLIC_FIREBASE_API_KEY (or FIREBASE_API_KEY)");
    if (!email) console.error("  - MIGRATION_EMAIL (or FIREBASE_MIGRATION_EMAIL)");
    if (!password) console.error("  - MIGRATION_PASSWORD (or FIREBASE_MIGRATION_PASSWORD)");
    return "";
  }

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true,
      }),
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

async function listScoutingDocs(authHeaders: Record<string, string>): Promise<FirestoreDoc[]> {
  const allDocs: FirestoreDoc[] = [];
  let pageToken = "";

  do {
    const query = new URLSearchParams({ pageSize: "500" });
    if (pageToken) query.set("pageToken", pageToken);
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/scouting?${query.toString()}`;
    const response = await fetch(url, { headers: authHeaders });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed to list scouting docs: ${response.status} ${body}`);
    }
    const payload = (await response.json()) as { documents?: FirestoreDoc[]; nextPageToken?: string };
    allDocs.push(...(payload.documents || []));
    pageToken = payload.nextPageToken || "";
  } while (pageToken);

  return allDocs;
}

async function patchDoc(docName: string, authHeaders: Record<string, string>) {
  const params = new URLSearchParams();
  params.append("updateMask.fieldPaths", "eventKey");
  params.append("updateMask.fieldPaths", "eventName");
  params.append("updateMask.fieldPaths", "game");
  params.append("updateMask.fieldPaths", "migrationVersion");
  params.append("updateMask.fieldPaths", "migratedAt");
  const url = `https://firestore.googleapis.com/v1/${docName}?${params.toString()}`;

  const body = {
    fields: {
      eventKey: { stringValue: TARGET_EVENT_KEY },
      eventName: { stringValue: TARGET_EVENT_NAME },
      game: { stringValue: TARGET_GAME },
      migrationVersion: { stringValue: "practice-bayou-backfill-v1" },
      migratedAt: { integerValue: String(Date.now()) },
    },
  };

  const response = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Patch failed for ${docName}: ${response.status} ${text}`);
  }
}

type JsonRecord = Record<string, unknown>;
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

function decodeField(field: FirestoreField | undefined): unknown {
  if (!field) return undefined;
  if (field.stringValue !== undefined) return field.stringValue;
  if (field.integerValue !== undefined) return Number(field.integerValue);
  if (field.doubleValue !== undefined) return field.doubleValue;
  if (field.booleanValue !== undefined) return field.booleanValue;
  if (field.nullValue !== undefined) return null;
  if (field.mapValue?.fields) {
    const out: JsonRecord = {};
    for (const [key, value] of Object.entries(field.mapValue.fields)) {
      out[key] = decodeField(value);
    }
    return out;
  }
  if (field.arrayValue?.values) return field.arrayValue.values.map((value) => decodeField(value));
  return undefined;
}

function decodeDoc(doc: FirestoreDoc): JsonRecord {
  const out: JsonRecord = {};
  for (const [key, value] of Object.entries(doc.fields || {})) {
    out[key] = decodeField(value);
  }
  return out;
}

function isPracticeEntry(data: JsonRecord): boolean {
  const matchType = String(data.matchType || "").toLowerCase();
  const practiceMode = String(data.practiceMode || "").toLowerCase();
  const isPracticeScouting = Boolean(data.isPracticeScouting);
  const hasPracticeSession = String(data.practiceSessionId || "").trim().length > 0;
  return (
    matchType === "practice" ||
    isPracticeScouting ||
    practiceMode === "trial" ||
    practiceMode === "competitive" ||
    hasPracticeSession
  );
}

function isTargetCandidate(data: JsonRecord): boolean {
  if (!isPracticeEntry(data)) return false;
  if (migrateAll) return true;
  const eventKey = String(data.eventKey || "").trim();
  // Default behavior: only migrate practice rows that are untagged or app-testing.
  if (!fromEvent) return eventKey === "" || eventKey === "app-testing";
  // Optional behavior: migrate practice rows from one specific event key.
  return eventKey === fromEvent;
}

async function run() {
  console.log(`Practice Bayou migration starting (${apply ? "APPLY" : "DRY RUN"})`);
  if (migrateAll) {
    console.log("Mode: ALL practice entries");
  }
  if (fromEvent) {
    console.log(`Source event filter: ${fromEvent}`);
  } else {
    console.log("Source event filter: (missing eventKey or app-testing)");
  }
  const authHeaders = await resolveAuthHeaders();
  if (!authHeaders.Authorization) {
    console.error(
      "No auth token found. Provide FIREBASE_ACCESS_TOKEN, or set MIGRATION_EMAIL/MIGRATION_PASSWORD in .env.local."
    );
    process.exit(1);
  }
  const docs = await listScoutingDocs(authHeaders);
  const decoded = docs.map((doc) => ({ doc, data: decodeDoc(doc) }));
  const candidates = decoded.filter(({ data }) => isTargetCandidate(data));
  const practiceEntries = decoded.filter(({ data }) => isPracticeEntry(data));

  console.log(`Found ${docs.length} scouting docs`);
  console.log(`Total practice entries: ${practiceEntries.length}`);
  console.log(`Practice candidates to migrate: ${candidates.length}`);
  for (const { doc, data } of candidates) {
    const id = doc.name.split("/").pop();
    console.log(
      `  - ${id} | team=${String(data.teamNumber || "")} | match=${String(data.matchId || data.matchNumber || "")} | mode=${String(
        data.practiceMode || ""
      )} | eventKey=${String(data.eventKey || "")}`
    );
  }

  if (!migrateAll && candidates.length !== 3) {
    console.error("Refusing to apply: expected exactly 3 practice candidate docs.");
    if (practiceEntries.length > 0) {
      console.error("Practice entry event keys seen:");
      const freq = new Map<string, number>();
      for (const { data } of practiceEntries) {
        const key = String(data.eventKey || "(missing)");
        freq.set(key, (freq.get(key) || 0) + 1);
      }
      for (const [key, count] of Array.from(freq.entries()).sort((a, b) => b[1] - a[1])) {
        console.error(`  - ${key}: ${count}`);
      }
      console.error("Tip: rerun with --from-event=<key> to migrate from one event to Bayou.");
    }
    process.exit(1);
  }

  if (!apply) {
    console.log(`Dry run complete. Re-run with --apply${migrateAll ? " --all" : ""} to write updates.`);
    return;
  }

  for (const { doc } of candidates) {
    await patchDoc(doc.name, authHeaders);
  }
  console.log(`Migration complete. Updated ${candidates.length} docs to ${TARGET_EVENT_KEY}.`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
