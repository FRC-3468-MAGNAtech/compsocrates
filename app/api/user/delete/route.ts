import { NextRequest, NextResponse } from "next/server";

type FirestoreValue = { stringValue?: string };

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

async function deleteJoinRequestsForUser(projectId: string, apiKey: string, serverToken: string, uid: string) {
  const keyQuery = apiKey ? `?key=${encodeURIComponent(apiKey)}` : "";
  const queryUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:runQuery${keyQuery}`;
  const queryResponse = await fetch(queryUrl, {
    method: "POST",
    headers: {
      ...authHeaders(serverToken),
      "Content-Type": "application/json",
    },
    cache: "no-store",
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "teamJoinRequests" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "userId" },
            op: "EQUAL",
            value: { stringValue: uid },
          },
        },
      },
    }),
  });
  if (!queryResponse.ok) return;
  const rows = (await queryResponse.json()) as Array<{ document?: { name?: string; fields?: Record<string, FirestoreValue> } }>;
  const docNames = rows
    .map((row) => String(row.document?.name || "").trim())
    .filter(Boolean);

  await Promise.all(
    docNames.map(async (name) => {
      const docUrl = `https://firestore.googleapis.com/v1/${name}${keyQuery}`;
      await fetch(docUrl, {
        method: "DELETE",
        headers: authHeaders(serverToken),
        cache: "no-store",
      });
    })
  );
}

async function deleteUserDoc(projectId: string, apiKey: string, serverToken: string, uid: string) {
  const keyQuery = apiKey ? `?key=${encodeURIComponent(apiKey)}` : "";
  const userDocUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/users/${encodeURIComponent(uid)}${keyQuery}`;
  await fetch(userDocUrl, {
    method: "DELETE",
    headers: authHeaders(serverToken),
    cache: "no-store",
  });
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = String(request.headers.get("authorization") || "");
    const clientIdToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const callerUid = await verifyCallerUid(clientIdToken);
    if (!callerUid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await request.json().catch(() => ({}))) as { uid?: string };
    const requestedUid = String(body.uid || "").trim();
    if (!requestedUid || requestedUid !== callerUid) {
      return NextResponse.json({ error: "You can only delete your own account data." }, { status: 403 });
    }

    const projectId = String(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "").trim();
    const apiKey = String(process.env.NEXT_PUBLIC_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || "").trim();
    if (!projectId) return NextResponse.json({ error: "Missing Firebase project id." }, { status: 500 });

    const serverToken = await fetchServerToken();
    if (!serverToken) {
      return NextResponse.json({ error: "Server Firebase auth is not configured for account deletion." }, { status: 500 });
    }

    await deleteJoinRequestsForUser(projectId, apiKey, serverToken, callerUid);
    await deleteUserDoc(projectId, apiKey, serverToken, callerUid);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Account delete cleanup failed:", error);
    return NextResponse.json({ error: "Unable to delete account data right now." }, { status: 500 });
  }
}
