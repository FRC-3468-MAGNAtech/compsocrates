import { parseFlushBody } from "@/lib/read-meter/model";
import { applyClientFlush } from "@/lib/server/read-meter";
import { fail, withViewer } from "@/lib/server/platform-route";
import { readJsonBody } from "@/lib/server/route-helpers";
import { getReadMeterEnabled } from "@/lib/server/team-settings";

/**
 * The read meter's flush: a signed-in browser sends the document counts it has kept in memory (at most every 10 minutes and when the page is hidden). Admin SDK only,
 * no client rule. While `appSettings/global.readMeterEnabled` is missing or false it answers `{ ok: true, ignored: true }` and writes NOTHING. The answer to that
 * question comes from the shared cached appSettings snapshot, and a browser only calls this after learning the switch is ON from the public config.
 */
const lastCall = new Map<string, number>();
const MIN_GAP_MS = 20_000;

export async function POST(request: Request) {
  return withViewer(request, async (db, viewer) => {
    if (!(await getReadMeterEnabled(db))) return { status: 200, body: { ok: true, ignored: true } };
    const now = Date.now();
    if (now - (lastCall.get(viewer.uid) ?? 0) < MIN_GAP_MS) return { status: 200, body: { ok: true, ignored: true, reason: "too_soon" } };
    const parsed = parseFlushBody(await readJsonBody(request));
    if (!parsed.ok) return fail(400, "invalid_input", "Bad meter counts.");
    lastCall.set(viewer.uid, now);
    if (lastCall.size > 2_000) lastCall.clear();
    const { docs } = await applyClientFlush(db, parsed.counts);
    return { status: 200, body: { ok: true, docs } };
  });
}
