import { NextResponse } from "next/server";

/**
 * Retired (memberships build 3): a team is created only from an approved application (`/api/applications`, approved by the platform owner in the Admin Panel),
 * in BOTH programs. This route answers 410 Gone for every caller and writes nothing.
 */
export async function POST(request: Request) {
  void request;
  return NextResponse.json({ ok: false, code: "gone", error: "Teams are created from applications now. Apply for a team instead." }, { status: 410 });
}
