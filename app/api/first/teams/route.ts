import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function resolveFirstCredentials() {
  const username = (process.env.FIRST_API_USERNAME || process.env.FIRST_API_USER || "").trim();
  const token = (process.env.FIRST_API_TOKEN || process.env.FIRST_API_AUTH_TOKEN || "").trim();
  return { username, token };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const year = Number(body?.year);
    const eventCode = String(body?.eventCode || "").trim().toUpperCase();
    if (!Number.isFinite(year) || !eventCode) {
      return NextResponse.json({ error: "Missing year or eventCode" }, { status: 400 });
    }

    const { username, token } = resolveFirstCredentials();
    if (!username || !token) {
      return NextResponse.json({ error: "Missing FIRST API credentials" }, { status: 500 });
    }

    const basicAuth = Buffer.from(`${username}:${token}`).toString("base64");
    const response = await fetch(
      `https://frc-api.firstinspires.org/v3.0/${year}/teams?eventCode=${encodeURIComponent(eventCode)}`,
      {
        headers: { Authorization: `Basic ${basicAuth}` },
        cache: "no-store",
      }
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: `FIRST request failed (${response.status})` },
        { status: response.status }
      );
    }

    const payload = (await response.json()) as { teams?: Array<Record<string, unknown>> };
    const teams = Array.isArray(payload.teams)
      ? payload.teams.map((team) => ({
          teamNumber: Number(team.teamNumber || 0),
          nameShort: String(team.nameShort || team.name || "Unknown Team"),
        }))
      : [];

    return NextResponse.json({ teams });
  } catch (error) {
    console.error("Failed to fetch FIRST teams:", error);
    return NextResponse.json({ error: "Unable to fetch teams" }, { status: 500 });
  }
}
