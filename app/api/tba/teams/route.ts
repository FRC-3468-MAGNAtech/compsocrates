import { NextRequest, NextResponse } from "next/server";
import { decryptTbaKey } from "@/app/api/tba/_crypto";
import { normalizeEventKey } from "@/app/utils/events";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const rawEventKey = String(body?.eventKey || "").trim().toLowerCase();
    const eventKey = normalizeEventKey(rawEventKey);
    const encryptedKey = typeof body?.encryptedKey === "string" ? body.encryptedKey : "";
    const plainKey = typeof body?.plainKey === "string" ? body.plainKey.trim() : "";
    if (!eventKey || (!encryptedKey && !plainKey)) {
      return NextResponse.json({ error: "Missing event key or API key" }, { status: 400 });
    }
    if (!/^\d{4}[a-z0-9]+$/.test(eventKey)) {
      return NextResponse.json({ error: "Invalid event key" }, { status: 400 });
    }

    const key = encryptedKey ? decryptTbaKey(encryptedKey) : plainKey;
    const response = await fetch(`https://www.thebluealliance.com/api/v3/event/${eventKey}/teams/simple`, {
      headers: { "X-TBA-Auth-Key": key },
      cache: "no-store",
    });
    if (!response.ok) {
      return NextResponse.json({ error: `TBA request failed (${response.status})` }, { status: response.status });
    }

    const payload = (await response.json()) as Array<{ team_number?: number; nickname?: string }>;
    const teams = Array.isArray(payload)
      ? payload.map((row) => ({
          teamNumber: Number(row.team_number || 0),
          nameShort: String(row.nickname || `Team ${row.team_number || ""}`),
        }))
      : [];
    return NextResponse.json({ teams });
  } catch (error) {
    console.error("Failed to fetch TBA teams:", error);
    return NextResponse.json({ error: "Unable to fetch teams" }, { status: 500 });
  }
}
