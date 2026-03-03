import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
const LIVE_LOBBY_COLLECTION = "practiceSessions";
const LIVE_LOBBY_RECORD_TYPE = "live_lobby";

type LobbyPlayer = { name?: string; joinedAt?: number };
type LobbyPlayers = Record<string, LobbyPlayer>;

type LobbyPayload = {
  id: string;
  code: string;
  hostId: string;
  hostName: string;
  teamId: string;
  game: "REEFSCAPE" | "REBUILT";
  mode: "trial" | "competitive";
  status: "waiting" | "in_progress" | "completed" | "closed";
  createdAt: number;
  startedAt?: number;
  playersByUid: LobbyPlayers;
  revealUntil?: number;
  matchJson?: string;
  assignmentsJson?: string;
  submissionsJson?: string;
};

type FirestoreValue =
  | { stringValue?: string }
  | { integerValue?: string }
  | { mapValue?: { fields?: Record<string, FirestoreValue> } };

function readStringValue(value: FirestoreValue | undefined) {
  if (!value || typeof value !== "object") return "";
  if ("stringValue" in value && typeof value.stringValue === "string") return value.stringValue;
  if ("integerValue" in value && typeof value.integerValue === "string") return value.integerValue;
  return "";
}

function readNumberValue(value: FirestoreValue | undefined) {
  const parsed = Number(readStringValue(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function encodeFields(values: Record<string, unknown>) {
  const fields: Record<string, FirestoreValue> = {};
  Object.entries(values).forEach(([key, value]) => {
    if (typeof value === "number") {
      fields[key] = { integerValue: String(Math.round(value)) };
      return;
    }
    fields[key] = { stringValue: String(value ?? "") };
  });
  return fields;
}

async function fetchIdToken() {
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

function readBearerToken(request: NextRequest) {
  const raw = String(request.headers.get("authorization") || "");
  if (!raw.toLowerCase().startsWith("bearer ")) return "";
  return raw.slice(7).trim();
}

function headersFor(idToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${idToken}`,
    "Content-Type": "application/json",
  };
}

function toDocId(pathOrName: string) {
  const trimmed = String(pathOrName || "").trim();
  if (!trimmed) return "";
  const parts = trimmed.split("/");
  return parts[parts.length - 1] || "";
}

function parseLobbyFromDocument(document: { name?: string; fields?: Record<string, FirestoreValue> }): LobbyPayload {
  const fields = document.fields || {};
  const recordType = readStringValue(fields.recordType);
  if (recordType && recordType !== LIVE_LOBBY_RECORD_TYPE) {
    throw new Error("Document is not a live lobby record");
  }
  const playersRaw = readStringValue(fields.playersJson);
  let playersByUid: LobbyPlayers = {};
  try {
    const parsed = JSON.parse(playersRaw || "{}") as LobbyPlayers;
    if (parsed && typeof parsed === "object") playersByUid = parsed;
  } catch {
    playersByUid = {};
  }
  return {
    id: toDocId(document.name || ""),
    code: readStringValue(fields.code),
    hostId: readStringValue(fields.hostId),
    hostName: readStringValue(fields.hostName),
    teamId: readStringValue(fields.teamId),
    game: readStringValue(fields.game) === "REBUILT" ? "REBUILT" : "REEFSCAPE",
    mode: readStringValue(fields.mode) === "competitive" ? "competitive" : "trial",
    status: (["waiting", "in_progress", "completed", "closed"].includes(readStringValue(fields.status))
      ? readStringValue(fields.status)
      : "waiting") as LobbyPayload["status"],
    createdAt: readNumberValue(fields.createdAt),
    startedAt: readNumberValue(fields.startedAt) || undefined,
    revealUntil: readNumberValue(fields.revealUntil) || undefined,
    playersByUid,
    matchJson: readStringValue(fields.matchJson),
    assignmentsJson: readStringValue(fields.assignmentsJson),
    submissionsJson: readStringValue(fields.submissionsJson),
  };
}

async function queryLobbyByCode(projectId: string, apiKey: string, idToken: string, code: string) {
  const normalizedCode = String(code || "").trim().toUpperCase();
  if (!normalizedCode) return null;
  const docId = `liveLobby_${normalizedCode}`;
  const keyQuery = apiKey ? `?key=${encodeURIComponent(apiKey)}` : "";
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${LIVE_LOBBY_COLLECTION}/${encodeURIComponent(docId)}${keyQuery}`;
  const response = await fetch(url, {
    method: "GET",
    headers: headersFor(idToken),
    cache: "no-store",
  });
  if (response.status === 404) return null;
  if (!response.ok) return null;
  const payload = (await response.json()) as { name?: string; fields?: Record<string, FirestoreValue> };
  const lobby = parseLobbyFromDocument(payload);
  if (lobby.code !== normalizedCode) return null;
  if (readStringValue(payload.fields?.recordType) !== LIVE_LOBBY_RECORD_TYPE) return null;
  return lobby;
}

async function patchLobby(
  projectId: string,
  apiKey: string,
  idToken: string,
  lobbyId: string,
  fields: Record<string, unknown>
) {
  const keyQuery = apiKey ? `&key=${encodeURIComponent(apiKey)}` : "";
  const masks = Object.keys(fields)
    .map((field) => `updateMask.fieldPaths=${encodeURIComponent(field)}`)
    .join("&");
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${LIVE_LOBBY_COLLECTION}/${encodeURIComponent(lobbyId)}?${masks}${keyQuery ? `&${keyQuery.slice(1)}` : ""}`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: headersFor(idToken),
    cache: "no-store",
    body: JSON.stringify({ fields: encodeFields(fields) }),
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as { name?: string; fields?: Record<string, FirestoreValue> };
  return parseLobbyFromDocument(payload);
}

export async function GET(request: NextRequest) {
  try {
    const code = String(request.nextUrl.searchParams.get("code") || "").trim().toUpperCase();
    if (!code) return NextResponse.json({ error: "Missing code" }, { status: 400 });

    const projectId = String(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "").trim();
    const apiKey = String(process.env.NEXT_PUBLIC_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || "").trim();
    const serverToken = await fetchIdToken();
    const callerToken = readBearerToken(request);
    const idToken = serverToken || callerToken;
    if (!projectId || !idToken) return NextResponse.json({ error: "Missing Firebase server credentials" }, { status: 500 });

    const lobby = await queryLobbyByCode(projectId, apiKey, idToken, code);
    if (!lobby) return NextResponse.json({ error: "Lobby not found" }, { status: 404 });
    return NextResponse.json({ lobby });
  } catch (error) {
    console.error("Failed reading live lobby:", error);
    return NextResponse.json({ error: "Unable to read lobby" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action || "").trim().toLowerCase();
    const projectId = String(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "").trim();
    const apiKey = String(process.env.NEXT_PUBLIC_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || "").trim();
    const serverToken = await fetchIdToken();
    const callerToken = readBearerToken(request);
    const idToken = serverToken || callerToken;
    if (!projectId || !idToken) return NextResponse.json({ error: "Missing Firebase server credentials" }, { status: 500 });

    if (action === "create") {
      const code = String(body.code || "").trim().toUpperCase();
      const hostId = String(body.hostId || "").trim();
      const hostName = String(body.hostName || "Host").trim();
      const teamId = String(body.teamId || "").trim();
      const game = String(body.game || "REEFSCAPE").toUpperCase() === "REBUILT" ? "REBUILT" : "REEFSCAPE";
      const mode = String(body.mode || "trial") === "competitive" ? "competitive" : "trial";
      if (!code || !hostId || !teamId) return NextResponse.json({ error: "Missing create fields" }, { status: 400 });
      const existing = await queryLobbyByCode(projectId, apiKey, idToken, code);
      if (existing && (existing.status === "waiting" || existing.status === "in_progress")) {
        return NextResponse.json({ error: "Lobby code already active" }, { status: 409 });
      }
      const playersByUid: LobbyPlayers = { [hostId]: { name: hostName, joinedAt: Date.now() } };
      const createdAt = Date.now();
      const docId = `liveLobby_${code}`;
      const keyQuery = apiKey ? `&key=${encodeURIComponent(apiKey)}` : "";
      const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${LIVE_LOBBY_COLLECTION}?documentId=${encodeURIComponent(docId)}${keyQuery}`;
      const response = await fetch(url, {
        method: "POST",
        headers: headersFor(idToken),
        cache: "no-store",
        body: JSON.stringify({
          fields: encodeFields({
            recordType: LIVE_LOBBY_RECORD_TYPE,
            code,
            hostId,
            hostName,
            teamId,
            game,
            mode,
            status: "waiting",
            createdAt,
            playersJson: JSON.stringify(playersByUid),
          }),
        }),
      });
      if (!response.ok) {
        const details = await response.text();
        return NextResponse.json({ error: `Create failed (${response.status})`, details }, { status: 500 });
      }
      const payload = (await response.json()) as { name?: string; fields?: Record<string, FirestoreValue> };
      return NextResponse.json({ lobby: parseLobbyFromDocument(payload) });
    }

    if (action === "join") {
      const code = String(body.code || "").trim().toUpperCase();
      const uid = String(body.uid || "").trim();
      const name = String(body.name || "Player").trim();
      const joinerTeamId = String(body.teamId || "").trim();
      if (!code || !uid) return NextResponse.json({ error: "Missing join fields" }, { status: 400 });
      const lobby = await queryLobbyByCode(projectId, apiKey, idToken, code);
      if (!lobby) return NextResponse.json({ error: "Lobby not found" }, { status: 404 });
      if (lobby.status !== "waiting") {
        return NextResponse.json({ error: "Lobby already started or closed" }, { status: 400 });
      }
      if (lobby.teamId && joinerTeamId && lobby.teamId !== joinerTeamId) {
        return NextResponse.json({ error: "Lobby belongs to another team" }, { status: 403 });
      }
      const players = { ...(lobby.playersByUid || {}) };
      players[uid] = { name, joinedAt: Date.now() };
      const updated = await patchLobby(projectId, apiKey, idToken, lobby.id, {
        playersJson: JSON.stringify(players),
        updatedAt: Date.now(),
      });
      if (!updated) return NextResponse.json({ error: "Join patch failed" }, { status: 500 });
      return NextResponse.json({ lobby: updated });
    }

    if (action === "start") {
      const code = String(body.code || "").trim().toUpperCase();
      const uid = String(body.uid || "").trim();
      const matchJson = String(body.matchJson || "").trim();
      const assignmentsJson = String(body.assignmentsJson || "").trim();
      if (!code || !uid) return NextResponse.json({ error: "Missing start fields" }, { status: 400 });
      const lobby = await queryLobbyByCode(projectId, apiKey, idToken, code);
      if (!lobby) return NextResponse.json({ error: "Lobby not found" }, { status: 404 });
      if (lobby.hostId !== uid) return NextResponse.json({ error: "Only host can start" }, { status: 403 });
      const count = Object.keys(lobby.playersByUid || {}).length;
      if (count === 0 || count % 3 !== 0) return NextResponse.json({ error: "Player count must be a multiple of 3" }, { status: 400 });
      if (!matchJson || !assignmentsJson) return NextResponse.json({ error: "Missing match assignments" }, { status: 400 });
      let parsedAssignments: Record<string, unknown> = {};
      try {
        parsedAssignments = JSON.parse(assignmentsJson) as Record<string, unknown>;
      } catch {
        return NextResponse.json({ error: "Invalid assignments payload" }, { status: 400 });
      }
      const assignedCount = Object.keys(parsedAssignments || {}).length;
      if (assignedCount < count) return NextResponse.json({ error: "All players must have assignments" }, { status: 400 });
      const now = Date.now();
      const updated = await patchLobby(projectId, apiKey, idToken, lobby.id, {
        status: "in_progress",
        startedAt: now,
        revealUntil: now + 12000,
        matchJson,
        assignmentsJson,
        submissionsJson: "{}",
        updatedAt: now,
      });
      if (!updated) return NextResponse.json({ error: "Start patch failed" }, { status: 500 });
      return NextResponse.json({ lobby: updated });
    }

    if (action === "submit") {
      const code = String(body.code || "").trim().toUpperCase();
      const uid = String(body.uid || "").trim();
      const submissionJson = String(body.submissionJson || "").trim();
      if (!code || !uid || !submissionJson) return NextResponse.json({ error: "Missing submit fields" }, { status: 400 });
      const lobby = await queryLobbyByCode(projectId, apiKey, idToken, code);
      if (!lobby) return NextResponse.json({ error: "Lobby not found" }, { status: 404 });
      if (lobby.status !== "in_progress") return NextResponse.json({ error: "Lobby is not in progress" }, { status: 400 });
      const players = lobby.playersByUid || {};
      if (!players[uid]) return NextResponse.json({ error: "Only active players can submit" }, { status: 403 });
      let existing: Record<string, unknown> = {};
      try {
        existing = JSON.parse(lobby.submissionsJson || "{}") as Record<string, unknown>;
      } catch {
        existing = {};
      }
      let parsedSubmission: Record<string, unknown> = {};
      try {
        parsedSubmission = JSON.parse(submissionJson) as Record<string, unknown>;
      } catch {
        return NextResponse.json({ error: "Invalid submission payload" }, { status: 400 });
      }
      existing[uid] = {
        ...parsedSubmission,
        submittedAt: Date.now(),
      };
      const playerCount = Object.keys(players).length;
      const submittedCount = Object.keys(existing).length;
      const shouldComplete = submittedCount >= playerCount;
      const updated = await patchLobby(projectId, apiKey, idToken, lobby.id, {
        submissionsJson: JSON.stringify(existing),
        status: shouldComplete ? "completed" : "in_progress",
        completedAt: shouldComplete ? Date.now() : 0,
        updatedAt: Date.now(),
      });
      if (!updated) return NextResponse.json({ error: "Submit patch failed" }, { status: 500 });
      return NextResponse.json({ lobby: updated });
    }

    if (action === "leave") {
      const code = String(body.code || "").trim().toUpperCase();
      const uid = String(body.uid || "").trim();
      if (!code || !uid) return NextResponse.json({ error: "Missing leave fields" }, { status: 400 });
      const lobby = await queryLobbyByCode(projectId, apiKey, idToken, code);
      if (!lobby) return NextResponse.json({ error: "Lobby not found" }, { status: 404 });
      if (lobby.hostId === uid) {
        const updated = await patchLobby(projectId, apiKey, idToken, lobby.id, { status: "closed", updatedAt: Date.now() });
        if (!updated) return NextResponse.json({ error: "Close patch failed" }, { status: 500 });
        return NextResponse.json({ lobby: updated });
      }
      const players = { ...(lobby.playersByUid || {}) };
      delete players[uid];
      const updated = await patchLobby(projectId, apiKey, idToken, lobby.id, {
        playersJson: JSON.stringify(players),
        updatedAt: Date.now(),
      });
      if (!updated) return NextResponse.json({ error: "Leave patch failed" }, { status: 500 });
      return NextResponse.json({ lobby: updated });
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (error) {
    console.error("Live lobby mutation failed:", error);
    return NextResponse.json({ error: "Unable to process lobby action" }, { status: 500 });
  }
}
