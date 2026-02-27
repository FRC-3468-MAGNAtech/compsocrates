import { NextRequest, NextResponse } from "next/server";

function parseAllowlist(value: string | undefined): Set<string> {
  if (!value) return new Set<string>();
  return new Set(
    value
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  );
}

function hasReleaseOwnerAccess(uid: string, email: string): boolean {
  const uids = parseAllowlist(process.env.RELEASE_OWNER_UIDS);
  const emails = parseAllowlist(process.env.RELEASE_OWNER_EMAILS);
  const normalizedUid = uid.trim().toLowerCase();
  const normalizedEmail = email.trim().toLowerCase();
  if (normalizedUid && uids.has(normalizedUid)) return true;
  if (normalizedEmail && emails.has(normalizedEmail)) return true;
  return false;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { uid?: string; email?: string };
    const uid = String(body?.uid || "");
    const email = String(body?.email || "");
    return NextResponse.json({ allowed: hasReleaseOwnerAccess(uid, email) });
  } catch (error) {
    console.error("Failed to resolve owner access:", error);
    return NextResponse.json({ allowed: false }, { status: 500 });
  }
}
