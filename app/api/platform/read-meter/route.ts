import { readUsageDays } from "@/lib/server/read-meter";
import { withOwner } from "@/lib/server/platform-route";
import { getReadMeterEnabled } from "@/lib/server/team-settings";

/**
 * The Read usage tab's data: today and the last 14 days of `readMeter/{day}` (15 documents, so at most 15 reads, plus the shared cached settings read). The platform
 * owner only: `withOwner` verifies the token's platform-owner claim on the server. `enabled` says whether the meter is ON.
 */
export async function GET(request: Request) {
  return withOwner(request, {}, async (db) => {
    const [enabled, days] = await Promise.all([getReadMeterEnabled(db), readUsageDays(db)]);
    return { status: 200, body: { ok: true, enabled, days }, headers: { "Cache-Control": "private, no-store" } };
  });
}
