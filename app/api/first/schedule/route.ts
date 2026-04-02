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
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    let year = Number(body?.year);
    let eventCode = String(body?.eventCode || "").trim().toUpperCase();
    const tournamentLevel = String(body?.tournamentLevel || "").trim();
    if (!Number.isFinite(year) || !eventCode) {
      const eventKey = String(body?.eventKey || body?.key || "").trim();
      if (eventKey) {
        const derivedYear = Number(eventKey.slice(0, 4));
        if (Number.isFinite(derivedYear)) year = derivedYear;
        if (!eventCode) {
          eventCode = eventKey.slice(4).toUpperCase() || eventKey.toUpperCase();
        }
      }
    }
    if (!Number.isFinite(year) || !eventCode) {
      return NextResponse.json({ error: "Missing year or eventCode", received: body }, { status: 400 });
    }

    const { username, token } = resolveFirstCredentials();
    if (!username || !token) {
      return NextResponse.json({ error: "Missing FIRST API credentials", code: "missing_credentials" }, { status: 500 });
    }

    const basicAuth = Buffer.from(`${username}:${token}`).toString("base64");
    const url = new URL(`https://frc-api.firstinspires.org/v3.0/${year}/schedule/${encodeURIComponent(eventCode)}`);
    if (tournamentLevel) {
      url.searchParams.set("tournamentLevel", tournamentLevel);
    }

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Basic ${basicAuth}` },
      cache: "no-store",
    });

    if (!response.ok) {
      const details = await response.text();
      return NextResponse.json(
        { error: `FIRST schedule request failed (${response.status})`, details },
        { status: response.status }
      );
    }

    const payload = await response.json();
    const schedule =
      (payload && Array.isArray(payload.Schedule) && payload.Schedule) ||
      (payload && Array.isArray(payload.schedule) && payload.schedule) ||
      (payload && Array.isArray(payload.matches) && payload.matches) ||
      [];

    return NextResponse.json({ schedule });
  } catch (error) {
    console.error("Failed to fetch FIRST schedule:", error);
    return NextResponse.json({ error: "Unable to fetch schedule" }, { status: 500 });
  }
}
