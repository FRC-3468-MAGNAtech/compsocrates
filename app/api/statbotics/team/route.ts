import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const teamNumber = Number(searchParams.get("teamNumber") || 0);
    const year = Number(searchParams.get("year") || 0);
    const eventKey = String(searchParams.get("eventKey") || "").trim();

    if (!Number.isFinite(teamNumber) || teamNumber <= 0 || !Number.isFinite(year) || year < 1992) {
      return NextResponse.json({ error: "Missing or invalid teamNumber/year" }, { status: 400 });
    }

    const [yearResponse, eventResponse] = await Promise.all([
      fetch(`https://api.statbotics.io/v3/team_year/${teamNumber}/${year}`, { cache: "no-store" }),
      eventKey
        ? fetch(`https://api.statbotics.io/v3/team_event/${teamNumber}/${encodeURIComponent(eventKey)}`, { cache: "no-store" })
        : Promise.resolve(null),
    ]);

    const teamYear = yearResponse.ok ? await yearResponse.json() : null;
    const teamEvent = eventResponse && eventResponse.ok ? await eventResponse.json() : null;

    if (!teamYear) {
      return NextResponse.json({
        teamYear: null,
        teamEvent,
        unavailable: true,
        upstreamStatus: yearResponse.status,
      });
    }

    return NextResponse.json({ teamYear, teamEvent, unavailable: false });
  } catch (error) {
    console.error("Failed to fetch Statbotics data:", error);
    return NextResponse.json({ error: "Unable to fetch Statbotics data" }, { status: 500 });
  }
}
