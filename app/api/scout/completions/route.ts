import { NextRequest, NextResponse } from "next/server";
import { expandEventKeyAliases, normalizeEventKey } from "@/app/utils/events";

type FirestoreValue =
  | { stringValue?: string }
  | { integerValue?: string }
  | { nullValue?: null };

type FirestoreDoc = {
  fields?: Record<string, FirestoreValue>;
};

type RunQueryResult = {
  document?: FirestoreDoc & { name?: string };
};

function readStringValue(value: FirestoreValue | undefined): string {
  if (!value) return "";
  if ("stringValue" in value && typeof value.stringValue === "string") return value.stringValue;
  if ("integerValue" in value && typeof value.integerValue === "string") return value.integerValue;
  return "";
}

async function fetchServerToken(): Promise<string> {
  const staticToken = String(process.env.FIREBASE_ACCESS_TOKEN || process.env.GOOGLE_OAUTH_ACCESS_TOKEN || "").trim();
  if (staticToken) return staticToken;

  const apiKey = String(process.env.NEXT_PUBLIC_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || "").trim();
  const email = String(process.env.MIGRATION_EMAIL || process.env.FIREBASE_MIGRATION_EMAIL || "").trim();
  const password = String(process.env.MIGRATION_PASSWORD || process.env.FIREBASE_MIGRATION_PASSWORD || "").trim();
  if (!apiKey || !email || !password) return "";

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
      cache: "no-store",
    }
  );
  if (!response.ok) return "";
  const payload = (await response.json()) as { idToken?: string };
  return String(payload.idToken || "");
}

function normalizeScoutedMatchId(value: unknown): string {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  const direct = raw.match(/^(p|q|qf|sf|f)(\d+)$/);
  if (direct) return `${direct[1]}${Number(direct[2])}`;
  const playoffSet = raw.match(/^(qf|sf|f)(\d+)m(\d+)$/);
  if (playoffSet) return `${playoffSet[1]}${Number(playoffSet[2])}`;
  const fromQmKey = raw.match(/_qm(\d+)/);
  if (fromQmKey) return `q${Number(fromQmKey[1])}`;
  const fromPracticeKey = raw.match(/_(?:pr|pm)(\d+)/);
  if (fromPracticeKey) return `p${Number(fromPracticeKey[1])}`;
  const fromPractice = raw.match(/practice(?:\s+match)?\s+(\d+)/);
  if (fromPractice) return `p${Number(fromPractice[1])}`;
  const fromQual = raw.match(/qualification(?:\s+match)?\s+(\d+)/);
  if (fromQual) return `q${Number(fromQual[1])}`;
  const sfKey = raw.match(/_sf(\d+)m(\d+)/);
  if (sfKey) return `sf${Number(sfKey[1])}`;
  const sfLabel = raw.match(/semifinal\s+(\d+)(?:-(\d+))?/);
  if (sfLabel) return `sf${Number(sfLabel[1])}`;
  const qfKey = raw.match(/_qf(\d+)m(\d+)/);
  if (qfKey) return `qf${Number(qfKey[1])}`;
  const qfLabel = raw.match(/quarterfinal\s+(\d+)(?:-(\d+))?/);
  if (qfLabel) return `qf${Number(qfLabel[1])}`;
  const finalsKey = raw.match(/_f(\d+)m(\d+)/);
  if (finalsKey) return `f${Number(finalsKey[2])}`;
  const finalsLabel = raw.match(/finals\s+(\d+)/);
  if (finalsLabel) {
    const n = Number(finalsLabel[1]);
    return `f${n >= 14 && n <= 16 ? n - 13 : n}`;
  }
  return raw.replace(/\s+/g, "");
}

async function runTeamQuery(
  projectId: string,
  token: string,
  collectionId: string,
  teamId: string
): Promise<RunQueryResult[]> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
  const body = {
    structuredQuery: {
      from: [{ collectionId }],
      where: {
        fieldFilter: {
          field: { fieldPath: "teamId" },
          op: "EQUAL",
          value: { stringValue: teamId },
        },
      },
    },
  };
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token ? `Bearer ${token}` : "",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) return [];
  const payload = (await response.json()) as RunQueryResult[];
  return Array.isArray(payload) ? payload : [];
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as { eventKey?: string; teamId?: string };
    const eventKey = String(payload.eventKey || "").trim();
    const teamId = String(payload.teamId || "").trim();
    if (!eventKey || !teamId) {
      return NextResponse.json({ completedIds: [], error: "Missing eventKey or teamId" }, { status: 400 });
    }

    const projectId = String(
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || ""
    ).trim();
    if (!projectId) {
      return NextResponse.json({ completedIds: [], error: "Missing Firebase project id" }, { status: 500 });
    }

    const token = await fetchServerToken();
    if (!token) {
      return NextResponse.json({ completedIds: [], error: "Missing server token" }, { status: 500 });
    }

    const collections = ["scouting", "leadScouting", "matchStrategyPlans", "driveScouting"];
    const aliasSet = new Set(
      expandEventKeyAliases(eventKey)
        .map((key) => normalizeEventKey(key))
        .filter(Boolean)
    );
    const completed = new Set<string>();

    for (const name of collections) {
      const results = await runTeamQuery(projectId, token, name, teamId);
      results.forEach((row) => {
        const doc = row.document;
        if (!doc?.fields) return;
        const rowEventKey = normalizeEventKey(readStringValue(doc.fields.eventKey));
        if (rowEventKey && aliasSet.size > 0 && !aliasSet.has(rowEventKey)) return;
        const entryType = readStringValue(doc.fields.entryType || doc.fields.formType).toLowerCase().trim();
        if (entryType === "sub-in-request" || entryType === "sub-in-claim") return;
        const matchId = normalizeScoutedMatchId(
          readStringValue(doc.fields.matchId || doc.fields.matchKey || doc.fields.matchLabel)
        );
        if (matchId) completed.add(matchId);
      });
    }

    return NextResponse.json({ completedIds: Array.from(completed) });
  } catch (error) {
    console.error("Completion API error:", error);
    return NextResponse.json({ completedIds: [], error: "Server error" }, { status: 500 });
  }
}
