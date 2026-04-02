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
    const fallbackKey = String(process.env.NEXT_PUBLIC_TBA_API_KEY || process.env.TBA_API_KEY || "").trim();
    if (!eventKey || (!encryptedKey && !plainKey && !fallbackKey)) {
      return NextResponse.json({ error: "Missing event key or API key" }, { status: 400 });
    }
    if (!/^\d{4}[a-z0-9]+$/.test(eventKey)) {
      return NextResponse.json({ error: "Invalid event key" }, { status: 400 });
    }

    const key = encryptedKey ? decryptTbaKey(encryptedKey) : plainKey || fallbackKey;
    const tbaResponse = await fetch(`https://www.thebluealliance.com/api/v3/event/${eventKey}/matches`, {
      headers: {
        "X-TBA-Auth-Key": key,
      },
      cache: "no-store",
    });
    if (!tbaResponse.ok) {
      return NextResponse.json({ error: `TBA request failed (${tbaResponse.status})` }, { status: tbaResponse.status });
    }

    const matches = await tbaResponse.json();
    return NextResponse.json({ matches });
  } catch (error) {
    console.error("Failed to fetch TBA matches:", error);
    return NextResponse.json({ error: "Unable to fetch matches" }, { status: 500 });
  }
}

