import { NextRequest, NextResponse } from "next/server";

type FirestoreValue =
  | { stringValue?: string }
  | { booleanValue?: boolean }
  | { integerValue?: string }
  | { nullValue?: null }
  | { arrayValue?: { values?: FirestoreValue[] } };

type FirestoreDocument = {
  fields?: Record<string, FirestoreValue>;
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

function readBooleanValue(value: FirestoreValue | undefined): boolean {
  return Boolean(value && "booleanValue" in value && value.booleanValue === true);
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

async function fetchDocument(docUrl: string, idToken: string, label: string): Promise<FirestoreDocument | null> {
  const response = await fetch(docUrl, {
    headers: authHeaders(idToken),
    cache: "no-store",
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const details = await readResponseError(response);
    throw new Error(`Failed to fetch ${label} (${response.status}): ${details || "unknown error"}`);
  }
  return (await response.json()) as FirestoreDocument;
}

async function readResponseError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as {
      error?: { message?: string; status?: string };
    };
    const message = String(payload?.error?.message || "").trim();
    const status = String(payload?.error?.status || "").trim();
    return message || status || "";
  } catch {
    try {
      return String(await response.text()).trim();
    } catch {
      return "";
    }
  }
}

function buildNameFromEmail(email: string): string {
  if (!email.includes("@")) return "";
  const local = email.split("@")[0]?.trim() || "";
  if (!local) return "";
  const chunks = local
    .replace(/\d+/g, " ")
    .split(/[._-]+|\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (chunks.length === 0) return local;
  return chunks
    .map((value) => value.charAt(0).toUpperCase() + value.slice(1).toLowerCase())
    .join(" ");
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
    const keyQuery = apiKey ? `?key=${encodeURIComponent(apiKey)}` : "";

    const serverToken = await fetchServerToken();
    const privilegedToken = serverToken || clientIdToken;
    if (!privilegedToken) {
      return NextResponse.json({ error: "Missing auth token for approval." }, { status: 500 });
    }

    const callerDocUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/users/${encodeURIComponent(callerUid)}${keyQuery}`;
    const callerDoc = await fetchDocument(callerDocUrl, privilegedToken, "caller user");
    const callerFields = callerDoc?.fields || {};
    const callerTeamId = readStringValue(callerFields.teamId);
    const callerIsTeamAdmin = readBooleanValue(callerFields.isTeamAdmin);
    if (!callerIsTeamAdmin) {
      return NextResponse.json({ error: "Only team admins can approve requests." }, { status: 403 });
    }

    const requestDocUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/teamJoinRequests/${encodeURIComponent(requestId)}${keyQuery}`;
    const requestDoc = await fetchDocument(requestDocUrl, privilegedToken, "join request");
    if (!requestDoc) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }
    const requestFields = requestDoc.fields || {};
    const requestTeamId = readStringValue(requestFields.teamId);
    const requestStatus = readStringValue(requestFields.status);
    const targetUserId = readStringValue(requestFields.userId);

    if (!targetUserId) {
      return NextResponse.json({ error: "Request is missing userId." }, { status: 400 });
    }
    if (requestStatus && requestStatus !== "pending") {
      return NextResponse.json({ error: `Request is already ${requestStatus}.` }, { status: 409 });
    }
    if (!callerTeamId || !requestTeamId || callerTeamId !== requestTeamId) {
      return NextResponse.json({ error: "You can only approve requests for your own team." }, { status: 403 });
    }

    const requestedRole =
      readStringValue(requestFields.requestedRole) ||
      readStringValue(requestFields.userRole) ||
      readStringValue(requestFields.role) ||
      "match-scout";

    const targetUserDocUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/users/${encodeURIComponent(targetUserId)}${keyQuery}`;
    let targetDisplayName = "";
    let targetEmail = "";
    try {
      const targetUserDoc = await fetchDocument(targetUserDocUrl, privilegedToken, "target user");
      const targetFields = targetUserDoc?.fields || {};
      targetDisplayName = readStringValue(targetFields.displayName);
      targetEmail = readStringValue(targetFields.email);
    } catch {
      // Best-effort only. Missing/inaccessible user doc should not block approval.
    }

    const userUpdateUrl = `${targetUserDocUrl}${targetUserDocUrl.includes("?") ? "&" : "?"}updateMask.fieldPaths=teamId&updateMask.fieldPaths=role&updateMask.fieldPaths=roles&updateMask.fieldPaths=specialRole&updateMask.fieldPaths=specialRoles`;
    const userUpdateResponse = await fetch(userUpdateUrl, {
      method: "PATCH",
      headers: {
        ...authHeaders(privilegedToken),
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({
        fields: {
          teamId: { stringValue: requestTeamId },
          role: { stringValue: requestedRole },
          roles: { arrayValue: { values: [{ stringValue: requestedRole }] } },
          specialRole: { nullValue: null },
          specialRoles: { arrayValue: {} },
        },
      }),
    });
    if (!userUpdateResponse.ok) {
      const details = await readResponseError(userUpdateResponse);
      const message = details || "Unable to update user for approval.";
      const status = userUpdateResponse.status === 403 ? 403 : 500;
      return NextResponse.json({ error: message }, { status });
    }

    const existingName = readStringValue(requestFields.userName);
    const existingEmail = readStringValue(requestFields.userEmail);
    const hydratedEmail = existingEmail || targetEmail;
    const hydratedName =
      (existingName && !existingName.startsWith("User ") ? existingName : targetDisplayName) ||
      buildNameFromEmail(hydratedEmail) ||
      existingName ||
      `User ${targetUserId.slice(0, 8)}`;

    const requestUpdateUrl = `${requestDocUrl}${requestDocUrl.includes("?") ? "&" : "?"}updateMask.fieldPaths=status&updateMask.fieldPaths=processedAt&updateMask.fieldPaths=processedBy&updateMask.fieldPaths=userName&updateMask.fieldPaths=userEmail`;
    const requestUpdateResponse = await fetch(requestUpdateUrl, {
      method: "PATCH",
      headers: {
        ...authHeaders(privilegedToken),
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({
        fields: {
          status: { stringValue: "approved" },
          processedAt: { integerValue: String(Date.now()) },
          processedBy: { stringValue: callerUid },
          userName: { stringValue: hydratedName },
          userEmail: { stringValue: hydratedEmail },
        },
      }),
    });
    if (!requestUpdateResponse.ok) {
      const details = await readResponseError(requestUpdateResponse);
      const message = details || "Unable to mark request approved.";
      const status = requestUpdateResponse.status === 403 ? 403 : 500;
      return NextResponse.json({ error: message }, { status });
    }

    return NextResponse.json({
      ok: true,
      approvedUserId: targetUserId,
      userName: hydratedName,
      userEmail: hydratedEmail,
    });
  } catch (error) {
    console.error("Approve join request failed:", error);
    const message = error instanceof Error && error.message ? error.message : "Unable to approve request right now.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
