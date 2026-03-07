// Script to populate practiceMatches from TBA into Firestore.
// Usage:
//   npx tsx app/scripts/setup-practice-matches.ts
//   npx tsx app/scripts/setup-practice-matches.ts --istanbul-only
// Env required:
//   NEXT_PUBLIC_TBA_API_KEY
//   NEXT_PUBLIC_FIREBASE_PROJECT_ID
// Auth required for Firestore writes (one of):
//   FIREBASE_ACCESS_TOKEN
//   MIGRATION_EMAIL + MIGRATION_PASSWORD + NEXT_PUBLIC_FIREBASE_API_KEY

import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

const TBA_API_KEY = String(process.env.NEXT_PUBLIC_TBA_API_KEY || "").trim();
const FIREBASE_PROJECT_ID = String(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "").trim();
const FIREBASE_WEB_API_KEY = String(process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "").trim();
const FIREBASE_ACCESS_TOKEN = String(process.env.FIREBASE_ACCESS_TOKEN || "").trim();
const MIGRATION_EMAIL = String(process.env.MIGRATION_EMAIL || "").trim();
const MIGRATION_PASSWORD = String(process.env.MIGRATION_PASSWORD || "").trim();

const TBA_BASE_URL = "https://www.thebluealliance.com/api/v3";
const FIRESTORE_BASE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

type EventConfig = {
  key: string;
  name: string;
};

type TbaAlliance = {
  team_keys?: string[];
  score?: number;
};

type TbaMatch = {
  key?: string;
  comp_level?: string;
  match_number?: number;
  videos?: Array<{ type?: string; key?: string }>;
  alliances?: {
    red?: TbaAlliance;
    blue?: TbaAlliance;
  };
  score_breakdown?: Record<string, unknown>;
};

const EVENTS: EventConfig[] = [
  { key: "2025alhu", name: "Rocket City Regional" },
  { key: "2025lake", name: "Bayou Regional" },
  { key: "2026tuis", name: "Istanbul Regional" },
];

function hasFlag(flag: string) {
  return process.argv.some((arg) => arg === flag);
}

function extractTeamNumber(teamKey: string): number {
  const numeric = Number(String(teamKey || "").replace(/[^\d]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function getYouTubeUrl(match: TbaMatch): string | null {
  const video = (match.videos || []).find((entry) => String(entry?.type || "").toLowerCase() === "youtube");
  const key = String(video?.key || "").trim();
  return key ? `https://www.youtube.com/watch?v=${key}` : null;
}

function scoreToDifficulty(score: number): "easy" | "medium" | "hard" {
  if (!Number.isFinite(score) || score <= 200) return "easy";
  if (score <= 400) return "medium";
  return "hard";
}

function getMatchType(compLevel: string): "qualification" | "playoff" | "practice" {
  const level = String(compLevel || "").toLowerCase();
  if (level === "qm") return "qualification";
  if (level === "qf" || level === "sf" || level === "f") return "playoff";
  return "practice";
}

function toFirestoreValue(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { integerValue: 0 };
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  // Keep parity with current app import expectations.
  return { stringValue: JSON.stringify(value) };
}

function toFirestoreDocument(data: Record<string, unknown>): { fields: Record<string, Record<string, unknown>> } {
  const fields: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(data)) {
    fields[key] = toFirestoreValue(value);
  }
  return { fields };
}

async function fetchEventMatches(eventKey: string): Promise<TbaMatch[]> {
  const response = await fetch(`${TBA_BASE_URL}/event/${eventKey}/matches`, {
    headers: { "X-TBA-Auth-Key": TBA_API_KEY },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch matches for ${eventKey}: ${response.status} ${text}`);
  }
  const payload = (await response.json()) as unknown;
  return Array.isArray(payload) ? (payload as TbaMatch[]) : [];
}

async function signInForAccessToken(): Promise<string> {
  if (FIREBASE_ACCESS_TOKEN) return FIREBASE_ACCESS_TOKEN;
  if (!MIGRATION_EMAIL || !MIGRATION_PASSWORD || !FIREBASE_WEB_API_KEY) {
    throw new Error(
      "Missing Firestore auth. Provide FIREBASE_ACCESS_TOKEN or MIGRATION_EMAIL + MIGRATION_PASSWORD + NEXT_PUBLIC_FIREBASE_API_KEY."
    );
  }

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(FIREBASE_WEB_API_KEY)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: MIGRATION_EMAIL,
        password: MIGRATION_PASSWORD,
        returnSecureToken: true,
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to sign in migration user: ${response.status} ${text}`);
  }

  const payload = (await response.json()) as { idToken?: string };
  const token = String(payload?.idToken || "").trim();
  if (!token) throw new Error("Migration sign-in succeeded but no idToken was returned.");
  return token;
}

async function createPracticeMatch(accessToken: string, data: Record<string, unknown>) {
  const response = await fetch(`${FIRESTORE_BASE_URL}/practiceMatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(toFirestoreDocument(data)),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Firestore write failed (${response.status}): ${text}`);
  }
}

async function run() {
  if (!TBA_API_KEY) throw new Error("NEXT_PUBLIC_TBA_API_KEY is required.");
  if (!FIREBASE_PROJECT_ID) throw new Error("NEXT_PUBLIC_FIREBASE_PROJECT_ID is required.");

  const istanbulOnly = hasFlag("--istanbul-only");
  const selectedEvents = istanbulOnly ? EVENTS.filter((event) => event.key === "2026tuis") : EVENTS;
  if (!selectedEvents.length) throw new Error("No events selected for import.");

  const accessToken = await signInForAccessToken();

  console.log("Starting practice match import...");
  console.log(`Selected events: ${selectedEvents.map((event) => `${event.name} (${event.key})`).join(", ")}`);

  let written = 0;
  for (const event of selectedEvents) {
    console.log(`\nFetching ${event.name} (${event.key})...`);
    const allMatches = await fetchEventMatches(event.key);
    const qualificationMatches = allMatches.filter(
      (match) => String(match.comp_level || "").toLowerCase() === "qm" && Array.isArray(match.videos) && match.videos.length > 0
    );
    console.log(`Found ${allMatches.length} matches, ${qualificationMatches.length} qualification matches with video.`);

    for (const match of qualificationMatches) {
      const videoUrl = getYouTubeUrl(match);
      if (!videoUrl) continue;
      const scoreBreakdown = (match.score_breakdown || {}) as Record<string, unknown>;
      for (const alliance of ["red", "blue"] as const) {
        const allianceData = match.alliances?.[alliance];
        const allianceScore = Number(allianceData?.score || 0);
        const allianceTeams = (allianceData?.team_keys || [])
          .map((teamKey) => extractTeamNumber(teamKey))
          .filter((teamNumber) => teamNumber > 0);
        if (allianceTeams.length === 0) continue;

        const payload: Record<string, unknown> = {
          matchKey: String(match.key || "").trim(),
          eventName: event.name,
          eventKey: event.key,
          matchNumber: Number(match.match_number || 0),
          matchType: getMatchType(String(match.comp_level || "")),
          videoUrl,
          difficulty: scoreToDifficulty(allianceScore),
          alliance,
          allianceScore,
          allianceTeams: allianceTeams.slice(0, 3),
          actualScore: allianceScore,
          officialData: {
            score: allianceScore,
            penaltyPoints: Number((scoreBreakdown?.[alliance] as Record<string, unknown> | undefined)?.foulPoints || 0),
            breakdown: (scoreBreakdown?.[alliance] as Record<string, unknown>) || {},
          },
          createdAt: Date.now(),
          importedByScript: "setup-practice-matches.ts",
        };

        await createPracticeMatch(accessToken, payload);
        written += 1;
        if (written % 25 === 0) {
          console.log(`Written ${written} practiceMatches rows...`);
        }
      }
    }
  }

  console.log(`\nDone. Wrote ${written} practiceMatches rows.`);
}

run().catch((error) => {
  console.error("Import failed:", error);
  process.exitCode = 1;
});

