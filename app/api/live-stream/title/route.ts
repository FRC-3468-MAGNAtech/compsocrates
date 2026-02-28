import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function isLikelyYoutubeUrl(input: string): boolean {
  const value = String(input || "").toLowerCase();
  return value.includes("youtube.com/") || value.includes("youtu.be/");
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { url?: string };
    const rawUrl = String(body?.url || "").trim();
    if (!rawUrl) {
      return NextResponse.json({ error: "Missing url" }, { status: 400 });
    }
    if (!isLikelyYoutubeUrl(rawUrl)) {
      return NextResponse.json({ title: "", source: "unsupported" });
    }

    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(rawUrl)}&format=json`;
    const response = await fetch(oembedUrl, { cache: "no-store" });
    if (!response.ok) {
      return NextResponse.json({ title: "", source: "youtube_oembed_unavailable" });
    }
    const payload = (await response.json()) as { title?: string };
    return NextResponse.json({ title: String(payload.title || "").trim(), source: "youtube_oembed" });
  } catch (error) {
    console.error("Failed to resolve stream title:", error);
    return NextResponse.json({ title: "", source: "error" });
  }
}

