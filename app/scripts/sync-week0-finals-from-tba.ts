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

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  return { apply };
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

async function fetchTbaFinals(eventKey: string, tbaKey: string): Promise<TbaMatch[]> {
  const response = await fetch(`https://www.thebluealliance.com/api/v3/event/${eventKey}/matches`, {
    headers: { "X-TBA-Auth-Key": tbaKey },
  });
  if (!response.ok) throw new Error(`TBA fetch failed (${response.status}): ${await response.text()}`);
  const all = (await response.json()) as TbaMatch[];
  return all
    .filter((m) => m.comp_level === "f" && m.set_number === 1 && [1, 2, 3].includes(m.match_number))
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

async function patchDoc(
  docName: string,
  payload: {
    eventKey: string;
    eventName: string;
    matchKey: string;
    matchNumber: number;
    videoUrl: string;
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
    "videoUrl",
    "allianceScore",
    "actualScore",
    "officialScore",
    "penaltyPoints",
    "allianceTeams",
    "officialData.score",
    "officialData.penaltyPoints",
    "officialData.breakdown.score",
    "officialData.breakdown.penaltyPoints",
    "migratedAt",
    "migrationVersion",
  ].forEach((fieldPath) => params.append("updateMask.fieldPaths", fieldPath));

  const body = {
    fields: {
      eventKey: { stringValue: payload.eventKey },
      eventName: { stringValue: payload.eventName },
      matchKey: { stringValue: payload.matchKey },
      matchNumber: { integerValue: String(payload.matchNumber) },
      videoUrl: { stringValue: payload.videoUrl },
      allianceScore: { integerValue: String(payload.allianceScore) },
      actualScore: { integerValue: String(payload.actualScore) },
      officialScore: { integerValue: String(payload.officialScore) },
      penaltyPoints: { integerValue: String(payload.penaltyPoints) },
      allianceTeams: {
        arrayValue: {
          values: payload.allianceTeams.map((team) => ({ integerValue: String(team) })),
        },
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
      migratedAt: { integerValue: String(Date.now()) },
      migrationVersion: { stringValue: "week0-sync-from-tba-v1" },
    },
  };

  const response = await fetch(`https://firestore.googleapis.com/v1/${docName}?${params.toString()}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Failed patching ${docName} (${response.status}): ${await response.text()}`);
}

function teamNumbers(teamKeys: string[]): number[] {
  return teamKeys.map((key) => Number(String(key).replace("frc", "").trim())).filter((n) => Number.isFinite(n));
}

async function run() {
  const { apply } = parseArgs();
  const projectId = String(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "").trim();
  const tbaKey = String(process.env.TBA_API_KEY || process.env.NEXT_PUBLIC_TBA_API_KEY || "").trim();
  if (!projectId) throw new Error("Missing NEXT_PUBLIC_FIREBASE_PROJECT_ID in .env.local");
  if (!tbaKey) throw new Error("Missing TBA_API_KEY or NEXT_PUBLIC_TBA_API_KEY in .env.local");

  const idToken = await getFirebaseIdToken();
  if (!idToken) throw new Error("No Firebase ID token resolved. Check MIGRATION_EMAIL/MIGRATION_PASSWORD.");
  const authHeaders = { Authorization: `Bearer ${idToken}` };

  const eventKey = "2026week0";
  const eventName = "Week 0";
  const finals = await fetchTbaFinals(eventKey, tbaKey);
  const byMatchNumber = new Map<number, TbaMatch>();
  finals.forEach((m) => byMatchNumber.set(m.match_number, m));

  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`TBA finals found: ${finals.length}`);

  const docs = await listPracticeDocs(projectId, authHeaders);
  const targets: Array<{ name: string; patch: Parameters<typeof patchDoc>[1]; summary: string }> = [];

  for (const doc of docs) {
    const fields = doc.fields || {};
    const matchKeyRaw = readString(fields.matchKey).toLowerCase();
    const alliance = readString(fields.alliance).toLowerCase();
    if (!(alliance === "red" || alliance === "blue")) continue;

    // Accept previously imported week0 keys and already-correct 2026week0 keys.
    const m = matchKeyRaw.match(/(?:week0|2026week0)_f1m([123])$/);
    if (!m) continue;
    const matchNumber = Number(m[1]);
    const tba = byMatchNumber.get(matchNumber);
    if (!tba) continue;

    const allianceData = alliance === "red" ? tba.alliances.red : tba.alliances.blue;
    const breakdown = (tba.score_breakdown?.[alliance] || {}) as Record<string, unknown>;
    const penaltyPoints = Number(breakdown.foulPoints || 0);
    const youtube = (tba.videos || []).find((v) => v.type === "youtube")?.key || "";
    const videoUrl = youtube ? `https://youtu.be/${youtube}` : "";

    const patch = {
      eventKey,
      eventName,
      matchKey: tba.key,
      matchNumber,
      videoUrl,
      allianceScore: Number(allianceData.score || 0),
      actualScore: Number(allianceData.score || 0),
      officialScore: Number(allianceData.score || 0),
      penaltyPoints,
      allianceTeams: teamNumbers(allianceData.team_keys),
    };

    targets.push({
      name: doc.name,
      patch,
      summary: `${tba.key} | ${alliance} | score=${patch.officialScore} | foul=${patch.penaltyPoints} | video=${patch.videoUrl}`,
    });
  }

  console.log(`Docs to sync: ${targets.length}`);
  targets.forEach((row) => console.log(`  - ${row.summary}`));

  if (!apply) return;

  for (const target of targets) {
    await patchDoc(target.name, target.patch, authHeaders);
  }
  console.log(`Patched: ${targets.length}`);
}

run().catch((error) => {
  console.error("Sync failed:", error);
  process.exit(1);
});

