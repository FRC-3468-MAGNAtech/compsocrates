import { NextRequest, NextResponse } from "next/server";

type FirestoreValue =
  | { stringValue?: string }
  | { integerValue?: string }
  | { nullValue?: null };

function authHeaders(idToken: string): HeadersInit {
  if (!idToken) return {};
  return { Authorization: `Bearer ${idToken}` };
}

function stringField(value: string) {
  return { stringValue: value };
}

function intField(value: number) {
  return { integerValue: String(Math.trunc(value)) };
}

function nullField() {
  return { nullValue: null };
}

async function readResponseError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: { message?: string; status?: string } };
    return String(payload?.error?.message || payload?.error?.status || "").trim();
  } catch {
    try {
      return String(await response.text()).trim();
    } catch {
      return "";
    }
  }
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

async function verifyCallerUid(clientIdToken: string): Promise<string> {
  const apiKey = String(process.env.NEXT_PUBLIC_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || "").trim();
  if (!apiKey || !clientIdToken) return "";

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: clientIdToken }),
      cache: "no-store",
    }
  );
  if (!response.ok) return "";
  const payload = (await response.json()) as { users?: Array<{ localId?: string }> };
  return String(payload.users?.[0]?.localId || "");
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const idToken = String(body.idToken || "").trim();
    const teamId = String(body.teamId || "").trim();
    const eventKey = String(body.eventKey || "").trim();
    const matchId = String(body.matchId || "").trim();
    const matchLabel = String(body.matchLabel || "").trim();
    const matchType = String(body.matchType || "").trim();
    const matchNumber = Number(body.matchNumber || 0);
    const requestedByName = String(body.requestedByName || "").trim();
    const teamNumberRaw = Number(body.teamNumber || 0);

    if (!idToken || !teamId || !eventKey || !matchId) {
      return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
    }

    const callerUid = await verifyCallerUid(idToken);
    if (!callerUid) {
      return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
    }

    const serverToken = await fetchServerToken();
    if (!serverToken) {
      return NextResponse.json({ error: "Server credentials unavailable." }, { status: 500 });
    }

    const projectId = String(
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || ""
    ).trim();
    if (!projectId) {
      return NextResponse.json({ error: "Missing Firebase project ID." }, { status: 500 });
    }

    const fields: Record<string, FirestoreValue> = {
      teamId: stringField(teamId),
      eventKey: stringField(eventKey),
      matchId: stringField(matchId),
      requestedByUid: stringField(callerUid),
      requestedAt: intField(Date.now()),
    };

    if (matchLabel) fields.matchLabel = stringField(matchLabel);
    if (matchType) fields.matchType = stringField(matchType);
    if (Number.isFinite(matchNumber) && matchNumber > 0) fields.matchNumber = intField(matchNumber);
    fields.teamNumber = Number.isFinite(teamNumberRaw) && teamNumberRaw > 0 ? intField(teamNumberRaw) : nullField();
    if (requestedByName) fields.requestedByName = stringField(requestedByName);

    const response = await fetch(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/subInRequests`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(serverToken) },
        body: JSON.stringify({ fields }),
        cache: "no-store",
      }
    );

    if (!response.ok) {
      const details = await readResponseError(response);
      return NextResponse.json({ error: details || "Unable to create sub-in request." }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create sub-in request.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
