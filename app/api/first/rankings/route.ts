import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function resolveFirstCredentials() {
  const username = (
    process.env.FIRST_API_USERNAME ||
    process.env.FIRST_API_USER ||
    process.env.FIRST_USERNAME ||
    process.env.NEXT_PUBLIC_FIRST_API_USERNAME ||
    ""
  ).trim();
  const token = (
    process.env.FIRST_API_TOKEN ||
    process.env.FIRST_API_AUTH_TOKEN ||
    process.env.FIRST_API_KEY ||
    process.env.FIRST_AUTH_TOKEN ||
    process.env.FIRST_API_PASSWORD ||
    process.env.NEXT_PUBLIC_FIRST_API_TOKEN ||
    ""
  ).trim();
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
      return NextResponse.json({ error: "Missing FIRST API credentials", code: "missing_credentials" }, { status: 500 });
    }

    const basicAuth = Buffer.from(`${username}:${token}`).toString("base64");
    const url = new URL(`https://frc-api.firstinspires.org/v3.0/${year}/rankings/${encodeURIComponent(eventCode)}`);

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Basic ${basicAuth}` },
      cache: "no-store",
    });

    if (!response.ok) {
      const details = await response.text();
      return NextResponse.json(
        { error: `FIRST rankings request failed (${response.status})`, details },
        { status: response.status }
      );
    }

    const payload = await response.json();
    const rankings =
      (payload && Array.isArray(payload.Rankings) && payload.Rankings) ||
      (payload && Array.isArray(payload.rankings) && payload.rankings) ||
      [];

    return NextResponse.json({ rankings });
  } catch (error) {
    console.error("Failed to fetch FIRST rankings:", error);
    return NextResponse.json({ error: "Unable to fetch rankings" }, { status: 500 });
  }
}
