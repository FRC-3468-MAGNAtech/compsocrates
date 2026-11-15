import { NextResponse } from "next/server";
import { firebaseAdminProblem, getAdminFirestore, getAdminMessaging } from "@/lib/firebase/admin";
import { checkSession } from "@/lib/server/require-user";
import { liveDataWarnings } from "@/lib/server/live-env";
import { liveProgramStore, programFromBody } from "@/lib/server/live-program";
import { resolvePendingLiveMatches } from "@/lib/live/resolve-pending";
import { LIVE_CONFIG } from "@/lib/live/config";

/**
 * P7: the client-side fallback — while a scout has a pending live session,
 * the app calls this every minute (see lib/live/config.ts's
 * CLIENT_SCORE_POLL_INTERVAL_MS) so score-ready notifications still work
 * even if the external scheduler for app/api/cron/poll-live-scores isn't
 * set up. Scoped to the caller's own sessions only — the cron route is
 * what sweeps every team's pending matches.
 *
 * Rate-limited server-side (in addition to the client's own interval) so a
 * stray fast poller can't hammer the event-data APIs — best-effort, in-memory
 * per-uid timestamps. Vercel serverless instances are ephemeral and can
 * run several in parallel, so this isn't a hard guarantee across
 * instances, only a cheap backstop on top of the client's own pacing.
 */
const lastCallByUid = new Map<string, number>();
const MIN_INTERVAL_MS = LIVE_CONFIG.CLIENT_SCORE_POLL_INTERVAL_MS / 2;

export async function POST(request: Request) {
  const session = await checkSession();
  if (!session.ok) {
    return NextResponse.json({ ok: false, error: session.message }, { status: session.reason === "not-configured" ? 503 : 401 });
  }
  const user = { uid: session.uid };
  // The program comes from the body and is REQUIRED (missing, unknown or unsupported is a 400); there is no default.
  const body = (await request.json().catch(() => null)) as { program?: unknown } | null;
  const parsed = programFromBody(body?.program, "live");
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error, code: parsed.code }, { status: 400 });
  const program = parsed.program;

  // Per program: the same person polling for both programs is two separate callers.
  const callKey = `${program}:${user.uid}`;
  const lastCall = lastCallByUid.get(callKey);
  if (lastCall && Date.now() - lastCall < MIN_INTERVAL_MS) {
    return NextResponse.json({ ok: true, checked: 0, resolved: 0, rateLimited: true });
  }
  lastCallByUid.set(callKey, Date.now());

  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ ok: false, error: firebaseAdminProblem() ?? "Server isn't configured." }, { status: 503 });
  const messaging = getAdminMessaging();

  try {
    // The caller must have a team in THAT program (its own users collection): a person of the other program has no account here and is refused.
    const userSnap = await db.collection(liveProgramStore(program).paths.users).doc(user.uid).get();
    if (!userSnap.exists || !userSnap.data()?.teamId) return NextResponse.json({ ok: false, error: "No team in this program." }, { status: 403 });
    // Only the caller's own sessions, in the one program asked for (the session query is `uid ==`).
    const result = await resolvePendingLiveMatches(db, messaging, user.uid, program);
    const warnings = liveDataWarnings(program);
    return NextResponse.json({ ok: true, ...result, ...(warnings.length > 0 ? { warnings } : {}) });
  } catch (err) {
    console.error("check-scores failed:", err);
    return NextResponse.json({ ok: false, error: "Internal error." }, { status: 500 });
  }
}
