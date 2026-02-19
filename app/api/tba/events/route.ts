import { NextRequest, NextResponse } from "next/server";
import { decryptTbaKey } from "@/app/api/tba/_crypto";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const year = Number(body?.year);
    const encryptedKey = typeof body?.encryptedKey === "string" ? body.encryptedKey : "";
    if (!Number.isFinite(year) || !encryptedKey) {
      return NextResponse.json({ error: "Missing year or encrypted key" }, { status: 400 });
    }

    const key = decryptTbaKey(encryptedKey);
    const tbaResponse = await fetch(`https://www.thebluealliance.com/api/v3/events/${year}`, {
      headers: {
        "X-TBA-Auth-Key": key,
      },
      cache: "no-store",
    });

    if (!tbaResponse.ok) {
      return NextResponse.json(
        { error: `TBA request failed (${tbaResponse.status})` },
        { status: tbaResponse.status }
      );
    }

    const events = await tbaResponse.json();
    return NextResponse.json({ events });
  } catch (error) {
    console.error("Failed to fetch TBA events:", error);
    return NextResponse.json({ error: "Unable to fetch events" }, { status: 500 });
  }
}
