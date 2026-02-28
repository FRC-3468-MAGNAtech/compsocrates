import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

type FirestoreField = {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  mapValue?: { fields?: Record<string, FirestoreField> };
};

type FirestoreDoc = {
  name: string;
  fields?: Record<string, FirestoreField>;
};

type AllianceScore = {
  score: number;
  penaltyPoints: number;
};

type MatchScoreMap = Record<string, { red: AllianceScore; blue: AllianceScore }>;

// Fill more matches here as you confirm scoreboard values.
const WEEK0_SCORES: MatchScoreMap = {
  // From screenshot: Finals 2 -> Red 223 (15 foul pts), Blue 215 (30 foul pts)
  "week0_f1m2": {
    red: { score: 223, penaltyPoints: 15 },
    blue: { score: 215, penaltyPoints: 30 },
  },
};

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const eventArg = args.find((arg) => arg.startsWith("--event="));
  const eventKey = (eventArg?.slice("--event=".length).trim() || "week0").toLowerCase();
  return { apply, eventKey };
}

function readString(field: FirestoreField | undefined): string {
  if (!field) return "";
  if (typeof field.stringValue === "string") return field.stringValue;
  if (typeof field.integerValue === "string") return field.integerValue;
  if (typeof field.doubleValue === "number") return String(field.doubleValue);
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
    throw new Error(`Firebase sign-in failed (${response.status}): ${text}`);
  }
  const payload = (await response.json()) as { idToken?: string };
  return payload.idToken || "";
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

async function patchDoc(
  docName: string,
  score: number,
  penaltyPoints: number,
  authHeaders: Record<string, string>
) {
  const params = new URLSearchParams();
  params.append("updateMask.fieldPaths", "allianceScore");
  params.append("updateMask.fieldPaths", "actualScore");
  params.append("updateMask.fieldPaths", "officialScore");
  params.append("updateMask.fieldPaths", "penaltyPoints");
  params.append("updateMask.fieldPaths", "officialData.score");
  params.append("updateMask.fieldPaths", "officialData.penaltyPoints");
  params.append("updateMask.fieldPaths", "officialData.breakdown.score");
  params.append("updateMask.fieldPaths", "officialData.breakdown.penaltyPoints");
  params.append("updateMask.fieldPaths", "migratedAt");
  params.append("updateMask.fieldPaths", "migrationVersion");

  const body = {
    fields: {
      allianceScore: { integerValue: String(score) },
      actualScore: { integerValue: String(score) },
      officialScore: { integerValue: String(score) },
      penaltyPoints: { integerValue: String(penaltyPoints) },
      officialData: {
        mapValue: {
          fields: {
            score: { integerValue: String(score) },
            penaltyPoints: { integerValue: String(penaltyPoints) },
            breakdown: {
              mapValue: {
                fields: {
                  score: { integerValue: String(score) },
                  penaltyPoints: { integerValue: String(penaltyPoints) },
                },
              },
            },
          },
        },
      },
      migratedAt: { integerValue: String(Date.now()) },
      migrationVersion: { stringValue: "week0-finals-score-fix-v1" },
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
  const { apply, eventKey } = parseArgs();
  const projectId = String(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "").trim();
  if (!projectId) throw new Error("Missing NEXT_PUBLIC_FIREBASE_PROJECT_ID in .env.local");

  const idToken = await getFirebaseIdToken();
  if (!idToken) throw new Error("No Firebase ID token resolved. Check MIGRATION_EMAIL/MIGRATION_PASSWORD.");
  const authHeaders = { Authorization: `Bearer ${idToken}` };

  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`Event key: ${eventKey}`);

  const docs = await listPracticeDocs(projectId, authHeaders);
  const targets: Array<{ name: string; matchKey: string; alliance: "red" | "blue"; score: number; penaltyPoints: number }> = [];

  for (const doc of docs) {
    const fields = doc.fields || {};
    const docEventKey = readString(fields.eventKey).toLowerCase();
    if (docEventKey !== eventKey) continue;
    const matchKey = readString(fields.matchKey).toLowerCase();
    const allianceRaw = readString(fields.alliance).toLowerCase();
    const alliance = allianceRaw === "red" ? "red" : allianceRaw === "blue" ? "blue" : null;
    if (!alliance) continue;

    const scoreBlock = WEEK0_SCORES[matchKey];
    if (!scoreBlock) continue;
    const data = scoreBlock[alliance];
    targets.push({
      name: doc.name,
      matchKey,
      alliance,
      score: data.score,
      penaltyPoints: data.penaltyPoints,
    });
  }

  console.log(`Matched docs for patch: ${targets.length}`);
  targets.forEach((row) => {
    console.log(`  - ${row.matchKey} | ${row.alliance} | score=${row.score} | penalty=${row.penaltyPoints}`);
  });

  if (!apply) return;

  for (const row of targets) {
    await patchDoc(row.name, row.score, row.penaltyPoints, authHeaders);
  }
  console.log(`Patched: ${targets.length}`);
}

run().catch((error) => {
  console.error("Patch failed:", error);
  process.exit(1);
});

