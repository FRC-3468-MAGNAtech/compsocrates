import { NextRequest, NextResponse } from "next/server";

type FirestoreValue =
  | { stringValue?: string }
  | { integerValue?: string }
  | { doubleValue?: number }
  | { nullValue?: null };

function readStringValue(value: FirestoreValue | undefined): string {
  if (!value) return "";
  if ("stringValue" in value && typeof value.stringValue === "string") return value.stringValue;
  if ("integerValue" in value && typeof value.integerValue === "string") return value.integerValue;
  if ("doubleValue" in value && typeof value.doubleValue === "number") return String(value.doubleValue);
  return "";
}

function formatLabel(teamCode: string, teamName: string, teamNumber: string): string {
  const normalizedCode = String(teamCode || "").trim().toUpperCase();
  const fromName = String(teamName || "").trim();
  const fromNumber = String(teamNumber || "").trim();
  const preferred = fromName || fromNumber;
  if (preferred) {
    const parsed = Number(preferred);
    if (Number.isFinite(parsed) && parsed > 0) return `Team ${parsed}`;
    return preferred;
  }
  return `Team ${normalizedCode}`;
}

async function fetchIdToken(): Promise<string> {
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

function firestoreAuthHeaders(idToken: string): HeadersInit {
  if (!idToken) return {};
  return { Authorization: `Bearer ${idToken}` };
}

async function readTeamByDocId(
  projectId: string,
  idToken: string,
  teamCode: string,
  apiKey: string
): Promise<{ teamName: string; teamNumber: string } | null> {
  const keyQuery = apiKey ? `?key=${encodeURIComponent(apiKey)}` : "";
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/teams/${encodeURIComponent(teamCode)}${keyQuery}`;
  const response = await fetch(url, {
    headers: firestoreAuthHeaders(idToken),
    cache: "no-store",
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as { fields?: Record<string, FirestoreValue> };
  const fields = payload.fields || {};
  return {
    teamName: readStringValue(fields.teamName),
    teamNumber: readStringValue(fields.teamNumber),
  };
}

async function readTeamByTeamIdField(
  projectId: string,
  idToken: string,
  teamCode: string,
  apiKey: string
): Promise<{ teamName: string; teamNumber: string } | null> {
  const keyQuery = apiKey ? `?key=${encodeURIComponent(apiKey)}` : "";
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:runQuery${keyQuery}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...firestoreAuthHeaders(idToken),
      "Content-Type": "application/json",
    },
    cache: "no-store",
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "teams" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "teamId" },
            op: "EQUAL",
            value: { stringValue: teamCode },
          },
        },
        limit: 1,
      },
    }),
  });
  if (!response.ok) return null;
  const rows = (await response.json()) as Array<{ document?: { fields?: Record<string, FirestoreValue> } }>;
  const fields = rows.find((row) => row?.document?.fields)?.document?.fields;
  if (!fields) return null;
  return {
    teamName: readStringValue(fields.teamName),
    teamNumber: readStringValue(fields.teamNumber),
  };
}

export async function GET(request: NextRequest) {
  try {
    const teamCode = String(request.nextUrl.searchParams.get("teamCode") || "").trim().toUpperCase();
    if (!teamCode) {
      return NextResponse.json({ error: "Missing teamCode" }, { status: 400 });
    }

    const projectId = String(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "").trim();
    if (!projectId) {
      return NextResponse.json({ error: "Missing Firebase project id" }, { status: 500 });
    }
    const apiKey = String(process.env.NEXT_PUBLIC_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || "").trim();

    const idToken = await fetchIdToken();
    const byDocId =
      (await readTeamByDocId(projectId, idToken, teamCode, apiKey)) ||
      (idToken ? await readTeamByDocId(projectId, "", teamCode, apiKey) : null);
    if (byDocId) {
      return NextResponse.json({ label: formatLabel(teamCode, byDocId.teamName, byDocId.teamNumber) });
    }

    const byField =
      (await readTeamByTeamIdField(projectId, idToken, teamCode, apiKey)) ||
      (idToken ? await readTeamByTeamIdField(projectId, "", teamCode, apiKey) : null);
    if (byField) {
      return NextResponse.json({ label: formatLabel(teamCode, byField.teamName, byField.teamNumber) });
    }

    return NextResponse.json({ label: `Team ${teamCode}` });
  } catch (error) {
    console.error("Team label resolve failed:", error);
    return NextResponse.json({ error: "Unable to resolve team label" }, { status: 500 });
  }
}
