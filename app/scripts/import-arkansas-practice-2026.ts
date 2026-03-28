// Import 2026 Arkansas Regional matches into practiceMatches for practice scouting.
//
// Usage:
//   npx tsx app/scripts/import-arkansas-practice-2026.ts          (dry run)
//   npx tsx app/scripts/import-arkansas-practice-2026.ts --apply  (write docs)
//
// Optional:
//   --event=2026arli
//   --name="Arkansas Regional"
//   --include-practice   (include practice comp level matches if present)

import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

const TBA_BASE_URL = "https://www.thebluealliance.com/api/v3";
const DEFAULT_EVENT_KEY = "2026arli";
const DEFAULT_EVENT_NAME = "Arkansas Regional";

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

type FirestoreField =
  | { stringValue: string }
  | { integerValue: string | number }
  | { doubleValue: string | number }
  | { booleanValue: boolean }
  | { mapValue: { fields?: Record<string, FirestoreField> } }
  | { arrayValue: { values?: FirestoreField[] } };

type FirestoreDoc = { name: string; fields?: Record<string, FirestoreField> };
type AuthContext = {
  headers: Record<string, string>;
  uid: string;
  teamId: string;
  isTeamAdmin: boolean;
};

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const includePractice = args.includes("--include-practice");
  const eventArg = args.find((arg) => arg.startsWith("--event="));
  const nameArg = args.find((arg) => arg.startsWith("--name="));
  const eventKey = eventArg ? eventArg.slice("--event=".length).trim() : DEFAULT_EVENT_KEY;
  const eventName = nameArg ? nameArg.slice("--name=".length).trim() : DEFAULT_EVENT_NAME;
  return { apply, includePractice, eventKey: eventKey || DEFAULT_EVENT_KEY, eventName };
}

function extractTeamNumber(teamKey: string): number {
  return parseInt(teamKey.replace("frc", "").trim(), 10);
}

function youtubeUrl(match: TbaMatch): string | null {
  const video = (match.videos || []).find((entry) => entry.type === "youtube");
  return video ? `https://www.youtube.com/watch?v=${video.key}` : null;
}

function classifyDifficulty(score: number): "easy" | "medium" | "hard" {
  if (score <= 200) return "easy";
  if (score <= 400) return "medium";
  return "hard";
}

function matchTypeFromCompLevel(compLevel: string): "qualification" | "playoff" | "practice" {
  const level = String(compLevel || "").toLowerCase();
  if (level === "qm") return "qualification";
  if (level === "qf" || level === "sf" || level === "f") return "playoff";
  return "practice";
}

function toFirestoreFields(data: Record<string, unknown>): Record<string, FirestoreField> {
  const fields: Record<string, FirestoreField> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string") {
      fields[key] = { stringValue: value };
    } else if (typeof value === "number") {
      if (Number.isInteger(value)) fields[key] = { integerValue: value };
      else fields[key] = { doubleValue: value };
    } else if (typeof value === "boolean") {
      fields[key] = { booleanValue: value };
    } else if (value && typeof value === "object") {
      // Keep parity with setup-practice-matches.ts: objects/arrays as JSON strings.
      fields[key] = { stringValue: JSON.stringify(value) };
    }
  }
  return fields;
}

function readString(field?: FirestoreField): string {
  if (!field) return "";
  if ("stringValue" in field) return field.stringValue;
  if ("integerValue" in field) return String(field.integerValue);
  if ("doubleValue" in field) return String(field.doubleValue);
  return "";
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
    console.warn(`Firebase sign-in failed: ${response.status} ${text}`);
    return "";
  }
  const payload = (await response.json()) as { idToken?: string };
  return payload.idToken || "";
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

async function resolveAuthHeaders(): Promise<Record<string, string>> {
  const token = getAccessToken() || (await getFirebaseIdToken());
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

async function resolveAuthContext(projectId: string): Promise<AuthContext> {
  const envToken = getAccessToken();
  const firebaseToken = envToken ? "" : await getFirebaseIdToken();
  const token = envToken || firebaseToken;
  if (!token) return { headers: {}, uid: "", teamId: "", isTeamAdmin: false };

  const headers = { Authorization: `Bearer ${token}` };
  let uid = decodeUidFromIdToken(token);
  if (!uid && process.env.MIGRATION_UID) uid = String(process.env.MIGRATION_UID).trim();
  if (!uid) return { headers, uid: "", teamId: "", isTeamAdmin: false };

  try {
    const response = await fetch(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`,
      { headers }
    );
    if (!response.ok) return { headers, uid, teamId: "", isTeamAdmin: false };
    const doc = (await response.json()) as FirestoreDoc;
    const fields = doc.fields || {};
    const teamId = readString(fields.teamId);
    const adminField = fields.isTeamAdmin;
    const isTeamAdmin = Boolean(adminField && "booleanValue" in adminField ? adminField.booleanValue : false);
    return { headers, uid, teamId, isTeamAdmin };
  } catch {
    return { headers, uid, teamId: "", isTeamAdmin: false };
  }
}

async function fetchExistingPracticeDocs(
  projectId: string,
  authHeaders: Record<string, string>
): Promise<FirestoreDoc[]> {
  const docs: FirestoreDoc[] = [];
  let pageToken = "";
  while (true) {
    const query = new URLSearchParams();
    query.set("pageSize", "500");
    if (pageToken) query.set("pageToken", pageToken);
    const response = await fetch(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/practiceMatches?${query.toString()}`,
      { headers: authHeaders }
    );
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed reading existing practiceMatches (${response.status}): ${body}`);
    }
    const payload = (await response.json()) as { documents?: FirestoreDoc[]; nextPageToken?: string };
    docs.push(...(payload.documents || []));
    pageToken = payload.nextPageToken || "";
    if (!pageToken) break;
  }
  return docs;
}

async function createPracticeDocViaRest(
  projectId: string,
  data: Record<string, unknown>,
  authHeaders: Record<string, string>
): Promise<void> {
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/practiceMatches`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify({ fields: toFirestoreFields(data) }),
    }
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Firestore write failed (${response.status}): ${body}`);
  }
}

async function run() {
  const { apply, includePractice, eventKey, eventName } = parseArgs();
  const projectId = String(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "").trim();
  const apiKey =
    String(process.env.TBA_API_KEY || "").trim() ||
    String(process.env.NEXT_PUBLIC_TBA_API_KEY || "").trim();

  if (!projectId) throw new Error("Missing NEXT_PUBLIC_FIREBASE_PROJECT_ID in .env.local");
  if (!apiKey) throw new Error("Missing TBA API key (TBA_API_KEY or NEXT_PUBLIC_TBA_API_KEY) in .env.local");

  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`Event key: ${eventKey}`);
  console.log(`Event name: ${eventName}`);

  const matches = await fetchTbaMatches(eventKey, apiKey);
  const eligibleLevels = includePractice ? ["qm", "qf", "sf", "f", "pr"] : ["qm", "qf", "sf", "f"];
  const eligible = matches
    .filter((match) => eligibleLevels.includes(String(match.comp_level || "").toLowerCase()))
    .filter((match) => Boolean(youtubeUrl(match)));

  if (eligible.length === 0) {
    console.log("No video-backed matches found to import.");
    return;
  }

  console.log(`Eligible matches: ${eligible.length}`);
  console.log("Difficulty thresholds: easy<=200, medium=201-400, hard>=401");

  const authContext = await resolveAuthContext(projectId);
  const authHeaders = authContext.headers;
  if (Object.keys(authHeaders).length > 0) {
    console.log("Authenticated REST mode enabled (Bearer token).");
    if (authContext.uid) {
      console.log(
        `Importer user: uid=${authContext.uid}, teamId=${authContext.teamId || "(none)"}, isTeamAdmin=${String(authContext.isTeamAdmin)}`
      );
    }
  } else {
    console.warn(
      "Warning: no auth token resolved. Set FIREBASE_ACCESS_TOKEN or MIGRATION_EMAIL/MIGRATION_PASSWORD."
    );
  }

  const existingDocs = await fetchExistingPracticeDocs(projectId, authHeaders);
  const existingKeys = new Set<string>();
  for (const doc of existingDocs) {
    const fields = doc.fields || {};
    const docEventKey = readString(fields.eventKey).toLowerCase();
    const docMatchKey = readString(fields.matchKey).toLowerCase();
    const docAlliance = readString(fields.alliance).toLowerCase();
    if (!docMatchKey || !docAlliance) continue;
    existingKeys.add(`${docEventKey}|${docMatchKey}|${docAlliance}`);
  }

  let attempted = 0;
  let skippedDuplicates = 0;
  let created = 0;
  const duplicatePrecheckEnabled = existingDocs.length > 0;

  for (const match of eligible) {
    const videoUrl = youtubeUrl(match);
    if (!videoUrl) continue;

    for (const allianceColor of ["red", "blue"] as const) {
      attempted += 1;
      const alliance = match.alliances[allianceColor];
      const dedupeKey = `${eventKey.toLowerCase()}|${match.key.toLowerCase()}|${allianceColor}`;
      if (duplicatePrecheckEnabled && existingKeys.has(dedupeKey)) {
        skippedDuplicates += 1;
        continue;
      }

      const score = Number(alliance.score || 0);
      const difficulty = classifyDifficulty(score);
      const matchType = matchTypeFromCompLevel(match.comp_level);
      const allianceTeams = alliance.team_keys.map(extractTeamNumber).filter((team) => Number.isFinite(team) && team > 0);
      const breakdown = match.score_breakdown?.[allianceColor] || {};
      const foulPoints = Number((breakdown as Record<string, unknown>)?.foulPoints || 0);

      const payload = {
        eventName,
        eventKey,
        matchKey: match.key,
        matchNumber: Number(match.match_number || 0),
        matchType,
        compLevel: String(match.comp_level || ""),
        setNumber: Number(match.set_number || 1),
        videoUrl,
        difficulty,
        alliance: allianceColor,
        allianceScore: score,
        allianceTeams: allianceTeams.slice(0, 3),
        actualScore: score,
        officialScore: score,
        penaltyPoints: foulPoints,
        officialData: {
          score,
          penaltyPoints: foulPoints,
          breakdown,
        },
        createdAt: Date.now(),
        importedByScript: "import-arkansas-practice-2026.ts",
      };

      if (apply) {
        await createPracticeDocViaRest(projectId, payload, authHeaders);
        created += 1;
      }
    }
  }

  console.log(`Attempted alliance docs: ${attempted}`);
  console.log(`Skipped duplicates: ${skippedDuplicates}`);
  if (!duplicatePrecheckEnabled) {
    console.log("Duplicate pre-check: disabled (no list permission).");
  }
  console.log(`${apply ? "Created" : "Would create"}: ${apply ? created : attempted - skippedDuplicates}`);
}

run().catch((error) => {
  console.error("Import failed:", error);
  process.exit(1);
});
