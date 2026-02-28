// Normalize practiceMatches.matchType from matchKey/compLevel.
//
// Usage:
//   npx tsx app/scripts/migrate-practice-matchtype-normalize.ts          (dry run)
//   npx tsx app/scripts/migrate-practice-matchtype-normalize.ts --apply  (write updates)
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
  const eventKey = eventArg ? eventArg.slice("--event=".length).trim().toLowerCase() : "";
  return { apply, eventKey };
}

function readString(field: FirestoreField | undefined): string {
  if (!field) return "";
  if (field.stringValue !== undefined) return field.stringValue;
  if (field.integerValue !== undefined) return String(field.integerValue);
  if (field.doubleValue !== undefined) return String(field.doubleValue);
  if (field.booleanValue !== undefined) return field.booleanValue ? "true" : "false";
  return "";
}

function normalizeMatchType(rawType: string, matchKey: string, compLevel: string): "qualification" | "playoff" | "practice" {
  const typeValue = rawType.trim().toLowerCase();
  if (typeValue === "qualification" || typeValue === "playoff" || typeValue === "practice") {
    return typeValue;
  }
  const level = compLevel.trim().toLowerCase();
  if (level === "qm") return "qualification";
  if (level === "qf" || level === "sf" || level === "f") return "playoff";

  const key = matchKey.trim().toLowerCase();
  if (/_qm\d+/.test(key)) return "qualification";
  if (/_qf\d+m\d+/.test(key) || /_sf\d+m\d+/.test(key) || /_f\d+m\d+/.test(key)) return "playoff";
  return "practice";
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
  if (!response.ok) return "";
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
    if (!response.ok) throw new Error(`Failed listing practiceMatches (${response.status}): ${await response.text()}`);
    const payload = (await response.json()) as { documents?: FirestoreDoc[]; nextPageToken?: string };
    docs.push(...(payload.documents || []));
    pageToken = payload.nextPageToken || "";
  } while (pageToken);
  return docs;
}

async function patchMatchType(
  docName: string,
  nextType: "qualification" | "playoff" | "practice",
  authHeaders: Record<string, string>
) {
  const params = new URLSearchParams();
  params.append("updateMask.fieldPaths", "matchType");
  params.append("updateMask.fieldPaths", "migratedAt");
  params.append("updateMask.fieldPaths", "migrationVersion");
  const url = `https://firestore.googleapis.com/v1/${docName}?${params.toString()}`;
  const body = {
    fields: {
      matchType: { stringValue: nextType },
      migratedAt: { integerValue: String(Date.now()) },
      migrationVersion: { stringValue: "practice-matchtype-normalize-v1" },
    },
  };
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Patch failed (${response.status}) for ${docName}: ${await response.text()}`);
}

async function run() {
  const { apply, eventKey } = parseArgs();
  const projectId = String(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "").trim();
  if (!projectId) throw new Error("Missing NEXT_PUBLIC_FIREBASE_PROJECT_ID in .env.local");

  const authHeaders = await resolveAuthHeaders();
  if (!authHeaders.Authorization) throw new Error("No auth token resolved. Set MIGRATION_EMAIL/MIGRATION_PASSWORD.");

  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
  if (eventKey) console.log(`Event filter: ${eventKey}`);

  const docs = await listPracticeDocs(projectId, authHeaders);
  const candidates: Array<{
    name: string;
    id: string;
    eventKey: string;
    matchKey: string;
    fromType: string;
    toType: "qualification" | "playoff" | "practice";
  }> = [];

  for (const doc of docs) {
    const fields = doc.fields || {};
    const docEventKey = readString(fields.eventKey).toLowerCase();
    if (eventKey && docEventKey !== eventKey) continue;
    const matchKey = readString(fields.matchKey);
    const compLevel = readString(fields.compLevel);
    const currentType = readString(fields.matchType) || "";
    const normalized = normalizeMatchType(currentType, matchKey, compLevel);
    if ((currentType || "").toLowerCase() !== normalized) {
      candidates.push({
        name: doc.name,
        id: doc.name.split("/").pop() || "",
        eventKey: docEventKey,
        matchKey,
        fromType: currentType || "(missing)",
        toType: normalized,
      });
    }
  }

  console.log(`Found ${docs.length} practiceMatches docs`);
  console.log(`${apply ? "Updating" : "Would update"} ${candidates.length} docs`);
  for (const row of candidates.slice(0, 30)) {
    console.log(`  - ${row.id} | ${row.eventKey} | ${row.matchKey} | ${row.fromType} -> ${row.toType}`);
  }
  if (candidates.length > 30) console.log(`  ...and ${candidates.length - 30} more`);

  if (!apply) return;

  let updated = 0;
  for (const row of candidates) {
    await patchMatchType(row.name, row.toType, authHeaders);
    updated += 1;
    if (updated % 50 === 0) console.log(`Updated ${updated} docs...`);
  }
  console.log(`Done. Updated ${updated} docs.`);
}

run().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});

