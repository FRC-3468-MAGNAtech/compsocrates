import { NextRequest, NextResponse } from "next/server";

type FirestoreValue =
  | { stringValue?: string }
  | { integerValue?: string }
  | { nullValue?: null };

type FirestoreDocument = {
  name?: string;
  fields?: Record<string, FirestoreValue>;
};

type FirestoreQueryResult = {
  document?: FirestoreDocument;
};

function authHeaders(idToken: string): HeadersInit {
  if (!idToken) return {};
  return { Authorization: `Bearer ${idToken}` };
}

function readStringValue(value: FirestoreValue | undefined): string {
  if (!value) return "";
  if ("stringValue" in value && typeof value.stringValue === "string") return value.stringValue;
  if ("integerValue" in value && typeof value.integerValue === "string") return value.integerValue;
  return "";
}

function readNumberValue(value: FirestoreValue | undefined): number {
  if (!value) return 0;
  if ("integerValue" in value && typeof value.integerValue === "string") {
    const parsed = Number(value.integerValue);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
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

    if (!idToken || !teamId) {
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

    const response = await fetch(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(serverToken) },
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: "subInRequests" }],
            where: {
              fieldFilter: {
                field: { fieldPath: "teamId" },
                op: "EQUAL",
                value: { stringValue: teamId },
              },
            },
            orderBy: [{ field: { fieldPath: "requestedAt" }, direction: "DESCENDING" }],
            limit: 50,
          },
        }),
        cache: "no-store",
      }
    );

    if (!response.ok) {
      const details = await readResponseError(response);
      return NextResponse.json({ error: details || "Unable to load sub-in requests." }, { status: 500 });
    }

    const payload = (await response.json()) as FirestoreQueryResult[];
    const requests = (payload || [])
      .map((row) => row.document)
      .filter(Boolean)
      .map((doc) => {
        const fields = doc?.fields || {};
        return {
          id: String(doc?.name || "").split("/").pop() || "",
          eventKey: readStringValue(fields.eventKey),
          matchId: readStringValue(fields.matchId),
          matchLabel: readStringValue(fields.matchLabel),
          matchType: readStringValue(fields.matchType),
          matchNumber: readNumberValue(fields.matchNumber),
          teamNumber: readNumberValue(fields.teamNumber) || null,
          requestedByName: readStringValue(fields.requestedByName),
          requestedAt: readNumberValue(fields.requestedAt),
        };
      })
      .filter((row) => row.id);

    return NextResponse.json({ requests });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load sub-in requests.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
