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

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const eventArg = args.find((arg) => arg.startsWith("--event="));
  const eventNameArg = args.find((arg) => arg.startsWith("--event-name="));
  return {
    apply,
    eventKey: (eventArg?.slice("--event=".length).trim() || "2026week0").toLowerCase(),
    eventName: eventNameArg?.slice("--event-name=".length).trim() || "Week 0",
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

function toDifficulty(score: number): "easy" | "medium" | "hard" {
  if (score <= 100) return "easy";
  if (score <= 200) return "medium";
  return "hard";
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
    throw new Error(`Firebase sign-in failed (${response.status}): ${await response.text()}`);
  }
  const payload = (await response.json()) as { idToken?: string };
  return payload.idToken || "";
}

async function fetchTbaQualificationMatches(eventKey: string, tbaKey: string): Promise<TbaMatch[]> {
  const response = await fetch(`https://www.thebluealliance.com/api/v3/event/${eventKey}/matches`, {
    headers: { "X-TBA-Auth-Key": tbaKey },
  });
  if (!response.ok) throw new Error(`TBA fetch failed (${response.status}): ${await response.text()}`);

  const matches = (await response.json()) as TbaMatch[];
  return matches
    .filter((match) => match.comp_level === "qm")
    .sort((a, b) => a.match_number - b.match_number);
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
  payload: {
    eventKey: string;
    eventName: string;
    matchKey: string;
    matchNumber: number;
    matchType: "qualification";
    compLevel: "qm";
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
  const now = Date.now();
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
      migrationVersion: { stringValue: "fill-missing-qm-alliances-v1" },
      migratedAt: { integerValue: String(now) },
      createdAt: { integerValue: String(now) },
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

async function run() {
  const { apply, eventKey, eventName } = parseArgs();
  const projectId = String(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "").trim();
  const tbaKey = String(process.env.TBA_API_KEY || process.env.NEXT_PUBLIC_TBA_API_KEY || "").trim();
  if (!projectId) throw new Error("Missing NEXT_PUBLIC_FIREBASE_PROJECT_ID in .env.local");
  if (!tbaKey) throw new Error("Missing TBA_API_KEY or NEXT_PUBLIC_TBA_API_KEY in .env.local");

  const idToken = await getFirebaseIdToken();
  if (!idToken) throw new Error("No Firebase ID token resolved. Check MIGRATION_EMAIL/MIGRATION_PASSWORD.");
  const authHeaders = { Authorization: `Bearer ${idToken}` };

  const tbaMatches = await fetchTbaQualificationMatches(eventKey, tbaKey);
  const tbaByKey = new Map(tbaMatches.map((match) => [match.key.toLowerCase(), match]));

  const docs = await listPracticeDocs(projectId, authHeaders);
  const existingByMatch = new Map<string, Set<"red" | "blue">>();

  for (const doc of docs) {
    const fields = doc.fields || {};
    const docEventKey = readString(fields.eventKey).toLowerCase();
    if (docEventKey !== eventKey) continue;

    const matchKey = readString(fields.matchKey).toLowerCase();
    const alliance = readString(fields.alliance).toLowerCase();
    const compLevel = readString(fields.compLevel).toLowerCase();
    const matchType = readString(fields.matchType).toLowerCase();

    if (!matchKey) continue;
    if (!(alliance === "red" || alliance === "blue")) continue;
    if (!(compLevel === "qm" || matchType === "qualification")) continue;

    const set = existingByMatch.get(matchKey) || new Set<"red" | "blue">();
    set.add(alliance as "red" | "blue");
    existingByMatch.set(matchKey, set);
  }

  const creates: Array<{
    matchKey: string;
    alliance: "red" | "blue";
    payload: Parameters<typeof createPracticeDoc>[1];
  }> = [];

  for (const [matchKey, alliances] of existingByMatch.entries()) {
    if (alliances.size >= 2) continue;
    const missingAlliance = alliances.has("red") ? "blue" : "red";
    const tba = tbaByKey.get(matchKey);
    if (!tba) continue;

    const allianceData = tba.alliances[missingAlliance];
    const breakdown = (tba.score_breakdown?.[missingAlliance] || {}) as Record<string, unknown>;
    const penaltyPoints = Number(breakdown.foulPoints || 0);
    const youtubeKey = (tba.videos || []).find((video) => video.type === "youtube")?.key || "";
    const videoUrl = youtubeKey ? `https://youtu.be/${youtubeKey}` : "";

    creates.push({
      matchKey: tba.key,
      alliance: missingAlliance,
      payload: {
        eventKey,
        eventName,
        matchKey: tba.key,
        matchNumber: Number(tba.match_number || 0),
        matchType: "qualification",
        compLevel: "qm",
        setNumber: Number(tba.set_number || 1),
        videoUrl,
        difficulty: toDifficulty(Number(allianceData.score || 0)),
        alliance: missingAlliance,
        allianceScore: Number(allianceData.score || 0),
        actualScore: Number(allianceData.score || 0),
        officialScore: Number(allianceData.score || 0),
        penaltyPoints,
        allianceTeams: toTeamNumbers(allianceData.team_keys || []),
      },
    });
  }

  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`Event: ${eventKey} (${eventName})`);
  console.log(`TBA qualification matches fetched: ${tbaMatches.length}`);
  console.log(`Missing alliance docs to create: ${creates.length}`);
  creates.forEach((row) => {
    console.log(
      `  - CREATE ${row.matchKey} | ${row.alliance} | score=${row.payload.officialScore} | teams=${row.payload.allianceTeams.join(",")}`
    );
  });

  if (!apply) return;

  for (const row of creates) {
    await createPracticeDoc(projectId, row.payload, authHeaders);
  }
  console.log(`Created docs: ${creates.length}`);
}

run().catch((error) => {
  console.error("Fill missing qualification alliances failed:", error);
  process.exit(1);
});

