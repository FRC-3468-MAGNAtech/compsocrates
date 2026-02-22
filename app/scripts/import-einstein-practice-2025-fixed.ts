// Import 2025 Einstein Field matches into practiceMatches with the legacy schema.
//
// Usage:
//   npx tsx app/scripts/import-einstein-practice-2025-fixed.ts          (dry run)
//   npx tsx app/scripts/import-einstein-practice-2025-fixed.ts --apply  (create docs)
//
// Optional:
//   --event=2025cmptx
//
// Difficulty rules:
//   easy:   <= 100
//   medium: 101-200
//   hard:   >= 201

import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

const TBA_BASE_URL = "https://www.thebluealliance.com/api/v3";

type TbaMatch = {
  key: string;
  comp_level: string;
  match_number: number;
  set_number: number;
  videos?: Array<{ type: string; key: string }>;
  alliances: {
    red: { score: number; team_keys: string[] };
    blue: { score: number; team_keys: string[] };
  };
  score_breakdown?: Record<string, Record<string, unknown>>;
};

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

function classifyDifficulty(score: number): "easy" | "medium" | "hard" {
  if (score <= 100) return "easy";
  if (score >= 201) return "hard";
  return "medium";
}

function extractTeamNumber(teamKey: string): number {
  return parseInt(teamKey.replace("frc", "").trim(), 10);
}

function youtubeUrl(match: TbaMatch): string | null {
  const video = (match.videos || []).find((entry) => entry.type === "youtube");
  return video ? `https://www.youtube.com/watch?v=${video.key}` : null;
}

function readString(field: FirestoreField | undefined): string {
  if (!field) return "";
  if (field.stringValue !== undefined) return field.stringValue;
  if (field.integerValue !== undefined) return String(field.integerValue);
  if (field.doubleValue !== undefined) return String(field.doubleValue);
  if (field.booleanValue !== undefined) return field.booleanValue ? "true" : "false";
  return "";
}

function toFirestoreField(value: unknown): FirestoreField {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number") {
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  if (typeof value === "boolean") return { booleanValue: value };
  if (value === null) return { nullValue: null };
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map((entry) => toFirestoreField(entry)),
      },
    };
  }
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
  for (const [key, value] of Object.entries(data)) {
    fields[key] = toFirestoreField(value);
  }
  return fields;
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

async function fetchTbaMatches(eventKey: string, apiKey: string): Promise<TbaMatch[]> {
  const response = await fetch(`${TBA_BASE_URL}/event/${eventKey}/matches`, {
    headers: { "X-TBA-Auth-Key": apiKey },
  });
  if (!response.ok) {
    throw new Error(`TBA request failed (${response.status}): ${await response.text()}`);
  }
  return response.json() as Promise<TbaMatch[]>;
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
      if (response.status === 403) return [];
      throw new Error(`Failed listing practiceMatches (${response.status}): ${await response.text()}`);
    }
    const payload = (await response.json()) as { documents?: FirestoreDoc[]; nextPageToken?: string };
    docs.push(...(payload.documents || []));
    pageToken = payload.nextPageToken || "";
  } while (pageToken);
  return docs;
}

async function createPracticeDoc(projectId: string, data: Record<string, unknown>, authHeaders: Record<string, string>) {
  const body = { fields: toFirestoreFields(data) };
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/practiceMatches`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify(body),
    }
  );
  if (!response.ok) {
    throw new Error(`Failed writing practice match (${response.status}): ${await response.text()}`);
  }
}

function readPenaltyPoints(breakdown: Record<string, unknown> | undefined): number {
  if (!breakdown) return 0;
  const candidates = [
    breakdown.foulPoints,
    breakdown.foul_points,
    breakdown.techFoulPoints,
    breakdown.tech_foul_points,
    breakdown.foulCount,
    breakdown.penaltyPoints,
    breakdown.penalty_points,
  ];
  for (const value of candidates) {
    const num = Number(value || 0);
    if (Number.isFinite(num)) return num;
  }
  return 0;
}

async function run() {
  const { apply, eventKey } = parseArgs();
  const projectId = String(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "").trim();
  const tbaKey = String(process.env.TBA_API_KEY || process.env.NEXT_PUBLIC_TBA_API_KEY || "").trim();

  if (!projectId) throw new Error("Missing NEXT_PUBLIC_FIREBASE_PROJECT_ID in .env.local");
  if (!tbaKey) throw new Error("Missing TBA_API_KEY or NEXT_PUBLIC_TBA_API_KEY in .env.local");

  const authHeaders = await resolveAuthHeaders();
  if (!authHeaders.Authorization) {
    throw new Error("No auth token resolved. Set MIGRATION_EMAIL/MIGRATION_PASSWORD.");
  }

  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`Event key: ${eventKey}`);

  const matches = await fetchTbaMatches(eventKey, tbaKey);
  const eligible = matches
    .filter((match) => ["qm", "qf", "sf", "f"].includes(match.comp_level))
    .filter((match) => Boolean(youtubeUrl(match)));

  console.log(`Eligible matches: ${eligible.length}`);
  console.log("Difficulty thresholds: easy<=100, medium=101-200, hard>=201");

  const existingDocs = await listPracticeDocs(projectId, authHeaders);
  const existingKeys = new Set<string>();
  for (const doc of existingDocs) {
    const eventValue = readString(doc.fields?.eventKey).toLowerCase();
    const matchKey = readString(doc.fields?.matchKey).toLowerCase();
    const alliance = readString(doc.fields?.alliance).toLowerCase();
    if (!eventValue || !matchKey || !alliance) continue;
    existingKeys.add(`${eventValue}|${matchKey}|${alliance}|alliance`);
  }

  let attempted = 0;
  let skippedDuplicates = 0;
  let created = 0;

  for (const match of eligible) {
    const video = youtubeUrl(match);
    if (!video) continue;

    for (const allianceColor of ["red", "blue"] as const) {
      attempted += 1;
      const alliance = match.alliances[allianceColor];
      const allianceScore = Number(alliance.score || 0);
      const penaltyPoints = readPenaltyPoints(match.score_breakdown?.[allianceColor]);
      const allianceTeams = alliance.team_keys
        .map(extractTeamNumber)
        .filter((team) => Number.isFinite(team) && team > 0);
      const difficulty = classifyDifficulty(allianceScore);
      const matchType =
        match.comp_level === "qm"
          ? "qualification"
          : ["qf", "sf", "f"].includes(match.comp_level)
          ? "playoff"
          : "practice";

      // One doc per alliance (2 docs per match), matching expected practice doc cardinality.
      const dedupeKey = `${eventKey.toLowerCase()}|${match.key.toLowerCase()}|${allianceColor}|alliance`;
      if (existingKeys.has(dedupeKey)) {
        skippedDuplicates += 1;
        continue;
      }

      const payload = {
        eventName: "Einstein Field",
        eventKey,
        matchKey: match.key,
        matchNumber: Number(match.match_number || 0),
        matchType,
        videoUrl: video,
        difficulty,
        alliance: allianceColor,
        allianceScore,
        allianceTeams,
        actualScore: allianceScore,
        officialScore: allianceScore,
        penaltyPoints,
        officialData: {
          score: allianceScore,
          penaltyPoints,
          breakdown: match.score_breakdown?.[allianceColor] || {},
        },
        createdAt: Date.now(),
        migratedAt: Date.now(),
        migrationVersion: "einstein-import-fixed-v2",
      };

      if (apply) {
        await createPracticeDoc(projectId, payload, authHeaders);
        created += 1;
      }
    }
  }

  console.log(`Attempted alliance docs: ${attempted}`);
  console.log(`Skipped duplicates: ${skippedDuplicates}`);
  console.log(`${apply ? "Created" : "Would create"}: ${apply ? created : attempted - skippedDuplicates}`);
}

run().catch((error) => {
  console.error("Import failed:", error);
  process.exit(1);
});
