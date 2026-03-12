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

type TbaMatch = {
  key: string;
  comp_level: string;
  set_number: number;
  match_number: number;
  videos?: Array<{ type: string; key: string }>;
  alliances: {
    red: { score: number; team_keys: string[] };
    blue: { score: number; team_keys: string[] };
  };
  score_breakdown?: Record<string, Record<string, unknown>>;
};

const FRC_CHANNEL_NAME = "FIRST Robotics Competition";
const ACCEPTED_CHANNEL_MARKERS = ["first robotics competition", "firstinspires", "first"];

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const eventArg = args.find((arg) => arg.startsWith("--event="));
  const eventNameArg = args.find((arg) => arg.startsWith("--event-name="));
  const fromQmArg = args.find((arg) => arg.startsWith("--from-qm="));
  const maxSfArg = args.find((arg) => arg.startsWith("--max-sf="));
  return {
    apply,
    eventKey: (eventArg?.slice("--event=".length).trim() || "2026week0").toLowerCase(),
    eventName: eventNameArg?.slice("--event-name=".length).trim() || "Week 0",
    fromQm: Number(fromQmArg?.slice("--from-qm=".length) || 4),
    maxSf: Number(maxSfArg?.slice("--max-sf=".length) || 13),
  };
}

function readString(field: FirestoreField | undefined): string {
  if (!field) return "";
  if (typeof field.stringValue === "string") return field.stringValue;
  if (typeof field.integerValue === "string") return field.integerValue;
  if (typeof field.doubleValue === "number") return String(field.doubleValue);
  return "";
}

function toTeamNumbers(teamKeys: string[]): number[] {
  return teamKeys
    .map((key) => Number(String(key).replace("frc", "").trim()))
    .filter((value) => Number.isFinite(value));
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
  if (!response.ok) throw new Error(`Firebase sign-in failed (${response.status}): ${await response.text()}`);
  const payload = (await response.json()) as { idToken?: string };
  return payload.idToken || "";
}

async function fetchTbaMatches(eventKey: string, tbaKey: string): Promise<TbaMatch[]> {
  const response = await fetch(`https://www.thebluealliance.com/api/v3/event/${eventKey}/matches`, {
    headers: { "X-TBA-Auth-Key": tbaKey },
  });
  if (!response.ok) throw new Error(`TBA fetch failed (${response.status}): ${await response.text()}`);
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
    if (!response.ok) throw new Error(`Failed listing practiceMatches (${response.status}): ${await response.text()}`);
    const payload = (await response.json()) as { documents?: FirestoreDoc[]; nextPageToken?: string };
    docs.push(...(payload.documents || []));
    pageToken = payload.nextPageToken || "";
  } while (pageToken);
  return docs;
}

async function createPracticeDoc(
  projectId: string,
  payload: Parameters<typeof patchPracticeDoc>[1],
  authHeaders: Record<string, string>
) {
  const body = {
    fields: {
      eventKey: { stringValue: payload.eventKey },
      eventName: { stringValue: payload.eventName },
      matchKey: { stringValue: payload.matchKey },
      matchNumber: { integerValue: String(payload.matchNumber) },
      matchType: { stringValue: payload.matchType },
      compLevel: { stringValue: payload.compLevel },
      setNumber: { integerValue: String(payload.setNumber) },
      videoUrl: { stringValue: payload.videoUrl },
      difficulty: { stringValue: payload.difficulty },
      alliance: { stringValue: payload.alliance },
      allianceScore: { integerValue: String(payload.allianceScore) },
      actualScore: { integerValue: String(payload.actualScore) },
      officialScore: { integerValue: String(payload.officialScore) },
      penaltyPoints: { integerValue: String(payload.penaltyPoints) },
      allianceTeams: {
        arrayValue: { values: payload.allianceTeams.map((team) => ({ integerValue: String(team) })) },
      },
      officialData: {
        mapValue: {
          fields: {
            score: { integerValue: String(payload.officialScore) },
            penaltyPoints: { integerValue: String(payload.penaltyPoints) },
            breakdown: {
              mapValue: {
                fields: {
                  score: { integerValue: String(payload.officialScore) },
                  penaltyPoints: { integerValue: String(payload.penaltyPoints) },
                },
              },
            },
          },
        },
      },
      migrationVersion: { stringValue: "week0-rest-sync-v1" },
      migratedAt: { integerValue: String(Date.now()) },
      createdAt: { integerValue: String(Date.now()) },
    },
  };

  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/practiceMatches`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify(body),
    }
  );
  if (!response.ok) throw new Error(`Failed creating practice match (${response.status}): ${await response.text()}`);
}

async function patchPracticeDoc(
  docName: string,
  payload: {
    eventKey: string;
    eventName: string;
    matchKey: string;
    matchNumber: number;
    matchType: "qualification" | "playoff";
    compLevel: "qm" | "sf";
    setNumber: number;
    videoUrl: string;
    difficulty: "easy" | "medium" | "hard";
    alliance: "red" | "blue";
    allianceScore: number;
    actualScore: number;
    officialScore: number;
    penaltyPoints: number;
    allianceTeams: number[];
  },
  authHeaders: Record<string, string>
) {
  const params = new URLSearchParams();
  [
    "eventKey",
    "eventName",
    "matchKey",
    "matchNumber",
    "matchType",
    "compLevel",
    "setNumber",
    "videoUrl",
    "difficulty",
    "alliance",
    "allianceScore",
    "actualScore",
    "officialScore",
    "penaltyPoints",
    "allianceTeams",
    "officialData.score",
    "officialData.penaltyPoints",
    "officialData.breakdown.score",
    "officialData.breakdown.penaltyPoints",
    "migrationVersion",
    "migratedAt",
  ].forEach((fieldPath) => params.append("updateMask.fieldPaths", fieldPath));

  const body = {
    fields: {
      eventKey: { stringValue: payload.eventKey },
      eventName: { stringValue: payload.eventName },
      matchKey: { stringValue: payload.matchKey },
      matchNumber: { integerValue: String(payload.matchNumber) },
      matchType: { stringValue: payload.matchType },
      compLevel: { stringValue: payload.compLevel },
      setNumber: { integerValue: String(payload.setNumber) },
      videoUrl: { stringValue: payload.videoUrl },
      difficulty: { stringValue: payload.difficulty },
      alliance: { stringValue: payload.alliance },
      allianceScore: { integerValue: String(payload.allianceScore) },
      actualScore: { integerValue: String(payload.actualScore) },
      officialScore: { integerValue: String(payload.officialScore) },
      penaltyPoints: { integerValue: String(payload.penaltyPoints) },
      allianceTeams: {
        arrayValue: { values: payload.allianceTeams.map((team) => ({ integerValue: String(team) })) },
      },
      officialData: {
        mapValue: {
          fields: {
            score: { integerValue: String(payload.officialScore) },
            penaltyPoints: { integerValue: String(payload.penaltyPoints) },
            breakdown: {
              mapValue: {
                fields: {
                  score: { integerValue: String(payload.officialScore) },
                  penaltyPoints: { integerValue: String(payload.penaltyPoints) },
                },
              },
            },
          },
        },
      },
      migrationVersion: { stringValue: "week0-rest-sync-v1" },
      migratedAt: { integerValue: String(Date.now()) },
    },
  };

  const response = await fetch(`https://firestore.googleapis.com/v1/${docName}?${params.toString()}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Failed patching ${docName} (${response.status}): ${await response.text()}`);
}

function toDifficulty(score: number): "easy" | "medium" | "hard" {
  if (score <= 200) return "easy";
  if (score <= 400) return "medium";
  return "hard";
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

async function isOfficialFrcChannel(youtubeKey: string): Promise<boolean> {
  const url = encodeURIComponent(`https://www.youtube.com/watch?v=${youtubeKey}`);
  const oembed = `https://www.youtube.com/oembed?url=${url}&format=json`;
  let response: Response;
  try {
    response = await fetch(oembed);
  } catch {
    return false;
  }
  if (!response.ok) return false;
  const payload = (await response.json()) as { author_name?: string; author_url?: string };
  const author = String(payload.author_name || "").trim().toLowerCase();
  const authorUrl = String(payload.author_url || "").trim().toLowerCase();
  const combined = `${author} ${authorUrl}`.trim();
  if (!combined) return false;
  if (author === FRC_CHANNEL_NAME.toLowerCase()) return true;
  return ACCEPTED_CHANNEL_MARKERS.some((marker) => combined.includes(marker));
}

async function getFrcYouTubeUrl(match: TbaMatch): Promise<string | null> {
  const video = (match.videos || []).find((entry) => entry.type === "youtube" && entry.key);
  const key = String(video?.key || "").trim();
  if (!key) return null;
  const ok = await isOfficialFrcChannel(key);
  return ok ? `https://youtu.be/${key}` : null;
}

async function run() {
  const { apply, eventKey, eventName, fromQm, maxSf } = parseArgs();
  const projectId = String(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "").trim();
  const tbaKey = String(process.env.TBA_API_KEY || process.env.NEXT_PUBLIC_TBA_API_KEY || "").trim();
  if (!projectId) throw new Error("Missing NEXT_PUBLIC_FIREBASE_PROJECT_ID in .env.local");
  if (!tbaKey) throw new Error("Missing TBA_API_KEY or NEXT_PUBLIC_TBA_API_KEY in .env.local");

  const idToken = await getFirebaseIdToken();
  if (!idToken) throw new Error("No Firebase ID token resolved. Check MIGRATION_EMAIL/MIGRATION_PASSWORD.");
  const authHeaders = { Authorization: `Bearer ${idToken}` };

  const matches = await fetchTbaMatches(eventKey, tbaKey);
  const filtered = matches.filter((match) => {
    if (match.comp_level === "qm") return match.match_number >= fromQm;
    if (match.comp_level === "sf" && match.match_number === 1) return match.set_number <= maxSf;
    return false;
  });

  const existingDocs = await listPracticeDocs(projectId, authHeaders);
  const existingByMatchAlliance = new Map<string, FirestoreDoc>();
  existingDocs.forEach((doc) => {
    const fields = doc.fields || {};
    const key = readString(fields.matchKey).toLowerCase();
    const alliance = readString(fields.alliance).toLowerCase();
    if (!key || (alliance !== "red" && alliance !== "blue")) return;
    existingByMatchAlliance.set(`${key}|${alliance}`, doc);
  });

  const targets: Array<{
    mode: "create" | "patch";
    docName?: string;
    payload: Parameters<typeof patchPracticeDoc>[1];
    summary: string;
  }> = [];

  for (const match of filtered) {
    const videoUrl = await getFrcYouTubeUrl(match);
    if (!videoUrl) continue;
    for (const alliance of ["red", "blue"] as const) {
      const allianceData = match.alliances[alliance];
      const scoreBreakdown = (match.score_breakdown?.[alliance] || {}) as Record<string, unknown>;
      const penaltyPoints = readPenaltyPoints(scoreBreakdown);
      const payload = {
        eventKey,
        eventName,
        matchKey: match.key,
        matchNumber: match.match_number,
        matchType: match.comp_level === "qm" ? "qualification" : "playoff",
        compLevel: match.comp_level as "qm" | "sf",
        setNumber: Number(match.set_number || 1),
        videoUrl,
        difficulty: toDifficulty(Number(allianceData.score || 0)),
        alliance,
        allianceScore: Number(allianceData.score || 0),
        actualScore: Number(allianceData.score || 0),
        officialScore: Number(allianceData.score || 0),
        penaltyPoints,
        allianceTeams: toTeamNumbers(allianceData.team_keys || []),
      };
      const existing = existingByMatchAlliance.get(`${match.key.toLowerCase()}|${alliance}`);
      const mode = existing ? "patch" : "create";
      targets.push({
        mode,
        docName: existing?.name,
        payload,
        summary: `${mode.toUpperCase()} ${payload.matchKey} | ${alliance} | score=${payload.officialScore} | teams=${payload.allianceTeams.join(",")} | video=${payload.videoUrl || "-"}`,
      });
    }
  }

  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`Event: ${eventKey} (${eventName})`);
  console.log(`Match filter: qm>=${fromQm}, sf<=${maxSf} (match 1)`);
  console.log(`Matches scanned: ${filtered.length}`);
  console.log(`Docs to sync: ${targets.length}`);
  targets.forEach((target) => console.log(`  - ${target.summary}`));

  if (!apply) return;

  for (const target of targets) {
    if (target.mode === "patch" && target.docName) {
      await patchPracticeDoc(target.docName, target.payload, authHeaders);
      continue;
    }
    await createPracticeDoc(projectId, target.payload, authHeaders);
  }

  console.log(`Synced: ${targets.length}`);
}

run().catch((error) => {
  console.error("Week 0 rest import failed:", error);
  process.exit(1);
});
