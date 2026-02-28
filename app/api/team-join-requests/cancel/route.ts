import { NextRequest, NextResponse } from "next/server";

type FirestoreValue =
  | { stringValue?: string }
  | { integerValue?: string }
  | { booleanValue?: boolean }
  | { nullValue?: null };

function readStringValue(value: FirestoreValue | undefined): string {
  if (!value) return "";
  if ("stringValue" in value && typeof value.stringValue === "string") return value.stringValue;
  if ("integerValue" in value && typeof value.integerValue === "string") return value.integerValue;
  return "";
}

function authHeaders(idToken: string): HeadersInit {
  if (!idToken) return {};
  return { Authorization: `Bearer ${idToken}` };
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
    const authHeader = String(request.headers.get("authorization") || "");
    const clientIdToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const callerUid = await verifyCallerUid(clientIdToken);
    if (!callerUid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as { requestId?: string };
    const requestId = String(body.requestId || "").trim();
    if (!requestId) {
      return NextResponse.json({ error: "Missing requestId" }, { status: 400 });
    }

    const projectId = String(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "").trim();
    if (!projectId) {
      return NextResponse.json({ error: "Missing Firebase project id" }, { status: 500 });
    }
    const apiKey = String(process.env.NEXT_PUBLIC_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || "").trim();
    const serverToken = await fetchServerToken();
    if (!serverToken) {
      return NextResponse.json({ error: "Server Firebase auth is not configured for cancel." }, { status: 500 });
    }
    const keyQuery = apiKey ? `?key=${encodeURIComponent(apiKey)}` : "";

    const docUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/teamJoinRequests/${encodeURIComponent(requestId)}${keyQuery}`;
    const readResponse = await fetch(docUrl, {
      headers: authHeaders(serverToken),
      cache: "no-store",
    });
    if (readResponse.status === 404) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }
    if (!readResponse.ok) {
      return NextResponse.json({ error: "Unable to read request" }, { status: 500 });
    }

    const requestDoc = (await readResponse.json()) as { fields?: Record<string, FirestoreValue> };
    const fields = requestDoc.fields || {};
    const ownerUid = readStringValue(fields.userId);
    const status = readStringValue(fields.status);
    if (!ownerUid || ownerUid !== callerUid) {
      return NextResponse.json({ error: "You can only cancel your own request." }, { status: 403 });
    }
    if (status && status !== "pending") {
      return NextResponse.json({ error: `Request is already ${status}.` }, { status: 409 });
    }

    const deleteResponse = await fetch(docUrl, {
      method: "DELETE",
      headers: authHeaders(serverToken),
      cache: "no-store",
    });
    if (!deleteResponse.ok) {
      return NextResponse.json({ error: "Unable to delete request" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Cancel join request failed:", error);
    return NextResponse.json({ error: "Unable to cancel request right now." }, { status: 500 });
  }
}

