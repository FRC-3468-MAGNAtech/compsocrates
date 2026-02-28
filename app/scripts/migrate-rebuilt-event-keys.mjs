import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

const DEFAULT_COLLECTIONS = ["driveScouting", "matchStrategyPlans", "strategyScouting", "pitScouting"];

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const collectionsArg = args.find((arg) => arg.startsWith("--collections=")) || "";
  const collections = collectionsArg
    ? collectionsArg
        .replace("--collections=", "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    : DEFAULT_COLLECTIONS;
  return { apply, collections };
}

function classifyRebuiltEventByTimestamp(timestamp) {
  const time = Number(timestamp || 0);
  if (!Number.isFinite(time) || time <= 0) return "app-testing";
  const date = new Date(time);
  const windows = [
    { key: "2026arli", start: "2026-03-18", end: "2026-03-21" },
    { key: "2026labr", start: "2026-04-01", end: "2026-04-04" },
  ];
  for (const window of windows) {
    const start = new Date(`${window.start}T00:00:00`);
    const end = new Date(`${window.end}T23:59:59`);
    if (date >= start && date <= end) return window.key;
  }
  return "app-testing";
}

function readString(field) {
  if (!field) return "";
  if (typeof field.stringValue === "string") return field.stringValue;
  if (typeof field.integerValue === "string") return field.integerValue;
  if (typeof field.doubleValue === "number") return String(field.doubleValue);
  return "";
}

function readNumber(field) {
  if (!field) return 0;
  if (typeof field.integerValue === "string") return Number(field.integerValue || 0);
  if (typeof field.doubleValue === "number") return Number(field.doubleValue || 0);
  if (typeof field.stringValue === "string") return Number(field.stringValue || 0);
  return 0;
}

async function getFirebaseIdToken() {
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
  const payload = await response.json();
  return payload.idToken || "";
}

async function listCollectionDocs(projectId, collectionName, authHeaders) {
  const docs = [];
  let pageToken = "";
  do {
    const query = new URLSearchParams({ pageSize: "500" });
    if (pageToken) query.set("pageToken", pageToken);
    const response = await fetch(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collectionName}?${query.toString()}`,
      { headers: authHeaders }
    );
    if (!response.ok) {
      throw new Error(`Failed listing ${collectionName} (${response.status}): ${await response.text()}`);
    }
    const payload = await response.json();
    docs.push(...(payload.documents || []));
    pageToken = payload.nextPageToken || "";
  } while (pageToken);
  return docs;
}

async function patchEventKey(docName, targetEventKey, authHeaders) {
  const params = new URLSearchParams();
  ["eventKey", "migratedAt", "migrationVersion"].forEach((fieldPath) =>
    params.append("updateMask.fieldPaths", fieldPath)
  );
  const body = {
    fields: {
      eventKey: { stringValue: targetEventKey },
      migratedAt: { integerValue: String(Date.now()) },
      migrationVersion: { stringValue: "rebuilt-event-key-by-date-v1" },
    },
  };
  const response = await fetch(`https://firestore.googleapis.com/v1/${docName}?${params.toString()}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Failed patching ${docName} (${response.status}): ${await response.text()}`);
}

async function run() {
  const { apply, collections } = parseArgs();
  const projectId = String(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "").trim();
  if (!projectId) throw new Error("Missing NEXT_PUBLIC_FIREBASE_PROJECT_ID in .env.local");

  const idToken = await getFirebaseIdToken();
  if (!idToken) throw new Error("No Firebase ID token resolved. Check MIGRATION_EMAIL/MIGRATION_PASSWORD.");
  const authHeaders = { Authorization: `Bearer ${idToken}` };

  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`Collections: ${collections.join(", ")}`);

  const patchTargets = [];

  for (const collectionName of collections) {
    const docs = await listCollectionDocs(projectId, collectionName, authHeaders);
    console.log(`\n${collectionName}: ${docs.length} docs scanned`);
    for (const doc of docs) {
      const fields = doc.fields || {};
      const game = readString(fields.game).toUpperCase() || "REEFSCAPE";
      if (game !== "REBUILT") continue;
      const timestamp =
        readNumber(fields.createdAt) ||
        readNumber(fields.submittedAt) ||
        readNumber(fields.timestamp) ||
        0;
      const targetEventKey = classifyRebuiltEventByTimestamp(timestamp);
      const currentEventKey = readString(fields.eventKey) || "";
      if (currentEventKey === targetEventKey) continue;
      patchTargets.push({
        collectionName,
        docName: doc.name,
        from: currentEventKey || "(missing)",
        to: targetEventKey,
        timestamp,
      });
    }
  }

  console.log(`\nDocs to update: ${patchTargets.length}`);
  patchTargets.slice(0, 100).forEach((row) => {
    console.log(`- ${row.collectionName}: ${row.from} -> ${row.to} | ts=${row.timestamp}`);
  });
  if (patchTargets.length > 100) {
    console.log(`... and ${patchTargets.length - 100} more`);
  }
  if (!apply) return;

  for (const target of patchTargets) {
    await patchEventKey(target.docName, target.to, authHeaders);
  }
  console.log(`Patched: ${patchTargets.length}`);
}

run().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});

