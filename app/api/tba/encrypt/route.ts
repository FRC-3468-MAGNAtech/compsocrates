import { NextRequest, NextResponse } from "next/server";
import { encryptTbaKey } from "@/app/api/tba/_crypto";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const key = typeof body?.key === "string" ? body.key.trim() : "";
    if (!key) {
      return NextResponse.json({ error: "Missing key" }, { status: 400 });
    }

    const encryptedKey = encryptTbaKey(key);
    return NextResponse.json({ encryptedKey });
  } catch (error) {
    console.error("Failed to encrypt TBA key:", error);
    return NextResponse.json({ error: "Unable to encrypt key" }, { status: 500 });
  }
}
