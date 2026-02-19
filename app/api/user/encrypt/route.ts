import { NextRequest, NextResponse } from "next/server";
import { encryptUserData } from "@/app/api/user/_crypto";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const data = body?.data;
    if (!data || typeof data !== "object") {
      return NextResponse.json({ error: "Missing data" }, { status: 400 });
    }

    const encryptedUserData = encryptUserData(JSON.stringify(data));
    return NextResponse.json({ encryptedUserData });
  } catch (error) {
    console.error("Failed to encrypt user data:", error);
    return NextResponse.json({ error: "Unable to encrypt user data" }, { status: 500 });
  }
}
