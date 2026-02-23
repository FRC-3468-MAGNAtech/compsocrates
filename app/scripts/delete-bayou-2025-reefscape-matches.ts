// Delete Bayou 2025 REEFSCAPE match scouting entries from Firestore.
//
// Safety behavior:
// - Dry run by default (no deletes).
// - Strictly targets collection "scouting" where:
//   - eventKey == "2025lake"
//   - game == "REEFSCAPE"
// - Apply mode additionally requires an explicit confirm token.
//
// Usage:
//   npx tsx app/scripts/delete-bayou-2025-reefscape-matches.ts
//   npx tsx app/scripts/delete-bayou-2025-reefscape-matches.ts --apply --confirm=DELETE_BAYOU_2025_REEFSCAPE
//
// Optional:
//   --only-missing-scout-name   (delete only rows where scoutName is blank)

import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

type FirestoreField = {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  mapValue?: { fields?: Record<string, FirestoreField> };
  arrayValue?: { values?: FirestoreField[] };
};

type FirestoreDoc = {
  name: string;
  fields?: Record<string, FirestoreField>;
};

type RunQueryRow = {
  document?: FirestoreDoc;
  readTime?: string;
  skippedResults?: number;
  done?: boolean;
};

const TARGET_COLLECTION = "scouting";
const TARGET_EVENT_KEY = "2025lake";
const TARGET_GAME = "REEFSCAPE";
const REQUIRED_CONFIRM = "DELETE_BAYOU_2025_REEFSCAPE";
const PAGE_SIZE = 100;
const MAX_RETRIES = 7;

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const onlyMissingScoutName = args.includes("--only-missing-scout-name");
  const confirmArg = args.find((arg) => arg.startsWith("--confirm="));
  const confirm = confirmArg ? confirmArg.slice("--confirm=".length).trim() : "";
  return { apply, confirm, onlyMissingScoutName };
}

function readString(field: FirestoreField | undefined): string {
  if (!field) return "";
  if (typeof field.stringValue === "string") return field.stringValue;
  if (typeof field.integerValue === "string") return field.integerValue;
  if (typeof field.doubleValue === "number") return String(field.doubleValue);
  return "";
}

function decodeUidFromIdToken(idToken: string): string {
  try {
    const payloadPart = idToken.split(".")[1] || "";
    const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
    const json = JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<string, unknown>;
    return String(json.user_id || json.sub || "").trim();
  } catch {
    return "";
  }
}

async function getFirebaseIdToken(): Promise<string> {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || "";
  const email = process.env.MIGRATION_EMAIL || process.env.FIREBASE_MIGRATION_EMAIL || "";
  const password = process.env.MIGRATION_PASSWORD || process.env.FIREBASE_MIGRATION_PASSWORD || "";
  if (!apiKey || !email || !password) {
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
    throw new Error(`Firebase sign-in failed (${response.status}): ${text}`);
  }
  const payload = (await response.json()) as { idToken?: string };
  return payload.idToken || "";
}

function getAccessToken(): string {
  const envToken = process.env.FIREBASE_ACCESS_TOKEN || process.env.GOOGLE_OAUTH_ACCESS_TOKEN || "";
  if (envToken.trim()) return envToken.trim();
  return "";
}

async function resolveAuthHeaders(): Promise<Record<string, string>> {
  const token = getAccessToken() || (await getFirebaseIdToken());
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

function sleep(ms: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function fetchWithRetry(
  input: string,
  init: RequestInit,
  description: string
): Promise<Response> {
  let lastError = "";
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const response = await fetch(input, init);
    if (response.ok) return response;

    const body = await response.text();
    lastError = `${description} failed (${response.status}): ${body}`;
    const retryable = response.status === 429 || response.status === 500 || response.status === 503;
    if (!retryable || attempt === MAX_RETRIES) {
      throw new Error(lastError);
    }

    const waitMs = Math.min(4000, 300 * 2 ** attempt) + Math.floor(Math.random() * 120);
    console.warn(`${description}: retrying in ${waitMs}ms (attempt ${attempt + 1}/${MAX_RETRIES + 1})`);
    await sleep(waitMs);
  }

  throw new Error(lastError || `${description} failed`);
}

function makeRunQueryBody(startAfterDocName?: string) {
  const body: Record<string, unknown> = {
    structuredQuery: {
      from: [{ collectionId: TARGET_COLLECTION }],
      where: {
        compositeFilter: {
          op: "AND",
          filters: [
            {
              fieldFilter: {
                field: { fieldPath: "eventKey" },
                op: "EQUAL",
                value: { stringValue: TARGET_EVENT_KEY },
              },
            },
            {
              fieldFilter: {
                field: { fieldPath: "game" },
                op: "EQUAL",
                value: { stringValue: TARGET_GAME },
              },
            },
          ],
        },
      },
      orderBy: [{ field: { fieldPath: "__name__" }, direction: "ASCENDING" }],
      limit: PAGE_SIZE,
    },
  };

  if (startAfterDocName) {
    (body.structuredQuery as Record<string, unknown>).startAt = {
      values: [{ referenceValue: startAfterDocName }],
      before: false,
    };
  }

  return body;
}

async function listTargetDocs(projectId: string, authHeaders: Record<string, string>): Promise<FirestoreDoc[]> {
  const docs: FirestoreDoc[] = [];
  let cursor = "";

  while (true) {
    const response = await fetchWithRetry(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify(makeRunQueryBody(cursor || undefined)),
      },
      "RunQuery"
    );
    const rows = (await response.json()) as RunQueryRow[];
    const pageDocs = rows
      .map((row) => row.document)
      .filter((doc): doc is FirestoreDoc => Boolean(doc?.name));

    if (pageDocs.length === 0) break;
    docs.push(...pageDocs);

    const last = pageDocs[pageDocs.length - 1];
    cursor = String(last.name || "");
    if (pageDocs.length < PAGE_SIZE) break;
  }

  return docs;
}

async function deleteDocByName(docName: string, authHeaders: Record<string, string>) {
  await fetchWithRetry(
    `https://firestore.googleapis.com/v1/${docName}`,
    {
      method: "DELETE",
      headers: authHeaders,
    },
    `Delete ${shortDocId(docName)}`
  );
}

function shortDocId(docName: string): string {
  const parts = docName.split("/");
  return parts[parts.length - 1] || docName;
}

async function run() {
  const { apply, confirm, onlyMissingScoutName } = parseArgs();
  const projectId = String(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "").trim();
  if (!projectId) throw new Error("Missing NEXT_PUBLIC_FIREBASE_PROJECT_ID in .env.local");

  const authHeaders = await resolveAuthHeaders();
  if (Object.keys(authHeaders).length === 0) {
    throw new Error(
      "No auth token resolved. Set FIREBASE_ACCESS_TOKEN or MIGRATION_EMAIL/MIGRATION_PASSWORD."
    );
  }

  const token = String(authHeaders.Authorization || "").replace(/^Bearer\s+/i, "");
  const uid = decodeUidFromIdToken(token);

  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`Target: /${TARGET_COLLECTION} where eventKey=${TARGET_EVENT_KEY} and game=${TARGET_GAME}`);
  console.log(`Filter: ${onlyMissingScoutName ? "scoutName must be blank" : "all matched rows"}`);
  if (uid) console.log(`Authenticated as UID: ${uid}`);

  const docs = await listTargetDocs(projectId, authHeaders);
  const filtered = docs.filter((doc) => {
    const fields = doc.fields || {};
    const scoutName = readString(fields.scoutName).trim();
    if (onlyMissingScoutName && scoutName.length > 0) return false;
    return true;
  });

  const blankScoutCount = filtered.filter((doc) => {
    const scoutName = readString((doc.fields || {}).scoutName).trim();
    return scoutName.length === 0;
  }).length;

  console.log(`Target docs returned by server query: ${docs.length}`);
  console.log(`Matched docs after optional local filter: ${filtered.length}`);
  console.log(`Matched docs with blank scoutName: ${blankScoutCount}`);

  const sample = filtered.slice(0, 20);
  if (sample.length > 0) {
    console.log("Sample matched docs:");
    for (const doc of sample) {
      const fields = doc.fields || {};
      const matchLabel = readString(fields.matchLabel) || readString(fields.matchId) || readString(fields.matchNumber);
      const teamNumber = readString(fields.teamNumber);
      const scoutName = readString(fields.scoutName);
      console.log(
        `  - ${shortDocId(doc.name)} | match=${matchLabel || "-"} | team=${teamNumber || "-"} | scout=${scoutName || "(blank)"}`
      );
    }
    if (filtered.length > sample.length) {
      console.log(`  ...and ${filtered.length - sample.length} more`);
    }
  }

  if (!apply) {
    console.log("\nDry run complete. No data deleted.");
    console.log(`To delete, run: npx tsx app/scripts/delete-bayou-2025-reefscape-matches.ts --apply --confirm=${REQUIRED_CONFIRM}`);
    return;
  }

  if (confirm !== REQUIRED_CONFIRM) {
    throw new Error(
      `Refusing to delete: missing or incorrect confirm token. Use --confirm=${REQUIRED_CONFIRM}`
    );
  }

  if (filtered.length === 0) {
    console.log("No matched docs to delete.");
    return;
  }

  let deleted = 0;
  for (const doc of filtered) {
    await deleteDocByName(doc.name, authHeaders);
    deleted += 1;
    await sleep(45);
    if (deleted % 25 === 0) {
      console.log(`Deleted ${deleted}/${filtered.length}...`);
    }
  }

  console.log(`Delete complete. Deleted ${deleted} document(s).`);
}

run().catch((error) => {
  console.error("Delete script failed:", error);
  process.exit(1);
});
