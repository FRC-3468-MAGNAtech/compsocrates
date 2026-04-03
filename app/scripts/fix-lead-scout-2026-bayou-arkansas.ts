// Fix lead-scout entries that are stuck on Arkansas and fix scout identity swaps.
//
// Usage:
//   npx tsx app/scripts/fix-lead-scout-2026-bayou-arkansas.ts          (dry run)
//   npx tsx app/scripts/fix-lead-scout-2026-bayou-arkansas.ts --apply  (write updates)
//
// Requires auth env:
// - FIREBASE_ACCESS_TOKEN, or
// - MIGRATION_EMAIL / MIGRATION_PASSWORD (+ NEXT_PUBLIC_FIREBASE_API_KEY)

import { config } from "dotenv";
import { resolve } from "path";
import { APP_EVENT_BY_KEY } from "@/app/utils/events";

config({ path: resolve(process.cwd(), ".env.local") });

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "";
const apply = process.argv.includes("--apply");

const BRANDON_UID = "gPKWtBHZT7UXXrXiUaa2SaNA9Nb2";
const BRANDON_NAME = "Brandon Villanueva";
const JAY_UID = "n3F0VbhtoAOMLapj1qLCveNwU3W2";

const ARKANSAS_KEY = "2026arli";
const BAYOU_KEY = "2026lake";

if (!projectId) {
  console.error("Missing NEXT_PUBLIC_FIREBASE_PROJECT_ID in .env.local");
  process.exit(1);
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

type JsonRecord = Record<string, unknown>;

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

async function runQuery(
  collectionName: "leadScouting" | "scouting",
  filters: Array<{ field: string; value: string }>,
  authHeaders: Record<string, string>
): Promise<FirestoreDoc[]> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
  const where =
    filters.length === 1
      ? {
          fieldFilter: {
            field: { fieldPath: filters[0].field },
            op: "EQUAL",
            value: { stringValue: filters[0].value },
          },
        }
      : {
          compositeFilter: {
            op: "AND",
            filters: filters.map((filter) => ({
              fieldFilter: {
                field: { fieldPath: filter.field },
                op: "EQUAL",
                value: { stringValue: filter.value },
              },
            })),
          },
        };
  const body = {
    structuredQuery: {
      from: [{ collectionId: collectionName }],
      where,
    },
  };
  const maxAttempts = 5;
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify(body),
    });
    if (response.ok) {
      const payload = (await response.json()) as Array<{ document?: FirestoreDoc }>;
      return payload.map((row) => row.document).filter(Boolean) as FirestoreDoc[];
    }
    const text = await response.text();
    if (response.status === 429 && attempt < maxAttempts) {
      const delayMs = 500 * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }
    throw new Error(`Failed runQuery ${collectionName}: ${response.status} ${text}`);
  }
  return [];
}

async function patchDoc(docName: string, fields: Record<string, FirestoreField>, authHeaders: Record<string, string>) {
  const params = new URLSearchParams();
  Object.keys(fields).forEach((path) => params.append("updateMask.fieldPaths", path));
  const url = `https://firestore.googleapis.com/v1/${docName}?${params.toString()}`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({ fields }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Patch failed for ${docName}: ${response.status} ${text}`);
  }
}

function isLeadEntry(data: JsonRecord): boolean {
  const type = String(data.entryType || data.formType || "").toLowerCase().trim();
  return type === "lead" || type === "lead-scout" || type === "lead-scouting" || Boolean(data.isLeadScouting);
}

async function run() {
  console.log(`Fixing lead scout entries (${apply ? "APPLY" : "DRY RUN"})`);
  const authHeaders = await resolveAuthHeaders();
  if (!authHeaders.Authorization) {
    console.error(
      "No auth token found. Provide FIREBASE_ACCESS_TOKEN, or set MIGRATION_EMAIL/MIGRATION_PASSWORD in .env.local."
    );
    process.exit(1);
  }

  const collections: Array<"leadScouting" | "scouting"> = ["leadScouting", "scouting"];
  const brandonDocs: FirestoreDoc[] = [];
  const jayDocs: FirestoreDoc[] = [];
  for (const collectionName of collections) {
    try {
      const [brandon, jay] = await Promise.all([
        runQuery(
          collectionName,
          [
            { field: "scoutId", value: BRANDON_UID },
            { field: "eventKey", value: ARKANSAS_KEY },
          ],
          authHeaders
        ),
        runQuery(
          collectionName,
          [
            { field: "scoutId", value: JAY_UID },
            { field: "eventKey", value: BAYOU_KEY },
          ],
          authHeaders
        ),
      ]);
      brandonDocs.push(...brandon);
      jayDocs.push(...jay);
    } catch (error) {
      console.warn(`Skipping ${collectionName} due to query error:`, error);
    }
  }

  const decodedBrandon = brandonDocs.map((doc) => ({ doc, data: decodeDoc(doc) }));
  const decodedJay = jayDocs.map((doc) => ({ doc, data: decodeDoc(doc) }));
  const brandonArkansas = decodedBrandon.filter(({ data }) => isLeadEntry(data));
  const jayBayou = decodedJay.filter(({ data }) => isLeadEntry(data));

  const bayouName = APP_EVENT_BY_KEY[BAYOU_KEY]?.name || "Bayou Regional";

  console.log(`Brandon @ Arkansas -> Bayou: ${brandonArkansas.length}`);
  console.log(`Jay @ Bayou -> Brandon: ${jayBayou.length}`);

  if (!apply) {
    for (const { doc, data } of brandonArkansas) {
      const id = doc.name.split("/").pop();
      console.log(`  - [Brandon->Bayou] ${id} | match=${String(data.matchId || data.matchKey || "")}`);
    }
    for (const { doc, data } of jayBayou) {
      const id = doc.name.split("/").pop();
      console.log(`  - [Jay->Brandon] ${id} | match=${String(data.matchId || data.matchKey || "")}`);
    }
    console.log("Dry run complete. Re-run with --apply to write updates.");
    return;
  }

  for (const { doc } of brandonArkansas) {
    await patchDoc(
      doc.name,
      {
        eventKey: { stringValue: BAYOU_KEY },
        eventName: { stringValue: bayouName },
      },
      authHeaders
    );
  }

  for (const { doc } of jayBayou) {
    await patchDoc(
      doc.name,
      {
        scoutId: { stringValue: BRANDON_UID },
        scoutName: { stringValue: BRANDON_NAME },
      },
      authHeaders
    );
  }

  console.log("Update complete.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
