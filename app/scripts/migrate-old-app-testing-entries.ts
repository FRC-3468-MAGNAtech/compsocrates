// One-time migration to tag legacy app-testing scouting entries with eventKey/eventName.
// Safety guard: this script only updates NON-practice scouting entries and will only apply
// if exactly 3 candidates are found.
//
// Usage:
//   npx tsx app/scripts/migrate-old-app-testing-entries.ts          (dry run)
//   npx tsx app/scripts/migrate-old-app-testing-entries.ts --apply  (write updates)

import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "";
const apply = process.argv.includes("--apply");
const migrateAll = process.argv.includes("--all");
const fromEventArg = process.argv.find((arg) => arg.startsWith("--from-event="));
const fromEvent = fromEventArg ? fromEventArg.split("=")[1]?.trim() || "" : "";
const TARGET_GAME = "REEFSCAPE";

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
      eventKey: { stringValue: "app-testing" },
      eventName: { stringValue: "App Testing" },
      game: { stringValue: TARGET_GAME },
      migrationVersion: { stringValue: "legacy-app-testing-event-backfill-v1" },
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

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || String(value).trim() === "";
}

function isPracticeEntry(data: JsonRecord): boolean {
  const matchType = String(data.matchType || "").toLowerCase();
  const practiceMode = String(data.practiceMode || "").toLowerCase();
  const isPracticeScouting = Boolean(data.isPracticeScouting);
  const hasPracticeSession = !isBlank(data.practiceSessionId);
  return (
    matchType === "practice" ||
    isPracticeScouting ||
    practiceMode === "trial" ||
    practiceMode === "competitive" ||
    hasPracticeSession
  );
}

function isCandidate(data: JsonRecord): boolean {
  // Legacy app-testing entries are those with missing event fields,
  // but explicitly NOT practice-scouting rows.
  if (isPracticeEntry(data)) return false;
  if (migrateAll) return true;
  if (fromEvent) {
    return String(data.eventKey || "").trim() === fromEvent;
  }
  const missingEventKey = isBlank(data.eventKey);
  const missingEventName = isBlank(data.eventName);
  if (!missingEventKey && !missingEventName) return false;
  return true;
}

async function run() {
  console.log(`Legacy app-testing migration starting (${apply ? "APPLY" : "DRY RUN"})`);
  if (migrateAll) {
    console.log("Mode: ALL non-practice entries");
  }
  if (fromEvent) {
    console.log(`Source event filter: ${fromEvent}`);
  } else {
    console.log("Source event filter: (missing eventKey/eventName)");
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
  const candidates = decoded.filter(({ data }) => isCandidate(data));

  console.log(`Found ${docs.length} scouting docs`);
  console.log(`Candidate docs (non-practice + missing event fields): ${candidates.length}`);

  for (const { doc, data } of candidates) {
    const id = doc.name.split("/").pop();
    console.log(
      `  - ${id} | matchId=${String(data.matchId || "")} | matchType=${String(data.matchType || "")} | scout=${String(
        data.scoutName || ""
      )}`
    );
  }

  if (!migrateAll && candidates.length !== 3) {
    console.error("Refusing to apply: expected exactly 3 target docs.");
    console.error("This guard prevents touching unintended records (especially practice scouting).");
    const nonPractice = decoded.filter(({ data }) => !isPracticeEntry(data));
    if (nonPractice.length > 0) {
      console.error("Non-practice event keys seen:");
      const freq = new Map<string, number>();
      for (const { data } of nonPractice) {
        const key = String(data.eventKey || "(missing)");
        freq.set(key, (freq.get(key) || 0) + 1);
      }
      for (const [key, count] of Array.from(freq.entries()).sort((a, b) => b[1] - a[1])) {
        console.error(`  - ${key}: ${count}`);
      }
      console.error("Tip: rerun with --from-event=<key> to migrate one non-practice event group.");
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

  console.log("Migration complete. Updated 3 docs.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
