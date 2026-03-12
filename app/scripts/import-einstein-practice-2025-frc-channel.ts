// Import Einstein 2025 practiceMatches using only videos from
// the "FIRST Robotics Competition" YouTube channel.
//
// Usage:
//   npx tsx app/scripts/import-einstein-practice-2025-frc-channel.ts          (dry run)
//   npx tsx app/scripts/import-einstein-practice-2025-frc-channel.ts --apply  (create docs)
//
// Optional:
//   --event=2025cmptx
//   --strict-frc-channel
//   --manual=path/to/video-overrides.json
//
// Difficulty rules:
//   easy: <= 200
//   medium: 201-400
//   hard: >= 401

import { config } from "dotenv";
import { readFileSync } from "fs";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

const TBA_BASE_URL = "https://www.thebluealliance.com/api/v3";
const FRC_CHANNEL_NAME = "FIRST Robotics Competition";
const ACCEPTED_CHANNEL_MARKERS = ["first robotics competition", "firstinspires", "first"];

type TbaVideo = { type: string; key: string };
type TbaMatch = {
  key: string;
  comp_level: string;
  match_number: number;
  set_number: number;
  videos?: TbaVideo[];
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

type OEmbedResponse = {
  author_name?: string;
  author_url?: string;
};

type ChannelCheckResult = "frc" | "non-frc" | "unknown";

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const strictFrcChannel = args.includes("--strict-frc-channel");
  const eventArg = args.find((arg) => arg.startsWith("--event="));
  const manualArg = args.find((arg) => arg.startsWith("--manual="));
  const eventKey = eventArg ? eventArg.slice("--event=".length).trim() : "2025cmptx";
  const manualPath = manualArg ? manualArg.slice("--manual=".length).trim() : "";
  return { apply, eventKey: eventKey || "2025cmptx", strictFrcChannel, manualPath };
}

function classifyDifficulty(score: number): "easy" | "medium" | "hard" {
  if (score <= 200) return "easy";
  if (score <= 400) return "medium";
  return "hard";
}

function extractTeamNumber(teamKey: string): number {
  return parseInt(teamKey.replace("frc", "").trim(), 10);
}

function videoUrl(videoKey: string): string {
  return `https://www.youtube.com/watch?v=${videoKey}`;
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
    return { arrayValue: { values: value.map((entry) => toFirestoreField(entry)) } };
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
  for (const [key, value] of Object.entries(data)) fields[key] = toFirestoreField(value);
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
  if (!response.ok) throw new Error(`TBA request failed (${response.status}): ${await response.text()}`);
  return response.json() as Promise<TbaMatch[]>;
}

const channelCheckCache = new Map<string, ChannelCheckResult>();
async function getChannelCheck(youtubeKey: string): Promise<ChannelCheckResult> {
  if (channelCheckCache.has(youtubeKey)) return channelCheckCache.get(youtubeKey) || "unknown";
  const url = encodeURIComponent(videoUrl(youtubeKey));
  const oembed = `https://www.youtube.com/oembed?url=${url}&format=json`;
  let response: Response;
  try {
    response = await fetch(oembed);
  } catch {
    channelCheckCache.set(youtubeKey, "unknown");
    return "unknown";
  }
  if (!response.ok) {
    channelCheckCache.set(youtubeKey, "unknown");
    return "unknown";
  }
  const payload = (await response.json()) as OEmbedResponse;
  const author = String(payload.author_name || "").trim().toLowerCase();
  const authorUrl = String(payload.author_url || "").trim().toLowerCase();
  const combined = `${author} ${authorUrl}`;
  const isMatch =
    author === FRC_CHANNEL_NAME.toLowerCase() ||
    ACCEPTED_CHANNEL_MARKERS.some((marker) => combined.includes(marker));
  const result: ChannelCheckResult = isMatch ? "frc" : "non-frc";
  channelCheckCache.set(youtubeKey, result);
  return result;
}

async function pickFrcYoutubeVideo(
  match: TbaMatch,
  strictFrcChannel: boolean
): Promise<{ url: string | null; source: "frc-verified" | "fallback-youtube" | "none" }> {
  const videos = (match.videos || []).filter((entry) => entry.type === "youtube" && entry.key);
  if (videos.length === 0) return { url: null, source: "none" };
  for (const entry of videos) {
    const result = await getChannelCheck(entry.key);
    if (result === "frc") return { url: videoUrl(entry.key), source: "frc-verified" };
  }
  if (strictFrcChannel) return { url: null, source: "none" };
  return { url: videoUrl(videos[0].key), source: "fallback-youtube" };
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
  if (!response.ok) throw new Error(`Failed writing practice match (${response.status}): ${await response.text()}`);
}

function readPenaltyPoints(breakdown: Record<string, unknown> | undefined): number {
  if (!breakdown) return 0;
  const candidates = [
    breakdown.foulPoints,
    breakdown.foul_points,
    breakdown.techFoulPoints,
    breakdown.tech_foul_points,
    breakdown.penaltyPoints,
    breakdown.penalty_points,
  ];
  for (const value of candidates) {
    const num = Number(value || 0);
    if (Number.isFinite(num)) return num;
  }
  return 0;
}

function loadManualOverrides(path: string): Record<string, string> {
  if (!path) return {};
  try {
    const rawText = readFileSync(resolve(process.cwd(), path), "utf8");
    const raw = JSON.parse(rawText) as Record<string, unknown>;
    const mapped: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw || {})) {
      if (typeof key !== "string" || typeof value !== "string") continue;
      const matchKey = key.trim().toLowerCase();
      const url = value.trim();
      if (!matchKey || !url) continue;
      mapped[matchKey] = url;
    }
    return mapped;
  } catch (error) {
    console.warn(`Warning: could not read manual overrides from ${path}:`, error);
    return {};
  }
}

async function run() {
  const { apply, eventKey, strictFrcChannel, manualPath } = parseArgs();
  const projectId = String(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "").trim();
  const tbaKey = String(process.env.TBA_API_KEY || process.env.NEXT_PUBLIC_TBA_API_KEY || "").trim();
  if (!projectId) throw new Error("Missing NEXT_PUBLIC_FIREBASE_PROJECT_ID in .env.local");
  if (!tbaKey) throw new Error("Missing TBA_API_KEY or NEXT_PUBLIC_TBA_API_KEY in .env.local");

  const authHeaders = await resolveAuthHeaders();
  if (!authHeaders.Authorization) throw new Error("No auth token resolved. Set MIGRATION_EMAIL/MIGRATION_PASSWORD.");

  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`Event key: ${eventKey}`);
  console.log(`Video mode: ${strictFrcChannel ? "strict FRC channel only" : "FRC preferred with fallback"}`);
  if (manualPath) console.log(`Manual override file: ${manualPath}`);

  const matches = await fetchTbaMatches(eventKey, tbaKey);
  const playoffAndQual = matches.filter((match) => ["qm", "qf", "sf", "f"].includes(match.comp_level));
  const manualOverrides = loadManualOverrides(manualPath);
  let frcVideoMatches = 0;
  let fallbackVideoMatches = 0;
  let manualVideoMatches = 0;

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
  let skippedNoFrcVideo = 0;
  let skippedDuplicates = 0;
  let created = 0;
  const missingVideoMatchKeys: string[] = [];

  for (const match of playoffAndQual) {
    const manualVideo = manualOverrides[match.key.toLowerCase()] || "";
    let selectedVideo = manualVideo;
    let source: "manual" | "frc-verified" | "fallback-youtube" | "none" = manualVideo ? "manual" : "none";
    if (!selectedVideo) {
      const picked = await pickFrcYoutubeVideo(match, strictFrcChannel);
      selectedVideo = picked.url || "";
      source = picked.source;
    }
    if (!selectedVideo) {
      skippedNoFrcVideo += 1;
      missingVideoMatchKeys.push(match.key);
      continue;
    }
    if (source === "manual") manualVideoMatches += 1;
    else if (source === "frc-verified") frcVideoMatches += 1;
    else if (source === "fallback-youtube") fallbackVideoMatches += 1;

    for (const allianceColor of ["red", "blue"] as const) {
      attempted += 1;
      const alliance = match.alliances[allianceColor];
      const allianceScore = Number(alliance.score || 0);
      const penaltyPoints = readPenaltyPoints(match.score_breakdown?.[allianceColor]);
      const allianceTeams = alliance.team_keys.map(extractTeamNumber).filter((team) => Number.isFinite(team) && team > 0);
      const difficulty = classifyDifficulty(allianceScore);
      const matchType =
        match.comp_level === "qm"
          ? "qualification"
          : ["qf", "sf", "f"].includes(match.comp_level)
          ? "playoff"
          : "practice";

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
        videoUrl: selectedVideo,
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
        migrationVersion: "einstein-import-frc-channel-v1",
      };

      if (apply) {
        await createPracticeDoc(projectId, payload, authHeaders);
        created += 1;
      }
    }
  }

  console.log(`Total qual/playoff matches scanned: ${playoffAndQual.length}`);
  console.log(`Matches with manual video override: ${manualVideoMatches}`);
  console.log(`Matches with FRC-channel video: ${frcVideoMatches}`);
  console.log(`Matches with fallback YouTube video: ${fallbackVideoMatches}`);
  console.log(`Matches skipped (no usable video): ${skippedNoFrcVideo}`);
  if (missingVideoMatchKeys.length > 0) {
    console.log("Missing video match keys:");
    for (const key of missingVideoMatchKeys) console.log(`  - ${key}`);
  }
  console.log(`Attempted alliance docs: ${attempted}`);
  console.log(`Skipped duplicates: ${skippedDuplicates}`);
  console.log(`${apply ? "Created" : "Would create"}: ${apply ? created : attempted - skippedDuplicates}`);
}

run().catch((error) => {
  console.error("Import failed:", error);
  process.exit(1);
});
